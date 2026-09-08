import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { Database } from "@/lib/supabase/types";

export type ApplyRuleResult = { updated: number; error?: string };

// Creates a merchant rule (pattern -> category) — categorizeTransaction already checks
// merchant_rules for every future sync, so this alone covers transactions synced later — and
// retroactively applies it to every currently-matching transaction (case-insensitive
// substring match against merchant_name/raw_description, same matching logic
// categorizeTransaction uses) so "label this person once" takes effect immediately rather
// than only going forward. Overwrites the category on matches even if one was already set,
// since a rule this specific (a named sender/recipient) is meant to be authoritative.
export async function applyMerchantRule(
  client: SupabaseClient<Database>,
  pattern: string,
  categoryId: string
): Promise<ApplyRuleResult> {
  const trimmed = pattern.trim();
  if (!trimmed) return { updated: 0, error: "Pattern is empty." };

  const { error: insertError } = await client.from("merchant_rules").insert({ pattern: trimmed, category_id: categoryId });
  if (insertError) return { updated: 0, error: insertError.message };

  type Row = { id: string; merchant_name: string | null; raw_description: string | null };
  const { data, error } = await fetchAllRows<Row>((from, to) =>
    client
      .from("transactions")
      .select("id, merchant_name, raw_description")
      .eq("is_internal_transfer", false)
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  );
  if (error) return { updated: 0, error: error.message };

  const needle = trimmed.toLowerCase();
  const matchIds = data
    .filter((t) => `${t.merchant_name ?? ""} ${t.raw_description ?? ""}`.toLowerCase().includes(needle))
    .map((t) => t.id);

  if (matchIds.length === 0) return { updated: 0 };

  const { error: updateError } = await client
    .from("transactions")
    .update({ category_id: categoryId, category_source: "rule", needs_review: false })
    .in("id", matchIds);
  if (updateError) return { updated: 0, error: updateError.message };

  return { updated: matchIds.length };
}
