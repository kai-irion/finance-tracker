import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { ENABLE_BANKING_PROVIDERS, isValidProviderKey } from "@/lib/enableBanking";
import { SyncHttpError, syncEnableBankingProvider } from "@/lib/enableBankingSync";

export async function POST(request: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ synced: 0, errors: ["Disabled in this public demo."] }, { status: 403 });
  let provider: unknown;
  try {
    const body = await request.json();
    provider = body?.provider;
  } catch {
    return NextResponse.json({ synced: 0, errors: ["Invalid request body (provider missing)."] }, { status: 400 });
  }

  if (!isValidProviderKey(provider)) {
    return NextResponse.json(
      {
        synced: 0,
        errors: [`Unknown provider "${String(provider)}". Allowed: ${Object.keys(ENABLE_BANKING_PROVIDERS).join(", ")}.`],
      },
      { status: 400 }
    );
  }

  try {
    const result = await syncEnableBankingProvider(supabaseAdmin, provider);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyncHttpError) {
      return NextResponse.json({ synced: err.synced, errors: [err.message] }, { status: err.status });
    }
    return NextResponse.json({ synced: 0, errors: [(err as Error).message] }, { status: 500 });
  }
}
