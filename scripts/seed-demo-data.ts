import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

config({ path: ".env.local" });

// Large deterministic English demo dataset for the public FinanceHub-demo:
// ~2 years of history, ~3000 transactions across 6 accounts (EUR + USD),
// recurring income/bills, internal-transfer pairs, review-queue items,
// merchant rules, daily net-worth snapshots, ETF holdings and FX rates —
// enough to make every chart, filter and drill-down feel alive.
//
// Run once against a FRESH demo Supabase project (migrations + seed.sql applied).
// Refuses to run when the transactions table is non-empty unless --force is passed.

const DAYS = 730;
const REVIEW_SHARE = 0.025;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check .env.local."
  );
}

const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Deterministic PRNG so every reseed produces the same demo dataset.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number, decimals = 2): number => {
  const v = min + rand() * (max - min);
  return Math.round(v * 10 ** decimals) / 10 ** decimals;
};

type Merchant = { name: string; min: number; max: number; perWeek: number; currency?: string };
type CategoryPlan = { category: string; merchants: Merchant[] };

const PLANS: CategoryPlan[] = [
  {
    category: "Groceries",
    merchants: [
      { name: "Whole Foods", min: 25, max: 95, perWeek: 1.2 },
      { name: "Trader Joe's", min: 18, max: 65, perWeek: 1.4 },
      { name: "Safeway", min: 12, max: 55, perWeek: 0.8 },
      { name: "Costco", min: 80, max: 220, perWeek: 0.5 },
      { name: "Ferry Plaza Farmers Market", min: 12, max: 45, perWeek: 0.6 },
    ],
  },
  {
    category: "Restaurants & Cafes",
    merchants: [
      { name: "Blue Bottle Coffee", min: 4, max: 9, perWeek: 2.5 },
      { name: "Chipotle", min: 11, max: 18, perWeek: 0.8 },
      { name: "Sweetgreen", min: 13, max: 19, perWeek: 0.7 },
      { name: "Slice House Pizza", min: 14, max: 28, perWeek: 0.5 },
      { name: "Nami Sushi", min: 25, max: 60, perWeek: 0.4 },
      { name: "Chez Panisse", min: 60, max: 140, perWeek: 0.12 },
    ],
  },
  {
    category: "Transport",
    merchants: [
      { name: "Shell", min: 35, max: 70, perWeek: 0.5 },
      { name: "Uber", min: 9, max: 32, perWeek: 1.1 },
      { name: "Clipper Card", min: 81, max: 81, perWeek: 0.23 },
      { name: "Amtrak", min: 29, max: 89, perWeek: 0.1 },
    ],
  },
  {
    category: "Shopping",
    merchants: [
      { name: "Amazon", min: 15, max: 120, perWeek: 1.0 },
      { name: "Target", min: 20, max: 90, perWeek: 0.5 },
      { name: "Zara", min: 30, max: 150, perWeek: 0.15 },
      { name: "Apple Store", min: 200, max: 1200, perWeek: 0.03 },
      { name: "IKEA", min: 100, max: 600, perWeek: 0.03 },
    ],
  },
  {
    category: "Travel",
    merchants: [
      { name: "United Airlines", min: 200, max: 700, perWeek: 0.06 },
      { name: "Airbnb", min: 120, max: 400, perWeek: 0.06 },
      { name: "Marriott", min: 150, max: 350, perWeek: 0.05 },
      { name: "Delta Air Lines", min: 180, max: 550, perWeek: 0.03 },
    ],
  },
  {
    category: "Health",
    merchants: [
      { name: "CVS Pharmacy", min: 8, max: 40, perWeek: 0.5 },
      { name: "One Medical", min: 199, max: 199, perWeek: 0.02 },
      { name: "Bright Dental", min: 80, max: 300, perWeek: 0.04 },
    ],
  },
  {
    category: "Leisure & Entertainment",
    merchants: [
      { name: "AMC Theatres", min: 15, max: 45, perWeek: 0.3 },
      { name: "Steam", min: 10, max: 60, perWeek: 0.2 },
      { name: "Green Apple Books", min: 12, max: 40, perWeek: 0.25 },
      { name: "Golden Gate Concerts", min: 30, max: 90, perWeek: 0.08 },
      { name: "Equinox", min: 85, max: 85, perWeek: 0.23 },
    ],
  },
  {
    category: "Other",
    merchants: [
      { name: "USPS", min: 5, max: 25, perWeek: 0.15 },
      { name: "Goodwill", min: 8, max: 45, perWeek: 0.1 },
      { name: "Apple iCloud+", min: 2.99, max: 2.99, perWeek: 0.23 },
    ],
  },
];

type MonthlyBill = { category: string; merchant: string; amount: number; account: string; day: number };
const MONTHLY_BILLS: MonthlyBill[] = [
  { category: "Housing", merchant: "Parkview Apartments", amount: -1450, account: "checking", day: 1 },
  { category: "Housing", merchant: "PG&E", amount: -95, account: "checking", day: 12 },
  { category: "Housing", merchant: "Comcast", amount: -65, account: "credit", day: 15 },
  { category: "Housing", merchant: "Lemonade Insurance", amount: -18, account: "checking", day: 3 },
  { category: "Subscriptions & Services", merchant: "Netflix", amount: -15.49, account: "credit", day: 7 },
  { category: "Subscriptions & Services", merchant: "Spotify", amount: -11.99, account: "credit", day: 9 },
  { category: "Subscriptions & Services", merchant: "New York Times", amount: -17, account: "credit", day: 20 },
  { category: "Subscriptions & Services", merchant: "Audible", amount: -14.95, account: "credit", day: 22 },
  { category: "Income", merchant: "Acme Corp Payroll", amount: 4850, account: "checking", day: 1 },
];

const HOLDINGS = [
  { isin: "US9229083632", name: "Vanguard Total Stock Market ETF", quantity: 42, price: 298.4, avg: 251.1 },
  { isin: "US9219097683", name: "Vanguard Total Intl Stock ETF", quantity: 85, price: 61.2, avg: 55.8 },
  { isin: "US9219378356", name: "Vanguard Total Bond Market ETF", quantity: 60, price: 73.5, avg: 76.2 },
  { isin: "US0378331005", name: "Apple Inc.", quantity: 12, price: 232.9, avg: 178.4 },
  { isin: "US5949181045", name: "Microsoft Corp.", quantity: 8, price: 428.1, avg: 331.7 },
  { isin: "US88160R1014", name: "Tesla Inc.", quantity: 15, price: 248.5, avg: 210.3 },
];

const FX_RATES: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.05,
  BTC: 97500,
  ETH: 3400,
  SOL: 210,
};

function dateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(8 + Math.floor(rand() * 12), Math.floor(rand() * 60), 0, 0);
  return d.toISOString();
}

function monthDate(monthsAgo: number, day: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, Math.min(day, 28), 9, 0, 0);
  return d.toISOString();
}

async function main() {
  const force = process.argv.includes("--force");

  const { count: existingCount, error: countError } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(`Cannot read transactions: ${countError.message}`);
  if ((existingCount ?? 0) > 0 && !force) {
    throw new Error(
      `transactions table already has ${existingCount} rows. Run against a fresh demo project, or re-run with --force (wipes demo data first).`
    );
  }
  if (force) {
    // FK-safe order: children before parents.
    console.log("Force: wiping existing demo data...");
    const NIL = "00000000-0000-0000-0000-000000000000";
    const wipes: [string, string, string][] = [
      ["transactions", "id", NIL],
      ["balance_snapshots", "date", "1970-01-01"],
      ["investment_holdings", "id", NIL],
      ["merchant_rules", "id", NIL],
      ["fx_rates", "currency", "__none__"],
      ["accounts", "id", NIL],
    ];
    for (const [table, column, neValue] of wipes) {
      const { error } = await supabase.from(table as "transactions").delete().neq(column as "id", neValue);
      if (error) throw new Error(`Wipe of ${table} failed: ${error.message}`);
    }
  }

  const { data: categories, error: catError } = await supabase.from("categories").select("id, name");
  if (catError) throw new Error(`Failed to load categories: ${catError.message}`);
  const catId = (name: string): string => {
    const found = categories?.find((c) => c.name === name);
    if (!found) throw new Error(`Category "${name}" missing — run supabase/seed.sql first.`);
    return found.id;
  };

  console.log("Creating demo accounts...");
  const { data: accounts, error: accError } = await supabase
    .from("accounts")
    .insert([
      { provider: "Manual", name: "Everyday Checking", currency: "EUR", account_type: "Checking", balance: 5230.45, balance_currency: "EUR" },
      { provider: "Manual", name: "Rewards Credit Card", currency: "EUR", account_type: "Credit Card", balance: 0, balance_currency: "EUR" },
      { provider: "Manual", name: "High-Yield Savings", currency: "EUR", account_type: "Savings", balance: 12840.0, balance_currency: "EUR" },
      { provider: "Manual", name: "Brokerage Depot", currency: "EUR", account_type: "Brokerage", balance: 0, balance_currency: "EUR" },
      { provider: "Manual", name: "Crypto Wallet", currency: "USD", account_type: "Crypto", balance: 3850.0, balance_currency: "USD" },
      { provider: "Manual", name: "US Travel Card", currency: "USD", account_type: "Credit Card", balance: 0, balance_currency: "USD" },
    ])
    .select("*");
  if (accError) throw new Error(`Failed to insert accounts: ${accError.message}`);
  if (!accounts || accounts.length !== 6) throw new Error("Expected 6 accounts.");
  const byName = new Map(accounts.map((a) => [a.name, a]));
  const checking = byName.get("Everyday Checking")!;
  const credit = byName.get("Rewards Credit Card")!;
  const savings = byName.get("High-Yield Savings")!;
  const broker = byName.get("Brokerage Depot")!;
  const cryptoWallet = byName.get("Crypto Wallet")!;
  const travelCard = byName.get("US Travel Card")!;
  const accountByKey: Record<string, typeof checking> = { checking, credit, savings, broker, crypto: cryptoWallet, travel: travelCard };

  type TxRow = {
    id?: string;
    account_id: string;
    booked_at: string;
    amount: number;
    currency: string;
    raw_description: string | null;
    merchant_name: string | null;
    category_id: string | null;
    category_source: string;
    is_internal_transfer: boolean;
    matched_transfer_id?: string | null;
    needs_review: boolean;
  };
  const rows: TxRow[] = [];
  const internalCatId = catId("Internal Transfer");

  // Every row gets an explicit id: PostgREST bulk-inserts use the union of keys
  // across the batch, so mixing rows with and without `id` would NULL the column
  // on the latter instead of applying the DB default.
  const push = (row: TxRow) => rows.push({ id: randomUUID(), ...row });

  // Daily randomized spending: each merchant fires with probability perWeek/7 per day,
  // scaled up so two years of history reach ~3000 transactions.
  const FREQUENCY_BOOST = 1.7;
  console.log("Generating daily spending...");
  for (let day = DAYS; day >= 0; day--) {
    for (const plan of PLANS) {
      for (const m of plan.merchants) {
        if (rand() > (m.perWeek * FREQUENCY_BOOST) / 7) continue;
        const amount = -Math.abs(between(m.min, m.max));
        const onCard = rand() < 0.45;
        const account = onCard ? credit : checking;
        const needsReview = rand() < REVIEW_SHARE;
        push({
          account_id: account.id,
          booked_at: dateDaysAgo(day),
          amount,
          currency: "EUR",
          raw_description: `${m.name.toUpperCase().replace(/[^A-Z0-9 ]/g, "")} - Card payment`,
          merchant_name: m.name,
          category_id: needsReview ? null : catId(plan.category),
          category_source: "seed",
          is_internal_transfer: false,
          needs_review: needsReview,
        });
      }
    }
    // Occasional crypto buys from the USD wallet.
    if (rand() < 0.06) {
      const coin = pick(["BTC", "ETH", "SOL"] as const);
      push({
        account_id: cryptoWallet.id,
        booked_at: dateDaysAgo(day),
        amount: -Math.abs(between(100, 600)),
        currency: "USD",
        raw_description: `COINBASE BUY ${coin}/USD`,
        merchant_name: "Coinbase",
        category_id: catId("Investment"),
        category_source: "seed",
        is_internal_transfer: false,
        needs_review: false,
      });
    }
  }

  // Monthly bills + payroll for the last 24 months.
  console.log("Generating monthly bills and payroll...");
  const months = Math.ceil(DAYS / 30.44);
  for (let m = months; m >= 0; m--) {
    for (const bill of MONTHLY_BILLS) {
      const account = accountByKey[bill.account];
      push({
        account_id: account.id,
        booked_at: monthDate(m, bill.day),
        amount: bill.amount,
        currency: account.currency,
        raw_description: `${bill.merchant} - Monthly`,
        merchant_name: bill.merchant,
        category_id: catId(bill.category),
        category_source: "seed",
        is_internal_transfer: false,
        needs_review: false,
      });
    }
    // Monthly savings + brokerage funding as matched internal-transfer pairs.
    for (const [target, amount] of [[savings, -300], [broker, -400]] as const) {
      const outId = randomUUID();
      const inId = randomUUID();
      const booked = monthDate(m, 5);
      push({
        id: outId,
        account_id: checking.id,
        booked_at: booked,
        amount,
        currency: "EUR",
        raw_description: `Transfer to ${target.name}`,
        merchant_name: null,
        category_id: internalCatId,
        category_source: "seed",
        is_internal_transfer: true,
        matched_transfer_id: inId,
        needs_review: false,
      });
      push({
        id: inId,
        account_id: target.id,
        booked_at: booked,
        amount: -amount,
        currency: "EUR",
        raw_description: `Transfer from Everyday Checking`,
        merchant_name: null,
        category_id: internalCatId,
        category_source: "seed",
        is_internal_transfer: true,
        matched_transfer_id: outId,
        needs_review: false,
      });
    }
  }

  // Quarterly dividends + one-off events.
  console.log("Generating dividends and one-offs...");
  for (let m = months; m >= 0; m -= 3) {
    push({
      account_id: broker.id,
      booked_at: monthDate(m, 15),
      amount: between(120, 210),
      currency: "EUR",
      raw_description: "VTI DIVIDEND",
      merchant_name: "Vanguard",
      category_id: catId("Income"),
      category_source: "seed",
      is_internal_transfer: false,
      needs_review: false,
    });
  }
  push({
    account_id: checking.id,
    booked_at: monthDate(14, 10),
    amount: 640,
    currency: "EUR",
    raw_description: "IRS TAX REFUND",
    merchant_name: "IRS",
    category_id: catId("Income"),
    category_source: "seed",
    is_internal_transfer: false,
    needs_review: false,
  });
  push({
    account_id: checking.id,
    booked_at: monthDate(9, 18),
    amount: 150,
    currency: "EUR",
    raw_description: "CRAIGSLIST - Sold bike",
    merchant_name: "Craigslist",
    category_id: catId("Income"),
    category_source: "seed",
    is_internal_transfer: false,
    needs_review: false,
  });

  // A USD road-trip cluster on the travel card ~3 months ago (exercises FX conversion).
  const tripMerchants = ["Motel 6 Barstow", "In-N-Out Burger", "Chevron", "Grand Canyon Fees", "Best Western", "Denny's"];
  for (let d = 0; d < 10; d++) {
    push({
      account_id: travelCard.id,
      booked_at: dateDaysAgo(95 - d),
      amount: -Math.abs(between(20, 160)),
      currency: "USD",
      raw_description: `${tripMerchants[d % tripMerchants.length].toUpperCase()} - Card payment`,
      merchant_name: tripMerchants[d % tripMerchants.length],
      category_id: catId(d % 3 === 0 ? "Transport" : "Travel"),
      category_source: "seed",
      is_internal_transfer: false,
      needs_review: false,
    });
  }

  console.log(`Inserting ${rows.length} transactions in batches...`);
  // Pairs reference each other, so they must land in a single statement (same-command
  // writes are visible to FK checks, but a pair split across batches is not).
  const pairRows = rows.filter((r) => r.matched_transfer_id);
  const normalRows = rows.filter((r) => !r.matched_transfer_id);
  for (let i = 0; i < normalRows.length; i += 500) {
    const { error } = await supabase.from("transactions").insert(normalRows.slice(i, i + 500));
    if (error) throw new Error(`Transaction batch ${i} failed: ${error.message}`);
  }
  if (pairRows.length > 0) {
    const { error } = await supabase.from("transactions").insert(pairRows);
    if (error) throw new Error(`Transfer-pair batch failed: ${error.message}`);
  }

  console.log("Seeding merchant rules...");
  const { error: rulesError } = await supabase.from("merchant_rules").insert([
    { pattern: "whole foods", category_id: catId("Groceries"), created_by: "seed" },
    { pattern: "acme corp", category_id: catId("Income"), created_by: "seed" },
    { pattern: "parkview", category_id: catId("Housing"), created_by: "seed" },
    { pattern: "united", category_id: catId("Travel"), created_by: "seed" },
    { pattern: "netflix", category_id: catId("Subscriptions & Services"), created_by: "seed" },
    { pattern: "shell", category_id: catId("Transport"), created_by: "seed" },
    { pattern: "coinbase", category_id: catId("Investment"), created_by: "seed" },
  ]);
  if (rulesError) throw new Error(`Rules failed: ${rulesError.message}`);

  console.log("Seeding FX rates...");
  const now = new Date().toISOString();
  const { error: fxError } = await supabase
    .from("fx_rates")
    .upsert(Object.entries(FX_RATES).map(([currency, rate_to_eur]) => ({ currency, rate_to_eur, updated_at: now })), {
      onConflict: "currency",
    });
  if (fxError) throw new Error(`FX rates failed: ${fxError.message}`);

  console.log("Seeding investment holdings...");
  const { error: holdingsError } = await supabase.from("investment_holdings").insert(
    HOLDINGS.map((h) => ({
      account_id: broker.id,
      isin: h.isin,
      name: h.name,
      quantity: h.quantity,
      price: h.price,
      avg_buy_in: h.avg,
      market_value: Math.round(h.quantity * h.price * 100) / 100,
      currency: "EUR",
    }))
  );
  if (holdingsError) throw new Error(`Holdings failed: ${holdingsError.message}`);
  const depotTotal = HOLDINGS.reduce((s, h) => s + h.quantity * h.price, 0);
  const { error: brokerBalError } = await supabase
    .from("accounts")
    .update({ balance: Math.round(depotTotal * 100) / 100, balance_updated_at: now })
    .eq("id", broker.id);
  if (brokerBalError) throw new Error(`Broker balance failed: ${brokerBalError.message}`);

  console.log("Seeding daily net-worth snapshots...");
  const snapshots: { date: string; total_balance_eur: number }[] = [];
  let netWorth = 18000;
  for (let day = DAYS; day >= 0; day--) {
    const d = new Date();
    d.setDate(d.getDate() - day);
    // Local noon: midnight is ambiguous/nonexistent on DST transition days, which
    // would map two consecutive days onto the same UTC date and break the upsert.
    d.setHours(12, 0, 0, 0);
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // Salary bump on the 1st, gentle upward drift + noise otherwise.
    if (d.getDate() === 1) netWorth += 2400;
    netWorth += between(-120, 190, 0);
    snapshots.push({ date: isoDate, total_balance_eur: Math.round(netWorth * 100) / 100 });
  }
  for (let i = 0; i < snapshots.length; i += 500) {
    const { error } = await supabase.from("balance_snapshots").upsert(snapshots.slice(i, i + 500), { onConflict: "date" });
    if (error) throw new Error(`Snapshots batch ${i} failed: ${error.message}`);
  }

  console.log(`Done. ${accounts.length} accounts, ${rows.length} transactions, ${snapshots.length} snapshots.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
