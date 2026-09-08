export function KpiTile({ value, valueFormatter }: { value: number; valueFormatter: (value: number) => string }) {
  return <div className="text-3xl font-semibold tabular-nums py-6">{valueFormatter(value)}</div>;
}
