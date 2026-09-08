"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Small filter-icon trigger + popover, meant to be embedded inline in a table <th> — each
// column carries its own filter control instead of a separate filter bar above the table.
export function HeaderFilterPopover({
  label,
  active,
  children,
  align = "left",
}: {
  label: string;
  active: boolean;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <span ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Filter ${label}`}
        className={`ml-1 rounded p-0.5 align-middle ${
          active ? "text-accent" : "text-neutral-400 hover:text-neutral-700"
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
      {open && (
        <div
          className={`absolute z-20 top-full mt-1 ${
            align === "right" ? "right-0" : "left-0"
          } min-w-[16rem] rounded-md border border-divider bg-surface elev-md p-3 font-normal normal-case`}
        >
          {children}
        </div>
      )}
    </span>
  );
}
