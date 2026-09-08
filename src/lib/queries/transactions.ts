import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type TransactionsQueryOptions = {
  // Every statistics/aggregate query (dashboard, analysis) should leave this at the default
  // (true) so is_internal_transfer=true rows never leak into balances/spending charts. Only
  // the transaction list itself passes false, since it needs to show (and let you unmark)
  // transfer rows rather than hide them.
  excludeInternalTransfers?: boolean;
};

// Central starting point for every transactions query in the app — use this instead of
// `client.from("transactions")` directly so the internal-transfer exclusion rule lives in
// one place. `selectStatement` is passed straight to `.select()`, so joins/aggregates work
// the same as calling it directly (e.g. `transactionsQuery(client, "*, accounts(name, provider)")`).
export function transactionsQuery(
  client: SupabaseClient<Database>,
  selectStatement = "*",
  options: TransactionsQueryOptions = {}
) {
  const { excludeInternalTransfers = true } = options;
  const query = client.from("transactions").select(selectStatement);
  return excludeInternalTransfers ? query.eq("is_internal_transfer", false) : query;
}
