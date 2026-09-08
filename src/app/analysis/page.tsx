"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { transactionsQuery } from "@/lib/queries/transactions";
import { refreshFxRatesIfStale, getBalanceInEur } from "@/lib/fxRates";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { computeDateRange, localDateOf, monthKey, monthLabel, toISODate, type DateRangePreset } from "@/lib/dateRanges";
import { DateRangeFilter } from "@/components/date-range-filter";
import { CategoricalPieChart, type PieSlice } from "@/components/charts/categorical-pie-chart";
import { MultiSeriesLineChart, type LineSeriesDef } from "@/components/charts/multi-series-line-chart";
import { ComparisonBarChart, type BarDatum } from "@/components/charts/comparison-bar-chart";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { NetWorthTrendChart, type NetWorthPoint } from "@/components/charts/net-worth-trend-chart";
import { TransactionListModal, type ModalTransaction } from "@/components/transaction-list-modal";
import { HoldingsTable } from "@/components/holdings-table";
import { AiWidgetChat } from "@/components/ai-widget-chat";
import { AiWidgetCard } from "@/components/ai-widget-card";
import { SortableSection } from "@/components/sortable-section";
import { useAiWidgets, type LoadedWidget } from "@/lib/ai-widgets/useAiWidgets";
import {
  resolveWidgetAccountDrilldown,
  resolveWidgetTransactionDrilldown,
} from "@/lib/ai-widgets/execute";
import { AccountListModal, type ModalAccount } from "@/components/account-list-modal";
import { usePageLayout } from "@/lib/pageLayout";
import { formatMoney } from "@/lib/formatMoney";
import { DEMO_AI_NOTE, isDemoMode } from "@/lib/demo-mode";
import { usePrivacy } from "@/lib/privacy-context";
import type { Account, Category, InvestmentHolding } from "@/lib/supabase/types";

const UNCATEGORIZED = "Uncategorized";

const STANDARD_IDS = [
  "asset-allocation",
  "net-worth-trend",
  "spending-by-category",
  "spending-over-time",
  "month-comparison",
  "income-vs-expenses",
  "biggest-expenses",
  "top-merchants",
  "investment-holdings",
] as const;

const STANDARD_TITLES: Record<string, string> = {
  "asset-allocation": "Asset allocation",
  "net-worth-trend": "Net worth trend",
  "spending-by-category": "Spending by category",
  "spending-over-time": "Spending over time",
  "month-comparison": "Month comparison",
  "income-vs-expenses": "Income vs. expenses",
  "biggest-expenses": "Biggest expenses",
  "top-merchants": "Top merchants",
  "investment-holdings": "Investment holdings",
};

type AnalysisTransaction = {
  id: string;
  booked_at: string;
  amount: number;
  currency: string;
  merchant_name: string | null;
  raw_description: string | null;
  category_id: string | null;
  categories: { name: string; is_income: boolean } | null;
  eurAmount: number | null;
};

function inRange(dateTime: string, from: string | null, to: string | null): boolean {
  const d = localDateOf(dateTime);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function monthWindow(year: number, month: number): { from: string; to: string } {
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  return { from: toISODate(from), to: toISODate(to) };
}

function monthKeyToWindow(monthKeyStr: string): { from: string; to: string } {
  const [year, month] = monthKeyStr.split("-").map(Number);
  return monthWindow(year, month - 1);
}

export default function AnalysisPage() {
  const { isPrivate } = usePrivacy();
  const eurFormatter = (v: number) => formatMoney(v, "EUR", isPrivate);
  const [transactions, setTransactions] = useState<AnalysisTransaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unconverted, setUnconverted] = useState<{ currencies: string[]; count: number } | null>(null);

  const [preset, setPreset] = useState<DateRangePreset>("thisMonth");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = useMemo(() => computeDateRange(preset, { from: customFrom, to: customTo }), [preset, customFrom, customTo]);

  const [compareCategoryIds, setCompareCategoryIds] = useState<Set<string>>(new Set());
  const [drilldown, setDrilldown] = useState<{ title: string; transactions: AnalysisTransaction[] } | null>(null);
  const [aiWidgetsRefreshKey, setAiWidgetsRefreshKey] = useState(0);

  const [aiTxnDrilldown, setAiTxnDrilldown] = useState<{ title: string; transactions: ModalTransaction[] } | null>(null);
  const [aiAcctDrilldown, setAiAcctDrilldown] = useState<{ title: string; accounts: ModalAccount[] } | null>(null);
  const [aiDrillLoading, setAiDrillLoading] = useState(false);

  const { widgets: aiWidgets, remove: removeAiWidget, persistDbOrder } = useAiWidgets("analysis", aiWidgetsRefreshKey);

  // Asset allocation — current live balances, not time-ranged, so it doesn't share the page's
  // spending-focused date filter above. Full account records are kept so slice clicks can
  // drill into the accounts behind each type.
  const [allocationBalances, setAllocationBalances] = useState<{ account: Account; eur: number | null }[]>([]);

  // Net worth trend keeps its own independent date filter (defaulting to "All time") — a
  // running-balance series isn't naturally sliced by "transactions in range" the way the
  // spending charts below are.
  const [nwPreset, setNwPreset] = useState<DateRangePreset>("allTime");
  const [nwCustomFrom, setNwCustomFrom] = useState("");
  const [nwCustomTo, setNwCustomTo] = useState("");
  const nwRange = useMemo(
    () => computeDateRange(nwPreset, { from: nwCustomFrom, to: nwCustomTo }),
    [nwPreset, nwCustomFrom, nwCustomTo]
  );
  const [snapshots, setSnapshots] = useState<NetWorthPoint[]>([]);

  async function loadAllocation() {
    const { data: accountRows } = await supabase.from("accounts").select("*").eq("is_archived", false);
    const withEur = await Promise.all(
      ((accountRows as Account[]) ?? []).map(async (account) => {
        if (account.balance === null) return { account, eur: null };
        const currency = account.balance_currency ?? account.currency;
        return { account, eur: await getBalanceInEur(supabase, account.balance, currency) };
      })
    );
    setAllocationBalances(withEur);
  }

  async function loadSnapshots() {
    // Unbounded/large selects default-cap at 1000 rows on PostgREST — with a snapshot for
    // every calendar day of history, "All time" easily exceeds that and would otherwise
    // silently truncate partway through instead of reaching today.
    const { data } = await fetchAllRows<{ date: string; total_balance_eur: number }>((from, to) => {
      let query = supabase
        .from("balance_snapshots")
        .select("date, total_balance_eur")
        .order("date", { ascending: true })
        .range(from, to);
      if (nwRange.from) query = query.gte("date", nwRange.from);
      if (nwRange.to) query = query.lte("date", nwRange.to);
      return query;
    });
    setSnapshots(data.map((r) => ({ date: r.date, totalBalanceEur: r.total_balance_eur })));
  }

  useEffect(() => {
    loadAllocation();
  }, []);

  useEffect(() => {
    loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nwRange.from, nwRange.to]);

  const allocationSlices: PieSlice[] = useMemo(() => {
    const byType = new Map<string, number>();
    for (const b of allocationBalances) {
      if (b.eur === null) continue;
      byType.set(b.account.account_type, (byType.get(b.account.account_type) ?? 0) + b.eur);
    }
    return Array.from(byType.entries()).map(([name, value]) => ({ name, value }));
  }, [allocationBalances]);

  function openAccountsForType(accountType: string) {
    const matches = allocationBalances
      .filter((b) => b.account.account_type === accountType)
      .map((b) => ({
        id: b.account.id,
        name: b.account.name,
        provider: b.account.provider,
        account_type: b.account.account_type,
        balance: b.account.balance,
        balance_currency: b.account.balance_currency ?? b.account.currency,
        eur: b.eur,
      }))
      .sort((a, b) => Math.abs(b.eur ?? 0) - Math.abs(a.eur ?? 0));
    setAiAcctDrilldown({ title: accountType, accounts: matches });
  }

  const defaultOrder = useMemo(
    () => [...STANDARD_IDS, ...aiWidgets.map((w) => `ai:${w.id}`)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiWidgets.map((w) => w.id).join("|")]
  );
  const layout = usePageLayout("analysis", defaultOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    type RawRow = Omit<AnalysisTransaction, "eurAmount">;
    const [txRes, catRes, holdingsRes] = await Promise.all([
      fetchAllRows<RawRow>((from, to) =>
        transactionsQuery(
          supabase,
          "id, booked_at, amount, currency, merchant_name, raw_description, category_id, categories(name, is_income)"
        )
          .order("booked_at", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: RawRow[] | null; error: { message: string } | null }>
      ),
      supabase.from("categories").select("*").order("name"),
      supabase.from("investment_holdings").select("*").order("market_value", { ascending: false }),
    ]);
    setHoldings(holdingsRes.data ?? []);

    if (txRes.error) {
      setError(txRes.error.message);
      setLoading(false);
      return;
    }

    const heldCurrencies = Array.from(new Set(txRes.data.map((t) => t.currency))).filter((c) => c !== "EUR");
    await refreshFxRatesIfStale(supabase, heldCurrencies);
    const { data: rateRows } = await supabase.from("fx_rates").select("currency, rate_to_eur");

    const rates = new Map((rateRows ?? []).map((r) => [r.currency, r.rate_to_eur]));
    const unconvertedCurrencies = new Set<string>();
    let unconvertedCount = 0;
    const rows = txRes.data.map((t) => {
      const rate = t.currency === "EUR" ? 1 : rates.get(t.currency);
      const eurAmount = rate === undefined ? null : t.amount * rate;
      if (eurAmount === null) {
        unconvertedCurrencies.add(t.currency);
        unconvertedCount++;
      }
      return { ...t, eurAmount };
    });

    setTransactions(rows);
    setCategories(catRes.data ?? []);
    setUnconverted(
      unconvertedCount > 0 ? { currencies: Array.from(unconvertedCurrencies).sort(), count: unconvertedCount } : null
    );
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => transactions.filter((t) => inRange(t.booked_at, range.from, range.to)),
    [transactions, range]
  );
  const expenses = useMemo(() => filtered.filter((t) => t.amount < 0), [filtered]);

  const categoryPieData: PieSlice[] = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const t of expenses) {
      if (t.eurAmount === null) continue;
      const name = t.categories?.name ?? UNCATEGORIZED;
      byCategory.set(name, (byCategory.get(name) ?? 0) + Math.abs(t.eurAmount));
    }
    return Array.from(byCategory.entries()).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const lineChartMonths = useMemo(() => Array.from(new Set(expenses.map((t) => monthKey(t.booked_at)))).sort(), [expenses]);
  const lineChartSeries: LineSeriesDef[] = useMemo(
    () => [
      { key: "total", label: "Total" },
      ...categories.filter((c) => compareCategoryIds.has(c.id)).map((c) => ({ key: c.id, label: c.name })),
    ],
    [categories, compareCategoryIds]
  );
  const lineChartData = useMemo(() => {
    return lineChartMonths.map((month) => {
      const row: Record<string, string | number> = { month };
      let total = 0;
      for (const catId of compareCategoryIds) row[catId] = 0;
      for (const t of expenses) {
        if (monthKey(t.booked_at) !== month || t.eurAmount === null) continue;
        const amount = Math.abs(t.eurAmount);
        total += amount;
        if (t.category_id && compareCategoryIds.has(t.category_id)) {
          row[t.category_id] = (Number(row[t.category_id]) || 0) + amount;
        }
      }
      row.total = total;
      return row;
    });
  }, [lineChartMonths, expenses, compareCategoryIds]);

  function toggleCompareCategory(id: string) {
    setCompareCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllCompareCategories() {
    setCompareCategoryIds(new Set(categories.map((c) => c.id)));
  }

  function clearCompareCategories() {
    setCompareCategoryIds(new Set());
  }

  const monthComparisonWindows = useMemo(() => {
    const now = new Date();
    return [
      { label: "This month", ...monthWindow(now.getFullYear(), now.getMonth()) },
      { label: "Last month", ...monthWindow(now.getFullYear(), now.getMonth() - 1) },
      { label: "Same month last year", ...monthWindow(now.getFullYear() - 1, now.getMonth()) },
    ];
  }, []);
  const monthComparisonData: BarDatum[] = useMemo(() => {
    return monthComparisonWindows.map(({ label, from, to }) => {
      const total = transactions
        .filter((t) => t.amount < 0 && t.eurAmount !== null && inRange(t.booked_at, from, to))
        .reduce((sum, t) => sum + Math.abs(t.eurAmount as number), 0);
      return { label, value: total };
    });
  }, [transactions, monthComparisonWindows]);

  function openDrilldownForRange(title: string, from: string, to: string) {
    const matches = transactions.filter((t) => t.amount < 0 && inRange(t.booked_at, from, to));
    setDrilldown({ title, transactions: matches });
  }

  function handleMonthComparisonClick(label: string) {
    const window = monthComparisonWindows.find((w) => w.label === label);
    if (window) openDrilldownForRange(label, window.from, window.to);
  }

  function handleLinePointClick(monthKeyStr: string) {
    const { from, to } = monthKeyToWindow(monthKeyStr);
    openDrilldownForRange(monthLabel(monthKeyStr), from, to);
  }

  function handleIncomeExpenseClick(monthKeyStr: string) {
    const { from, to } = monthKeyToWindow(monthKeyStr);
    const matches = transactions.filter((t) => inRange(t.booked_at, from, to));
    setDrilldown({ title: monthLabel(monthKeyStr), transactions: matches });
  }

  function openDrilldownForMerchant(name: string) {
    const matches = expenses.filter((t) => (t.merchant_name || t.raw_description || "Unknown") === name);
    setDrilldown({ title: name, transactions: matches });
  }

  function openDrilldownForCategory(name: string) {
    const matches = [...expenses]
      .filter((t) => (t.categories?.name ?? UNCATEGORIZED) === name)
      .sort((a, b) => Math.abs(b.eurAmount as number) - Math.abs(a.eurAmount as number));
    setDrilldown({ title: name, transactions: matches });
  }

  async function handleAiBucketClick(widget: LoadedWidget, bucket: string | null) {
    const title = bucket ? `${widget.title} — ${bucket}` : widget.title;
    setAiDrillLoading(true);
    try {
      if (widget.spec.query.source === "accounts") {
        const accounts = await resolveWidgetAccountDrilldown(supabase, widget.spec, bucket);
        setAiAcctDrilldown({ title, accounts });
      } else {
        const txns = await resolveWidgetTransactionDrilldown(supabase, widget.spec, bucket);
        setAiTxnDrilldown({ title, transactions: txns });
      }
    } finally {
      setAiDrillLoading(false);
    }
  }

  function openDrilldownForSingle(tx: AnalysisTransaction) {
    setDrilldown({ title: tx.merchant_name ?? tx.raw_description ?? "Transaction", transactions: [tx] });
  }

  const topExpenses = useMemo(
    () =>
      [...expenses]
        .filter((t) => t.eurAmount !== null)
        .sort((a, b) => Math.abs(b.eurAmount as number) - Math.abs(a.eurAmount as number))
        .slice(0, 10),
    [expenses]
  );

  const topMerchants = useMemo(() => {
    const byMerchant = new Map<string, number>();
    for (const t of expenses) {
      if (t.eurAmount === null) continue;
      const name = t.merchant_name || t.raw_description || "Unknown";
      byMerchant.set(name, (byMerchant.get(name) ?? 0) + Math.abs(t.eurAmount));
    }
    return Array.from(byMerchant.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [expenses]);

  const incomeExpenseMonths = useMemo(() => Array.from(new Set(filtered.map((t) => monthKey(t.booked_at)))).sort(), [filtered]);
  const incomeExpenseData = useMemo(() => {
    return incomeExpenseMonths.map((month) => {
      let income = 0;
      let expensesTotal = 0;
      for (const t of filtered) {
        if (monthKey(t.booked_at) !== month || t.eurAmount === null) continue;
        if (t.categories?.is_income) income += t.eurAmount;
        else if (t.amount < 0) expensesTotal += Math.abs(t.eurAmount);
      }
      return { month, income, expenses: expensesTotal };
    });
  }, [incomeExpenseMonths, filtered]);

  const aiById = useMemo(() => new Map(aiWidgets.map((w) => [`ai:${w.id}`, w])), [aiWidgets]);
  const visibleOrder = layout.order.filter((id) => !layout.hidden.includes(id));
  const hiddenSections = layout.order.filter((id) => layout.hidden.includes(id));

  function sectionTitle(id: string): string {
    if (id.startsWith("ai:")) return aiById.get(id)?.title ?? "AI chart";
    return STANDARD_TITLES[id] ?? id;
  }

  function handleDropOn(targetId: string) {
    if (dragId) {
      layout.reorder(dragId, targetId);
      const visible = layout.order.filter((x) => !layout.hidden.includes(x));
      const from = visible.indexOf(dragId);
      const to = visible.indexOf(targetId);
      if (from !== -1 && to !== -1) {
        const r = [...visible];
        const [m] = r.splice(from, 1);
        r.splice(to, 0, m);
        const aiIds = r.filter((x) => x.startsWith("ai:")).map((x) => x.slice(3));
        if (aiIds.length > 1) void persistDbOrder(aiIds);
      }
    }
    setDragId(null);
    setDropTargetId(null);
  }

  function renderSectionBody(id: string) {
    switch (id) {
      case "asset-allocation":
        return (
          <>
            <CategoricalPieChart
              data={allocationSlices}
              valueFormatter={(v) => eurFormatter(v)}
              emptyMessage='No accounts with a known balance yet. Sync an account or add one under "Settings".'
              onSliceClick={openAccountsForType}
            />
            <p className="text-xs text-neutral-400 mt-2">Click a slice to see its accounts.</p>
          </>
        );
      case "net-worth-trend":
        return (
          <>
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <span className="text-xs text-neutral-500">Trend</span>
              <DateRangeFilter
                preset={nwPreset}
                customFrom={nwCustomFrom}
                customTo={nwCustomTo}
                onChange={(p, _range, from, to) => {
                  setNwPreset(p);
                  setNwCustomFrom(from);
                  setNwCustomTo(to);
                }}
              />
            </div>
            <NetWorthTrendChart data={snapshots} valueFormatter={(v) => eurFormatter(v)} />
          </>
        );
      case "spending-by-category":
        return (
          <>
            <CategoricalPieChart
              data={categoryPieData}
              valueFormatter={(v) => eurFormatter(v)}
              emptyMessage="No expenses in this range."
              onSliceClick={openDrilldownForCategory}
            />
            <p className="text-xs text-neutral-400 mt-2">Click a slice to see its transactions, largest first.</p>
          </>
        );
      case "spending-over-time":
        return (
          <>
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <button onClick={selectAllCompareCategories} className="text-xs text-neutral-500 hover:underline mr-1">
                Select all
              </button>
              <button onClick={clearCompareCategories} className="text-xs text-neutral-500 hover:underline mr-2">
                Unselect all
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleCompareCategory(c.id)}
                  className={`rounded-full px-2.5 py-1 text-xs border ${
                    compareCategoryIds.has(c.id)
                      ? "bg-accent text-white border-accent"
                      : "border-divider text-muted"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <MultiSeriesLineChart
              data={lineChartData}
              xKey="month"
              xTickFormatter={monthLabel}
              series={lineChartSeries}
              valueFormatter={(v) => eurFormatter(v)}
              onPointClick={handleLinePointClick}
            />
            <p className="text-xs text-neutral-400 mt-2">Click a point to see that month&apos;s transactions.</p>
          </>
        );
      case "month-comparison":
        return (
          <>
            <p className="text-xs text-neutral-500 mb-3">
              Total spending — fixed periods, not affected by the date filter above. Click a bar to see its transactions.
            </p>
            <ComparisonBarChart data={monthComparisonData} valueFormatter={(v) => eurFormatter(v)} onBarClick={handleMonthComparisonClick} />
          </>
        );
      case "income-vs-expenses":
        return (
          <>
            <p className="text-xs text-neutral-500 mb-3">Click a bar to see that month&apos;s transactions.</p>
            <GroupedBarChart
              data={incomeExpenseData}
              xKey="month"
              xTickFormatter={monthLabel}
              series={[
                { key: "income", label: "Income" },
                { key: "expenses", label: "Expenses" },
              ]}
              valueFormatter={(v) => eurFormatter(v)}
              onBarClick={handleIncomeExpenseClick}
            />
          </>
        );
      case "biggest-expenses":
        return (
          <div className="flex flex-col gap-2">
            {topExpenses.map((t) => (
              <button
                key={t.id}
                onClick={() => openDrilldownForSingle(t)}
                className="flex items-center justify-between w-full text-sm gap-2 text-left rounded hover:bg-neutral-100 -mx-1 px-1 py-0.5"
              >
                <div className="min-w-0">
                  <div className="truncate">{t.merchant_name ?? t.raw_description ?? "—"}</div>
                  <div className="text-xs text-neutral-500">
                    {new Date(t.booked_at).toLocaleDateString("en-US")} · {t.categories?.name ?? UNCATEGORIZED}
                  </div>
                </div>
                <span className="tabular-nums shrink-0 font-medium">{eurFormatter(Math.abs(t.eurAmount as number))}</span>
              </button>
            ))}
            {topExpenses.length === 0 && <p className="text-sm text-neutral-500">No expenses in this range.</p>}
          </div>
        );
      case "top-merchants":
        return (
          <div className="flex flex-col gap-2">
            {topMerchants.map((m) => (
              <button
                key={m.name}
                onClick={() => openDrilldownForMerchant(m.name)}
                className="flex items-center justify-between w-full text-sm gap-2 text-left rounded hover:bg-neutral-100 -mx-1 px-1 py-0.5"
              >
                <span className="truncate">{m.name}</span>
                <span className="tabular-nums shrink-0 font-medium">{eurFormatter(m.value)}</span>
              </button>
            ))}
            {topMerchants.length === 0 && <p className="text-sm text-neutral-500">No expenses in this range.</p>}
          </div>
        );
      case "investment-holdings":
        return holdings.length > 0 ? (
          <HoldingsTable holdings={holdings} isPrivate={isPrivate} />
        ) : (
          <p className="text-sm text-neutral-500">No holdings yet.</p>
        );
      default: {
        const w = aiById.get(id);
        if (!w) return null;
        return <AiWidgetCard spec={w.spec} data={w.data} error={w.error} onBucketClick={(bucket) => void handleAiBucketClick(w, bucket)} />;
      }
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-1 flex-wrap">
        <h1 className="text-2xl font-semibold">Analysis</h1>
        <DateRangeFilter
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          onChange={(p, _range, from, to) => {
            setPreset(p);
            setCustomFrom(from);
            setCustomTo(to);
          }}
        />
      </div>
      <p className="text-sm text-muted mb-4">Internal transfers are excluded from every chart below.</p>

      <div className="mb-6">
        {isDemoMode() ? (
          <p className="text-xs text-muted">{DEMO_AI_NOTE}</p>
        ) : (
          <AiWidgetChat page="analysis" onWidgetAdded={() => setAiWidgetsRefreshKey((k) => k + 1)} />
        )}
      </div>

      {unconverted && (
        <div className="mb-6 rounded-md border border-accent-300 bg-accent-100 p-3 text-sm text-accent-700">
          <strong>{unconverted.count} transaction{unconverted.count === 1 ? "" : "s"} excluded from every figure below</strong> —
          no cached exchange rate for {unconverted.currencies.join(", ")}. Reload this page in a moment to trigger a
          refresh; if it persists, make sure you&apos;re signed in (writing to{" "}
          <code className="rounded bg-neutral-200 px-1 py-0.5">fx_rates</code> requires an active
          session — see <code className="rounded bg-neutral-200 px-1 py-0.5">supabase/migrations/010_enable_rls.sql</code>)
          or that the currency is actually a supported symbol.
        </div>
      )}

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger">Error: {error}</p>}

      {!loading && !error && layout.ready && (
        <>
          <p className="text-xs text-neutral-400 mb-3">
            Drag any chart by its ⠿ handle, or use ⤒ ↑ ↓ to reorder. Click any chart piece to see what&apos;s behind it.
            Hiding removes it from view — restore below.
          </p>
          <div className="flex flex-col gap-6">
            {visibleOrder.map((id) => {
              const isAi = id.startsWith("ai:");
              const widgetId = isAi ? id.slice(3) : null;
              return (
                <SortableSection
                  key={id}
                  id={id}
                  title={sectionTitle(id)}
                  isFirst={visibleOrder[0] === id}
                  isLast={visibleOrder[visibleOrder.length - 1] === id}
                  isDropTarget={dropTargetId === id && dragId !== id}
                  onMoveUp={() => layout.move(id, -1)}
                  onMoveDown={() => layout.move(id, 1)}
                  onMoveTop={() => layout.moveToTop(id)}
                  onHide={() => {
                    if (isAi && widgetId) void removeAiWidget(widgetId);
                    else layout.hide(id);
                  }}
                  hideLabel={isAi ? "Remove" : "Hide"}
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropTargetId(null);
                  }}
                  onDragOver={() => {
                    if (dropTargetId !== id) setDropTargetId(id);
                  }}
                  onDrop={() => handleDropOn(id)}
                >
                  {renderSectionBody(id)}
                </SortableSection>
              );
            })}
          </div>

          {hiddenSections.length > 0 && (
            <div className="mt-6 rounded-lg border border-dashed border-divider p-4">
              <h2 className="text-sm font-medium text-muted mb-2">
                Hidden charts ({hiddenSections.length})
              </h2>
              <div className="flex flex-col gap-1.5">
                {hiddenSections.map((id) => (
                  <div key={id} className="flex items-center justify-between text-sm">
                    <span className="text-muted">{sectionTitle(id)}</span>
                    <button onClick={() => layout.restore(id)} className="text-xs underline hover:no-underline">
                      Show
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={layout.reset} className="mt-3 text-xs text-muted hover:underline">
                Reset layout to default
              </button>
            </div>
          )}
        </>
      )}

      {drilldown && (
        <TransactionListModal
          title={drilldown.title}
          transactions={drilldown.transactions}
          isPrivate={isPrivate}
          onClose={() => setDrilldown(null)}
        />
      )}
      {aiDrillLoading && !aiTxnDrilldown && !aiAcctDrilldown && (
        <div className="dialog-backdrop z-50">
          <div className="bg-surface rounded-lg elev-lg px-6 py-4 text-sm">Loading…</div>
        </div>
      )}
      {aiTxnDrilldown && (
        <TransactionListModal
          title={aiTxnDrilldown.title}
          transactions={aiTxnDrilldown.transactions}
          isPrivate={isPrivate}
          onClose={() => setAiTxnDrilldown(null)}
        />
      )}
      {aiAcctDrilldown && (
        <AccountListModal
          title={aiAcctDrilldown.title}
          accounts={aiAcctDrilldown.accounts}
          isPrivate={isPrivate}
          onClose={() => setAiAcctDrilldown(null)}
        />
      )}
    </div>
  );
}
