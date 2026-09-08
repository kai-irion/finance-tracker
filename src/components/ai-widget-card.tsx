"use client";

import { CategoricalPieChart, type PieSlice } from "@/components/charts/categorical-pie-chart";
import { ComparisonBarChart, type BarDatum } from "@/components/charts/comparison-bar-chart";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { MultiSeriesLineChart } from "@/components/charts/multi-series-line-chart";
import { KpiTile } from "@/components/charts/kpi-tile";
import { formatMoney } from "@/lib/formatMoney";
import { usePrivacy } from "@/lib/privacy-context";
import type { WidgetSpec } from "@/lib/ai-widgets/spec";
import type { WidgetChartData } from "@/lib/ai-widgets/execute";

export function AiWidgetCard({
  spec,
  data,
  error,
  onBucketClick,
}: {
  spec: WidgetSpec;
  data: WidgetChartData | null;
  error: string | null;
  /** Called with the clicked slice/bar/point label (null = whole KPI card). Parent resolves + shows the drilldown modal. */
  onBucketClick?: (bucket: string | null) => void;
}) {
  const { isPrivate } = usePrivacy();
  const eurFormatter = (v: number) => formatMoney(v, "EUR", isPrivate);
  const valueFormatter = (metric: WidgetSpec["query"]["metric"]) =>
    metric === "count" ? (v: number) => v.toLocaleString("en-US") : eurFormatter;

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-black/50 dark:text-white/50">No data.</p>;

  const hint = onBucketClick ? (
    <p className="text-xs text-neutral-400 mt-2">Click to see the transactions behind it.</p>
  ) : null;

  if (data.kind === "kpi")
    return (
      <>
        {onBucketClick ? (
          <button onClick={() => onBucketClick(null)} className="block w-full text-left cursor-pointer" title="Show transactions">
            <KpiTile value={data.value} valueFormatter={valueFormatter(spec.query.metric)} />
          </button>
        ) : (
          <KpiTile value={data.value} valueFormatter={valueFormatter(spec.query.metric)} />
        )}
        {hint}
      </>
    );
  if (data.kind === "pie")
    return (
      <>
        <CategoricalPieChart
          data={data.slices as PieSlice[]}
          valueFormatter={valueFormatter(spec.query.metric)}
          emptyMessage="No data for this range."
          onSliceClick={onBucketClick ? (name) => onBucketClick(name) : undefined}
        />
        {hint}
      </>
    );
  if (data.kind === "bar")
    return (
      <>
        <ComparisonBarChart
          data={data.bars as BarDatum[]}
          valueFormatter={valueFormatter(spec.query.metric)}
          onBarClick={onBucketClick ? (label) => onBucketClick(label) : undefined}
        />
        {hint}
      </>
    );
  if (data.kind === "series" && spec.chartType === "grouped-bar")
    return (
      <>
        <GroupedBarChart
          data={data.rows}
          xKey={data.xKey}
          xTickFormatter={data.xTickFormatter}
          series={data.series}
          valueFormatter={valueFormatter(spec.query.metric)}
          onBarClick={onBucketClick ? (x) => onBucketClick(x) : undefined}
        />
        {hint}
      </>
    );
  if (data.kind === "series" && spec.chartType === "line")
    return (
      <>
        <MultiSeriesLineChart
          data={data.rows}
          xKey={data.xKey}
          xTickFormatter={data.xTickFormatter}
          series={data.series}
          valueFormatter={valueFormatter(spec.query.metric)}
          onPointClick={onBucketClick ? (x) => onBucketClick(x) : undefined}
        />
        {hint}
      </>
    );
  return null;
}
