import type { SupabaseClient } from "@supabase/supabase-js";
import { getBalanceInEur } from "@/lib/fxRates";
import { toISODate } from "@/lib/dateRanges";
import type { Database } from "@/lib/supabase/types";

// Writes today's total-balance-across-active-accounts snapshot, but only once per calendar
// date — safe to call from every sync route (see matchInternalTransfers call sites) since
// the second and later calls on the same day are a no-op. Archived accounts are excluded,
// matching the dashboard's "active accounts" total.
export async function recordDailySnapshotIfNeeded(client: SupabaseClient<Database>): Promise<void> {
  const today = toISODate(new Date());
  const { data: existing } = await client.from("balance_snapshots").select("date").eq("date", today).maybeSingle();
  if (existing) return;

  const { data: accounts } = await client
    .from("accounts")
    .select("balance, balance_currency, currency")
    .eq("is_archived", false)
    .not("balance", "is", null);

  let total = 0;
  for (const account of accounts ?? []) {
    const currency = account.balance_currency ?? account.currency;
    const eur = await getBalanceInEur(client, account.balance as number, currency);
    if (eur !== null) total += eur;
  }

  await client.from("balance_snapshots").insert({ date: today, total_balance_eur: total });
}
