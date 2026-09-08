import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { transactionsQuery } from "@/lib/queries/transactions";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { getBalanceInEur, refreshFxRatesIfStale } from "@/lib/fxRates";
import { localDateOf, monthKey, monthLabel, toISODate } from "@/lib/dateRanges";
import type { WidgetSpec, RelativeDateRange } from "./spec";

export type WidgetChartData =
  | { kind: "pie"; slices: { name: string; value: number }[] }
  | { kind: "bar"; bars: { label: string; value: number }[] }
  | { kind: "series"; xKey: string; rows: Record<string, string | number>[]; series: { key: string; label: string }[]; xTickFormatter: (v: string) => string }
  | { kind: "kpi"; value: number };

type Row = {
  id: string;
  amount: number;
  currency: string;
  booked_at: string;
  merchant_name: string | null;
  raw_description: string | null;
  category_name: string | null;
  is_income: boolean;
  account_type: string | null;
  provider: string | null;
  /** Signed original amount in its own currency (for the drilldown modal). */
  amountOriginal: number;
};

/** Transaction row behind an AI chart, shaped for TransactionListModal. */
export type WidgetDrillTransaction = {
  id: string;
  booked_at: string;
  amount: number;
  currency: string;
  merchant_name: string | null;
  raw_description: string | null;
  categories: { name: string } | null;
};

/** Account row behind an accounts-backed AI chart, shaped for AccountListModal. */
export type WidgetDrillAccount = {
  id: string;
  name: string;
  provider: string;
  account_type: string;
  balance: number | null;
  balance_currency: string;
  eur: number | null;
};

const DRILLDOWN_LIMIT = 200;

const UNCATEGORIZED = "Uncategorized";
const MAX_BUCKETS = 15;

function relativeDateWindow(range?: RelativeDateRange): { from: string | null; to: string | null } {
  if (!range || range === "all_time") return { from: null, to: null };
  const now = new Date();
  if (range === "this_month") return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: null };
  if (range === "this_year") return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: null };
  const months = range === "last_3_months" ? 3 : range === "last_6_months" ? 6 : 12;
  const from = new Date(now);
  from.setMonth(from.getMonth() - months);
  return { from: toISODate(from), to: null };
}

function inRange(dateTime: string, from: string | null, to: string | null): boolean {
  const d = localDateOf(dateTime);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

async function loadTransactionRows(client: SupabaseClient<Database>): Promise<Row[]> {
  type RawRow = {
    id: string;
    amount: number;
    currency: string;
    booked_at: string;
    merchant_name: string | null;
    raw_description: string | null;
    categories: { name: string; is_income: boolean } | null;
    accounts: { account_type: string; provider: string } | null;
  };
  const { data, error } = await fetchAllRows<RawRow>((from, to) =>
    transactionsQuery(
      client,
      "id, amount, currency, booked_at, merchant_name, raw_description, categories(name, is_income), accounts(account_type, provider)"
    )
      .order("booked_at", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: RawRow[] | null; error: { message: string } | null }>
  );
  if (error) throw new Error(error.message);

  const heldCurrencies = Array.from(new Set(data.map((t) => t.currency))).filter((c) => c !== "EUR");
  await refreshFxRatesIfStale(client, heldCurrencies);
  const { data: rateRows } = await client.from("fx_rates").select("currency, rate_to_eur");
  const rates = new Map((rateRows ?? []).map((r) => [r.currency, r.rate_to_eur]));

  return data.map((t) => {
    const rate = t.currency === "EUR" ? 1 : rates.get(t.currency);
    return {
      id: t.id,
      amount: rate === undefined ? 0 : t.amount * rate,
      currency: t.currency,
      booked_at: t.booked_at,
      merchant_name: t.merchant_name,
      raw_description: t.raw_description,
      category_name: t.categories?.name ?? null,
      is_income: t.categories?.is_income ?? false,
      account_type: t.accounts?.account_type ?? null,
      provider: t.accounts?.provider ?? null,
      amountOriginal: t.amount,
    };
  }).filter((t) => rates.has(t.currency) || t.currency === "EUR");
}

function applyFilters(rows: Row[], spec: WidgetSpec): Row[] {
  const f = spec.query.filters;
  const { from, to } = relativeDateWindow(f?.relativeDateRange);
  return rows.filter((r) => {
    if (!inRange(r.booked_at, from, to)) return false;
    if (f?.amountSign === "negative" && r.amount >= 0) return false;
    if (f?.amountSign === "positive" && r.amount <= 0) return false;
    if (f?.categoryNames?.length && !f.categoryNames.includes(r.category_name ?? UNCATEGORIZED)) return false;
    if (f?.accountTypes?.length && !f.accountTypes.includes(r.account_type ?? "")) return false;
    if (f?.providers?.length && !f.providers.includes(r.provider ?? "")) return false;
    return true;
  });
}

function aggregate(values: number[], metric: WidgetSpec["query"]["metric"]): number {
  if (values.length === 0) return 0;
  if (metric === "count") return values.length;
  const sum = values.reduce((s, v) => s + v, 0);
  return metric === "avg" ? sum / values.length : sum;
}

// Buckets filtered rows by the requested groupBy, aggregating |amount| within each bucket —
// sign only ever controls which rows are *included* (via the amountSign filter), never the
// aggregated value, so a pie/bar chart never has to render a negative slice/bar.
function bucketRows(rows: Row[], groupBy: "category" | "merchant" | "account_type" | "provider", metric: WidgetSpec["query"]["metric"]) {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const key =
      groupBy === "category"
        ? r.category_name ?? UNCATEGORIZED
        : groupBy === "merchant"
          ? r.merchant_name || r.raw_description || "Unknown"
          : groupBy === "account_type"
            ? r.account_type ?? "Unknown"
            : r.provider ?? "Unknown";
    const list = buckets.get(key) ?? [];
    list.push(Math.abs(r.amount));
    buckets.set(key, list);
  }
  return Array.from(buckets.entries())
    .map(([label, values]) => ({ label, value: aggregate(values, metric) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_BUCKETS);
}

async function loadAccountBuckets(
  client: SupabaseClient<Database>,
  spec: WidgetSpec
): Promise<{ label: string; value: number }[]> {
  const f = spec.query.filters;
  const { data: accounts } = await client.from("accounts").select("*").eq("is_archived", false);
  const withEur = await Promise.all(
    (accounts ?? []).map(async (a) => ({
      account: a,
      eur: a.balance === null ? null : await getBalanceInEur(client, a.balance, a.balance_currency ?? a.currency),
    }))
  );
  const filtered = withEur.filter(({ account, eur }) => {
    if (eur === null) return false;
    if (f?.accountTypes?.length && !f.accountTypes.includes(account.account_type)) return false;
    if (f?.providers?.length && !f.providers.includes(account.provider)) return false;
    return true;
  });

  if (spec.query.groupBy === "none") {
    return [{ label: spec.title, value: aggregate(filtered.map((f2) => Math.abs(f2.eur as number)), spec.query.metric) }];
  }
  const buckets = new Map<string, number[]>();
  for (const { account, eur } of filtered) {
    const key = spec.query.groupBy === "account_type" ? account.account_type : account.provider;
    const list = buckets.get(key) ?? [];
    list.push(Math.abs(eur as number));
    buckets.set(key, list);
  }
  return Array.from(buckets.entries())
    .map(([label, values]) => ({ label, value: aggregate(values, spec.query.metric) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_BUCKETS);
}

export async function executeWidgetQuery(client: SupabaseClient<Database>, spec: WidgetSpec): Promise<WidgetChartData> {
  const { chartType, query } = spec;

  if (query.source === "accounts") {
    const buckets = await loadAccountBuckets(client, spec);
    if (chartType === "kpi") return { kind: "kpi", value: buckets[0]?.value ?? 0 };
    if (chartType === "pie") return { kind: "pie", slices: buckets.map((b) => ({ name: b.label, value: b.value })) };
    return { kind: "bar", bars: buckets };
  }

  const allRows = await loadTransactionRows(client);
  const rows = applyFilters(allRows, spec);

  if (query.groupBy === "none") {
    const values = rows.map((r) => Math.abs(r.amount));
    return { kind: "kpi", value: aggregate(values, query.metric) };
  }

  if (query.groupBy === "month") {
    const months = Array.from(new Set(rows.map((r) => monthKey(r.booked_at)))).sort();

    if (query.seriesSplit === "income_vs_expense") {
      const chartRows = months.map((month) => {
        let income = 0;
        let expenses = 0;
        for (const r of rows) {
          if (monthKey(r.booked_at) !== month) continue;
          if (r.is_income) income += Math.abs(r.amount);
          else if (r.amount < 0) expenses += Math.abs(r.amount);
        }
        return { month, income, expenses };
      });
      return {
        kind: "series",
        xKey: "month",
        rows: chartRows,
        series: [
          { key: "income", label: "Income" },
          { key: "expenses", label: "Expenses" },
        ],
        xTickFormatter: monthLabel,
      };
    }

    const chartRows = months.map((month) => {
      const values = rows.filter((r) => monthKey(r.booked_at) === month).map((r) => Math.abs(r.amount));
      return { month, value: aggregate(values, query.metric) };
    });

    if (chartType === "bar") return { kind: "bar", bars: chartRows.map((r) => ({ label: monthLabel(r.month), value: r.value })) };
    return {
      kind: "series",
      xKey: "month",
      rows: chartRows,
      series: [{ key: "value", label: spec.title }],
      xTickFormatter: monthLabel,
    };
  }

  const buckets = bucketRows(rows, query.groupBy, query.metric);
  if (chartType === "pie") return { kind: "pie", slices: buckets.map((b) => ({ name: b.label, value: b.value })) };
  return { kind: "bar", bars: buckets };
}

/** Bucket key for one filtered row under this spec's groupBy — mirrors bucketRows(). */
function widgetBucketKey(r: Row, groupBy: WidgetSpec["query"]["groupBy"]): string {
  if (groupBy === "category") return r.category_name ?? UNCATEGORIZED;
  if (groupBy === "merchant") return r.merchant_name || r.raw_description || "Unknown";
  if (groupBy === "account_type") return r.account_type ?? "Unknown";
  if (groupBy === "provider") return r.provider ?? "Unknown";
  return "";
}

/**
 * Transactions behind one clicked bucket of an AI chart.
 * `bucket` is the clicked slice/bar label — or a raw monthKey for line/grouped-bar
 * point clicks, or null for KPI cards (returns every filtered row).
 * Sorted largest-first and capped so the modal stays usable on all_time charts.
 */
export async function resolveWidgetTransactionDrilldown(
  client: SupabaseClient<Database>,
  spec: WidgetSpec,
  bucket: string | null
): Promise<WidgetDrillTransaction[]> {
  if (spec.query.source !== "transactions") return [];
  const rows = applyFilters(await loadTransactionRows(client), spec);
  const { groupBy } = spec.query;

  let matches: Row[];
  if (bucket === null) {
    matches = rows;
  } else if (groupBy === "month") {
    matches = rows.filter((r) => monthKey(r.booked_at) === bucket || monthLabel(monthKey(r.booked_at)) === bucket);
  } else {
    matches = rows.filter((r) => widgetBucketKey(r, groupBy) === bucket);
  }

  return matches
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, DRILLDOWN_LIMIT)
    .map((r) => ({
      id: r.id,
      booked_at: r.booked_at,
      amount: r.amountOriginal,
      currency: r.currency,
      merchant_name: r.merchant_name,
      raw_description: r.raw_description,
      categories: r.category_name ? { name: r.category_name } : null,
    }));
}

/** Accounts behind one clicked bucket of an accounts-backed AI chart. */
export async function resolveWidgetAccountDrilldown(
  client: SupabaseClient<Database>,
  spec: WidgetSpec,
  bucket: string | null
): Promise<WidgetDrillAccount[]> {
  if (spec.query.source !== "accounts") return [];
  const f = spec.query.filters;
  const { data: accounts } = await client.from("accounts").select("*").eq("is_archived", false);
  const withEur = await Promise.all(
    (accounts ?? []).map(async (a) => ({
      account: a,
      eur: a.balance === null ? null : await getBalanceInEur(client, a.balance, a.balance_currency ?? a.currency),
    }))
  );
  const filtered = withEur.filter(({ account, eur }) => {
    if (eur === null) return false;
    if (f?.accountTypes?.length && !f.accountTypes.includes(account.account_type)) return false;
    if (f?.providers?.length && !f.providers.includes(account.provider)) return false;
    return true;
  });
  const matches =
    bucket === null
      ? filtered
      : filtered.filter(({ account }) =>
          spec.query.groupBy === "account_type" ? account.account_type === bucket : account.provider === bucket
        );
  return matches
    .sort((a, b) => Math.abs(b.eur as number) - Math.abs(a.eur as number))
    .slice(0, DRILLDOWN_LIMIT)
    .map(({ account, eur }) => ({
      id: account.id,
      name: account.name,
      provider: account.provider,
      account_type: account.account_type,
      balance: account.balance,
      balance_currency: account.balance_currency ?? account.currency,
      eur,
    }));
}
