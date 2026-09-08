import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { findCategoryForMerchant, GoogleMapsConfigError } from "@/lib/googlePlaces";
import { applyMerchantRule } from "@/lib/merchantRules";
import { fetchAllRows } from "@/lib/fetchAllRows";

// Bounded lower than classify-ai's DEFAULT_LIMIT (100) — Google Places Text Search is a billed
// API (unlike OpenRouter's free tier), so a single button click should cost a small, predictable
// number of requests. The place_lookup_cache table means clicking again to continue never
// re-bills a merchant already looked up, whether it matched or not.
const DEFAULT_LIMIT = 25;

type ReviewRow = {
  id: string;
  merchant_name: string | null;
  raw_description: string | null;
};

// Batches transactions through Google Places: search the merchant name, map its place type to
// one of the user's existing categories (src/lib/googlePlaces.ts), and on a match create a
// merchant rule (same effect as the "Label sender" flow) so this and every future matching
// transaction is categorized going forward — this route itself never needs_review=false's a row
// directly, applyMerchantRule does that as a side effect of the rule insert. Rows with no match
// are left as needs_review for the manual swipe review queue.
//
// Two modes: with no `ids`, pulls the next `limit` needs_review transactions (the "Classify with
// Maps" button on the Needs review tab, for working through the backlog) — bounded well below
// classify-ai's DEFAULT_LIMIT since Places is a billed API. With `ids`, classifies exactly those
// transactions (any needs_review status) and does not truncate — the caller explicitly chose
// this set (a single row's "Maps" action, or the bulk-selection toolbar), so silently dropping
// some of an explicit selection would be more surprising than honoring it in full.
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

  let allReview: ReviewRow[];
  if (explicitIds) {
    if (explicitIds.length === 0) return NextResponse.json({ classified: 0, matched: 0, errors: [], remaining: 0 });
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("id, merchant_name, raw_description")
      .in("id", explicitIds);
    if (error) return NextResponse.json({ classified: 0, errors: [error.message] }, { status: 500 });
    allReview = data ?? [];
  } else {
    const { data, error: txError } = await fetchAllRows<ReviewRow>((from, to) =>
      supabaseAdmin
        .from("transactions")
        .select("id, merchant_name, raw_description")
        .eq("needs_review", true)
        .eq("is_internal_transfer", false)
        .order("booked_at", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: ReviewRow[] | null; error: { message: string } | null }>
    );
    if (txError) return NextResponse.json({ classified: 0, errors: [txError.message] }, { status: 500 });
    allReview = data;
  }

  // Dedupe by merchant key so a merchant with many selected transactions costs one Places
  // lookup, not one per transaction — applyMerchantRule retroactively covers every match anyway.
  const byMerchant = new Map<string, string>();
  for (const row of allReview) {
    const label = (row.merchant_name || row.raw_description || "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!byMerchant.has(key)) byMerchant.set(key, label);
  }

  const uniqueMerchants = Array.from(byMerchant.values());
  const toProcess = explicitIds ? uniqueMerchants : uniqueMerchants.slice(0, limit);
  if (toProcess.length === 0) return NextResponse.json({ classified: 0, matched: 0, errors: [], remaining: 0 });

  let classified = 0;
  let matched = 0;
  const errors: string[] = [];

  for (const merchantLabel of toProcess) {
    try {
      const { categoryId } = await findCategoryForMerchant(supabaseAdmin, merchantLabel, categories);
      if (!categoryId) continue;
      matched++;
      const result = await applyMerchantRule(supabaseAdmin, merchantLabel, categoryId);
      if (result.error) {
        errors.push(`"${merchantLabel}": ${result.error}`);
        continue;
      }
      classified += result.updated;
    } catch (err) {
      if (err instanceof GoogleMapsConfigError) {
        return NextResponse.json({ classified, matched, errors: [err.message] }, { status: 500 });
      }
      errors.push(`"${merchantLabel}": ${(err as Error).message}`);
    }
  }

  return NextResponse.json({
    classified,
    matched,
    errors,
    remaining: Math.max(0, uniqueMerchants.length - toProcess.length),
  });
}
