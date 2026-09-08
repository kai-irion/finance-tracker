import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { OpenRouterConfigError } from "@/lib/openrouter";
import { suggestCategoriesForTransactions, type SuggestTransaction } from "@/lib/aiCategorize";
import { fetchAllRows } from "@/lib/fetchAllRows";

const DEFAULT_LIMIT = 100;

// Batches transactions to OpenRouter, asking it to pick the best matching category from the
// ones that already exist (never invents new ones), completing the "AI fallback" categorize.ts
// documents as a future step beyond MCC/merchant-rule matching.
//
// Two modes, same as classify-maps: with no `ids`, pulls the next `limit` needs_review
// transactions (free-tier OpenRouter rate limits, ~20 req/min, make processing thousands of
// rows in one call impractical — the button can just be clicked again). With `ids`, classifies
// exactly those transactions (any needs_review status) in full, no truncation — an explicit
// single-row or bulk-selection request shouldn't silently drop part of the selection.
export async function POST(request: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ error: "Disabled in this public demo." }, { status: 403 });
  let limit = DEFAULT_LIMIT;
  let explicitIds: string[] | null = null;
  try {
    const body = await request.json();
    if (typeof body?.limit === "number" && body.limit > 0) limit = Math.floor(body.limit);
    if (Array.isArray(body?.ids) && body.ids.every((id: unknown) => typeof id === "string")) {
      explicitIds = body.ids;
    }
  } catch {
    // No body / non-JSON body — use the default limit, no explicit ids.
  }

  const { data: categories, error: catError } = await supabaseAdmin.from("categories").select("id, name");
  if (catError) return NextResponse.json({ classified: 0, errors: [catError.message] }, { status: 500 });
  if (!categories || categories.length === 0) {
    return NextResponse.json({ classified: 0, errors: ["No categories exist yet — add some on the Categories page first."] }, { status: 400 });
  }

  let allReview: SuggestTransaction[];
  if (explicitIds) {
    if (explicitIds.length === 0) return NextResponse.json({ classified: 0, errors: [], remaining: 0 });
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("id, merchant_name, raw_description, amount, currency")
      .in("id", explicitIds);
    if (error) return NextResponse.json({ classified: 0, errors: [error.message] }, { status: 500 });
    allReview = data ?? [];
  } else {
    const { data, error: txError } = await fetchAllRows<SuggestTransaction>((from, to) =>
      supabaseAdmin
        .from("transactions")
        .select("id, merchant_name, raw_description, amount, currency")
        .eq("needs_review", true)
        .eq("is_internal_transfer", false)
        .order("booked_at", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: SuggestTransaction[] | null; error: { message: string } | null }>
    );
    if (txError) return NextResponse.json({ classified: 0, errors: [txError.message] }, { status: 500 });
    allReview = data;
  }

  const toProcess = explicitIds ? allReview : allReview.slice(0, limit);
  if (toProcess.length === 0) return NextResponse.json({ classified: 0, errors: [], remaining: 0 });

  let suggestions: Map<string, string>;
  let errors: string[];
  try {
    ({ suggestions, errors } = await suggestCategoriesForTransactions(supabaseAdmin, toProcess, categories));
  } catch (err) {
    if (err instanceof OpenRouterConfigError) {
      return NextResponse.json({ classified: 0, errors: [err.message] }, { status: 500 });
    }
    throw err;
  }

  let classified = 0;
  for (const tx of toProcess) {
    const categoryId = suggestions.get(tx.id);
    if (!categoryId) continue;
    const { error: updateError } = await supabaseAdmin
      .from("transactions")
      .update({ category_id: categoryId, category_source: "ai", needs_review: false })
      .eq("id", tx.id);
    if (updateError) {
      errors.push(`${tx.id}: ${updateError.message}`);
      continue;
    }
    classified++;
  }

  return NextResponse.json({ classified, errors, remaining: Math.max(0, allReview.length - toProcess.length) });
}
