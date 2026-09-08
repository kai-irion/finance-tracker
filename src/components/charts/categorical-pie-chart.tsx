"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CATEGORICAL, CHART_TOOLTIP_STYLE } from "./palette";

export type PieSlice = { name: string; value: number };

const defaultFormatter = (v: number) => v.toLocaleString("en-US");

export function CategoricalPieChart({
  data,
  valueFormatter = defaultFormatter,
  emptyMessage = "No data yet.",
  onSliceClick,
}: {
  data: PieSlice[];
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
  onSliceClick?: (name: string) => void;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={110}
          onClick={(_, index) => {
            if (onSliceClick && typeof index === "number") {
              const entry = data[index];
              if (entry) onSliceClick(entry.name);
            }
          }}
          style={{ cursor: onSliceClick ? "pointer" : undefined }}
          // No inline labels: with one dominant slice and several tiny ones (the common case
          // for real spending/allocation data), positioned labels collide with each other and
          // with the pie itself no matter how they're placed. Legend + Tooltip cover the same
          // information without ever overlapping.
          // "auto" (the default) can get stuck at the zero-radius entrance keyframe instead
          // of resolving to the final sectors — Legend/Tooltip aren't animation-gated so they
          // render fine, but every <path> sector stays invisible. Disabling entrance
          // animation sidesteps that entirely; a pie chart doesn't need it anyway.
          isAnimationActive={false}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={CATEGORICAL[index % CATEGORICAL.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => valueFormatter(Number(value))} contentStyle={CHART_TOOLTIP_STYLE} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
