export type DateRangePreset = "last30" | "thisMonth" | "thisYear" | "allTime" | "custom";

// ISO date strings (yyyy-mm-dd); null on either end means unbounded in that direction.
export type DateRange = { from: string | null; to: string | null };

// Local calendar date as "yyyy-mm-dd" — NOT `d.toISOString().slice(0, 10)`, which converts
// through UTC first and silently shifts the date backward by a day for any timezone ahead of
// UTC (e.g. local Aug 1 00:00 CEST is still July 31 22:00 UTC), corrupting "this month" etc.
export function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Local calendar date of a stored UTC timestamp (e.g. transactions.booked_at) — use this
// instead of `isoDateTime.slice(0, 10)` when comparing against a DateRange from
// computeDateRange(), since that raw slice reads the UTC date and would misclassify
// transactions booked near local midnight (same UTC-vs-local mismatch as toISODate above).
export function localDateOf(isoDateTime: string): string {
  return toISODate(new Date(isoDateTime));
}

export function computeDateRange(preset: DateRangePreset, custom?: { from: string; to: string }): DateRange {
  const now = new Date();
  switch (preset) {
    case "last30": {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      return { from: toISODate(from), to: toISODate(now) };
    }
    case "thisMonth":
      return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
    case "thisYear":
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: toISODate(now) };
    case "allTime":
      return { from: null, to: null };
    case "custom":
      return { from: custom?.from || null, to: custom?.to || null };
  }
}

// "2026-03" — used to bucket transactions into monthly chart series. Derived from the local
// calendar date (see localDateOf) so a transaction booked near local midnight lands in the
// month the user actually experienced it in, not shifted by the UTC storage offset.
export function monthKey(isoDateTime: string): string {
  return localDateOf(isoDateTime).slice(0, 7);
}

export function monthLabel(monthKeyStr: string): string {
  const [year, month] = monthKeyStr.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export const DATE_RANGE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "last30", label: "Last 30 days" },
  { key: "thisMonth", label: "This month" },
  { key: "thisYear", label: "This year" },
  { key: "allTime", label: "All time" },
  { key: "custom", label: "Custom" },
];
