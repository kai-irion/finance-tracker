// Declarative shape for an AI-generated chart: the model never writes chart code or SQL, only
// a JSON object matching this schema. validateWidgetSpec() is the enforcement point — if the
// model hallucinates a field/table/value outside what's listed here, the spec is rejected and
// nothing is saved or rendered, regardless of what the model claimed. See execute.ts for how a
// validated spec is turned into chart data, and route.ts (api/ai-widgets/chat) for where
// validation happens.

export const CHART_TYPES = ["pie", "bar", "grouped-bar", "line", "kpi"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const SOURCES = ["transactions", "accounts"] as const;
export type WidgetSource = (typeof SOURCES)[number];

export const METRICS = ["sum", "count", "avg"] as const;
export type Metric = (typeof METRICS)[number];

export const GROUP_BYS = ["category", "merchant", "account_type", "provider", "month", "none"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export const AMOUNT_SIGNS = ["negative", "positive", "any"] as const;
export type AmountSign = (typeof AMOUNT_SIGNS)[number];

export const RELATIVE_DATE_RANGES = [
  "this_month",
  "this_year",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "all_time",
] as const;
export type RelativeDateRange = (typeof RELATIVE_DATE_RANGES)[number];

export const SERIES_SPLITS = ["income_vs_expense"] as const;
export type SeriesSplit = (typeof SERIES_SPLITS)[number];

const MAX_LIST_LEN = 20;
const MAX_STRING_LEN = 80;

export type WidgetFilters = {
  relativeDateRange?: RelativeDateRange;
  amountSign?: AmountSign;
  categoryNames?: string[];
  accountTypes?: string[];
  providers?: string[];
};

export type WidgetQuery = {
  source: WidgetSource;
  metric: Metric;
  groupBy: GroupBy;
  seriesSplit?: SeriesSplit;
  filters?: WidgetFilters;
};

export type WidgetSpec = {
  title: string;
  chartType: ChartType;
  query: WidgetQuery;
};

type ValidationResult = { ok: true; spec: WidgetSpec } | { ok: false; error: string };

function isStringArray(v: unknown, maxLen = MAX_LIST_LEN): v is string[] {
  return Array.isArray(v) && v.length <= maxLen && v.every((x) => typeof x === "string" && x.length <= MAX_STRING_LEN);
}

// Which (chartType, groupBy, source, seriesSplit) combinations are renderable — kept in one
// place so an AI-produced spec can't request a shape execute.ts has no code path for (e.g. a
// "line" chart grouped by "category" instead of "month", or a "kpi" with a groupBy at all).
function validateCombination(chartType: ChartType, query: WidgetQuery): string | null {
  const { source, groupBy, seriesSplit } = query;

  if (chartType === "kpi") {
    if (groupBy !== "none") return 'chartType "kpi" requires query.groupBy "none".';
    return null;
  }
  if (groupBy === "none") return `groupBy "none" is only valid with chartType "kpi".`;

  if (chartType === "pie") {
    if (!["category", "merchant", "account_type", "provider"].includes(groupBy)) {
      return 'chartType "pie" requires groupBy one of category, merchant, account_type, provider.';
    }
  }
  if (chartType === "bar") {
    if (!["category", "merchant", "account_type", "provider", "month"].includes(groupBy)) {
      return 'chartType "bar" requires groupBy one of category, merchant, account_type, provider, month.';
    }
    if (groupBy === "month" && seriesSplit) return 'chartType "bar" with groupBy "month" cannot use seriesSplit — use "grouped-bar" instead.';
  }
  if (chartType === "line" && groupBy !== "month") return 'chartType "line" requires groupBy "month".';
  if (chartType === "grouped-bar") {
    if (groupBy !== "month") return 'chartType "grouped-bar" requires groupBy "month".';
    if (seriesSplit !== "income_vs_expense") return 'chartType "grouped-bar" requires seriesSplit "income_vs_expense".';
  }

  if (["category", "merchant"].includes(groupBy) && source !== "transactions") {
    return `groupBy "${groupBy}" requires query.source "transactions".`;
  }
  if (groupBy === "month" && source !== "transactions") {
    return 'groupBy "month" requires query.source "transactions" (no time series is available for accounts).';
  }
  if (seriesSplit && source !== "transactions") {
    return 'seriesSplit requires query.source "transactions".';
  }

  return null;
}

export function validateWidgetSpec(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Spec must be a JSON object." };
  const obj = input as Record<string, unknown>;

  if (typeof obj.title !== "string" || obj.title.trim().length === 0 || obj.title.length > MAX_STRING_LEN) {
    return { ok: false, error: `title must be a non-empty string up to ${MAX_STRING_LEN} characters.` };
  }
  if (typeof obj.chartType !== "string" || !CHART_TYPES.includes(obj.chartType as ChartType)) {
    return { ok: false, error: `chartType must be one of: ${CHART_TYPES.join(", ")}.` };
  }
  const chartType = obj.chartType as ChartType;

  if (typeof obj.query !== "object" || obj.query === null) return { ok: false, error: "query must be an object." };
  const q = obj.query as Record<string, unknown>;

  if (typeof q.source !== "string" || !SOURCES.includes(q.source as WidgetSource)) {
    return { ok: false, error: `query.source must be one of: ${SOURCES.join(", ")}.` };
  }
  if (typeof q.metric !== "string" || !METRICS.includes(q.metric as Metric)) {
    return { ok: false, error: `query.metric must be one of: ${METRICS.join(", ")}.` };
  }
  if (typeof q.groupBy !== "string" || !GROUP_BYS.includes(q.groupBy as GroupBy)) {
    return { ok: false, error: `query.groupBy must be one of: ${GROUP_BYS.join(", ")}.` };
  }
  if (q.seriesSplit !== undefined && (typeof q.seriesSplit !== "string" || !SERIES_SPLITS.includes(q.seriesSplit as SeriesSplit))) {
    return { ok: false, error: `query.seriesSplit, if present, must be one of: ${SERIES_SPLITS.join(", ")}.` };
  }

  let filters: WidgetFilters | undefined;
  if (q.filters !== undefined) {
    if (typeof q.filters !== "object" || q.filters === null) return { ok: false, error: "query.filters must be an object." };
    const f = q.filters as Record<string, unknown>;
    if (f.relativeDateRange !== undefined && !RELATIVE_DATE_RANGES.includes(f.relativeDateRange as RelativeDateRange)) {
      return { ok: false, error: `query.filters.relativeDateRange must be one of: ${RELATIVE_DATE_RANGES.join(", ")}.` };
    }
    if (f.amountSign !== undefined && !AMOUNT_SIGNS.includes(f.amountSign as AmountSign)) {
      return { ok: false, error: `query.filters.amountSign must be one of: ${AMOUNT_SIGNS.join(", ")}.` };
    }
    if (f.categoryNames !== undefined && !isStringArray(f.categoryNames)) {
      return { ok: false, error: `query.filters.categoryNames must be an array of up to ${MAX_LIST_LEN} strings.` };
    }
    if (f.accountTypes !== undefined && !isStringArray(f.accountTypes)) {
      return { ok: false, error: `query.filters.accountTypes must be an array of up to ${MAX_LIST_LEN} strings.` };
    }
    if (f.providers !== undefined && !isStringArray(f.providers)) {
      return { ok: false, error: `query.filters.providers must be an array of up to ${MAX_LIST_LEN} strings.` };
    }
    filters = {
      relativeDateRange: f.relativeDateRange as RelativeDateRange | undefined,
      amountSign: f.amountSign as AmountSign | undefined,
      categoryNames: f.categoryNames as string[] | undefined,
      accountTypes: f.accountTypes as string[] | undefined,
      providers: f.providers as string[] | undefined,
    };
  }

  const query: WidgetQuery = {
    source: q.source as WidgetSource,
    metric: q.metric as Metric,
    groupBy: q.groupBy as GroupBy,
    seriesSplit: q.seriesSplit as SeriesSplit | undefined,
    filters,
  };

  const comboError = validateCombination(chartType, query);
  if (comboError) return { ok: false, error: comboError };

  return { ok: true, spec: { title: obj.title.trim(), chartType, query } };
}

// Fed into the AI's system prompt (see api/ai-widgets/chat/route.ts) so it only ever proposes
// combinations validateWidgetSpec() can accept — actual category/account names are appended
// separately at request time since they're per-user data, not part of the fixed schema.
export const WIDGET_SCHEMA_DESCRIPTION = `You can build charts from exactly two data sources:

1. "transactions" — every booked transaction, each with: an amount (signed; negative = money out, positive = money in) converted to EUR, a category, a merchant name, a month, and the account it belongs to (which has an account_type and a provider). Internal transfers between the user's own accounts are always excluded automatically.
2. "accounts" — the user's financial accounts, each with a balance (converted to EUR), an account_type (e.g. checking, savings, credit, loan, investment, crypto), and a provider (the bank/platform name).

A widget spec has:
- title: short chart title, shown to the user.
- chartType: one of "pie", "bar", "grouped-bar", "line", "kpi".
- query.source: "transactions" or "accounts".
- query.metric: "sum", "count", or "avg" — aggregated as an absolute-value magnitude (e.g. total spending, not net cash flow), except for grouped-bar/line with seriesSplit "income_vs_expense" where income and expenses are each summed on their own sign.
- query.groupBy: "category" | "merchant" | "account_type" | "provider" | "month" | "none".
- query.seriesSplit: only "income_vs_expense", only allowed with groupBy "month".
- query.filters (all optional): relativeDateRange ("this_month" | "this_year" | "last_3_months" | "last_6_months" | "last_12_months" | "all_time"), amountSign ("negative" for spending, "positive" for income/deposits, "any" for both), categoryNames (array of exact category names), accountTypes (array), providers (array).

Allowed combinations:
- chartType "kpi" → groupBy must be "none" (a single number, e.g. total debt, total savings, transaction count).
- chartType "pie" → groupBy one of category, merchant, account_type, provider.
- chartType "bar" → groupBy one of category, merchant, account_type, provider, month.
- chartType "line" → groupBy must be "month" (optionally seriesSplit "income_vs_expense" for two lines).
- chartType "grouped-bar" → groupBy must be "month" AND seriesSplit must be "income_vs_expense".
- groupBy "category" or "merchant" or "month" requires query.source "transactions".

If what the user is asking for cannot be built from the data described above — it names something this app doesn't track at all (e.g. credit score, budgets, stock performance, external investment returns) — do not invent a widget. Reply with a "message" response instead, explaining plainly what data is missing.`;
