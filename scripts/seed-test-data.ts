import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check .env.local."
  );
}

const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

const TEST_ACCOUNTS = [
  { provider: "Manuell", name: "Girokonto (Test)", currency: "EUR", account_type: "Girokonto" },
  { provider: "Manuell", name: "Kreditkarte (Test)", currency: "EUR", account_type: "Kreditkarte" },
  { provider: "Manuell", name: "Broker (Test)", currency: "EUR", account_type: "Broker/Depot" },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function main() {
  console.log("Inserting test accounts...");
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .insert(TEST_ACCOUNTS)
    .select("*");
  if (accountsError) throw new Error(`Failed to insert test accounts: ${accountsError.message}`);
  if (!accounts || accounts.length < 3) throw new Error("Expected 3 accounts to be created.");

  const [checking, creditCard, broker] = accounts;

  const { data: categories, error: categoriesError } = await supabase
    .from("categories")
    .select("id, name");
  if (categoriesError) throw new Error(`Failed to load categories: ${categoriesError.message}`);
  if (!categories || categories.length === 0) {
    throw new Error(
      "No categories found. Run supabase/seed.sql in the Supabase SQL Editor before seeding test data."
    );
  }

  const catId = (name: string) => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`Category "${name}" not found. Did supabase/seed.sql run?`);
    return found.id;
  };

  const transactions = [
    { account: checking, days: 1, amount: -34.5, merchant: "Rewe", category: "Groceries" },
    { account: checking, days: 2, amount: -12.9, merchant: "Edeka", category: "Groceries" },
    { account: checking, days: 3, amount: -8.4, merchant: "Bäckerei Müller", category: "Restaurants & Cafes" },
    { account: creditCard, days: 3, amount: -45.0, merchant: "L'Osteria", category: "Restaurants & Cafes" },
    { account: checking, days: 4, amount: -29.9, merchant: "DB Bahncard", category: "Transport" },
    { account: creditCard, days: 5, amount: -18.2, merchant: "Uber", category: "Transport" },
    { account: checking, days: 6, amount: -890.0, merchant: "Hausverwaltung Schmidt", category: "Housing" },
    { account: checking, days: 6, amount: -65.3, merchant: "Stadtwerke", category: "Housing" },
    { account: creditCard, days: 7, amount: -120.0, merchant: "Zalando", category: "Shopping" },
    { account: creditCard, days: 8, amount: -55.0, merchant: "MediaMarkt", category: "Shopping" },
    { account: checking, days: 9, amount: -9.99, merchant: "Netflix", category: "Subscriptions & Services" },
    { account: checking, days: 9, amount: -16.99, merchant: "Spotify", category: "Subscriptions & Services" },
    { account: creditCard, days: 12, amount: -340.0, merchant: "Lufthansa", category: "Travel" },
    { account: checking, days: 14, amount: -55.0, merchant: "Apotheke am Markt", category: "Health" },
    { account: creditCard, days: 15, amount: -42.0, merchant: "CineStar", category: "Leisure & Entertainment" },
    { account: broker, days: 18, amount: -500.0, merchant: "ETF Sparplan", category: "Investment" },
    { account: checking, days: 1, amount: 3200.0, merchant: "Gehalt GmbH", category: "Income" },
    { account: checking, days: 20, amount: -25.0, merchant: "Fitnessstudio", category: "Leisure & Entertainment" },
    { account: checking, days: 25, amount: -60.0, merchant: "Rewe", category: "Groceries" },
    { account: creditCard, days: 27, amount: -15.5, merchant: "Amazon", category: "Other" },
  ] as const;

  const rows = transactions.map((t) => ({
    account_id: t.account.id,
    booked_at: daysAgo(t.days),
    amount: t.amount,
    currency: "EUR",
    raw_description: `${t.merchant} - Kartenzahlung`,
    merchant_name: t.merchant,
    category_id: catId(t.category),
    category_source: "seed",
    is_internal_transfer: false,
  }));

  // A matched internal-transfer pair: money moved from checking to broker.
  const transferOutId = crypto.randomUUID();
  const transferInId = crypto.randomUUID();
  const internalTransferCatId = catId("Internal Transfer");

  const transferRows = [
    {
      id: transferOutId,
      account_id: checking.id,
      booked_at: daysAgo(10),
      amount: -1000.0,
      currency: "EUR",
      raw_description: "Umbuchung zu Broker",
      merchant_name: null,
      category_id: internalTransferCatId,
      category_source: "seed",
      is_internal_transfer: true,
      matched_transfer_id: transferInId,
    },
    {
      id: transferInId,
      account_id: broker.id,
      booked_at: daysAgo(10),
      amount: 1000.0,
      currency: "EUR",
      raw_description: "Einzahlung von Girokonto",
      merchant_name: null,
      category_id: internalTransferCatId,
      category_source: "seed",
      is_internal_transfer: true,
      matched_transfer_id: transferOutId,
    },
  ];

  console.log(`Inserting ${rows.length + transferRows.length} test transactions...`);
  const { error: rowsError } = await supabase.from("transactions").insert(rows);
  if (rowsError) throw new Error(`Failed to insert test transactions: ${rowsError.message}`);
  const { error: transferError } = await supabase.from("transactions").insert(transferRows);
  if (transferError) throw new Error(`Failed to insert transfer transactions: ${transferError.message}`);

  console.log("Done. Seeded 3 accounts and", rows.length + transferRows.length, "transactions.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
