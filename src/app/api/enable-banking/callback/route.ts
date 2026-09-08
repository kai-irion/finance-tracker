import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import {
  EB_STATE_COOKIE,
  ENABLE_BANKING_PROVIDERS,
  exchangeCodeForSession,
  isValidProviderKey,
  resolveRequestOrigin,
  type EnableBankingProviderKey,
} from "@/lib/enableBanking";

function redirectWithStatus(
  origin: string,
  provider: EnableBankingProviderKey | undefined,
  params: { message?: string; error?: string }
): NextResponse {
  const dest = new URL("/accounts/connect", origin);
  if (provider) dest.searchParams.set("provider", provider);
  if (params.message) dest.searchParams.set("message", params.message);
  if (params.error) dest.searchParams.set("error", params.error);
  return NextResponse.redirect(dest);
}

export async function GET(request: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ error: "Disabled in this public demo." }, { status: 403 });
  const url = new URL(request.url);
  const origin = resolveRequestOrigin(request);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const aspspError = url.searchParams.get("error") || url.searchParams.get("error_description");

  const cookieStore = await cookies();
  const cookieState = cookieStore.get(EB_STATE_COOKIE)?.value;
  cookieStore.delete(EB_STATE_COOKIE);

  // The provider travels through the flow embedded in `state` ("<provider>:<uuid>"),
  // set on our own cookie in start-consent — the cookie is authoritative since not every
  // ASPSP reliably echoes the state query param back on redirect.
  const providerKey = cookieState?.split(":")[0];
  const provider = isValidProviderKey(providerKey) ? providerKey : undefined;

  if (aspspError) {
    return redirectWithStatus(origin, provider, { error: `Authorization denied: ${aspspError}` });
  }
  if (!code) {
    return redirectWithStatus(origin, provider, {
      error: "No authorization received (no 'code' parameter in the redirect).",
    });
  }
  if (!provider) {
    return redirectWithStatus(origin, undefined, {
      error: "No valid provider context found (state cookie missing or expired). Please restart the connection flow.",
    });
  }
  if (cookieState && returnedState && cookieState !== returnedState) {
    return redirectWithStatus(origin, provider, {
      error: "State parameter mismatch — connection aborted as a precaution. Please try again.",
    });
  }

  const label = ENABLE_BANKING_PROVIDERS[provider].label;

  try {
    const session = await exchangeCodeForSession(code);

    const { error: sessionUpsertError } = await supabaseAdmin
      .from("enable_banking_sessions")
      .upsert(
        { provider, session_id: session.session_id, expires_at: session.access.valid_until },
        { onConflict: "provider" }
      );
    if (sessionUpsertError) {
      throw new Error(`Session could not be saved: ${sessionUpsertError.message}`);
    }

    for (const account of session.accounts) {
      const externalAccountId = `eb-${provider}-${account.uid}`;
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("accounts")
        .select("id")
        .eq("provider", provider)
        .eq("external_account_id", externalAccountId)
        .maybeSingle();
      if (lookupError) throw new Error(`Account lookup failed: ${lookupError.message}`);

      if (!existing) {
        const { error: insertError } = await supabaseAdmin.from("accounts").insert({
          provider,
          name: account.name || account.account_id?.iban || `${label} (${account.currency})`,
          currency: account.currency,
          account_type: "bank",
          external_account_id: externalAccountId,
        });
        if (insertError) throw new Error(`Account could not be created: ${insertError.message}`);
      }
    }

    const expiresLabel = new Date(session.access.valid_until).toLocaleDateString("en-US");
    return redirectWithStatus(origin, provider, {
      message: `${label} connected successfully (${session.accounts.length} account${session.accounts.length === 1 ? "" : "s"}). Access valid until ${expiresLabel}.`,
    });
  } catch (err) {
    return redirectWithStatus(origin, provider, {
      error: `${label} connection failed: ${(err as Error).message}`,
    });
  }
}
