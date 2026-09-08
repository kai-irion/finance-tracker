import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { chatCompletion, OpenRouterConfigError } from "@/lib/openrouter";

// The model doesn't always follow "reply with exactly one emoji" literally — it sometimes
// wraps the emoji in quotes, a word, or punctuation ("Sure! 🐾", "🏠 Home"). Grabbing the
// first grapheme cluster (the previous approach) happily returned a plain letter like "H"
// for "Health" — it never checked the character was actually an emoji. This scans for the
// first \p{Extended_Pictographic} match instead, with the optional variation-selector/
// skin-tone/ZWJ-sequence suffixes emoji are frequently made of, so a non-emoji reply
// correctly yields null (surfaced as an error) rather than saving garbage as the icon.
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);
const ZWJ = String.fromCodePoint(0x200d);
const EMOJI_PATTERN = new RegExp(
  `\\p{Extended_Pictographic}(?:${VARIATION_SELECTOR})?(?:[\\u{1F3FB}-\\u{1F3FF}])?(?:${ZWJ}\\p{Extended_Pictographic}(?:${VARIATION_SELECTOR})?)*`,
  "u"
);

function extractFirstEmoji(text: string): string | null {
  const match = text.match(EMOJI_PATTERN);
  return match ? match[0] : null;
}

export async function POST(request: NextRequest) {
  if (isDemoMode()) return NextResponse.json({ error: "Disabled in this public demo." }, { status: 403 });
  let categoryIds: unknown;
  try {
    const body = await request.json();
    categoryIds = body?.categoryIds;
  } catch {
    return NextResponse.json({ updated: 0, errors: ["Invalid request body (categoryIds missing)."] }, { status: 400 });
  }
  if (!Array.isArray(categoryIds) || categoryIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ updated: 0, errors: ["categoryIds must be an array of strings."] }, { status: 400 });
  }
  if (categoryIds.length === 0) return NextResponse.json({ updated: 0, errors: [] });

  const { data: categories, error: fetchError } = await supabaseAdmin
    .from("categories")
    .select("id, name")
    .in("id", categoryIds as string[]);
  if (fetchError) {
    return NextResponse.json({ updated: 0, errors: [fetchError.message] }, { status: 500 });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const category of categories ?? []) {
    try {
      const reply = await chatCompletion(supabaseAdmin, [
        {
          role: "user",
          content: `Reply with exactly one emoji character — no words, no explanation, no quotes — that best represents this personal-finance spending category: "${category.name}".`,
        },
      ], 20);
      const emoji = extractFirstEmoji(reply);
      if (!emoji) {
        errors.push(`${category.name}: model reply had no usable emoji ("${reply.slice(0, 40)}").`);
        continue;
      }
      const { error: updateError } = await supabaseAdmin.from("categories").update({ icon: emoji }).eq("id", category.id);
      if (updateError) {
        errors.push(`${category.name}: ${updateError.message}`);
        continue;
      }
      updated++;
    } catch (err) {
      if (err instanceof OpenRouterConfigError) {
        return NextResponse.json({ updated, errors: [err.message] }, { status: 500 });
      }
      errors.push(`${category.name}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({ updated, errors });
}
