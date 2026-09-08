"use client";

import { DATE_RANGE_PRESETS, computeDateRange, type DateRange, type DateRangePreset } from "@/lib/dateRanges";

export function DateRangeFilter({
  preset,
  customFrom,
  customTo,
  onChange,
}: {
  preset: DateRangePreset;
  customFrom: string;
  customTo: string;
  onChange: (preset: DateRangePreset, range: DateRange, customFrom: string, customTo: string) => void;
}) {
  function selectPreset(next: DateRangePreset) {
    onChange(next, computeDateRange(next, { from: customFrom, to: customTo }), customFrom, customTo);
  }

  function updateCustom(from: string, to: string) {
    onChange("custom", { from: from || null, to: to || null }, from, to);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {DATE_RANGE_PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => selectPreset(p.key)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
            preset === p.key ? "border-accent text-accent bg-accent-100" : "border-divider hover:bg-neutral-100"
          }`}
        >
          {p.label}
        </button>
      ))}
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => updateCustom(e.target.value, customTo)}
            className="rounded-md border border-divider bg-transparent px-2 py-1 text-xs"
          />
          <span className="text-xs text-neutral-500">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => updateCustom(customFrom, e.target.value)}
            className="rounded-md border border-divider bg-transparent px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}
