"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { matchInternalTransfers } from "@/lib/matchInternalTransfers";
import { applyMerchantRule } from "@/lib/merchantRules";
import { DateRangeFilter } from "@/components/date-range-filter";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/multi-select-filter";
import { HeaderFilterPopover } from "@/components/header-filter-popover";
import { computeDateRange, localDateOf, type DateRangePreset } from "@/lib/dateRanges";
import { formatMoney } from "@/lib/formatMoney";
import { usePrivacy } from "@/lib/privacy-context";
import { computeAccountLabels, providerLabel } from "@/lib/accountLabels";
import type { Account, Category } from "@/lib/supabase/types";

export type TransactionRow = {
  id: string;
  booked_at: string;
  amount: number;
  currency: string;
  raw_description: string | null;
  merchant_name: string | null;
  account_id: string;
  category_id: string | null;
  is_internal_transfer: boolean;
  matched_transfer_id: string | null;
  needs_review: boolean;
  accounts: { name: string; provider: string } | null;
  categories: { name: string } | null;
};

type SortBy = "date" | "amount";
type SortDir = "asc" | "desc";

function sortIndicator(active: boolean, dir: SortDir) {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

// Full-featured transactions table — filtering (date/account/description/amount/category),
// sorting, needs-review tab + AI classify, category editing, "label sender" merchant rules,
// bulk select + bulk categorize, and internal-transfer marking. Shared between the main
// Transactions page (all accounts) and each account's detail page (scoped to one account) so
// both get identical capabilities instead of the detail page being a read-only subset.
export function TransactionsTable({
  transactions,
  accounts,
  categories,
  onReload,
  showAccountColumn = true,
}: {
  transactions: TransactionRow[];
  accounts: Account[];
  categories: Category[];
  onReload: () => Promise<void>;
  showAccountColumn?: boolean;
}) {
  const { isPrivate } = usePrivacy();

  const [rematching, setRematching] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [classifyMessage, setClassifyMessage] = useState<string | null>(null);
  const [classifyingMaps, setClassifyingMaps] = useState(false);
  const [classifyMapsMessage, setClassifyMapsMessage] = useState<string | null>(null);
  const [labelingTxId, setLabelingTxId] = useState<string | null>(null);
  const [labelPattern, setLabelPattern] = useState("");
  const [labelCategoryId, setLabelCategoryId] = useState("");
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelResult, setLabelResult] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkClassifying, setBulkClassifying] = useState<"maps" | "ai" | null>(null);
  const [rowClassifying, setRowClassifying] = useState<Set<string>>(new Set());

  const [accountFilter, setAccountFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [search, setSearch] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [preset, setPreset] = useState<DateRangePreset>("allTime");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = useMemo(() => computeDateRange(preset, { from: customFrom, to: customTo }), [preset, customFrom, customTo]);

  const accountLabels = useMemo(() => computeAccountLabels(accounts), [accounts]);
  const accountOptions: MultiSelectOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        id: a.id,
        label: accountLabels.get(a.id) ?? a.name,
        group: providerLabel(a.provider),
      })),
    [accounts, accountLabels]
  );
  const categoryOptions: MultiSelectOption[] = useMemo(
    () => categories.map((c) => ({ id: c.id, label: c.name })),
    [categories]
  );

  const needsReviewCount = useMemo(() => transactions.filter((t) => t.needs_review).length, [transactions]);

  const filtered = useMemo(() => {
    const min = amountMin.trim() ? Number(amountMin) : null;
    const max = amountMax.trim() ? Number(amountMax) : null;
    const query = search.trim().toLowerCase();

    const rows = transactions.filter((tx) => {
      if (needsReviewOnly && !tx.needs_review) return false;
      if (accountFilter.size > 0 && !accountFilter.has(tx.account_id)) return false;
      if (categoryFilter.size > 0 && (!tx.category_id || !categoryFilter.has(tx.category_id))) return false;
      if (min !== null && tx.amount < min) return false;
      if (max !== null && tx.amount > max) return false;
      if (range.from && localDateOf(tx.booked_at) < range.from) return false;
      if (range.to && localDateOf(tx.booked_at) > range.to) return false;
      if (query) {
        const haystack = `${tx.merchant_name ?? ""} ${tx.raw_description ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    const sorted = [...rows].sort((a, b) => {
      const cmp = sortBy === "date" ? a.booked_at.localeCompare(b.booked_at) : a.amount - b.amount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [transactions, needsReviewOnly, accountFilter, categoryFilter, amountMin, amountMax, search, range, sortBy, sortDir]);

  const dateActive = preset !== "allTime";
  const accountActive = accountFilter.size > 0;
  const categoryActive = categoryFilter.size > 0;
  const amountActive = amountMin.trim() !== "" || amountMax.trim() !== "";
  const searchActive = search.trim() !== "";
  const anyFilterActive =
    dateActive || accountActive || categoryActive || amountActive || searchActive || needsReviewOnly;

  function clearAllFilters() {
    setPreset("allTime");
    setCustomFrom("");
    setCustomTo("");
    setAccountFilter(new Set());
    setCategoryFilter(new Set());
    setAmountMin("");
    setAmountMax("");
    setSearch("");
    setNeedsReviewOnly(false);
  }

  function toggleSort(column: SortBy) {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir(column === "date" ? "desc" : "desc");
    }
  }

  // Looked up from the full (unfiltered) `transactions` list, so the matched partner's
  // account name resolves correctly even if the partner itself is hidden by the active filters
  // (or lives on a different account than the one this table is scoped to).
  const transactionsById = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions]);

  async function toggleInternalTransfer(tx: TransactionRow) {
    if (tx.is_internal_transfer) {
      await supabase
        .from("transactions")
        .update({ is_internal_transfer: false, matched_transfer_id: null, needs_review: false })
        .eq("id", tx.id);
      if (tx.matched_transfer_id) {
        await supabase
          .from("transactions")
          .update({ is_internal_transfer: false, matched_transfer_id: null, needs_review: false })
          .eq("id", tx.matched_transfer_id);
      }
    } else {
      await supabase.from("transactions").update({ is_internal_transfer: true }).eq("id", tx.id);
    }
    await onReload();
  }

  async function handleRematch() {
    setRematching(true);
    try {
      await matchInternalTransfers(supabase);
      await onReload();
    } finally {
      setRematching(false);
    }
  }

  async function handleClassifyAi() {
    setClassifying(true);
    setClassifyMessage(null);
    try {
      const res = await fetch("/api/transactions/classify-ai", { method: "POST" });
      const data: { classified: number; errors: string[]; remaining?: number } = await res.json();
      const parts = [`${data.classified} transaction${data.classified === 1 ? "" : "s"} classified.`];
      if (data.remaining) parts.push(`${data.remaining} still need review — click again to continue.`);
      if (data.errors.length > 0) parts.push(`Errors: ${data.errors.slice(0, 3).join(" ")}`);
      setClassifyMessage(parts.join(" "));
      await onReload();
    } catch (err) {
      setClassifyMessage(err instanceof Error ? err.message : "AI classification failed.");
    } finally {
      setClassifying(false);
    }
  }

  async function handleClassifyMaps() {
    setClassifyingMaps(true);
    setClassifyMapsMessage(null);
    try {
      const res = await fetch("/api/transactions/classify-maps", { method: "POST" });
      const data: { classified: number; matched: number; errors: string[]; remaining?: number } = await res.json();
      const parts = [`${data.classified} transaction${data.classified === 1 ? "" : "s"} classified from ${data.matched} matched merchant${data.matched === 1 ? "" : "s"}.`];
      if (data.remaining) parts.push(`${data.remaining} merchants still need review — click again to continue.`);
      if (data.errors.length > 0) parts.push(`Errors: ${data.errors.slice(0, 3).join(" ")}`);
      setClassifyMapsMessage(parts.join(" "));
      await onReload();
    } catch (err) {
      setClassifyMapsMessage(err instanceof Error ? err.message : "Maps classification failed.");
    } finally {
      setClassifyingMaps(false);
    }
  }

  // Shared by the bulk-selection toolbar and the per-row single-transaction actions below —
  // both pass an explicit `ids` list, which classify-maps/classify-ai treat as "classify exactly
  // these, no truncation" rather than the backlog-batch mode the header buttons use.
  async function classifyByIds(kind: "maps" | "ai", ids: string[]): Promise<string> {
    const url = kind === "maps" ? "/api/transactions/classify-maps" : "/api/transactions/classify-ai";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data: { classified: number; matched?: number; errors: string[] } = await res.json();
    const parts =
      kind === "maps"
        ? [`${data.classified} of ${ids.length} classified via Maps (${data.matched ?? 0} merchant match${data.matched === 1 ? "" : "es"}).`]
        : [`${data.classified} of ${ids.length} classified via AI.`];
    if (data.errors.length > 0) parts.push(`Errors: ${data.errors.slice(0, 3).join(" ")}`);
    return parts.join(" ");
  }

  async function handleBulkClassify(kind: "maps" | "ai") {
    if (selectedIds.size === 0) return;
    setBulkClassifying(kind);
    const ids = Array.from(selectedIds);
    try {
      const message = await classifyByIds(kind, ids);
      if (kind === "maps") setClassifyMapsMessage(message);
      else setClassifyMessage(message);
      setSelectedIds(new Set());
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Classification failed.";
      if (kind === "maps") setClassifyMapsMessage(msg);
      else setClassifyMessage(msg);
    } finally {
      setBulkClassifying(null);
    }
  }

  async function handleRowClassify(kind: "maps" | "ai", tx: TransactionRow) {
    setRowClassifying((prev) => new Set(prev).add(tx.id));
    try {
      const message = await classifyByIds(kind, [tx.id]);
      if (kind === "maps") setClassifyMapsMessage(message);
      else setClassifyMessage(message);
      await onReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Classification failed.";
      if (kind === "maps") setClassifyMapsMessage(msg);
      else setClassifyMessage(msg);
    } finally {
      setRowClassifying((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
    }
  }

  function startLabeling(tx: TransactionRow) {
    setLabelingTxId(tx.id);
    setLabelPattern(tx.merchant_name ?? tx.raw_description ?? "");
    setLabelCategoryId(tx.category_id ?? categories[0]?.id ?? "");
    setLabelResult(null);
  }

  async function submitLabelRule() {
    if (!labelPattern.trim() || !labelCategoryId) return;
    setLabelSaving(true);
    setLabelResult(null);
    const result = await applyMerchantRule(supabase, labelPattern, labelCategoryId);
    setLabelSaving(false);
    if (result.error) {
      setLabelResult(`Error: ${result.error}`);
      return;
    }
    setLabelResult(
      `Rule saved. ${result.updated} transaction${result.updated === 1 ? "" : "s"} categorized now; future matching transactions will be too.`
    );
    await onReload();
  }

  async function handleCategoryChange(tx: TransactionRow, categoryId: string) {
    const newCategoryId = categoryId || null;
    await supabase
      .from("transactions")
      .update({ category_id: newCategoryId, category_source: "manual" })
      .eq("id", tx.id);
    await onReload();
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const allSelected = filtered.length > 0 && filtered.every((tx) => prev.has(tx.id));
      if (allSelected) return new Set();
      return new Set(filtered.map((tx) => tx.id));
    });
  }

  async function handleBulkCategorize() {
    if (!bulkCategoryId || selectedIds.size === 0) return;
    setBulkSaving(true);
    await supabase
      .from("transactions")
      .update({ category_id: bulkCategoryId, category_source: "manual" })
      .in("id", Array.from(selectedIds));
    setBulkSaving(false);
    setSelectedIds(new Set());
    setBulkCategoryId("");
    await onReload();
  }

  const columnCount = showAccountColumn ? 7 : 6;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <p className="text-sm text-muted">
          {transactions.length} transaction{transactions.length === 1 ? "" : "s"}.
          {anyFilterActive && (
            <>
              {" · "}
              <button onClick={clearAllFilters} className="text-neutral-700 hover:underline">
                Clear all filters
              </button>
            </>
          )}
        </p>
        <button
          onClick={handleRematch}
          disabled={rematching}
          className="btn btn-secondary text-sm shrink-0 disabled:opacity-50"
        >
          {rematching ? "Matching…" : "Re-run transfer matching"}
        </button>
      </div>

      <div className="flex gap-2 mb-4 mt-3 border-b border-divider">
        <button
          onClick={() => setNeedsReviewOnly(false)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            !needsReviewOnly ? "border-accent text-accent" : "border-transparent text-neutral-500"
          }`}
        >
          All transactions
        </button>
        <button
          onClick={() => setNeedsReviewOnly(true)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${
            needsReviewOnly ? "border-accent text-accent" : "border-transparent text-neutral-500"
          }`}
        >
          Needs review
          {needsReviewCount > 0 && (
            <span className="rounded-full tag tag-accent text-xs px-1.5 py-0.5">
              {needsReviewCount}
            </span>
          )}
        </button>
        {needsReviewOnly && needsReviewCount > 0 && (
          <div className="ml-auto mb-1.5 self-center flex items-center gap-2">
            <button
              onClick={handleClassifyMaps}
              disabled={classifyingMaps}
              className="btn btn-secondary text-xs py-1 disabled:opacity-50"
            >
              {classifyingMaps ? "Classifying…" : "Classify with Maps"}
            </button>
            <button
              onClick={handleClassifyAi}
              disabled={classifying}
              className="btn btn-secondary text-xs py-1 disabled:opacity-50"
            >
              {classifying ? "Classifying…" : "Classify with AI"}
            </button>
            <Link
              href="/review"
              className="btn btn-primary text-xs py-1"
            >
              Swipe to review →
            </Link>
          </div>
        )}
      </div>

      {classifyMessage && <p className="text-sm text-muted mb-2">{classifyMessage}</p>}
      {classifyMapsMessage && <p className="text-sm text-muted mb-4">{classifyMapsMessage}</p>}

      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-md border border-divider px-3 py-2">
          <span className="text-sm">{selectedIds.size} selected</span>
          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            className="rounded-md border border-divider bg-transparent px-2 py-1 text-sm"
          >
            <option value="">Choose category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleBulkCategorize}
            disabled={!bulkCategoryId || bulkSaving}
            className="btn btn-primary text-sm disabled:opacity-50"
          >
            {bulkSaving ? "Saving…" : "Set category for selected"}
          </button>
          <span className="text-neutral-500">|</span>
          <button
            onClick={() => handleBulkClassify("maps")}
            disabled={bulkClassifying !== null}
            className="btn btn-secondary text-sm disabled:opacity-50"
          >
            {bulkClassifying === "maps" ? "Classifying…" : "Classify with Maps"}
          </button>
          <button
            onClick={() => handleBulkClassify("ai")}
            disabled={bulkClassifying !== null}
            className="btn btn-secondary text-sm disabled:opacity-50"
          >
            {bulkClassifying === "ai" ? "Classifying…" : "Classify with AI"}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-neutral-500">
            Clear selection
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-divider">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-divider text-left text-muted text-[11px] uppercase tracking-wider">
              <th className="px-3 py-2 font-medium w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((tx) => selectedIds.has(tx.id))}
                  onChange={toggleSelectAllFiltered}
                />
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                <button onClick={() => toggleSort("date")} className="hover:underline">
                  Date{sortIndicator(sortBy === "date", sortDir)}
                </button>
                <HeaderFilterPopover label="date" active={dateActive}>
                  <DateRangeFilter
                    preset={preset}
                    customFrom={customFrom}
                    customTo={customTo}
                    onChange={(p, _range, from, to) => {
                      setPreset(p);
                      setCustomFrom(from);
                      setCustomTo(to);
                    }}
                  />
                </HeaderFilterPopover>
              </th>
              {showAccountColumn && (
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Account
                  <MultiSelectFilter
                    compact
                    label="Accounts"
                    options={accountOptions}
                    selected={accountFilter}
                    onChange={setAccountFilter}
                  />
                </th>
              )}
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Description
                <HeaderFilterPopover label="description" active={searchActive}>
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    type="text"
                    placeholder="Search merchant/description…"
                    className="w-56 rounded-md border border-divider bg-transparent px-2 py-1 text-sm"
                  />
                </HeaderFilterPopover>
              </th>
              <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                <button onClick={() => toggleSort("amount")} className="hover:underline">
                  Amount{sortIndicator(sortBy === "amount", sortDir)}
                </button>
                <HeaderFilterPopover label="amount" active={amountActive} align="right">
                  <div className="flex items-center gap-2">
                    <input
                      value={amountMin}
                      onChange={(e) => setAmountMin(e.target.value)}
                      type="number"
                      placeholder="Min"
                      className="w-20 rounded-md border border-divider bg-transparent px-2 py-1 text-sm"
                    />
                    <span className="text-neutral-500">–</span>
                    <input
                      value={amountMax}
                      onChange={(e) => setAmountMax(e.target.value)}
                      type="number"
                      placeholder="Max"
                      className="w-20 rounded-md border border-divider bg-transparent px-2 py-1 text-sm"
                    />
                  </div>
                </HeaderFilterPopover>
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                Category
                <MultiSelectFilter
                  compact
                  label="Categories"
                  options={categoryOptions}
                  selected={categoryFilter}
                  onChange={setCategoryFilter}
                />
              </th>
              <th className="px-3 py-2 font-medium">Transfer</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx) => {
              const partner = tx.matched_transfer_id ? transactionsById.get(tx.matched_transfer_id) : undefined;
              return (
                <Fragment key={tx.id}>
                  <tr
                    className={`border-b border-neutral-200 last:border-0 ${
                      tx.is_internal_transfer ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelected(tx.id)} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(tx.booked_at).toLocaleDateString("en-US")}</td>
                    {showAccountColumn && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        {tx.accounts
                          ? `${providerLabel(tx.accounts.provider)} · ${accountLabels.get(tx.account_id) ?? tx.accounts.name}`
                          : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {tx.merchant_name ?? tx.raw_description ?? "—"}
                      {tx.needs_review && (
                        <span className="ml-2 rounded tag tag-accent">
                          needs review
                        </span>
                      )}
                      <button
                        onClick={() => startLabeling(tx)}
                        title="Always categorize transactions from this sender/recipient"
                        className="ml-2 text-xs text-neutral-500 hover:text-neutral-700 hover:underline"
                      >
                        Label sender
                      </button>
                      {tx.needs_review && (
                        <>
                          <button
                            onClick={() => handleRowClassify("maps", tx)}
                            disabled={rowClassifying.has(tx.id)}
                            title="Classify just this transaction with Google Maps"
                            className="ml-2 text-xs text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70 hover:underline disabled:opacity-50"
                          >
                            {rowClassifying.has(tx.id) ? "…" : "Maps"}
                          </button>
                          <button
                            onClick={() => handleRowClassify("ai", tx)}
                            disabled={rowClassifying.has(tx.id)}
                            title="Classify just this transaction with AI"
                            className="ml-2 text-xs text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70 hover:underline disabled:opacity-50"
                          >
                            {rowClassifying.has(tx.id) ? "…" : "AI"}
                          </button>
                        </>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${
                        tx.amount < 0 ? "text-danger" : "text-success"
                      }`}
                    >
                      {formatMoney(tx.amount, tx.currency, isPrivate)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <select
                        value={tx.category_id ?? ""}
                        onChange={(e) => handleCategoryChange(tx, e.target.value)}
                        className="rounded-md border border-transparent hover:border-divider bg-transparent px-1.5 py-1 text-sm"
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {tx.is_internal_transfer && (
                          <span className="text-xs text-neutral-500" title="Internal transfer">
                            {partner?.accounts
                              ? `↔ ${providerLabel(partner.accounts.provider)} · ${accountLabels.get(partner.account_id) ?? partner.accounts.name}`
                              : "↔ internal transfer"}
                          </span>
                        )}
                        <button
                          onClick={() => toggleInternalTransfer(tx)}
                          className="shrink-0 rounded border border-divider px-2 py-0.5 text-xs hover:bg-neutral-100"
                        >
                          {tx.is_internal_transfer ? "Unmark" : "Mark as transfer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {labelingTxId === tx.id && (
                    <tr className="border-b border-neutral-200">
                      <td colSpan={columnCount} className="px-3 py-3 bg-neutral-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted">
                            Always categorize transactions matching
                          </span>
                          <input
                            value={labelPattern}
                            onChange={(e) => setLabelPattern(e.target.value)}
                            className="rounded-md border border-divider bg-transparent px-2 py-1 text-sm min-w-[10rem]"
                          />
                          <span className="text-xs text-muted">as</span>
                          <select
                            value={labelCategoryId}
                            onChange={(e) => setLabelCategoryId(e.target.value)}
                            className="rounded-md border border-divider bg-transparent px-2 py-1 text-sm"
                          >
                            <option value="">Choose category…</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={submitLabelRule}
                            disabled={labelSaving || !labelPattern.trim() || !labelCategoryId}
                            className="btn btn-primary text-xs py-1 disabled:opacity-50"
                          >
                            {labelSaving ? "Applying…" : "Apply to all matching"}
                          </button>
                          <button onClick={() => setLabelingTxId(null)} className="text-xs text-neutral-500">
                            Close
                          </button>
                        </div>
                        {labelResult && <p className="text-xs text-muted mt-2">{labelResult}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-3 py-6 text-center text-neutral-500">
                  No transactions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
