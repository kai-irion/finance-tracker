import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { SyncHttpError, syncEnableBankingProvider } from "@/lib/enableBankingSync";

// Thin backwards-compatible wrapper — the generic route is now POST /api/sync/enable-banking
// with { provider: "revolut" | "wise" | "paypal" | "sparkasse" } in the body. Kept so
// anything still pointing at this specific URL (old bookmarks, cached UI) keeps working.
export async function POST() {
  try {
    const result = await syncEnableBankingProvider(supabaseAdmin, "revolut");
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyncHttpError) {
      return NextResponse.json({ synced: err.synced, errors: [err.message] }, { status: err.status });
    }
    return NextResponse.json({ synced: 0, errors: [(err as Error).message] }, { status: 500 });
  }
}
