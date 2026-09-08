import { createSign } from "crypto";
import { readFileSync } from "fs";
import {
  ENABLE_BANKING_PROVIDERS,
  type EnableBankingProviderKey,
} from "@/lib/enableBankingProviders";

export {
  ENABLE_BANKING_PROVIDERS,
  ENABLE_BANKING_PROVIDER_KEYS,
  isValidProviderKey,
  type EnableBankingProviderKey,
} from "@/lib/enableBankingProviders";

// Enable Banking (PSD2 open banking aggregator) — used for the Revolut/Wise/PayPal/
// Hamburger Sparkasse integrations, all via the same mechanism (one ASPSP each).
// Auth is a self-signed RS256 JWT per request (not OAuth client-credentials): the
// application ID goes in the JWT "kid" header, signed with the private key generated
// at application registration. See https://enablebanking.com/docs/api/reference/.
const API_BASE = "https://api.enablebanking.com";
const JWT_TTL_SECONDS = 300;
const MAX_FETCH_ATTEMPTS = 2;

// Short-lived cookie carrying the "state" value from start-consent to callback, so the
// callback route can confirm the redirect actually belongs to a consent flow it started.
export const EB_STATE_COOKIE = "eb_consent_state";

export class EnableBankingAuthError extends Error {}
export class EnableBankingConsentError extends Error {}

// Behind a reverse proxy (ngrok, in dev), Next.js's `request.url` reflects the internal
// bind address ("http://localhost:3000/...") rather than the public origin the browser
// actually hit — it doesn't consult the Host header. The proxy sets x-forwarded-host/
// -proto correctly though, so those take priority; request.url is only a fallback for
// direct (non-proxied) access.
export function resolveRequestOrigin(request: { url: string; headers: { get(name: string): string | null } }): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

let cachedPrivateKeyPem: string | null = null;

function getConfig(): { appId: string; privateKeyPem: string } {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const keyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
  if (!appId || !keyPath) {
    throw new Error(
      "ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY_PATH is not set. Please add it in .env.local."
    );
  }
  if (!cachedPrivateKeyPem) {
    try {
      cachedPrivateKeyPem = readFileSync(keyPath, "utf-8");
    } catch (err) {
      throw new Error(
        `Enable Banking private key could not be read (${keyPath}): ${(err as Error).message}`
      );
    }
  }
  return { appId, privateKeyPem: cachedPrivateKeyPem };
}

function base64url(input: object | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input));
  return buf.toString("base64url");
}

function buildJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: appId };
  const payload = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${signature.toString("base64url")}`;
}

async function enableBankingFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; searchParams?: Record<string, string | undefined> } = {}
): Promise<T> {
  const { appId, privateKeyPem } = getConfig();
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const jwt = buildJwt(appId, privateKeyPem);
    let res: Response;
    try {
      res = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      // Node's fetch throws a bare "fetch failed" TypeError for network-level failures
      // (DNS, TLS, connection refused) — the actionable detail is nested in `.cause`,
      // which gets lost if not surfaced explicitly here.
      const cause = err instanceof Error && err.cause ? String((err.cause as Error).message ?? err.cause) : null;
      throw new Error(
        `Network error calling Enable Banking (${url.hostname}${path}): ${(err as Error).message}${cause ? ` — cause: ${cause}` : ""}`
      );
    }

    if (res.status === 429 && attempt < MAX_FETCH_ATTEMPTS) {
      const retryAfterSeconds = Number(res.headers.get("Retry-After")) || 2;
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      const body = await res.text();
      throw new EnableBankingAuthError(
        `Enable Banking auth failed (${res.status}): ${body.slice(0, 300)}`
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Enable Banking error ${res.status} at ${path}: ${body.slice(0, 300)}`);
    }

    return res.json();
  }

  throw new Error(`Enable Banking rate limit reached at ${path}.`);
}

export type EnableBankingAspsp = {
  name: string;
  country: string;
  bic?: string;
  maximum_consent_validity?: number;
};

export async function getAspsps(country?: string): Promise<EnableBankingAspsp[]> {
  const data = await enableBankingFetch<{ aspsps: EnableBankingAspsp[] }>("/aspsps", {
    searchParams: { country },
  });
  return data.aspsps;
}

// Finds the ASPSP entry matching a name (case-insensitive substring — Enable Banking's
// names are exact but this stays forgiving of minor formatting drift) and, if given, an
// exact country. Looked up live rather than hardcoding name/country pairs, since the same
// institution (e.g. Revolut, Wise) is listed once per EU country it passports into, all
// sharing one BIC, and a hardcoded guess could silently go stale.
export async function findAspsp(searchName: string, country?: string): Promise<EnableBankingAspsp | null> {
  const aspsps = await getAspsps(country);
  const needle = searchName.toLowerCase();
  const matches = aspsps.filter((a) => a.name.toLowerCase().includes(needle));
  if (matches.length === 0) return null;
  if (country) {
    return matches.find((a) => a.country === country) ?? matches[0];
  }
  return matches[0];
}

// Tries each preferred country in turn, falling back to whatever findAspsp returns with no
// country filter (i.e. the first match) if none of the preferred countries have an entry.
export async function resolveAspspForProvider(
  provider: EnableBankingProviderKey
): Promise<EnableBankingAspsp | null> {
  const config = ENABLE_BANKING_PROVIDERS[provider];
  for (const country of config.preferredCountries) {
    const match = await findAspsp(config.aspspSearchName, country);
    if (match) return match;
  }
  return findAspsp(config.aspspSearchName);
}

export type StartAuthorizationResult = {
  url: string;
  authorization_id: string;
};

// PSD2 consent is valid for a maximum of 90 days — Revolut/most ASPSPs cap it there
// regardless of what's requested, but we ask for the full 90 to avoid re-consenting sooner
// than necessary.
const CONSENT_VALIDITY_DAYS = 90;

export async function startAuthorization(params: {
  aspspName: string;
  aspspCountry: string;
  redirectUrl: string;
  state: string;
}): Promise<StartAuthorizationResult> {
  const validUntil = new Date(Date.now() + CONSENT_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return enableBankingFetch<StartAuthorizationResult>("/auth", {
    method: "POST",
    body: {
      access: { valid_until: validUntil },
      aspsp: { name: params.aspspName, country: params.aspspCountry },
      state: params.state,
      redirect_url: params.redirectUrl,
      psu_type: "personal",
    },
  });
}

export type EnableBankingSessionAccount = {
  uid: string;
  name?: string;
  currency: string;
  cash_account_type?: string;
  account_id?: { iban?: string; other?: { identification?: string } };
};

export type EnableBankingSession = {
  session_id: string;
  accounts: EnableBankingSessionAccount[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
};

export async function exchangeCodeForSession(code: string): Promise<EnableBankingSession> {
  return enableBankingFetch<EnableBankingSession>("/sessions", {
    method: "POST",
    body: { code },
  });
}

export async function getSession(sessionId: string): Promise<EnableBankingSession & { status: string }> {
  return enableBankingFetch<EnableBankingSession & { status: string }>(`/sessions/${sessionId}`);
}

export type EnableBankingTransaction = {
  transaction_id?: string;
  entry_reference?: string;
  transaction_amount: { currency: string; amount: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  creditor?: { name?: string };
  debtor?: { name?: string };
  // Not every ASPSP passes this through — absent for many banks/transaction types, so
  // `toRow()` in enableBankingSync.ts must treat it as optional and fall back to null.
  merchant_category_code?: string;
};

export type EnableBankingBalance = {
  balance_amount: { amount: string; currency: string };
  balance_type?: string;
};

// ASPSPs report several balance "types" for the same account (available vs. booked vs.
// forward-looking) — prefer the one closest to "money usable right now", falling back
// through less-ideal types, then whatever's first, rather than failing outright.
const BALANCE_TYPE_PREFERENCE = ["interimAvailable", "expected", "closingBooked", "openingBooked", "forwardAvailable"];

export function pickPreferredBalance(balances: EnableBankingBalance[]): EnableBankingBalance | null {
  if (balances.length === 0) return null;
  for (const type of BALANCE_TYPE_PREFERENCE) {
    const match = balances.find((b) => b.balance_type === type);
    if (match) return match;
  }
  return balances[0];
}

export async function getAccountBalances(accountUid: string): Promise<EnableBankingBalance[]> {
  const data = await enableBankingFetch<{ balances: EnableBankingBalance[] }>(`/accounts/${accountUid}/balances`);
  return data.balances ?? [];
}

// Paginates through continuation_key until the ASPSP stops returning one.
export async function getAllTransactions(
  accountUid: string,
  dateFrom?: string
): Promise<EnableBankingTransaction[]> {
  const all: EnableBankingTransaction[] = [];
  let continuationKey: string | undefined;

  do {
    const page = await enableBankingFetch<{ transactions: EnableBankingTransaction[]; continuation_key?: string }>(
      `/accounts/${accountUid}/transactions`,
      { searchParams: { date_from: dateFrom, continuation_key: continuationKey } }
    );
    all.push(...page.transactions);
    continuationKey = page.continuation_key;
  } while (continuationKey);

  return all;
}
