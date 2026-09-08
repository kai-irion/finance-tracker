// Known sync-integration provider keys get a friendly display name and a fixed section
// order matching how the user thinks about their accounts; anything else (manual accounts,
// "Splitwise", "Bank (SEPA)", etc.) falls back to its raw provider string and is grouped
// alphabetically after the known ones.
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  traderepublic: "TradeRepublic",
  revolut: "Revolut",
  wise: "Wise",
  paypal: "PayPal",
  coinbase: "Coinbase",
  sparkasse: "Hamburger Sparkasse",
};
export const PROVIDER_ORDER = ["traderepublic", "revolut", "wise", "paypal", "coinbase", "sparkasse"];

export function providerLabel(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

export function compareProviders(a: string, b: string): number {
  const ia = PROVIDER_ORDER.indexOf(a);
  const ib = PROVIDER_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return providerLabel(a).localeCompare(providerLabel(b));
}

type LabelableAccount = { id: string; provider: string; name: string; currency: string };

// Enable Banking accounts get synced with `name` set to the account HOLDER's own name (e.g.
// "Kai Irion"), not anything account-specific — harmless when there's only one account per
// provider, useless (and actively confusing) once there are several sharing that same name,
// which is exactly what multi-currency Revolut/Wise/PayPal sub-accounts look like. Falls back
// to "Provider (currency)" only when an account's raw name collides with a sibling under the
// same provider; a genuinely distinct name (manually renamed, or already provider-specific
// like "TradeRepublic Depot") is left untouched.
export function computeAccountLabels(accounts: LabelableAccount[]): Map<string, string> {
  const nameCollisionKey = (a: LabelableAccount) => `${a.provider}::${a.name}`;
  const nameCounts = new Map<string, number>();
  for (const a of accounts) {
    const key = nameCollisionKey(a);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const fallbackLabel = (a: LabelableAccount) => `${providerLabel(a.provider)} (${a.currency})`;
  const fallbackCounts = new Map<string, number>();
  for (const a of accounts) {
    if ((nameCounts.get(nameCollisionKey(a)) ?? 0) > 1) {
      const base = fallbackLabel(a);
      fallbackCounts.set(base, (fallbackCounts.get(base) ?? 0) + 1);
    }
  }

  const seenIndex = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const a of accounts) {
    if ((nameCounts.get(nameCollisionKey(a)) ?? 0) <= 1) {
      labels.set(a.id, a.name);
      continue;
    }
    const base = fallbackLabel(a);
    if ((fallbackCounts.get(base) ?? 0) > 1) {
      const idx = (seenIndex.get(base) ?? 0) + 1;
      seenIndex.set(base, idx);
      labels.set(a.id, `${base} #${idx}`);
    } else {
      labels.set(a.id, base);
    }
  }
  return labels;
}
