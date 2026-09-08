"use client";

import { formatMoney } from "@/lib/formatMoney";

export type ModalAccount = {
  id: string;
  name: string;
  provider: string;
  account_type: string;
  balance: number | null;
  balance_currency: string;
  eur: number | null;
};

// Account-side equivalent of TransactionListModal: shown when clicking a slice of an
// accounts-backed chart (asset allocation, AI widgets with source "accounts"), where the
// underlying data is accounts, not transactions.
export function AccountListModal({
  title,
  accounts,
  isPrivate,
  onClose,
}: {
  title: string;
  accounts: ModalAccount[];
  isPrivate: boolean;
  onClose: () => void;
}) {
  const eurTotal = accounts.reduce((s, a) => s + (a.eur ?? 0), 0);
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
              ({accounts.length} account{accounts.length === 1 ? "" : "s"} · {formatMoney(eurTotal, "EUR", isPrivate)})
            </span>
          </h3>
          <button onClick={onClose} className="shrink-0 text-muted hover:text-text" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 px-2 py-2 border-b border-neutral-200 last:border-0 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate">{a.name}</div>
                <div className="text-xs text-muted">
                  {a.provider} · {a.account_type}
                </div>
              </div>
              <span className="tabular-nums shrink-0 font-medium text-right">
                {a.balance !== null ? (
                  <>
                    <span className="block text-muted text-xs">
                      {formatMoney(a.balance, a.balance_currency, isPrivate)}
                    </span>
                    <span>{a.eur !== null ? formatMoney(a.eur, "EUR", isPrivate) : "—"}</span>
                  </>
                ) : (
                  <span className="text-muted">no balance yet</span>
                )}
              </span>
            </div>
          ))}
          {accounts.length === 0 && (
            <p className="text-sm text-muted p-6 text-center">No accounts.</p>
          )}
        </div>
      </div>
    </div>
  );
}
