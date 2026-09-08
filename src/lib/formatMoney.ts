const MASK = "•••.••";

export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

// Central money formatter for the whole app — every amount displayed anywhere (tables,
// cards, chart ticks/tooltips/labels) should go through this so privacy mode masks
// consistently everywhere at once, per the `masked` flag from usePrivacy().
export function formatMoney(amount: number, currency: string, masked = false): string {
  if (masked) return `${currencySymbol(currency)}${MASK}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
