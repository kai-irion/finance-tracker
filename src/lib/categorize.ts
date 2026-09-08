import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction, Database } from "@/lib/supabase/types";

export type CategorizationInput = Pick<Transaction, "mcc" | "merchant_name" | "raw_description"> & {
  // Not a transaction column — the account's account_type, passed in by the caller so
  // crypto accounts can fall back to "Investment" instead of needs_review below.
  account_type?: string;
};

export type CategorizationResult = Pick<
  Transaction,
  "category_id" | "category_source" | "needs_review"
>;

// Categorization order: MCC default category, then merchant rules (case-insensitive
// substring match), then crypto accounts default to "Investment", then uncategorized +
// flagged for manual review. AI fallback is Phase 2b, not implemented here.
export async function categorizeTransaction(
  client: SupabaseClient<Database>,
  transaction: CategorizationInput
): Promise<CategorizationResult> {
  if (transaction.mcc) {
    const { data: mccRow } = await client
      .from("mcc_codes")
      .select("default_category_id")
      .eq("mcc", transaction.mcc)
      .maybeSingle();
    if (mccRow?.default_category_id) {
      return {
        category_id: mccRow.default_category_id,
        category_source: "mcc",
        needs_review: false,
      };
    }
  }

  const { data: rules } = await client
    .from("merchant_rules")
    .select("pattern, category_id")
    .order("created_at", { ascending: true });

  const haystack = `${transaction.merchant_name ?? ""} ${transaction.raw_description ?? ""}`.toLowerCase();
  for (const rule of rules ?? []) {
    if (rule.category_id && haystack.includes(rule.pattern.toLowerCase())) {
      return {
        category_id: rule.category_id,
        category_source: "rule",
        needs_review: false,
      };
    }
  }

  if (transaction.account_type === "crypto") {
    const { data: investmentCategory } = await client
      .from("categories")
      .select("id")
      .eq("name", "Investment")
      .maybeSingle();
    if (investmentCategory?.id) {
      return {
        category_id: investmentCategory.id,
        category_source: "rule",
        needs_review: false,
      };
    }
  }

  return { category_id: null, category_source: null, needs_review: true };
}

// Runs categorizeTransaction and persists the result on the given row.
export async function categorizeAndUpdateTransaction(
  client: SupabaseClient<Database>,
  id: string,
  transaction: CategorizationInput
): Promise<CategorizationResult> {
  const result = await categorizeTransaction(client, transaction);
  const { error } = await client.from("transactions").update(result).eq("id", id);
  if (error) throw error;
  return result;
}
