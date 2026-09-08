"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORICAL, CHART_INK, CHART_TOOLTIP_STYLE } from "./palette";

export type BarSeriesDef = { key: string; label: string };

// Multiple data series sharing an x-axis (e.g. Income vs Expenses per month) — each series
// keeps one color across every x value, unlike ComparisonBarChart's per-bar coloring.
export function GroupedBarChart({
  data,
  xKey,
  xTickFormatter,
  series,
  valueFormatter,
  onBarClick,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  xTickFormatter?: (value: string) => string;
  series: BarSeriesDef[];
  valueFormatter: (value: number) => string;
  onBarClick?: (xValue: string) => void;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No data yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        onClick={(state) => {
          if (onBarClick && state?.activeLabel) onBarClick(String(state.activeLabel));
        }}
        style={{ cursor: onBarClick ? "pointer" : undefined }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={xTickFormatter}
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.grid }}
        />
        <YAxis
          tickFormatter={valueFormatter}
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={90}
        />
        <Tooltip
          formatter={(value) => valueFormatter(Number(value))}
          labelFormatter={xTickFormatter ? (v) => xTickFormatter(String(v)) : undefined}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        {series.length > 1 && <Legend />}
        {series.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={CATEGORICAL[index % CATEGORICAL.length]}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
