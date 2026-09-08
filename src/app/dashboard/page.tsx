"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { getBalanceInEur } from "@/lib/fxRates";
import { formatMoney } from "@/lib/formatMoney";
import { usePrivacy } from "@/lib/privacy-context";
import { compareProviders, computeAccountLabels, providerLabel } from "@/lib/accountLabels";
import { AiWidgetChat } from "@/components/ai-widget-chat";
import { AiWidgetCard } from "@/components/ai-widget-card";
import { SortableSection } from "@/components/sortable-section";
import { TransactionListModal, type ModalTransaction } from "@/components/transaction-list-modal";
import { AccountListModal, type ModalAccount } from "@/components/account-list-modal";
import { useAiWidgets, type LoadedWidget } from "@/lib/ai-widgets/useAiWidgets";
import {
  resolveWidgetAccountDrilldown,
  resolveWidgetTransactionDrilldown,
} from "@/lib/ai-widgets/execute";
import { usePageLayout } from "@/lib/pageLayout";
import { SYNC_PROVIDERS, runSync, type SyncResult } from "@/lib/sync-providers";
import { DEMO_AI_NOTE, DEMO_SYNC_NOTE, isDemoMode } from "@/lib/demo-mode";
import type { Account } from "@/lib/supabase/types";

type AccountBalance = { account: Account; eur: number | null };

// Asset allocation + net worth trend live on the Analysis page (moved there in main);
// the dashboard keeps the balance hero, the account list, and AI charts.
const STANDARD_IDS = ["total-balance", "by-account"] as const;

const STANDARD_TITLES: Record<string, string> = {
  "total-balance": "Total balance",
  "by-account": "By account",
};

export default function DashboardPage() {
  const { isPrivate } = usePrivacy();
  const eurFormatter = (v: number) => formatMoney(v, "EUR", isPrivate);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<Record<string, SyncResult> | null>(null);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [aiWidgetsRefreshKey, setAiWidgetsRefreshKey] = useState(0);
  const [txnDrilldown, setTxnDrilldown] = useState<{ title: string; transactions: ModalTransaction[] } | null>(null);
  const [acctDrilldown, setAcctDrilldown] = useState<{ title: string; accounts: ModalAccount[] } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const { widgets: aiWidgets, loading: aiLoading, remove: removeAiWidget, persistDbOrder } = useAiWidgets(
    "dashboard",
    aiWidgetsRefreshKey
  );

  const defaultOrder = useMemo(
    () => [...STANDARD_IDS, ...aiWidgets.map((w) => `ai:${w.id}`)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiWidgets.map((w) => w.id).join("|")]
  );
  const layout = usePageLayout("dashboard", defaultOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  async function handleSyncAll() {
    setSyncing(true);
    setSyncResults(null);
    const entries = await Promise.all(
      SYNC_PROVIDERS.map(async (p) => [p.label, await runSync(p.endpoint, p.body)] as const)
    );
    setSyncResults(Object.fromEntries(entries));
    setSyncing(false);
    await loadAll();
  }

  async function loadAll() {
    setLoading(true);
    const { data: accountRows, error: accountsError } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_archived", false);
    if (accountsError) {
      setError(accountsError.message);
      setLoading(false);
      return;
    }
    setAccounts(accountRows ?? []);

    const withEur = await Promise.all(
      (accountRows ?? []).map(async (account) => {
        if (account.balance === null) return { account, eur: null };
        const currency = account.balance_currency ?? account.currency;
        return { account, eur: await getBalanceInEur(supabase, account.balance, currency) };
      })
    );
    setBalances(withEur);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const totalEur = useMemo(() => balances.reduce((sum, b) => sum + (b.eur ?? 0), 0), [balances]);
  const unconvertedCurrencies = useMemo(
    () =>
      Array.from(
        new Set(
          balances
            .filter((b) => b.account.balance !== null && b.eur === null)
            .map((b) => b.account.balance_currency ?? b.account.currency)
        )
      ).sort(),
    [balances]
  );

  const accountLabels = useMemo(() => computeAccountLabels(accounts), [accounts]);

  const balancesByProvider = useMemo(() => {
    const byProvider = new Map<string, AccountBalance[]>();
    for (const b of balances) {
      const list = byProvider.get(b.account.provider) ?? [];
      list.push(b);
      byProvider.set(b.account.provider, list);
    }
    return Array.from(byProvider.entries()).sort(([a], [b]) => compareProviders(a, b));
  }, [balances]);

  function toggleCollapsed(provider: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  const aiById = useMemo(() => new Map(aiWidgets.map((w) => [`ai:${w.id}`, w])), [aiWidgets]);
  const visibleOrder = layout.order.filter((id) => !layout.hidden.includes(id));
  const hiddenSections = layout.order.filter((id) => layout.hidden.includes(id));

  function sectionTitle(id: string): string {
    if (id.startsWith("ai:")) return aiById.get(id)?.title ?? "AI chart";
    return STANDARD_TITLES[id] ?? id;
  }

  function handleDropOn(targetId: string) {
    if (dragId) {
      layout.reorder(dragId, targetId);
      // Best-effort cross-device sync of AI-only relative order.
      const nextVisible = (() => {
        const visible = layout.order.filter((x) => !layout.hidden.includes(x));
        const from = visible.indexOf(dragId);
        const to = visible.indexOf(targetId);
        if (from === -1 || to === -1) return null;
        const r = [...visible];
        const [m] = r.splice(from, 1);
        r.splice(to, 0, m);
        return r;
      })();
      if (nextVisible) {
        const aiIds = nextVisible.filter((x) => x.startsWith("ai:")).map((x) => x.slice(3));
        if (aiIds.length > 1) void persistDbOrder(aiIds);
      }
    }
    setDragId(null);
    setDropTargetId(null);
  }

  async function handleAiBucketClick(widget: LoadedWidget, bucket: string | null) {
    const title = bucket ? `${widget.title} — ${bucket}` : widget.title;
    setDrillLoading(true);
    try {
      if (widget.spec.query.source === "accounts") {
        const accounts = await resolveWidgetAccountDrilldown(supabase, widget.spec, bucket);
        setAcctDrilldown({ title, accounts });
      } else {
        const transactions = await resolveWidgetTransactionDrilldown(supabase, widget.spec, bucket);
        setTxnDrilldown({ title, transactions });
      }
    } finally {
      setDrillLoading(false);
    }
  }

  function renderSectionBody(id: string) {
    switch (id) {
      case "total-balance":
        return (
          <>
            <div className="text-xs text-muted mb-1">
              Total balance across {accounts.length} active account{accounts.length === 1 ? "" : "s"}
            </div>
            <div className="text-3xl font-semibold tabular-nums">{eurFormatter(totalEur)}</div>
            {unconvertedCurrencies.length > 0 && (
              <p className="text-xs text-accent-700 mt-1">
                Balances in {unconvertedCurrencies.join(", ")} have no cached exchange rate and are excluded from
                this total. Reload the page in a moment to trigger a refresh; if it persists, make sure you&apos;re
                signed in (writing to <code className="rounded bg-neutral-200 px-1">fx_rates</code>{" "}
                requires an active session) and that the currency is a supported symbol.
              </p>
            )}
          </>
        );
      case "by-account":
        return (
          <div className="flex flex-col gap-4">
            {balancesByProvider.map(([provider, providerBalances]) => {
              const isCollapsed = collapsed.has(provider);
              return (
                <div key={provider}>
                  <button
                    onClick={() => toggleCollapsed(provider)}
                    className="flex items-center gap-2 mb-2 text-sm font-medium text-neutral-700"
                  >
                    <span className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
                    {providerLabel(provider)}
                    <span className="text-xs font-normal text-neutral-500">
                      ({providerBalances.length})
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="flex flex-col gap-2 pl-5">
                      {providerBalances.map(({ account, eur }) => (
                        <div key={account.id} className="flex items-center justify-between text-sm">
                          <Link href={`/accounts/${account.id}`} className="text-neutral-700 hover:underline">
                            {accountLabels.get(account.id) ?? account.name}
                          </Link>
                          <span className="tabular-nums flex items-center gap-2">
                            {account.balance !== null ? (
                              <>
                                <span className="text-neutral-500">
                                  {formatMoney(account.balance, account.balance_currency ?? account.currency, isPrivate)}
                                </span>
                                <span className="font-medium">{eur !== null ? eurFormatter(eur) : "—"}</span>
                              </>
                            ) : (
                              <span className="text-neutral-500">no balance yet</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {balances.length === 0 && <p className="text-sm text-neutral-500">No accounts yet.</p>}
          </div>
        );
      default: {
        const w = aiById.get(id);
        if (!w) return null;
        return <AiWidgetCard spec={w.spec} data={w.data} error={w.error} onBucketClick={(bucket) => void handleAiBucketClick(w, bucket)} />;
      }
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {isDemoMode() ? (
          <p className="text-xs text-muted shrink-0 pt-2">{DEMO_SYNC_NOTE}</p>
        ) : (
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="btn btn-primary text-sm shrink-0 disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync all accounts"}
          </button>
        )}
      </div>

      {syncResults && (
        <div className="mb-6 flex flex-col gap-1">
          {Object.entries(syncResults).map(([label, result]) => (
            <p
              key={label}
              className={`text-sm ${
                result.errors.length > 0 ? "text-danger" : "text-success"
              }`}
            >
              {label}: {result.synced} new transaction{result.synced === 1 ? "" : "s"}
              {result.filesProcessed !== undefined ? ` from ${result.filesProcessed} file${result.filesProcessed === 1 ? "" : "s"}` : " synced"}
              {result.errors.length > 0 ? ` — errors: ${result.errors.join(" ")}` : ""}
            </p>
          ))}
        </div>
      )}

      <div className="mb-6">
        {isDemoMode() ? (
          <p className="text-xs text-muted">{DEMO_AI_NOTE}</p>
        ) : (
          <AiWidgetChat page="dashboard" onWidgetAdded={() => setAiWidgetsRefreshKey((k) => k + 1)} />
        )}
      </div>

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger">Error: {error}</p>}

      {!loading && !error && layout.ready && (
        <>
          <p className="text-xs text-neutral-400 mb-3">
            Drag any chart by its ⠿ handle, or use ⤒ ↑ ↓ to reorder. Click any chart piece to see what&apos;s behind it.
            Hiding removes it from view — restore below.
          </p>
          <div className="flex flex-col gap-6">
            {visibleOrder.map((id) => {
              const isAi = id.startsWith("ai:");
              const widgetId = isAi ? id.slice(3) : null;
              return (
                <SortableSection
                  key={id}
                  id={id}
                  title={sectionTitle(id)}
                  isFirst={visibleOrder[0] === id}
                  isLast={visibleOrder[visibleOrder.length - 1] === id}
                  isDropTarget={dropTargetId === id && dragId !== id}
                  onMoveUp={() => layout.move(id, -1)}
                  onMoveDown={() => layout.move(id, 1)}
                  onMoveTop={() => layout.moveToTop(id)}
                  onHide={() => {
                    if (isAi && widgetId) void removeAiWidget(widgetId);
                    else layout.hide(id);
                  }}
                  hideLabel={isAi ? "Remove" : "Hide"}
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropTargetId(null);
                  }}
                  onDragOver={() => {
                    if (dropTargetId !== id) setDropTargetId(id);
                  }}
                  onDrop={() => handleDropOn(id)}
                >
                  {renderSectionBody(id)}
                </SortableSection>
              );
            })}
          </div>

          {!aiLoading && aiWidgets.length === 0 && visibleOrder.every((id) => !id.startsWith("ai:")) && null}

          {hiddenSections.length > 0 && (
            <div className="mt-6 rounded-lg border border-dashed border-divider p-4">
              <h2 className="text-sm font-medium text-muted mb-2">
                Hidden charts ({hiddenSections.length})
              </h2>
              <div className="flex flex-col gap-1.5">
                {hiddenSections.map((id) => (
                  <div key={id} className="flex items-center justify-between text-sm">
                    <span className="text-muted">{sectionTitle(id)}</span>
                    <button onClick={() => layout.restore(id)} className="text-xs underline hover:no-underline">
                      Show
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={layout.reset} className="mt-3 text-xs text-muted hover:underline">
                Reset layout to default
              </button>
            </div>
          )}
        </>
      )}

      {drillLoading && !txnDrilldown && !acctDrilldown && (
        <div className="dialog-backdrop z-50">
          <div className="bg-surface rounded-lg elev-lg px-6 py-4 text-sm">Loading…</div>
        </div>
      )}
      {txnDrilldown && (
        <TransactionListModal
          title={txnDrilldown.title}
          transactions={txnDrilldown.transactions}
          isPrivate={isPrivate}
          onClose={() => setTxnDrilldown(null)}
        />
      )}
      {acctDrilldown && (
        <AccountListModal
          title={acctDrilldown.title}
          accounts={acctDrilldown.accounts}
          isPrivate={isPrivate}
          onClose={() => setAcctDrilldown(null)}
        />
      )}
    </div>
  );
}
