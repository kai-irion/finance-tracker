import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import {
  EB_STATE_COOKIE,
  ENABLE_BANKING_PROVIDERS,
  EnableBankingAuthError,
  isValidProviderKey,
  resolveAspspForProvider,
  resolveRequestOrigin,
  startAuthorization,
} from "@/lib/enableBanking";

export async function POST(request: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ error: "Disabled in this public demo." }, { status: 403 });
  let provider: unknown;
  try {
    const body = await request.json();
    provider = body?.provider;
  } catch {
    return NextResponse.json({ error: "Invalid request body (provider missing)." }, { status: 400 });
  }

  if (!isValidProviderKey(provider)) {
    return NextResponse.json(
      {
        error: `Unknown provider "${String(provider)}". Allowed: ${Object.keys(ENABLE_BANKING_PROVIDERS).join(", ")}.`,
      },
      { status: 400 }
    );
  }

  try {
    const config = ENABLE_BANKING_PROVIDERS[provider];
    const aspsp = await resolveAspspForProvider(provider);
    if (!aspsp) {
      return NextResponse.json(
        {
          error: `${config.label} was not found in the Enable Banking ASPSP list (searched for "${config.aspspSearchName}"). The ASPSP name may have changed — check the Enable Banking ASPSP list (GET /aspsps) manually.`,
        },
        { status: 502 }
      );
    }

    // Provider travels through the whole redirect round-trip embedded in `state`
    // ("<provider>:<uuid>") — set on our own httpOnly cookie here and read back in the
    // callback, since not every ASPSP reliably echoes the state query param on redirect.
    const state = `${provider}:${randomUUID()}`;
    // Derived from the incoming request (via x-forwarded-host/-proto — see
    // resolveRequestOrigin), not a hardcoded/env URL — matches whatever origin (e.g. the
    // current ngrok tunnel) the page was actually loaded from, so this keeps working
    // across ngrok URL rotations without a code change.
    const redirectUrl = `${resolveRequestOrigin(request)}/api/enable-banking/callback`;

    const { url } = await startAuthorization({
      aspspName: aspsp.name,
      aspspCountry: aspsp.country,
      redirectUrl,
      state,
    });

    const cookieStore = await cookies();
    cookieStore.set(EB_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 900,
      sameSite: "lax",
      path: "/",
    });

    return NextResponse.json({ url });
  } catch (err) {
    const status = err instanceof EnableBankingAuthError ? 401 : 502;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
