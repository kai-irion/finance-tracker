import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { ENABLE_BANKING_PROVIDER_KEYS, ENABLE_BANKING_PROVIDERS } from "../src/lib/enableBankingProviders";
import { getAllTransactions, EnableBankingAuthError } from "../src/lib/enableBanking";
import { categorizeTransaction } from "../src/lib/categorize";

// One-time backfill: the Enable Banking sync only started capturing `merchant_category_code`
// as of this session's fix — any transaction synced before that has mcc = null. This
// re-fetches each EB-connected account's transactions (limited to the last 90 days, the
// PSD2 consent/API window — older history isn't retrievable at all) and:
//   1. fills in `mcc` for rows that matched by external_id but are missing it, and
//   2. re-runs categorization ONLY for rows still `needs_review` (never touches a row a
//      merchant rule, MCC-at-insert-time, or the user has already categorized).
// CSV/broker/crypto-sourced transactions have no MCC concept at their source and are
// untouched — this only ever queries `eb-{provider}-*` accounts.
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let totalMccFilled = 0;
  let totalRecategorized = 0;

  for (const provider of ENABLE_BANKING_PROVIDER_KEYS) {
    const { data: session } = await supabase
      .from("enable_banking_sessions")
      .select("*")
      .eq("provider", provider)
      .maybeSingle();
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      console.log(`${ENABLE_BANKING_PROVIDERS[provider].label}: no active session, skipping.`);
      continue;
    }

    const { data: accounts } = await supabase.from("accounts").select("id, name, external_account_id").eq("provider", provider);
    const externalIdPrefix = `eb-${provider}-`;

    for (const account of accounts ?? []) {
      if (!account.external_account_id?.startsWith(externalIdPrefix)) continue;
      const accountUid = account.external_account_id.slice(externalIdPrefix.length);

      let transactions;
      try {
        transactions = await getAllTransactions(accountUid, dateFrom);
      } catch (err) {
        if (err instanceof EnableBankingAuthError) {
          console.log(`${account.name}: auth error, skipping remaining accounts for ${provider}.`);
          break;
        }
        console.log(`${account.name}: fetch failed (${(err as Error).message}), skipping.`);
        continue;
      }

      const mccByExternalId = new Map<string, string>();
      for (const tx of transactions) {
        const externalId = tx.transaction_id || tx.entry_reference;
        if (externalId && tx.merchant_category_code) mccByExternalId.set(externalId, tx.merchant_category_code);
      }
      if (mccByExternalId.size === 0) {
        console.log(`${account.name}: 0 of ${transactions.length} fetched transactions carry an MCC from this bank.`);
        continue;
      }

      const { data: existingRows } = await supabase
        .from("transactions")
        .select("id, external_id, mcc, merchant_name, raw_description, category_id, needs_review")
        .eq("account_id", account.id)
        .is("mcc", null)
        .in("external_id", Array.from(mccByExternalId.keys()));

      let mccFilled = 0;
      let recategorized = 0;
      for (const row of existingRows ?? []) {
        if (!row.external_id) continue;
        const mcc = mccByExternalId.get(row.external_id);
        if (!mcc) continue;
        await supabase.from("transactions").update({ mcc }).eq("id", row.id);
        mccFilled++;

        if (row.needs_review) {
          const result = await categorizeTransaction(supabase, {
            mcc,
            merchant_name: row.merchant_name,
            raw_description: row.raw_description,
          });
          if (result.category_id) {
            await supabase.from("transactions").update(result).eq("id", row.id);
            recategorized++;
          }
        }
      }

      console.log(`${account.name}: ${mccFilled} mcc backfilled, ${recategorized} recategorized out of needs-review.`);
      totalMccFilled += mccFilled;
      totalRecategorized += recategorized;
    }
  }

  console.log(`\nDone. Total mcc backfilled: ${totalMccFilled}. Total recategorized: ${totalRecategorized}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
