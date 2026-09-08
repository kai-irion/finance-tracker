"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { localDateOf } from "@/lib/dateRanges";
import { formatMoney } from "@/lib/formatMoney";
import { usePrivacy } from "@/lib/privacy-context";
import { NetWorthTrendChart, type NetWorthPoint } from "@/components/charts/net-worth-trend-chart";
import { TransactionsTable, type TransactionRow } from "@/components/transactions-table";
import { HoldingsTable } from "@/components/holdings-table";
import type { Account, Category, InvestmentHolding } from "@/lib/supabase/types";

export default function AccountDetailPage() {
  const params = useParams();
  const accountId = String(params.id);
  const { isPrivate } = usePrivacy();

  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
  // Only gates the initial "Loading…" placeholder — later reloads (e.g. after labeling a
  // sender in the transaction table below) update data in place instead of unmounting the
  // whole page, so scroll position and in-progress UI state survive.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  async function load() {
    const [accRes, txRes, allAccRes, catRes, holdingsRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("id", accountId).single(),
      fetchAllRows<TransactionRow>((from, to) =>
        supabase
          .from("transactions")
          .select(
            "id, booked_at, amount, currency, raw_description, merchant_name, account_id, category_id, is_internal_transfer, matched_transfer_id, needs_review, accounts(name, provider), categories(name)"
          )
          .eq("account_id", accountId)
          .order("booked_at", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: TransactionRow[] | null; error: { message: string } | null }>
      ),
      supabase.from("accounts").select("*").order("name"),
      supabase.from("categories").select("*").order("name"),
      supabase.from("investment_holdings").select("*").eq("account_id", accountId).order("market_value", { ascending: false }),
    ]);
    setHoldings(holdingsRes.data ?? []);

    if (accRes.error) {
      setError(accRes.error.message);
      setInitialLoading(false);
      return;
    }
    setAccount(accRes.data);
    if (txRes.error) {
      setError(txRes.error.message);
      setInitialLoading(false);
      return;
    }
    setTransactions(txRes.data);
    setAllAccounts(allAccRes.data ?? []);
    setCategories(catRes.data ?? []);
    setError(null);
    setInitialLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function startRename() {
    if (!account) return;
    setRenameValue(account.name);
    setRenaming(true);
  }

  async function saveRename() {
    setRenaming(false);
    const trimmed = renameValue.trim();
    if (!account || !trimmed || trimmed === account.name) return;
    setAccount({ ...account, name: trimmed });
    await supabase.from("accounts").update({ name: trimmed }).eq("id", account.id);
  }

  // Reconstructs a balance-over-time series from the account's current balance and its full
  // transaction history: balance right after transaction i = current balance minus the sum of
  // every transaction that posted later. There's no stored per-account balance history (only
  // the current snapshot), so this is the only way to show a trend — it assumes every
  // balance-affecting event is represented by a transaction row, which won't capture things
  // like pending holds or not-yet-posted interest, but is a reasonable approximation.
  const balanceHistory: NetWorthPoint[] = useMemo(() => {
    if (!account || account.balance === null) return [];
    const ascending = [...transactions].sort((a, b) => a.booked_at.localeCompare(b.booked_at));
    let runningBalance = account.balance;
    const totalLaterSum = ascending.reduce((sum, t) => sum + t.amount, 0);
    // Start from the balance *before* the earliest transaction, then walk forward adding each
    // transaction's amount, so the series reads chronologically (oldest first).
    runningBalance = account.balance - totalLaterSum;
    const points: NetWorthPoint[] = [];
    for (const t of ascending) {
      runningBalance += t.amount;
      points.push({ date: localDateOf(t.booked_at), totalBalanceEur: runningBalance });
    }
    return points;
  }, [account, transactions]);

  if (initialLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <p className="text-sm text-danger">Error: {error}</p>;
  if (!account) return <p className="text-sm text-muted">Account not found.</p>;

  const currency = account.balance_currency ?? account.currency;

  return (
    <div className="max-w-3xl">
      <Link href="/settings?tab=accounts" className="text-sm text-neutral-500 hover:underline mb-4 inline-block">
        ← Accounts
      </Link>

      <div className="flex items-center justify-between gap-4 mb-1">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={saveRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="rounded-md border border-divider bg-transparent px-2 py-1 text-2xl font-semibold"
          />
        ) : (
          <button onClick={startRename} className="text-2xl font-semibold text-left hover:underline decoration-dotted" title="Rename">
            {account.name}
          </button>
        )}
      </div>
      <p className="text-sm text-muted mb-6">
        {account.provider} · {account.account_type} · {account.currency}
      </p>

      <div className="card p-5 mb-6">
        <div className="text-xs text-muted mb-1">Current balance</div>
        <div className="text-3xl font-semibold tabular-nums">
          {account.balance !== null ? formatMoney(account.balance, currency, isPrivate) : "no balance yet"}
        </div>
      </div>

      <div className="card p-4 mb-6">
        <h2 className="text-sm font-medium mb-3 text-neutral-700">Balance over time</h2>
        {balanceHistory.length >= 2 ? (
          <NetWorthTrendChart data={balanceHistory} valueFormatter={(v) => formatMoney(v, currency, isPrivate)} />
        ) : (
          <p className="text-sm text-muted">
            Not enough transaction history to reconstruct a trend yet.
          </p>
        )}
      </div>

      {holdings.length > 0 && (
        <div className="card p-4 mb-6">
          <h2 className="text-sm font-medium mb-3 text-neutral-700">Holdings</h2>
          <HoldingsTable holdings={holdings} isPrivate={isPrivate} />
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium mb-3 text-neutral-700">Transaction history</h2>
        <TransactionsTable
          transactions={transactions}
          accounts={allAccounts}
          categories={categories}
          onReload={load}
          showAccountColumn={false}
        />
      </div>
    </div>
  );
}
