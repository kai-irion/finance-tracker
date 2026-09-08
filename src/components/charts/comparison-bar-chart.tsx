"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORICAL, CHART_INK, CHART_TOOLTIP_STYLE } from "./palette";

export type BarDatum = { label: string; value: number };

// One color per bar (Cell-based) — for comparing distinct categorical buckets (e.g. "This
// month" / "Last month" / "Same month last year"), not multiple data series across a shared
// x-axis (see GroupedBarChart for that case).
export function ComparisonBarChart({
  data,
  valueFormatter,
  onBarClick,
}: {
  data: BarDatum[];
  valueFormatter: (value: number) => string;
  onBarClick?: (label: string) => void;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No data yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        onClick={(state) => {
          if (onBarClick && state?.activeLabel) onBarClick(String(state.activeLabel));
        }}
        style={{ cursor: onBarClick ? "pointer" : undefined }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} vertical={false} />
        <XAxis dataKey="label" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} />
        <YAxis
          tickFormatter={valueFormatter}
          stroke={CHART_INK.muted}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={90}
        />
        <Tooltip formatter={(value) => valueFormatter(Number(value))} contentStyle={CHART_TOOLTIP_STYLE} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64} isAnimationActive={false}>
          {data.map((entry, index) => (
            <Cell key={entry.label} fill={CATEGORICAL[index % CATEGORICAL.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
