import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizeTransaction } from "@/lib/categorize";
import { matchInternalTransfers } from "@/lib/matchInternalTransfers";
import { recordDailySnapshotIfNeeded } from "@/lib/balanceSnapshots";
import type { Database } from "@/lib/supabase/types";
import {
  ENABLE_BANKING_PROVIDERS,
  EnableBankingAuthError,
  getAccountBalances,
  getAllTransactions,
  pickPreferredBalance,
  type EnableBankingProviderKey,
  type EnableBankingTransaction,
} from "@/lib/enableBanking";

export type EnableBankingSyncResult = { synced: number; errors: string[] };

// Thrown only for genuine mid-sync failures (auth lost, unexpected error) — carries the
// HTTP status + partial synced count the route should respond with, so the shared sync
// function doesn't need to know about NextResponse.
export class SyncHttpError extends Error {
  status: number;
  synced: number;
  constructor(message: string, status: number, synced: number) {
    super(message);
    this.status = status;
    this.synced = synced;
  }
}

function consentInstructions(provider: EnableBankingProviderKey): string {
  return `${ENABLE_BANKING_PROVIDERS[provider].label} access expired or not set up — please redo /accounts/connect.`;
}

// If this provider also has CSV-imported history (external_account_id "csv-{provider}-*",
// from the fallback in importCsv.ts), returns the most recent booked_at date covered by it
// — so the EB sync below never re-pulls a date range CSV already covered. importCsv.ts
// handles the reverse direction (pausing the CSV fallback once EB is active for a
// provider). Together, no date range is ever double-covered — deterministic, not a
// content-based dedup, which would be unreliable across differently-formatted sources.
async function csvHistoryCutoff(client: SupabaseClient<Database>, provider: EnableBankingProviderKey): Promise<string | null> {
  const { data: csvAccounts } = await client
    .from("accounts")
    .select("id")
    .eq("provider", provider)
    .like("external_account_id", `csv-${provider}-%`);
  if (!csvAccounts || csvAccounts.length === 0) return null;

  const { data: latest } = await client
    .from("transactions")
    .select("booked_at")
    .in(
      "account_id",
      csvAccounts.map((a) => a.id)
    )
    .order("booked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return latest?.booked_at ?? null;
}

function hashExternalId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function toRow(tx: EnableBankingTransaction, accountId: string, provider: EnableBankingProviderKey) {
  const amount = Number(tx.transaction_amount.amount);
  const signedAmount = tx.credit_debit_indicator === "DBIT" ? -Math.abs(amount) : Math.abs(amount);
  const bookedAt = tx.booking_date || tx.value_date || tx.transaction_date || new Date().toISOString();
  const rawDescription = tx.remittance_information?.join(" ") || null;
  const merchantName = tx.creditor?.name || tx.debtor?.name || null;
  // Enable Banking should always provide transaction_id/entry_reference, but fall back to a
  // content hash rather than silently dropping the row if an ASPSP ever omits both.
  const externalId =
    tx.transaction_id ||
    tx.entry_reference ||
    hashExternalId([provider, accountId, bookedAt, String(signedAmount), tx.transaction_amount.currency, rawDescription ?? ""]);

  return {
    account_id: accountId,
    external_id: externalId,
    booked_at: bookedAt,
    amount: signedAmount,
    currency: tx.transaction_amount.currency,
    raw_description: rawDescription,
    merchant_name: merchantName,
    mcc: tx.merchant_category_code || null,
  };
}

export async function syncEnableBankingProvider(
  client: SupabaseClient<Database>,
  provider: EnableBankingProviderKey
): Promise<EnableBankingSyncResult> {
  const { data: session, error: sessionError } = await client
    .from("enable_banking_sessions")
    .select("*")
    .eq("provider", provider)
    .maybeSingle();

  if (sessionError) return { synced: 0, errors: [sessionError.message] };
  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    return { synced: 0, errors: [consentInstructions(provider)] };
  }

  const { data: accounts, error: accountsError } = await client
    .from("accounts")
    .select("id, name, external_account_id")
    .eq("provider", provider);

  if (accountsError) return { synced: 0, errors: [accountsError.message] };
  if (!accounts || accounts.length === 0) {
    return { synced: 0, errors: [consentInstructions(provider)] };
  }

  const errors: string[] = [];
  let syncedCount = 0;
  // PSD2 consent (and most ASPSPs' data retention over the API) only covers the last 90
  // days, matching the consent window itself — unless CSV-imported history for this
  // provider already reaches further, in which case start the day after that instead, to
  // avoid re-pulling (and double-counting) dates the CSV fallback already covered.
  let dateFromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const csvCutoff = await csvHistoryCutoff(client, provider);
  if (csvCutoff) {
    const dayAfterCsvCutoff = new Date(csvCutoff);
    dayAfterCsvCutoff.setUTCDate(dayAfterCsvCutoff.getUTCDate() + 1);
    if (dayAfterCsvCutoff > dateFromDate) dateFromDate = dayAfterCsvCutoff;
  }
  const dateFrom = dateFromDate.toISOString().slice(0, 10);
  const externalIdPrefix = `eb-${provider}-`;

  try {
    for (const account of accounts) {
      // `wise`/`paypal` are also used by the CSV-import fallback (external_account_id
      // "csv-wise-EUR" etc.) — same provider string, different account rows. Skip those
      // silently here rather than attempting an Enable Banking call with a bogus account
      // UID; they're not an error, just not managed by this sync path. See the duplicate-
      // data note in importCsv.ts for the known risk if both sources are active at once.
      if (!account.external_account_id?.startsWith(externalIdPrefix)) continue;
      const accountUid = account.external_account_id.slice(externalIdPrefix.length);

      try {
        const balances = await getAccountBalances(accountUid);
        const preferred = pickPreferredBalance(balances);
        if (preferred) {
          await client
            .from("accounts")
            .update({
              balance: Number(preferred.balance_amount.amount),
              balance_currency: preferred.balance_amount.currency,
              balance_updated_at: new Date().toISOString(),
            })
            .eq("id", account.id);
        }
      } catch (err) {
        if (err instanceof EnableBankingAuthError) throw err;
        errors.push(`Balance for ${account.name} could not be loaded (${(err as Error).message})`);
      }

      let transactions: EnableBankingTransaction[];
      try {
        transactions = await getAllTransactions(accountUid, dateFrom);
      } catch (err) {
        if (err instanceof EnableBankingAuthError) throw err;
        errors.push(`Transactions for ${account.name} could not be loaded (${(err as Error).message})`);
        continue;
      }

      if (transactions.length === 0) continue;

      const rows = transactions.map((tx) => toRow(tx, account.id, provider));

      const { data: insertedRows, error: insertError } = await client
        .from("transactions")
        .upsert(rows, { onConflict: "account_id,external_id", ignoreDuplicates: true })
        .select("id, mcc, merchant_name, raw_description, category_id");

      if (insertError) {
        errors.push(`Transactions for ${account.name} could not be saved (${insertError.message})`);
        continue;
      }

      syncedCount += insertedRows?.length ?? 0;

      for (const row of insertedRows ?? []) {
        if (row.category_id) continue;
        try {
          const result = await categorizeTransaction(client, {
            mcc: row.mcc,
            merchant_name: row.merchant_name,
            raw_description: row.raw_description,
          });
          await client.from("transactions").update(result).eq("id", row.id);
        } catch (err) {
          errors.push(`Categorization failed for transaction ${row.id} (${(err as Error).message})`);
        }
      }
    }

    const status = errors.length === 0 ? "success" : "partial";
    await client.from("sync_log").insert({
      provider,
      status,
      message: errors.length > 0 ? errors.join("; ") : null,
      transactions_synced: syncedCount,
    });

    try {
      await matchInternalTransfers(client);
    } catch (err) {
      errors.push(`Internal transfer matching failed: ${(err as Error).message}`);
    }
    try {
      await recordDailySnapshotIfNeeded(client);
    } catch (err) {
      errors.push(`Balance snapshot failed: ${(err as Error).message}`);
    }

    return { synced: syncedCount, errors };
  } catch (err) {
    const isAuthError = err instanceof EnableBankingAuthError;
    const message = isAuthError
      ? consentInstructions(provider)
      : `${ENABLE_BANKING_PROVIDERS[provider].label} sync failed: ${(err as Error).message}`;

    await client.from("sync_log").insert({ provider, status: "error", message, transactions_synced: syncedCount });

    throw new SyncHttpError(message, isAuthError ? 401 : 502, syncedCount);
  }
}
