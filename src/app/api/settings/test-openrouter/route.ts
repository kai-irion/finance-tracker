import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { chatCompletion, OpenRouterConfigError } from "@/lib/openrouter";

export async function POST() {
  try {
    const reply = await chatCompletion(supabaseAdmin, [{ role: "user", content: "Reply with exactly one word: OK" }], 10);
    return NextResponse.json({ ok: true, reply: reply.trim().slice(0, 50) });
  } catch (err) {
    const status = err instanceof OpenRouterConfigError ? 400 : 502;
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status });
  }
}
