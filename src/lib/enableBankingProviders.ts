// Pure data, no Node built-ins — safe to import from both server routes and client
// components (unlike enableBanking.ts, which uses `fs`/`crypto` and would break the
// browser bundle if imported client-side).
export type EnableBankingProviderKey = "revolut" | "wise" | "paypal" | "sparkasse";

// One row per supported ASPSP integration. `aspspSearchName` is what findAspsp() looks
// for; `preferredCountries` is tried in order (each is the same institution passported
// into multiple EU countries under one BIC — see findAspsp's comment in enableBanking.ts —
// so any of them works technically, but we prefer the user's own country, DE, first).
export const ENABLE_BANKING_PROVIDERS: Record<
  EnableBankingProviderKey,
  { label: string; aspspSearchName: string; preferredCountries: string[] }
> = {
  revolut: { label: "Revolut", aspspSearchName: "Revolut", preferredCountries: ["DE", "LT", "GB", "IE"] },
  wise: { label: "Wise", aspspSearchName: "Wise", preferredCountries: ["DE", "GB", "BE"] },
  paypal: { label: "PayPal", aspspSearchName: "PayPal", preferredCountries: ["DE", "LU"] },
  sparkasse: {
    label: "Hamburger Sparkasse",
    aspspSearchName: "Hamburger Sparkasse",
    preferredCountries: ["DE"],
  },
};

export const ENABLE_BANKING_PROVIDER_KEYS = Object.keys(ENABLE_BANKING_PROVIDERS) as EnableBankingProviderKey[];

export function isValidProviderKey(value: unknown): value is EnableBankingProviderKey {
  return typeof value === "string" && value in ENABLE_BANKING_PROVIDERS;
}
