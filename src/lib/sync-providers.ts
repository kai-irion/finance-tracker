// Shared by /accounts (per-account "Sync now" button) and /dashboard ("Sync all accounts").
// Add a new provider's sync route here and both pages pick it up.

type SyncTarget = { endpoint: string; body?: unknown };

// The actual sync operations to run for "Alle Konten syncen" — one entry per provider.
// Revolut/Wise/PayPal/Sparkasse all go through the generic Enable Banking sync route with
// a { provider } body. TradeRepublic isn't listed here — it syncs separately via the
// python-sync script, not through this app's API.
export const SYNC_PROVIDERS: { key: string; label: string; endpoint: string; body?: unknown }[] = [
  { key: "coinbase", label: "Coinbase", endpoint: "/api/sync/coinbase" },
  {
    key: "csv-import",
    label: "CSV import (Wise/PayPal/Sparkasse, fallback)",
    endpoint: "/api/sync/csv-imports",
  },
  { key: "revolut", label: "Revolut (Enable Banking)", endpoint: "/api/sync/enable-banking", body: { provider: "revolut" } },
  { key: "wise-eb", label: "Wise (Enable Banking)", endpoint: "/api/sync/enable-banking", body: { provider: "wise" } },
  { key: "paypal-eb", label: "PayPal (Enable Banking)", endpoint: "/api/sync/enable-banking", body: { provider: "paypal" } },
  {
    key: "sparkasse-eb",
    label: "Hamburger Sparkasse (Enable Banking)",
    endpoint: "/api/sync/enable-banking",
    body: { provider: "sparkasse" },
  },
];

// Maps an account's `provider` value to the sync target that refreshes it — used by the
// per-account "Sync now" button on /accounts. Note "wise"/"paypal" accounts created by
// the CSV-import fallback also carry these provider values but aren't touched by the
// Enable Banking sync (see the external_account_id prefix check in enableBankingSync.ts) —
// clicking "Sync now" on such an account is a no-op rather than an error.
//
// TradeRepublic is deliberately NOT in SYNC_PROVIDERS above ("Sync all accounts" bundles
// every entry there) since an unattended first-run-after-expiry needs a 2FA push
// confirmation and can take up to ~2 minutes to time out — that's fine for a single
// dedicated button here, less fine silently tacked onto every bulk sync.
const PROVIDER_SYNC_ENDPOINT: Record<string, SyncTarget> = {
  coinbase: { endpoint: "/api/sync/coinbase" },
  revolut: { endpoint: "/api/sync/enable-banking", body: { provider: "revolut" } },
  wise: { endpoint: "/api/sync/enable-banking", body: { provider: "wise" } },
  paypal: { endpoint: "/api/sync/enable-banking", body: { provider: "paypal" } },
  sparkasse: { endpoint: "/api/sync/enable-banking", body: { provider: "sparkasse" } },
  traderepublic: { endpoint: "/api/sync/traderepublic" },
};

export function findSyncEndpoint(provider: string): SyncTarget | undefined {
  return PROVIDER_SYNC_ENDPOINT[provider.toLowerCase()];
}

export type SyncResult = { synced: number; errors: string[]; filesProcessed?: number };

export async function runSync(endpoint: string, body?: unknown): Promise<SyncResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: Partial<SyncResult> = {};
    try {
      data = await res.json();
    } catch {
      // Non-JSON response (e.g. a 404 HTML page for a route that doesn't exist) —
      // fall through to the generic status-based error below.
    }
    if (!res.ok) {
      return {
        synced: data.synced ?? 0,
        errors: data.errors?.length ? data.errors : [`Failed (status ${res.status}).`],
        filesProcessed: data.filesProcessed,
      };
    }
    return { synced: data.synced ?? 0, errors: data.errors ?? [], filesProcessed: data.filesProcessed };
  } catch (err) {
    return { synced: 0, errors: [err instanceof Error ? err.message : "Sync failed."] };
  }
}
