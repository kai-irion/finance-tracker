import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Reference currency for all EUR-converted display values across the app.
export const REFERENCE_CURRENCY = "EUR";

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";
const COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const COINGECKO_SEARCH_URL = "https://api.coingecko.com/api/v3/search";

// Symbols we might realistically hold on Coinbase, mapped to their CoinGecko id.
// `refreshFxRatesIfStale` also accepts extra symbols at call time (e.g. read live from
// accounts.currency) so a coin missing from this list still gets a best-effort lookup.
const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  USDC: "usd-coin",
  USDT: "tether",
  ADA: "cardano",
  DOT: "polkadot",
  MATIC: "matic-network",
  LTC: "litecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  ATOM: "cosmos",
  UNI: "uniswap",
  BCH: "bitcoin-cash",
  XLM: "stellar",
  ALGO: "algorand",
  ETC: "ethereum-classic",
  EURC: "euro-coin",
};

// In-memory only (not worth persisting): symbol -> resolved CoinGecko id, or null if a
// confident resolution attempt already failed once this process's lifetime.
const resolvedCryptoIds = new Map<string, string | null>();

// For any currency symbol not in the static map above — there's no way to run an actual web
// search from a server process, but CoinGecko's public coin search is the closest honest
// equivalent: given a symbol like "ETH2", find a listed coin whose OWN symbol matches
// exactly (not just a fuzzy name hit — a stray "ETH2X-FLI" leveraged token would give a
// wildly wrong price), preferring the most established (lowest market cap rank) if more than
// one coin shares that symbol. This is a best-effort estimate, same as asking someone to look
// it up — not authoritative, but far better than silently excluding the currency forever.
async function resolveCryptoId(symbol: string): Promise<string | null> {
  if (resolvedCryptoIds.has(symbol)) return resolvedCryptoIds.get(symbol) ?? null;
  let resolved: string | null = null;
  try {
    const res = await fetch(`${COINGECKO_SEARCH_URL}?query=${encodeURIComponent(symbol)}`);
    if (res.ok) {
      const data = (await res.json()) as { coins: { id: string; symbol: string; market_cap_rank: number | null }[] };
      const exactMatches = data.coins
        .filter((c) => c.symbol.toUpperCase() === symbol.toUpperCase())
        .sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity));
      resolved = exactMatches[0]?.id ?? null;
    }
  } catch (err) {
    console.error(`FX: CoinGecko symbol search failed for "${symbol}":`, err);
  }
  resolvedCryptoIds.set(symbol, resolved);
  return resolved;
}

async function fetchFiatRates(): Promise<Record<string, number>> {
  const res = await fetch(FRANKFURTER_URL);
  if (!res.ok) throw new Error(`Frankfurter API error ${res.status}`);
  const data = (await res.json()) as { rates: Record<string, number> };
  // Frankfurter returns "units of X per 1 EUR" — invert to get "EUR per unit of X".
  const rateToEur: Record<string, number> = { EUR: 1 };
  for (const [currency, perEur] of Object.entries(data.rates)) {
    if (perEur > 0) rateToEur[currency] = 1 / perEur;
  }
  return rateToEur;
}

async function fetchCryptoRates(symbols: string[]): Promise<Record<string, number>> {
  const idBySymbol = new Map<string, string>();
  const unmapped: string[] = [];
  for (const s of symbols) {
    const staticId = CRYPTO_IDS[s];
    if (staticId) idBySymbol.set(s, staticId);
    else unmapped.push(s);
  }
  if (unmapped.length > 0) {
    const resolved = await Promise.all(unmapped.map(async (s) => [s, await resolveCryptoId(s)] as const));
    for (const [s, id] of resolved) {
      if (id) idBySymbol.set(s, id);
    }
  }
  if (idBySymbol.size === 0) return {};

  const ids = Array.from(new Set(idBySymbol.values()));
  const url = `${COINGECKO_PRICE_URL}?ids=${ids.join(",")}&vs_currencies=eur`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko API error ${res.status}`);
  const data = (await res.json()) as Record<string, { eur?: number }>;
  const rateToEur: Record<string, number> = {};
  for (const [symbol, id] of idBySymbol) {
    const price = data[id]?.eur;
    if (typeof price === "number") rateToEur[symbol] = price;
  }
  return rateToEur;
}

// Stale if the newest row is older than the refresh interval, OR if any currency we now know
// we need (e.g. one just added to CRYPTO_IDS, or newly held in an account) has no row at all —
// otherwise a symbol added after the last refresh would silently stay unconverted for up to
// 24h since a fresh *other* row would make the cache look up to date.
async function isCacheStale(client: SupabaseClient<Database>, requiredCurrencies: string[]): Promise<boolean> {
  const { data } = await client.from("fx_rates").select("currency, updated_at");
  if (!data || data.length === 0) return true;
  const newest = data.reduce((max, row) => (row.updated_at > max ? row.updated_at : max), data[0].updated_at);
  if (Date.now() - new Date(newest).getTime() > REFRESH_INTERVAL_MS) return true;
  const present = new Set(data.map((row) => row.currency));
  return requiredCurrencies.some((c) => !present.has(c));
}

// Collapses concurrent callers (e.g. several sync routes finishing around the same time)
// into a single in-flight refresh instead of racing duplicate API calls.
let inFlightRefresh: Promise<void> | null = null;

// Refreshes the fx_rates cache from Frankfurter (fiat) + CoinGecko (crypto) if it's missing
// or older than 24h; a no-op otherwise. Safe to call liberally — from every sync route and
// from dashboard/analysis pages before reading rates. `extraCryptoSymbols` covers currencies
// held in accounts that aren't in the built-in CRYPTO_IDS map.
export async function refreshFxRatesIfStale(
  client: SupabaseClient<Database>,
  extraCryptoSymbols: string[] = []
): Promise<void> {
  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const requiredCryptoSymbols = Array.from(new Set([...Object.keys(CRYPTO_IDS), ...extraCryptoSymbols]));
        if (!(await isCacheStale(client, requiredCryptoSymbols))) return;

        const now = new Date().toISOString();
        const rows: { currency: string; rate_to_eur: number; updated_at: string }[] = [];

        try {
          const fiatRates = await fetchFiatRates();
          for (const [currency, rate] of Object.entries(fiatRates)) {
            rows.push({ currency, rate_to_eur: rate, updated_at: now });
          }
        } catch (err) {
          console.error("FX rate refresh (fiat) failed:", err);
        }

        try {
          const symbols = Array.from(new Set([...Object.keys(CRYPTO_IDS), ...extraCryptoSymbols]));
          const cryptoRates = await fetchCryptoRates(symbols);
          for (const [currency, rate] of Object.entries(cryptoRates)) {
            rows.push({ currency, rate_to_eur: rate, updated_at: now });
          }
        } catch (err) {
          console.error("FX rate refresh (crypto) failed:", err);
        }

        if (rows.length > 0) {
          await client.from("fx_rates").upsert(rows, { onConflict: "currency" });
        }
      } finally {
        inFlightRefresh = null;
      }
    })();
  }
  return inFlightRefresh;
}

// Returns the cached EUR rate for a currency, or null if it isn't cached (unknown/unsupported
// currency, or the cache hasn't been populated yet). Does not trigger a refresh itself — call
// refreshFxRatesIfStale() first if the cache might be empty.
export async function getRateToEur(client: SupabaseClient<Database>, currency: string): Promise<number | null> {
  if (currency === REFERENCE_CURRENCY) return 1;
  const { data } = await client.from("fx_rates").select("rate_to_eur").eq("currency", currency).maybeSingle();
  return data?.rate_to_eur ?? null;
}

// Converts a native amount/currency to EUR for display purposes only — never write the
// result back over the original amount/currency stored in the DB. Returns null if no rate is
// available for the currency (caller should fall back to showing the native amount only).
export async function getBalanceInEur(
  client: SupabaseClient<Database>,
  amount: number,
  currency: string
): Promise<number | null> {
  if (currency === REFERENCE_CURRENCY) return amount;
  await refreshFxRatesIfStale(client, [currency]);
  const rate = await getRateToEur(client, currency);
  return rate === null ? null : amount * rate;
}
