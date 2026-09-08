"use client";

import { useEffect, useRef, useState } from "react";

export type MultiSelectOption = { id: string; label: string; group?: string };

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  compact = false,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  // Renders just a small filter icon (for embedding in a table column header) instead of the
  // full "Label: summary" button — the popover content is identical either way.
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  const groups = new Map<string, MultiSelectOption[]>();
  for (const opt of options) {
    const key = opt.group ?? "";
    const list = groups.get(key) ?? [];
    list.push(opt);
    groups.set(key, list);
  }

  const summary = selected.size === 0 ? `All ${label.toLowerCase()}` : `${selected.size} selected`;

  return (
    <div ref={ref} className="relative inline-block">
      {compact ? (
        <button
          onClick={() => setOpen((v) => !v)}
          title={`Filter ${label} (${summary})`}
          className={`ml-1 rounded p-0.5 align-middle ${
            selected.size > 0 ? "text-accent" : "text-neutral-400 hover:text-neutral-700"
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path
              fillRule="evenodd"
              d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.66 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-divider bg-transparent px-3 py-1.5 text-sm whitespace-nowrap"
        >
          {label}: {summary}
        </button>
      )}
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-divider bg-surface elev-md p-2">
          {selected.size > 0 && (
            <button onClick={() => onChange(new Set())} className="mb-1 text-xs text-muted hover:underline">
              Clear all
            </button>
          )}
          {Array.from(groups.entries()).map(([group, opts]) => (
            <div key={group || "_"} className="mb-2">
              {group && <div className="px-1 text-xs font-medium text-muted mb-1">{group}</div>}
              {opts.map((opt) => (
                <label key={opt.id} className="flex items-center gap-2 px-1 py-0.5 text-sm rounded hover:bg-neutral-100">
                  <input type="checkbox" checked={selected.has(opt.id)} onChange={() => toggle(opt.id)} />
                  {opt.label}
                </label>
              ))}
            </div>
          ))}
          {options.length === 0 && <p className="px-1 text-xs text-neutral-400">No options.</p>}
        </div>
      )}
    </div>
  );
}
