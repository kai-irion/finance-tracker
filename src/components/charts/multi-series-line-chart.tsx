"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORICAL, CHART_INK, CHART_TOOLTIP_STYLE } from "./palette";

export type LineSeriesDef = { key: string; label: string };

export function MultiSeriesLineChart({
  data,
  xKey,
  xTickFormatter,
  series,
  valueFormatter,
  onPointClick,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  xTickFormatter: (value: string) => string;
  series: LineSeriesDef[];
  valueFormatter: (value: number) => string;
  onPointClick?: (xValue: string) => void;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No data yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        onClick={(state) => {
          if (onPointClick && state?.activeLabel) onPointClick(String(state.activeLabel));
        }}
        style={{ cursor: onPointClick ? "pointer" : undefined }}
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
          labelFormatter={(v) => xTickFormatter(String(v))}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        {series.length > 1 && <Legend />}
        {series.map((s, index) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={CATEGORICAL[index % CATEGORICAL.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
