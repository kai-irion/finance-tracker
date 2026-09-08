import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

async function main() {
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, provider, account_type, currency, external_account_id")
    .in("provider", ["wise", "paypal", "sparkasse"]);
  console.log("accounts:", accounts);

  for (const acc of accounts ?? []) {
    const { data: txs } = await supabase
      .from("transactions")
      .select("external_id, booked_at, amount, currency, raw_description, merchant_name, category_id, category_source, needs_review")
      .eq("account_id", acc.id);
    console.log(`\n${acc.name}:`, txs);
  }

  const { data: logs } = await supabase
    .from("sync_log")
    .select("status, message, transactions_synced, synced_at")
    .eq("provider", "csv-import")
    .order("synced_at", { ascending: false })
    .limit(2);
  console.log("\nsync_log:", logs);
}

main();
