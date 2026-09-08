import type { SupabaseClient } from "@supabase/supabase-js";
import { getBalanceInEur } from "@/lib/fxRates";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { Database } from "@/lib/supabase/types";

// A transfer's other leg is frequently synced from a *different* provider, possibly several
// days later (ACH/SEPA/card-network settlement delays, or just a later manual sync) — a full
// week each way catches same-amount in/out pairs that a tighter window would miss, without
// getting so loose it starts matching unrelated coincidences (amount + sign + different
// account still have to match too).
const DATE_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000;
// Same-currency legs should match almost exactly — a cent or two of rounding at most.
const SAME_CURRENCY_ABS_TOLERANCE = 0.01;
// Cross-currency legs go through each provider's own FX conversion at slightly different
// rates/spreads — 3% covers that without being loose enough to match unrelated transactions.
const CROSS_CURRENCY_RELATIVE_TOLERANCE = 0.03;

// PayPal, funded per-purchase straight from a bank account (no held balance), exports BOTH a
// generic account-level funding record (no merchant info — these two patterns) AND, on the
// bank side, a FOLGELASTSCHRIFT that carries the real merchant name ("...Ihr Einkauf bei X").
// The two legs genuinely represent the same money movement, but only ONE of them should be
// excluded as a transfer: the PayPal side is a redundant internal record, while the bank side
// is the only place the real expense (and its merchant) is captured. Marking both as a
// transfer — the matcher's normal behavior for a true two-account transfer — silently drops
// the actual expense from every spend figure instead of just deduplicating it.
const PAYPAL_FUNDING_RECORD_PATTERNS = [/bankgutschrift auf paypal-konto/i, /rückbuchung allgemeiner einbehaltung/i];

function isPaypalFundingRecord(description: string | null): boolean {
  return description !== null && PAYPAL_FUNDING_RECORD_PATTERNS.some((p) => p.test(description));
}

type Candidate = {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  booked_at: string;
  raw_description: string | null;
  eurAmount: number | null;
};

// TODO(stretch): likely-subscription detection (same merchant + similar amount recurring
// ~monthly) — a separate pass, similar shape to this file, not implemented yet.

export type MatchResult = { matched: number; needsReview: number };

function sameCurrencyMatch(a: Candidate, b: Candidate): boolean {
  return Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) <= Math.max(SAME_CURRENCY_ABS_TOLERANCE, Math.abs(a.amount) * 0.001);
}

function crossCurrencyMatch(a: Candidate, b: Candidate): boolean {
  if (a.eurAmount === null || b.eurAmount === null) return false;
  const diff = Math.abs(Math.abs(a.eurAmount) - Math.abs(b.eurAmount));
  const scale = Math.max(Math.abs(a.eurAmount), Math.abs(b.eurAmount), 1);
  return diff / scale <= CROSS_CURRENCY_RELATIVE_TOLERANCE;
}

// crossCurrencyMatch converts through *today's* cached fx_rates row, since there's no
// historical rate table — for a pair booked months ago, FX drift alone can push the ratio
// outside the 3% tolerance even though the two legs are obviously the same event (e.g.
// PayPal's own "Allgemeine Währungsumrechnung" internal SEK<->EUR conversion). A shared
// booked_at down to the second is much stronger evidence than an amount ratio computed at
// the wrong point in time, so it's accepted as a match on its own — but only when that
// timestamp carries real time-of-day precision. Many CSV-imported/date-only rows default to
// midnight UTC, where two unrelated transactions could coincidentally share a timestamp.
function hasTimeOfDayPrecision(iso: string): boolean {
  const d = new Date(iso);
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

function sameInstantMatch(a: Candidate, b: Candidate): boolean {
  return a.booked_at === b.booked_at && hasTimeOfDayPrecision(a.booked_at);
}

// Runs over every currently-unmatched transaction (is_internal_transfer=false AND
// matched_transfer_id IS NULL) system-wide — not just rows from the latest sync — since a
// transfer's other leg is often synced later, from a different provider. Cheap/safe to call
// after every sync: once a pair is matched it drops out of future runs via the same WHERE
// clause. Call sites: syncEnableBankingProvider, the Coinbase sync route, and the CSV-import
// route — every place that inserts new transactions.
type UnmatchedRow = {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  booked_at: string;
  raw_description: string | null;
};

export async function matchInternalTransfers(client: SupabaseClient<Database>): Promise<MatchResult> {
  const [{ data, error }, { data: accounts, error: accountsError }] = await Promise.all([
    fetchAllRows<UnmatchedRow>((from, to) =>
      client
        .from("transactions")
        .select("id, account_id, amount, currency, booked_at, raw_description")
        .eq("is_internal_transfer", false)
        .is("matched_transfer_id", null)
        .order("booked_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: UnmatchedRow[] | null; error: { message: string } | null }>
    ),
    client.from("accounts").select("id, provider"),
  ]);

  if (error) throw new Error(`Internal transfer matching: could not load transactions (${error.message})`);
  if (accountsError) throw new Error(`Internal transfer matching: could not load accounts (${accountsError.message})`);
  if (data.length < 2) return { matched: 0, needsReview: 0 };

  const accountProvider = new Map((accounts ?? []).map((a) => [a.id, a.provider]));

  const currencies = Array.from(new Set(data.map((t) => t.currency)));
  const eurByCurrency = new Map<string, number | null>();
  for (const currency of currencies) {
    // getBalanceInEur(1, currency) resolves to null if no rate is cached/fetchable for this
    // currency — those legs simply become ineligible for cross-currency matching below.
    eurByCurrency.set(currency, currency === "EUR" ? 1 : await getBalanceInEur(client, 1, currency));
  }

  const candidates: Candidate[] = data.map((t) => {
    const rate = eurByCurrency.get(t.currency) ?? null;
    return { ...t, eurAmount: rate === null ? null : t.amount * rate };
  });

  // PayPal sometimes posts the "Bankgutschrift"/funding credit AND the actual outgoing
  // payment (e.g. a person-to-person "Handyzahlung", not a merchant checkout) as two separate
  // rows on the same PayPal account at the exact same instant — the credit nets to zero
  // against the debit within PayPal's own ledger; there's no held-balance step in between.
  // When that same-account twin exists, IT (not the bank-side FOLGELASTSCHRIFT that funded
  // the credit) is the one true expense record — so the special case below must not also keep
  // the bank leg as a second counted expense. Detected up front, scoped per account, and
  // still gated on real time-of-day precision to avoid CSV midnight-default collisions.
  const fundingRecordsWithTwin = new Set<string>();
  const byAccount = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byAccount.get(c.account_id) ?? [];
    list.push(c);
    byAccount.set(c.account_id, list);
  }
  for (const list of byAccount.values()) {
    for (const x of list) {
      if (!isPaypalFundingRecord(x.raw_description) || !hasTimeOfDayPrecision(x.booked_at)) continue;
      const hasTwin = list.some(
        (y) =>
          y.id !== x.id &&
          y.booked_at === x.booked_at &&
          y.currency === x.currency &&
          Math.abs(y.amount + x.amount) <= SAME_CURRENCY_ABS_TOLERANCE &&
          !isPaypalFundingRecord(y.raw_description)
      );
      if (hasTwin) fundingRecordsWithTwin.add(x.id);
    }
  }

  const claimed = new Set<string>();
  const updates: { id: string; is_internal_transfer: boolean; matched_transfer_id: string; needs_review?: boolean }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (claimed.has(a.id)) continue;

    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      // Sorted ascending by booked_at: once b is further than the tolerance window from a,
      // every later candidate is too — stop scanning instead of just skipping this pair.
      if (new Date(b.booked_at).getTime() - new Date(a.booked_at).getTime() > DATE_TOLERANCE_MS) break;
      if (claimed.has(b.id)) continue;
      if (a.account_id === b.account_id) continue;
      if (a.amount === 0 || b.amount === 0 || Math.sign(a.amount) === Math.sign(b.amount)) continue;

      const isExact = a.currency === b.currency && sameCurrencyMatch(a, b);
      const isApprox = !isExact && crossCurrencyMatch(a, b);
      const isSameInstant = !isExact && !isApprox && sameInstantMatch(a, b);
      if (!isExact && !isApprox && !isSameInstant) continue;

      claimed.add(a.id);
      claimed.add(b.id);

      // A genuine PayPal-funded-purchase pair (Bankgutschrift credit <-> FOLGELASTSCHRIFT
      // debit) is an EXACT euro-for-euro reconciliation of the same real-world pull, never
      // merely "close" — so this special case must require isExact, not the looser isApprox
      // cross-currency path. Without this, two same-currency but financially UNRELATED small
      // transactions that happen to land within the 3% tolerance of each other (e.g. an
      // unrelated €3.40 purchase and an unrelated €3.33 funding credit within the 7-day
      // window) could be treated as a funding pair by coincidence.
      const aIsPaypalFunding = isExact && accountProvider.get(a.account_id) === "paypal" && isPaypalFundingRecord(a.raw_description);
      const bIsPaypalFunding = isExact && accountProvider.get(b.account_id) === "paypal" && isPaypalFundingRecord(b.raw_description);
      // "Bank-like" = not the intermediary itself and not an exchange — a real spend-bearing
      // account whose leg should stay a counted expense when it's the one carrying the
      // merchant info.
      const bProviderIsSpendBearing = !["paypal", "coinbase"].includes(accountProvider.get(b.account_id) ?? "");
      const aProviderIsSpendBearing = !["paypal", "coinbase"].includes(accountProvider.get(a.account_id) ?? "");

      let aIsTransfer = true;
      let bIsTransfer = true;
      if (aIsPaypalFunding && bProviderIsSpendBearing && !fundingRecordsWithTwin.has(a.id)) bIsTransfer = false;
      else if (bIsPaypalFunding && aProviderIsSpendBearing && !fundingRecordsWithTwin.has(b.id)) aIsTransfer = false;

      const needsReview = isApprox || isSameInstant;
      updates.push({
        id: a.id,
        is_internal_transfer: aIsTransfer,
        matched_transfer_id: b.id,
        ...(aIsTransfer ? { needs_review: needsReview } : {}),
      });
      updates.push({
        id: b.id,
        is_internal_transfer: bIsTransfer,
        matched_transfer_id: a.id,
        ...(bIsTransfer ? { needs_review: needsReview } : {}),
      });
      break;
    }
  }

  for (const update of updates) {
    const { id, ...fields } = update;
    await client.from("transactions").update(fields).eq("id", id);
  }

  return { matched: updates.length, needsReview: updates.filter((u) => u.needs_review).length };
}
