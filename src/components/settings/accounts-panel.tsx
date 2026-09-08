"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { findSyncEndpoint, runSync } from "@/lib/sync-providers";
import { ENABLE_BANKING_PROVIDER_KEYS, ENABLE_BANKING_PROVIDERS } from "@/lib/enableBankingProviders";
import { formatMoney } from "@/lib/formatMoney";
import { usePrivacy } from "@/lib/privacy-context";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { compareProviders, computeAccountLabels, providerLabel } from "@/lib/accountLabels";
import type { Account, EnableBankingSession } from "@/lib/supabase/types";
import type { ProcessedFileInfo } from "@/lib/importCsv";
import { DEMO_CONNECT_NOTE, DEMO_SYNC_NOTE, isDemoMode } from "@/lib/demo-mode";

const IMPORTS_FOLDER_PATH = "~/Projects/FinanceHub/imports/";

const PROVIDER_OPTIONS = [
  "Manual",
  "TradeRepublic",
  "Revolut",
  "PayPal",
  "Wise",
  "Coinbase",
  "Splitwise",
  "Bank (SEPA)",
  "Other",
];

const ACCOUNT_TYPE_OPTIONS = [
  "Checking Account",
  "Savings Account",
  "Broker/Custody",
  "Credit Card",
  "Crypto",
  "Cash",
  "Other",
];

type AccountStats = { since: string | null; lastActivity: string | null };
type PendingDelete = { account: Account; transactionCount: number };

export function AccountsPanel() {
  const { isPrivate } = usePrivacy();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<Record<string, AccountStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [provider, setProvider] = useState(PROVIDER_OPTIONS[0]);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [accountType, setAccountType] = useState(ACCOUNT_TYPE_OPTIONS[0]);

  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [processedFiles, setProcessedFiles] = useState<ProcessedFileInfo[]>([]);
  const [ebSessions, setEbSessions] = useState<Record<string, EnableBankingSession>>({});

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadEbSessions() {
    const { data } = await supabase
      .from("enable_banking_sessions")
      .select("*")
      .in("provider", ENABLE_BANKING_PROVIDER_KEYS);
    const byProvider: Record<string, EnableBankingSession> = {};
    for (const row of data ?? []) byProvider[row.provider] = row;
    setEbSessions(byProvider);
  }

  async function loadProcessedFiles() {
    try {
      const res = await fetch("/api/sync/csv-imports");
      const data: { files: ProcessedFileInfo[] } = await res.json();
      setProcessedFiles(data.files ?? []);
    } catch {
      // Not critical — the page still works without this list.
    }
  }

  // "Data available since" (oldest booked_at) and a transaction-based "last synced" fallback
  // (newest created_at, i.e. when a row was last inserted) per account — derived client-side
  // from a single lightweight query rather than a per-account round trip. balance_updated_at
  // (set by the sync routes, see src/lib/fxRates.ts / enableBankingSync.ts) is preferred for
  // "last synced" when present; this is the fallback for accounts without balance capture
  // (CSV-imported, manual, or TradeRepublic Depot).
  async function loadStats() {
    type StatsRow = { account_id: string; booked_at: string; created_at: string };
    const { data } = await fetchAllRows<StatsRow>((from, to) =>
      supabase
        .from("transactions")
        .select("account_id, booked_at, created_at")
        .range(from, to) as unknown as PromiseLike<{ data: StatsRow[] | null; error: { message: string } | null }>
    );
    const next: Record<string, AccountStats> = {};
    for (const row of data) {
      const current = next[row.account_id] ?? { since: null, lastActivity: null };
      if (!current.since || row.booked_at < current.since) current.since = row.booked_at;
      if (!current.lastActivity || row.created_at > current.lastActivity) current.lastActivity = row.created_at;
      next[row.account_id] = current;
    }
    setStats(next);
  }

  async function loadAccounts() {
    setLoading(true);
    const { data, error } = await supabase.from("accounts").select("*").order("name");
    if (error) {
      setError(error.message);
    } else {
      setAccounts(data ?? []);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAccounts();
    loadStats();
    loadProcessedFiles();
    loadEbSessions();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from("accounts").insert({
      provider,
      name: name.trim(),
      currency,
      account_type: accountType,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setName("");
    setShowForm(false);
    loadAccounts();
  }

  async function handleSync(accountId: string, endpoint: string, body?: unknown) {
    setSyncingAccountId(accountId);
    setSyncMessage(null);
    setSyncError(null);
    const result = await runSync(endpoint, body);
    if (result.errors.length > 0) {
      setSyncError(result.errors.join(" "));
    }
    setSyncMessage(`${result.synced} transaction${result.synced === 1 ? "" : "s"} synced.`);
    await loadAccounts();
    await loadStats();
    await loadProcessedFiles();
    await loadEbSessions();
    setSyncingAccountId(null);
  }

  function startRename(account: Account) {
    setRenamingId(account.id);
    setRenameValue(account.name);
  }

  async function saveRename(account: Account) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === account.name) return;
    setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, name: trimmed } : a)));
    await supabase.from("accounts").update({ name: trimmed }).eq("id", account.id);
  }

  async function toggleArchived(account: Account) {
    const next = !account.is_archived;
    setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, is_archived: next } : a)));
    await supabase.from("accounts").update({ is_archived: next }).eq("id", account.id);
  }

  async function requestDelete(account: Account) {
    const { count, error } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id);
    if (error) {
      setError(error.message);
      return;
    }
    setPendingDelete({ account, transactionCount: count ?? 0 });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    // transactions.account_id has ON DELETE CASCADE (supabase/migrations/001_init.sql), so
    // this also removes every transaction on the account — no separate cleanup step needed.
    const { error } = await supabase.from("accounts").delete().eq("id", pendingDelete.account.id);
    setDeleting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPendingDelete(null);
    loadAccounts();
    loadStats();
  }

  function toggleCollapsed(provider: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  const groups = useMemo(() => {
    const visible = accounts.filter((a) => showArchived || !a.is_archived);
    const byProvider = new Map<string, Account[]>();
    for (const a of visible) {
      const list = byProvider.get(a.provider) ?? [];
      list.push(a);
      byProvider.set(a.provider, list);
    }
    return Array.from(byProvider.entries()).sort(([a], [b]) => compareProviders(a, b));
  }, [accounts, showArchived]);

  const accountLabels = useMemo(() => computeAccountLabels(accounts), [accounts]);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-end mb-6">
        <div className="flex items-center gap-2">
          {isDemoMode() ? (
            <p className="text-xs text-muted">{DEMO_CONNECT_NOTE}</p>
          ) : (
            <Link
              href="/accounts/connect"
              className="rounded-md border border-divider px-3 py-1.5 text-sm font-medium"
            >
              Connect bank accounts
            </Link>
          )}          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn btn-primary text-sm"
          >
            {showForm ? "Cancel" : "Add account"}
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-lg border border-divider p-4 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-md border border-divider bg-transparent px-3 py-1.5 text-sm"
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sparkasse Checking"
              required
              className="rounded-md border border-divider bg-transparent px-3 py-1.5 text-sm"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-muted">Currency</label>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                className="rounded-md border border-divider bg-transparent px-3 py-1.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-muted">Account type</label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="rounded-md border border-divider bg-transparent px-3 py-1.5 text-sm"
              >
                {ACCOUNT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary text-sm self-start disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {(() => {
        const expiredLabels = ENABLE_BANKING_PROVIDER_KEYS.filter((key) => {
          if (!accounts.some((a) => a.provider === key)) return false;
          const session = ebSessions[key];
          return !session || new Date(session.expires_at).getTime() < Date.now();
        }).map((key) => ENABLE_BANKING_PROVIDERS[key].label);

        if (expiredLabels.length === 0) return null;
        if (isDemoMode()) return null;
        return (
          <div className="mb-4 rounded-md bg-accent-100 border border-accent-300 p-3 text-sm flex items-center justify-between gap-3">
            <span className="text-accent-700">
              {expiredLabels.join(", ")}: connection expired, please reconnect.
            </span>
            <Link
              href="/accounts/connect"
              className="btn btn-primary text-xs shrink-0"
            >
              Reconnect
            </Link>
          </div>
        );
      })()}

      {isDemoMode() ? (
        <p className="text-xs text-neutral-500 mb-4">{DEMO_SYNC_NOTE}</p>
      ) : (
        <p className="text-xs text-neutral-500 mb-4">
          Wise, PayPal, and Sparkasse accounts run primarily via Enable Banking (see &quot;Connect
          bank accounts&quot; above). CSV import is the fallback for when the Enable Banking
          connection isn&apos;t available — drop statement exports as CSV in{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5">{IMPORTS_FOLDER_PATH}</code>, they get
          processed automatically on the next sync.
        </p>
      )}

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger mb-3">Error: {error}</p>}
      {syncMessage && !syncError && <p className="text-sm text-success mb-3">{syncMessage}</p>}
      {syncError && <p className="text-sm text-danger mb-3">Sync error: {syncError}</p>}

      <label className="flex items-center gap-2 text-xs text-muted mb-3">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived accounts
      </label>

      {!loading && (
        <div className="flex flex-col gap-6">
          {groups.map(([providerKey, providerAccounts]) => {
            const isCollapsed = collapsed.has(providerKey);
            return (
              <div key={providerKey}>
                <button
                  onClick={() => toggleCollapsed(providerKey)}
                  className="flex items-center gap-2 mb-2 text-sm font-medium text-neutral-700"
                >
                  <span className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
                  {providerLabel(providerKey)}
                  <span className="text-xs font-normal text-neutral-500">
                    ({providerAccounts.length})
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="flex flex-col gap-2">
                    {providerAccounts.map((a) => {
                      const target = findSyncEndpoint(a.provider);
                      const accountStats = stats[a.id];
                      const lastSynced = a.balance_updated_at ?? accountStats?.lastActivity ?? null;
                      return (
                        <div
                          key={a.id}
                          className={`rounded-lg border border-divider p-3 ${
                            a.is_archived ? "opacity-60" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              {renamingId === a.id ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={() => saveRename(a)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveRename(a);
                                    if (e.key === "Escape") setRenamingId(null);
                                  }}
                                  className="rounded-md border border-divider bg-transparent px-2 py-0.5 text-sm font-medium"
                                />
                              ) : (
                                <span className="inline-flex items-center gap-1.5">
                                  <Link href={`/accounts/${a.id}`} className="font-medium text-sm hover:underline">
                                    {accountLabels.get(a.id) ?? a.name}
                                  </Link>
                                  <button
                                    onClick={() => startRename(a)}
                                    className="text-neutral-400 hover:text-neutral-700"
                                    title="Rename"
                                  >
                                    ✎
                                  </button>
                                </span>
                              )}
                              <div className="text-xs text-muted">
                                {a.account_type} · {a.currency}
                                {a.is_archived && <span className="ml-2 text-accent-700">Archived</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {target && !isDemoMode() && (
                                <button
                                  onClick={() => handleSync(a.id, target.endpoint, target.body)}
                                  disabled={syncingAccountId !== null}
                                  className="rounded-md border border-divider px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                                >
                                  {syncingAccountId === a.id ? "Syncing…" : "Sync now"}
                                </button>
                              )}
                              <button
                                onClick={() => toggleArchived(a)}
                                className="rounded-md border border-divider px-3 py-1.5 text-xs font-medium"
                              >
                                {a.is_archived ? "Unarchive" : "Archive"}
                              </button>
                              <button
                                onClick={() => requestDelete(a)}
                                className="text-xs text-danger hover:underline"
                              >
                                Delete permanently
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
                            <span>
                              Balance:{" "}
                              {a.balance !== null ? formatMoney(a.balance, a.balance_currency ?? a.currency, isPrivate) : "—"}
                            </span>
                            <span>
                              Data available since:{" "}
                              {accountStats?.since ? new Date(accountStats.since).toLocaleDateString("en-US") : "no transactions yet"}
                            </span>
                            <span>Last synced: {lastSynced ? new Date(lastSynced).toLocaleString("en-US") : "never"}</span>
                          </div>

                          {pendingDelete?.account.id === a.id && (
                            <div className="mt-3 rounded-md border border-danger/30 bg-danger-100 p-3 text-sm">
                              <p className="mb-2">
                                {pendingDelete.transactionCount > 0
                                  ? `This will permanently delete ${pendingDelete.transactionCount} associated transaction${pendingDelete.transactionCount === 1 ? "" : "s"}. This cannot be undone.`
                                  : "This account has no transactions. Deletion cannot be undone."}
                              </p>
                              <div className="flex gap-2">
                                <button
                                  onClick={confirmDelete}
                                  disabled={deleting}
                                  className="btn btn-danger text-xs disabled:opacity-50"
                                >
                                  {deleting ? "Deleting…" : "Delete permanently"}
                                </button>
                                <button
                                  onClick={() => setPendingDelete(null)}
                                  className="rounded-md border border-divider px-3 py-1 text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && <p className="text-sm text-neutral-500">No accounts yet.</p>}
        </div>
      )}

      {processedFiles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium mb-2 text-neutral-700">Recently imported CSV files</h2>
          <div className="flex flex-col gap-1">
            {processedFiles.map((f, i) => (
              <div
                key={`${f.fileName}-${i}`}
                className="text-xs text-muted flex items-center justify-between"
              >
                <span>{f.fileName}</span>
                <span>
                  {f.processedAt ? new Date(f.processedAt).toLocaleString("en-US") : "—"}
                  {f.imported !== null ? ` · ${f.imported} transaction${f.imported === 1 ? "" : "s"}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
