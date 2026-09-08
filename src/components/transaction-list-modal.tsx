"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/formatMoney";

export type ModalTransaction = {
  id: string;
  booked_at: string;
  amount: number;
  currency: string;
  merchant_name: string | null;
  raw_description: string | null;
  categories: { name: string } | null;
};

type SortBy = "date" | "amount";
type SortDir = "asc" | "desc";

function sortIndicator(active: boolean, dir: SortDir) {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

// Drill-down list shown from a chart click (a month's bar/point) or a "Biggest expenses" /
// "Top merchants" row — same component either way, just a different pre-filtered list.
export function TransactionListModal({
  title,
  transactions,
  isPrivate,
  onClose,
}: {
  title: string;
  transactions: ModalTransaction[];
  isPrivate: boolean;
  onClose: () => void;
}) {
  // Defaults to date order (matching the order callers already pass in) — switching to
  // "Amount" starts at highest-first, since that's the comparison people actually want when
  // auditing why a period was expensive (find the big-ticket items first).
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(column: SortBy) {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    const rows = [...transactions].sort((a, b) => {
      const cmp = sortBy === "date" ? a.booked_at.localeCompare(b.booked_at) : a.amount - b.amount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [transactions, sortBy, sortDir]);

  return (
    <div className="dialog-backdrop z-50" onClick={onClose}>
      <div
        className="bg-surface rounded-lg elev-lg border border-divider max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-divider shrink-0">
          <h3 className="dialog-title text-base">
            {title}{" "}
            <span className="text-muted font-body font-normal text-sm">
              ({transactions.length} transaction{transactions.length === 1 ? "" : "s"})
            </span>
          </h3>
          <button onClick={onClose} className="shrink-0 text-muted hover:text-text" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-200 text-xs text-muted shrink-0">
          <span>Sort by</span>
          <button onClick={() => toggleSort("date")} className={`hover:underline ${sortBy === "date" ? "text-accent font-medium" : ""}`}>
            Date{sortIndicator(sortBy === "date", sortDir)}
          </button>
          <button
            onClick={() => toggleSort("amount")}
            className={`hover:underline ${sortBy === "amount" ? "text-accent font-medium" : ""}`}
          >
            Amount{sortIndicator(sortBy === "amount", sortDir)}
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {sorted.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 px-2 py-2 border-b border-neutral-200 last:border-0 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate">{t.merchant_name ?? t.raw_description ?? "—"}</div>
                <div className="text-xs text-muted">
                  {new Date(t.booked_at).toLocaleDateString("en-US")} · {t.categories?.name ?? "Uncategorized"}
                </div>
              </div>
              <span className={`tabular-nums shrink-0 font-medium ${t.amount < 0 ? "text-danger" : "text-success"}`}>
                {formatMoney(t.amount, t.currency, isPrivate)}
              </span>
            </div>
          ))}
          {transactions.length === 0 && <p className="text-sm text-muted p-6 text-center">No transactions.</p>}
        </div>
      </div>
    </div>
  );
}
