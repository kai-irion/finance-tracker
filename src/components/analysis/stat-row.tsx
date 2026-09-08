export type StatDeltaTone = "down" | "up" | "neutral";

export type Stat = {
  label: string;
  value: string;
  delta: string;
  deltaTone: StatDeltaTone;
};

const DELTA_TONE_CLASS: Record<StatDeltaTone, string> = {
  // Redesign: .stat-delta.down (green accent) / .up (warm) / plain (muted).
  down: "text-accent",
  up: "text-warm",
  neutral: "text-muted",
};

export function StatCard({ label, value, delta, deltaTone }: Stat) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 font-sans">
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums text-ink">{value}</div>
      <div className={`mt-1 text-xs ${DELTA_TONE_CLASS[deltaTone]}`}>{delta}</div>
    </div>
  );
}

export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}
