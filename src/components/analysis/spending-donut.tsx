import { DONUT_TRACK_COLOR, categoryColor } from "./category-colors";

export type DonutSlice = {
  name: string;
  /** Raw numeric value; segment sizes are derived from these. */
  value: number;
  /** Pre-formatted amount, e.g. "€612". Rendered with tabular-nums. */
  display: string;
  /** Pre-formatted share, e.g. "28%". Rendered with tabular-nums. */
  pct: string;
};

const R = 15.9;

type Segment = DonutSlice & { color: string; dasharray: string; dashoffset: number };

function computeSegments(slices: DonutSlice[]): Segment[] {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return slices.map((s) => ({ ...s, color: categoryColor(s.name), dasharray: "", dashoffset: 0 }));
  let start = 0;
  return slices.map((s, i) => {
    // Last segment takes the remainder so rounding never leaves a gap.
    const frac = i === slices.length - 1 ? 100 - start : (s.value / total) * 100;
    const segment = {
      ...s,
      color: categoryColor(s.name),
      dasharray: `${frac} ${100 - frac}`,
      dashoffset: 25 - start,
    };
    start += frac;
    return segment;
  });
}

export function SpendingDonut({
  slices,
  totalLabel,
  caption,
}: {
  slices: DonutSlice[];
  totalLabel: string;
  caption: string;
}) {
  const segments = computeSegments(slices);

  return (
    <div className="flex items-center gap-10">
      <svg width="200" height="200" viewBox="0 0 42 42" role="img" aria-label={`Spending donut, total ${totalLabel}`}>
        <circle cx="21" cy="21" r={R} fill="transparent" stroke={DONUT_TRACK_COLOR} strokeWidth="5" />
        {segments.map((s) => (
          <circle
            key={s.name}
            cx="21"
            cy="21"
            r={R}
            fill="transparent"
            stroke={s.color}
            strokeWidth="5"
            strokeDasharray={s.dasharray}
            strokeDashoffset={s.dashoffset}
          />
        ))}
        <text x="21" y="19" textAnchor="middle" fontSize="4.5" fontWeight="700" className="fill-ink font-sans">
          {totalLabel}
        </text>
        <text x="21" y="24" textAnchor="middle" fontSize="2.6" className="fill-muted font-sans">
          {caption}
        </text>
      </svg>
      <div className="flex-1">
        {segments.map((s) => (
          <div
            key={s.name}
            className="flex items-center border-b border-border py-2 text-[13.5px] last:border-b-0"
          >
            <span
              aria-hidden="true"
              className="mr-2.5 h-[9px] w-[9px] shrink-0 rounded-[2px]"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1 text-ink-soft">{s.name}</span>
            <span className="mr-2.5 font-semibold tabular-nums">{s.display}</span>
            <span className="w-[38px] text-right text-muted tabular-nums">{s.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
