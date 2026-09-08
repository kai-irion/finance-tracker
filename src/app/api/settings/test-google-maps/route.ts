import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { testGoogleMapsKey, GoogleMapsConfigError } from "@/lib/googlePlaces";

export async function POST() {
  try {
    const types = await testGoogleMapsKey(supabaseAdmin);
    return NextResponse.json({ ok: true, reply: types.slice(0, 3).join(", ") });
  } catch (err) {
    const status = err instanceof GoogleMapsConfigError ? 400 : 502;
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status });
  }
}
