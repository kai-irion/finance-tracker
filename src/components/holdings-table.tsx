"use client";

import { useMemo } from "react";
import { formatMoney } from "@/lib/formatMoney";
import type { InvestmentHolding } from "@/lib/supabase/types";

// Same gain/loss math as pytr's own Portfolio.overview() (buyCost = avgCost * quantity,
// diff = netValue - buyCost) — shown here per-row plus a totals row, shared between the
// Analysis tab's "Investment holdings" section and the Depot account's detail page.
export function HoldingsTable({ holdings, isPrivate }: { holdings: InvestmentHolding[]; isPrivate: boolean }) {
  const rows = useMemo(() => {
    return [...holdings]
      .map((h) => {
        const buyCost = h.avg_buy_in * h.quantity;
        const gain = h.market_value - buyCost;
        const gainPct = buyCost === 0 ? 0 : (h.market_value / buyCost - 1) * 100;
        return { ...h, buyCost, gain, gainPct };
      })
      .sort((a, b) => b.market_value - a.market_value);
  }, [holdings]);

  const totals = useMemo(() => {
    const buyCost = rows.reduce((sum, r) => sum + r.buyCost, 0);
    const marketValue = rows.reduce((sum, r) => sum + r.market_value, 0);
    const gain = marketValue - buyCost;
    const gainPct = buyCost === 0 ? 0 : (marketValue / buyCost - 1) * 100;
    return { buyCost, marketValue, gain, gainPct };
  }, [rows]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted">No holdings synced yet.</p>;
  }

  const currency = rows[0].currency;
  const gainClass = (v: number) => (v > 0 ? "text-success" : v < 0 ? "text-danger" : "");

  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-divider text-left text-muted text-[11px] uppercase tracking-wider">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Qty</th>
            <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Avg. buy-in</th>
            <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Price</th>
            <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Value</th>
            <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Gain</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-neutral-200 last:border-0">
              <td className="px-3 py-2 min-w-0">
                <div className="truncate">{r.name}</div>
                <div className="text-xs text-muted">{r.isin}</div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.quantity}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(r.avg_buy_in, r.currency, isPrivate)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(r.price, r.currency, isPrivate)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">
                {formatMoney(r.market_value, r.currency, isPrivate)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${gainClass(r.gain)}`}>
                {formatMoney(r.gain, r.currency, isPrivate)}
                <span className="block text-xs">
                  {r.gainPct > 0 ? "+" : ""}
                  {r.gainPct.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-divider font-medium">
            <td className="px-3 py-2" colSpan={4}>
              Total
            </td>
            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(totals.marketValue, currency, isPrivate)}</td>
            <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${gainClass(totals.gain)}`}>
              {formatMoney(totals.gain, currency, isPrivate)}
              <span className="block text-xs">
                {totals.gainPct > 0 ? "+" : ""}
                {totals.gainPct.toFixed(1)}%
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
