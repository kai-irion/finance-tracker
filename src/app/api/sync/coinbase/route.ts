import { createPrivateKey, randomBytes, sign as edSign, type KeyObject } from "crypto";
import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { categorizeTransaction } from "@/lib/categorize";
import { matchInternalTransfers } from "@/lib/matchInternalTransfers";
import { recordDailySnapshotIfNeeded } from "@/lib/balanceSnapshots";

// Coinbase App API (formerly "Sign in with Coinbase") — the v2 wallet/accounts/
// transactions surface, distinct from the trading-focused Advanced Trade API.
// Auth: CDP Cloud API Keys, JWT signed per-request (2 min expiry).
const COINBASE_API_BASE = "https://api.coinbase.com";
const MAX_FETCH_ATTEMPTS = 2;
const PAGE_LIMIT = "100";

type CoinbaseAccount = {
  id: string;
  name: string;
  type: string; // "wallet" (crypto) | "fiat"
  currency: { code: string; type: string };
  balance: { amount: string; currency: string };
};

type CoinbaseTransaction = {
  id: string;
  type: string;
  status: string;
  created_at: string;
  amount: { amount: string; currency: string };
  description?: string | null;
  details?: { title?: string; subtitle?: string; header?: string };
};

type CoinbasePage<T> = {
  data: T[];
  pagination?: { next_starting_after: string | null };
};

class CoinbaseAuthError extends Error {}

// CDP exports Ed25519 secrets as a base64 blob: 32-byte seed + 32-byte public key.
// Only the seed is needed — Node requires it PKCS8-DER-wrapped to import it, so this
// prepends the fixed RFC 8410 prefix for "Ed25519 private key" ASN.1 structure.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function buildEd25519PrivateKey(secretBase64: string): KeyObject {
  const raw = Buffer.from(secretBase64, "base64");
  if (raw.length < 32) {
    throw new Error("COINBASE_API_SECRET is too short for an Ed25519 key.");
  }
  const seed = raw.subarray(0, 32);
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function buildCoinbaseJwt(method: string, pathname: string, keyName: string, privateKey: KeyObject): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "EdDSA",
    typ: "JWT",
    kid: keyName,
    nonce: randomBytes(16).toString("hex"),
  };
  // The uri claim is method + host + pathname ONLY — a query string here causes Coinbase
  // to reject the JWT with 401 even though the request itself is otherwise identical.
  const payload = {
    iss: "cdp",
    sub: keyName,
    nbf: now,
    exp: now + 120,
    uri: `${method} api.coinbase.com${pathname}`,
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = edSign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

async function coinbaseFetch<T>(
  pathname: string,
  keyName: string,
  privateKey: KeyObject,
  searchParams?: Record<string, string>
): Promise<T> {
  const url = new URL(COINBASE_API_BASE + pathname);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const jwt = buildCoinbaseJwt("GET", pathname, keyName, privateKey);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });

    if (res.status === 429 && attempt < MAX_FETCH_ATTEMPTS) {
      const retryAfterSeconds = Number(res.headers.get("Retry-After")) || 2;
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new CoinbaseAuthError("Coinbase API key is invalid or expired.");
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Coinbase API error ${res.status} at ${pathname}: ${body.slice(0, 300)}`);
    }

    return res.json();
  }

  throw new Error(`Coinbase API rate limit reached at ${pathname}.`);
}

async function fetchAllTransactions(
  accountId: string,
  keyName: string,
  privateKey: KeyObject
): Promise<CoinbaseTransaction[]> {
  const pathname = `/v2/accounts/${accountId}/transactions`;
  const all: CoinbaseTransaction[] = [];
  let startingAfter: string | undefined;

  do {
    const params: Record<string, string> = { limit: PAGE_LIMIT };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await coinbaseFetch<CoinbasePage<CoinbaseTransaction>>(pathname, keyName, privateKey, params);
    all.push(...page.data);
    startingAfter = page.pagination?.next_starting_after ?? undefined;
  } while (startingAfter);

  return all;
}

export async function POST() {
  if (isDemoMode()) return NextResponse.json({ error: "Disabled in this public demo." }, { status: 403 });
  const keyName = process.env.COINBASE_API_KEY;
  const secretBase64 = process.env.COINBASE_API_SECRET;
  if (!keyName || !secretBase64) {
    return NextResponse.json(
      { synced: 0, errors: ["COINBASE_API_KEY / COINBASE_API_SECRET is not set. Please add it in .env.local."] },
      { status: 500 }
    );
  }

  let privateKey: KeyObject;
  try {
    privateKey = buildEd25519PrivateKey(secretBase64);
  } catch (err) {
    return NextResponse.json(
      { synced: 0, errors: [`COINBASE_API_SECRET is invalid: ${(err as Error).message}`] },
      { status: 500 }
    );
  }

  const errors: string[] = [];
  let syncedCount = 0;

  try {
    const accountsPage = await coinbaseFetch<CoinbasePage<CoinbaseAccount>>("/v2/accounts", keyName, privateKey, {
      limit: PAGE_LIMIT,
    });

    for (const account of accountsPage.data) {
      const externalAccountId = account.id;

      const { data: existingAccount, error: lookupError } = await supabaseAdmin
        .from("accounts")
        .select("id")
        .eq("provider", "coinbase")
        .eq("external_account_id", externalAccountId)
        .maybeSingle();

      if (lookupError) {
        errors.push(`Account ${account.name}: lookup failed (${lookupError.message})`);
        continue;
      }

      const balanceFields = {
        balance: Number(account.balance.amount),
        balance_currency: account.balance.currency,
        balance_updated_at: new Date().toISOString(),
      };

      let accountId = existingAccount?.id;
      if (!accountId) {
        const { data: newAccount, error: insertAccountError } = await supabaseAdmin
          .from("accounts")
          .insert({
            provider: "coinbase",
            name: account.name,
            currency: account.currency.code,
            account_type: "crypto",
            external_account_id: externalAccountId,
            ...balanceFields,
          })
          .select("id")
          .single();

        if (insertAccountError || !newAccount) {
          errors.push(`Account ${account.name} could not be created (${insertAccountError?.message})`);
          continue;
        }
        accountId = newAccount.id;
      } else {
        const { error: updateBalanceError } = await supabaseAdmin.from("accounts").update(balanceFields).eq("id", accountId);
        if (updateBalanceError) {
          errors.push(`Balance for ${account.name} could not be updated (${updateBalanceError.message})`);
        }
      }

      let transactions: CoinbaseTransaction[];
      try {
        transactions = await fetchAllTransactions(externalAccountId, keyName, privateKey);
      } catch (err) {
        if (err instanceof CoinbaseAuthError) throw err;
        errors.push(`Transactions for ${account.name} could not be loaded (${(err as Error).message})`);
        continue;
      }

      if (transactions.length === 0) continue;

      const rows = transactions.map((tx) => ({
        account_id: accountId as string,
        external_id: tx.id,
        booked_at: tx.created_at,
        // Stored in the wallet's own currency (e.g. BTC amount for a BTC wallet), not
        // converted to EUR — FX/crypto pricing for display is a separate concern.
        amount: Number(tx.amount.amount),
        currency: tx.amount.currency,
        raw_description: tx.details?.title
          ? `${tx.details.title}${tx.details.subtitle ? " - " + tx.details.subtitle : ""}`
          : tx.description || tx.type,
        merchant_name: tx.details?.header ?? null,
      }));

      const { data: insertedRows, error: insertTxError } = await supabaseAdmin
        .from("transactions")
        .upsert(rows, { onConflict: "account_id,external_id", ignoreDuplicates: true })
        .select("id, mcc, merchant_name, raw_description, category_id");

      if (insertTxError) {
        errors.push(`Transactions for ${account.name} could not be saved (${insertTxError.message})`);
        continue;
      }

      syncedCount += insertedRows?.length ?? 0;

      for (const row of insertedRows ?? []) {
        if (row.category_id) continue;
        try {
          const result = await categorizeTransaction(supabaseAdmin, {
            mcc: row.mcc,
            merchant_name: row.merchant_name,
            raw_description: row.raw_description,
            account_type: "crypto",
          });
          await supabaseAdmin.from("transactions").update(result).eq("id", row.id);
        } catch (err) {
          errors.push(`Categorization failed for transaction ${row.id} (${(err as Error).message})`);
        }
      }
    }

    const status = errors.length === 0 ? "success" : "partial";
    await supabaseAdmin.from("sync_log").insert({
      provider: "coinbase",
      status,
      message: errors.length > 0 ? errors.join("; ") : null,
      transactions_synced: syncedCount,
    });

    try {
      await matchInternalTransfers(supabaseAdmin);
    } catch (err) {
      errors.push(`Internal transfer matching failed: ${(err as Error).message}`);
    }
    try {
      await recordDailySnapshotIfNeeded(supabaseAdmin);
    } catch (err) {
      errors.push(`Balance snapshot failed: ${(err as Error).message}`);
    }

    return NextResponse.json({ synced: syncedCount, errors });
  } catch (err) {
    const isAuthError = err instanceof CoinbaseAuthError;
    const message = isAuthError
      ? (err as Error).message
      : `Coinbase sync failed: ${(err as Error).message}`;

    await supabaseAdmin.from("sync_log").insert({
      provider: "coinbase",
      status: "error",
      message,
      transactions_synced: syncedCount,
    });

    return NextResponse.json({ synced: syncedCount, errors: [message] }, { status: isAuthError ? 401 : 502 });
  }
}
