"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { usePrivacy } from "@/lib/privacy-context";
import { computeAccountLabels } from "@/lib/accountLabels";
import { applyMerchantRule } from "@/lib/merchantRules";
import { SwipeReviewCard, type ReviewTransaction } from "@/components/swipe-review-card";
import type { Category } from "@/lib/supabase/types";

// One batch at a time — mirrors the DEFAULT_LIMIT bounding on classify-ai/classify-maps, and
// keeps a single page load from firing a huge OpenRouter suggestion batch (free-tier rate
// limits make hundreds of transactions in one go impractical anyway).
const QUEUE_LIMIT = 50;
const VISIBLE_STACK = 3;

type RawRow = {
  id: string;
  merchant_name: string | null;
  raw_description: string | null;
  amount: number;
  currency: string;
  booked_at: string;
  account_id: string;
};

// Tinder-style review queue for transactions that neither merchant rules nor Google Maps could
// categorize (see /transactions "Needs review" tab, which links here). Each card shows an
// OpenRouter-suggested category pre-filled in an editable dropdown; swiping right (or clicking
// Accept) commits whatever category is currently selected, swiping left (or Skip) leaves the
// transaction untouched for a later session.
export default function ReviewPage() {
  const { isPrivate } = usePrivacy();

  const [categories, setCategories] = useState<Category[]>([]);
  const [queue, setQueue] = useState<ReviewTransaction[]>([]);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [suggestionsReady, setSuggestionsReady] = useState(false);
  const [suggestBanner, setSuggestBanner] = useState<string | null>(null);
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setIndex(0);
    setReviewedCount(0);
    setSkippedCount(0);
    setSuggestionsReady(false);
    setRuleMessage(null);

    const [catRes, accRes, countRes, txRes] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("accounts").select("id, provider, name, currency"),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("needs_review", true)
        .eq("is_internal_transfer", false),
      supabase
        .from("transactions")
        .select("id, merchant_name, raw_description, amount, currency, booked_at, account_id")
        .eq("needs_review", true)
        .eq("is_internal_transfer", false)
        .order("booked_at", { ascending: false })
        .limit(QUEUE_LIMIT),
    ]);

    const cats = catRes.data ?? [];
    setCategories(cats);
    setTotalRemaining(countRes.count ?? 0);

    const accountLabels = computeAccountLabels(accRes.data ?? []);
    const rows = (txRes.data ?? []) as RawRow[];
    const nextQueue: ReviewTransaction[] = rows.map((r) => ({
      id: r.id,
      merchant_name: r.merchant_name,
      raw_description: r.raw_description,
      amount: r.amount,
      currency: r.currency,
      booked_at: r.booked_at,
      accountLabel: accountLabels.get(r.account_id) ?? "Account",
    }));
    setQueue(nextQueue);
    setLoading(false);

    if (nextQueue.length === 0) return;

    setSuggestBanner(null);
    try {
      const res = await fetch("/api/transactions/suggest-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: nextQueue.map((t) => t.id) }),
      });
      const data: { suggestions: Record<string, string>; errors: string[] } = await res.json();
      setSuggestions(data.suggestions);
      setChoices((prev) => {
        const next = { ...prev };
        for (const t of nextQueue) next[t.id] = data.suggestions[t.id] ?? "";
        return next;
      });
      if (!res.ok) {
        setSuggestBanner(data.errors[0] ?? "Could not fetch AI suggestions — pick categories manually below.");
      }
    } catch {
      setSuggestBanner("Could not fetch AI suggestions — pick categories manually below.");
      setChoices((prev) => {
        const next = { ...prev };
        for (const t of nextQueue) if (!(t.id in next)) next[t.id] = "";
        return next;
      });
    } finally {
      setSuggestionsReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = queue[index];

  const refreshRemainingCount = useCallback(async () => {
    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("needs_review", true)
      .eq("is_internal_transfer", false);
    setTotalRemaining(count ?? 0);
  }, []);

  // Accepting a card doesn't just categorize that one transaction — it creates a merchant rule
  // (same as the "Label sender" flow) keyed on the merchant name/description, so every future
  // transaction from this sender or shop is categorized automatically too. applyMerchantRule
  // also retroactively sweeps any other currently-matching transaction (including others still
  // sitting later in this queue), so those get pruned from the local queue rather than making
  // the user swipe through already-categorized cards.
  const accept = useCallback(async () => {
    if (!current) return;
    const categoryId = choices[current.id];
    if (!categoryId) return;

    const pattern = (current.merchant_name || current.raw_description || "").trim();
    let sweptExtra = false;

    if (pattern) {
      const result = await applyMerchantRule(supabase, pattern, categoryId);
      if (result.error) {
        // Rule couldn't be saved — still record this transaction's own category directly.
        await supabase
          .from("transactions")
          .update({ category_id: categoryId, category_source: "manual", needs_review: false })
          .eq("id", current.id);
      } else if (result.updated > 1) {
        sweptExtra = true;
        setRuleMessage(`Rule created for "${pattern}" — ${result.updated} matching transactions categorized.`);
        const needle = pattern.toLowerCase();
        setQueue((prev) =>
          prev.filter(
            (t, i) => i <= index || !`${t.merchant_name ?? ""} ${t.raw_description ?? ""}`.toLowerCase().includes(needle)
          )
        );
      }
    } else {
      await supabase
        .from("transactions")
        .update({ category_id: categoryId, category_source: "manual", needs_review: false })
        .eq("id", current.id);
    }

    setReviewedCount((n) => n + 1);
    if (sweptExtra) {
      await refreshRemainingCount();
    } else {
      setTotalRemaining((n) => Math.max(0, n - 1));
    }
    setIndex((i) => i + 1);
  }, [current, choices, index, refreshRemainingCount]);

  const skip = useCallback(() => {
    if (!current) return;
    setSkippedCount((n) => n + 1);
    setIndex((i) => i + 1);
  }, [current]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!current) return;
      if (e.key === "ArrowRight") accept();
      else if (e.key === "ArrowLeft") skip();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, accept, skip]);

  const visible = useMemo(() => queue.slice(index, index + VISIBLE_STACK), [queue, index]);
  const done = !loading && queue.length > 0 && index >= queue.length;
  const empty = !loading && queue.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <span className="text-sm text-black/60 dark:text-white/60">{totalRemaining} need review</span>
      </div>

      {suggestBanner && (
        <p className="text-sm text-amber-700 dark:text-amber-400 mb-4 rounded-md bg-amber-500/10 px-3 py-2">{suggestBanner}</p>
      )}
      {ruleMessage && (
        <p className="text-sm text-green-700 dark:text-green-400 mb-4 rounded-md bg-green-500/10 px-3 py-2">{ruleMessage}</p>
      )}

      {loading && <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>}

      {empty && (
        <p className="text-sm text-black/60 dark:text-white/60">
          Nothing needs review right now. New uncategorized transactions will show up here.
        </p>
      )}

      {!loading && !empty && (
        <>
          <p className="text-sm text-black/60 dark:text-white/60 mb-6">
            {reviewedCount} categorized · {skippedCount} skipped this session · {queue.length - index} of {queue.length} left in this
            batch
          </p>

          <div className="relative mx-auto" style={{ height: 420, maxWidth: 480 }}>
            {done ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <p className="text-lg font-medium">Batch complete.</p>
                <p className="text-sm text-black/60 dark:text-white/60">
                  {skippedCount > 0 ? `${skippedCount} skipped — they'll show up again if you reload.` : "Nice work."}
                </p>
                <button
                  onClick={load}
                  className="mt-2 rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium"
                >
                  {totalRemaining > 0 ? "Load next batch" : "Reload"}
                </button>
              </div>
            ) : (
              visible.map((t, i) => (
                <SwipeReviewCard
                  key={t.id}
                  transaction={t}
                  categories={categories}
                  categoryId={choices[t.id] ?? ""}
                  suggestedCategoryId={suggestions[t.id] ?? null}
                  suggestionPending={!suggestionsReady && !(t.id in choices)}
                  onCategoryChange={(categoryId) => setChoices((prev) => ({ ...prev, [t.id]: categoryId }))}
                  onAccept={accept}
                  onSkip={skip}
                  active={i === 0}
                  stackIndex={i}
                  isPrivate={isPrivate}
                />
              ))
            )}
          </div>

          {!done && (
            <p className="text-center text-xs text-black/40 dark:text-white/40 mt-4">
              Drag the card, use the buttons, or ← / → on your keyboard.
            </p>
          )}
        </>
      )}
    </div>
  );
}
