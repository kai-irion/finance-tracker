"use client";

import { useState } from "react";

const DEFAULT_SEGMENTS = ["30 days", "This month", "This year", "All time"];

export function AnalysisHeader({
  title = "Analysis",
  subtitle = "Internal transfers are excluded from every chart below.",
  segments = DEFAULT_SEGMENTS,
  defaultActive = "This month",
  onSegmentChange,
}: {
  title?: string;
  subtitle?: string;
  segments?: string[];
  defaultActive?: string;
  onSegmentChange?: (segment: string) => void;
}) {
  const [active, setActive] = useState(defaultActive);

  function select(segment: string) {
    setActive(segment);
    onSegmentChange?.(segment);
  }

  return (
    <div className="mb-1.5 flex items-start justify-between gap-4 font-sans">
      <div>
        {/* Plain div (not h1): components.css's unlayered h1 rule would override utilities. */}
        <div className="text-[28px] font-bold tracking-[-0.02em] text-ink">{title}</div>
        <div className="mt-1 mb-6 text-[13px] text-muted">{subtitle}</div>
      </div>
      <div
        role="tablist"
        aria-label="Date range"
        className="flex shrink-0 gap-1 rounded-pill border border-border bg-surface p-[3px]"
      >
        {segments.map((segment) => (
          <button
            key={segment}
            role="tab"
            aria-selected={segment === active}
            onClick={() => select(segment)}
            className={`rounded-pill px-3.5 py-1.5 text-[13px] transition-colors ${
              segment === active ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"
            }`}
          >
            {segment}
          </button>
        ))}
      </div>
    </div>
  );
}
