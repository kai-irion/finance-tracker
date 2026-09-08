"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { TransactionsTable, type TransactionRow } from "@/components/transactions-table";
import type { Account, Category } from "@/lib/supabase/types";

// TODO(stretch): CSV export of the current filtered/sorted transaction list.
export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // Only gates the initial "Loading…" placeholder — once the table has rendered once, later
  // reloads (e.g. after labeling a sender) update the data in place instead of unmounting the
  // table, so scroll position and in-progress UI state (like an open "label sender" row) survive.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [txRes, accRes, catRes] = await Promise.all([
      fetchAllRows<TransactionRow>((from, to) =>
        supabase
          .from("transactions")
          .select(
            "id, booked_at, amount, currency, raw_description, merchant_name, account_id, category_id, is_internal_transfer, matched_transfer_id, needs_review, accounts(name, provider), categories(name)"
          )
          .order("booked_at", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: TransactionRow[] | null; error: { message: string } | null }>
      ),
      supabase.from("accounts").select("*").order("name"),
      supabase.from("categories").select("*").order("name"),
    ]);

    if (txRes.error) {
      setError(txRes.error.message);
      setInitialLoading(false);
      return;
    }

    setTransactions(txRes.data);
    setAccounts(accRes.data ?? []);
    setCategories(catRes.data ?? []);
    setError(null);
    setInitialLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Transactions</h1>

      {initialLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger">Error: {error}</p>}

      {!initialLoading && !error && (
        <TransactionsTable transactions={transactions} accounts={accounts} categories={categories} onReload={load} />
      )}
    </div>
  );
}
