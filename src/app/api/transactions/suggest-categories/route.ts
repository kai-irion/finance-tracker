import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { OpenRouterConfigError } from "@/lib/openrouter";
import { suggestCategoriesForTransactions } from "@/lib/aiCategorize";

// Read-only counterpart to classify-ai: given a list of transaction ids, returns OpenRouter's
// best-guess category for each without writing anything to the database. Used to pre-fill the
// swipe review queue's (/review) category dropdown so the user can accept, override, or skip
// each suggestion themselves rather than having it applied automatically.
export async function POST(request: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ suggestions: {}, errors: ["Disabled in this public demo."] }, { status: 403 });
  let ids: unknown;
  try {
    const body = await request.json();
    ids = body?.ids;
  } catch {
    return NextResponse.json({ suggestions: {}, errors: ["Invalid request body (ids missing)."] }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ suggestions: {}, errors: ["ids must be an array of strings."] }, { status: 400 });
  }
  if (ids.length === 0) return NextResponse.json({ suggestions: {}, errors: [] });

  const { data: categories, error: catError } = await supabaseAdmin.from("categories").select("id, name");
  if (catError) return NextResponse.json({ suggestions: {}, errors: [catError.message] }, { status: 500 });
  if (!categories || categories.length === 0) {
    return NextResponse.json({ suggestions: {}, errors: ["No categories exist yet — add some on the Categories page first."] }, { status: 400 });
  }

  const { data: transactions, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, merchant_name, raw_description, amount, currency")
    .in("id", ids as string[]);
  if (txError) return NextResponse.json({ suggestions: {}, errors: [txError.message] }, { status: 500 });

  try {
    const { suggestions, errors } = await suggestCategoriesForTransactions(supabaseAdmin, transactions ?? [], categories);
    return NextResponse.json({ suggestions: Object.fromEntries(suggestions), errors });
  } catch (err) {
    if (err instanceof OpenRouterConfigError) {
      return NextResponse.json({ suggestions: {}, errors: [err.message] }, { status: 500 });
    }
    throw err;
  }
}
