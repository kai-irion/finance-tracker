"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_INK, CHART_TOOLTIP_STYLE } from "./palette";

// A single-series trend line reads as identity (net worth) rather than a categorical
// comparison, so it uses the accent directly rather than a CATEGORICAL palette slot —
// matches the design system's own net-worth sparkline (--color-accent-700).
const LINE_COLOR = "#7d5411";

export type NetWorthPoint = { date: string; totalBalanceEur: number };

const defaultFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" });

// This series can span several years at daily granularity, so "Aug 12" alone repeats
// identically every year with no way to tell which one — always include the year. Parses the
// "yyyy-mm-dd" string into local y/m/d components (not `new Date(dateStr)`, which reads a
// bare date as UTC midnight and can silently shift the displayed day backward by one in any
// timezone behind UTC — same pitfall toISODate/localDateOf in dateRanges.ts guard against).
function formatDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

// Axis ticks show only "Mon YY" (no day) — the tooltip still shows the full date on hover.
function formatAxisTick(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function NetWorthTrendChart({
  data,
  valueFormatter = (v) => defaultFormatter.format(v),
}: {
  data: NetWorthPoint[];
  valueFormatter?: (value: number) => string;
}) {
  // One tick per calendar year (the first data point on/after each Jan 1 present in the
  // series), so a multi-year "All time" range doesn't cram evenly-spaced arbitrary dates
  // onto the axis — assumes `data` is sorted ascending, which every caller already provides.
  const yearTicks = useMemo(() => {
    const seenYears = new Set<string>();
    const ticks: string[] = [];
    for (const point of data) {
      const year = point.date.slice(0, 4);
      if (!seenYears.has(year)) {
        seenYears.add(year);
        ticks.push(point.date);
      }
    }
    return ticks;
  }, [data]);

  if (data.length < 2) {
    return (
      <p className="text-sm text-muted">
        Not enough history yet — a snapshot is recorded on the first sync of each day, so the
        trend fills in over time.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} vertical={false} />
        <XAxis
          dataKey="date"
          ticks={yearTicks}
          interval={0}
          tickFormatter={formatAxisTick}
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
          labelFormatter={(v) => formatDateLabel(String(v))}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        <Line
          type="monotone"
          dataKey="totalBalanceEur"
          stroke={LINE_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
