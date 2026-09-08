import type { SupabaseClient } from "@supabase/supabase-js";
import { chatCompletion, OpenRouterConfigError } from "@/lib/openrouter";
import type { Database } from "@/lib/supabase/types";

const BATCH_SIZE = 20;

export type SuggestTransaction = {
  id: string;
  merchant_name: string | null;
  raw_description: string | null;
  amount: number;
  currency: string;
};

export type SuggestCategoriesResult = {
  suggestions: Map<string, string>;
  errors: string[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Asks OpenRouter to pick the best-fitting category (from the ones that already exist) for each
// transaction, returning suggestions without writing anything to the database. Shared by
// classify-ai/route.ts (which persists every suggestion immediately) and
// suggest-categories/route.ts (a read-only variant that pre-fills the swipe review queue's
// category dropdown, letting the user accept/override before anything is written).
export async function suggestCategoriesForTransactions(
  client: SupabaseClient<Database>,
  transactions: SuggestTransaction[],
  categories: { id: string; name: string }[]
): Promise<SuggestCategoriesResult> {
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const categoryNames = categories.map((c) => c.name);

  const suggestions = new Map<string, string>();
  const errors: string[] = [];

  for (const batch of chunk(transactions, BATCH_SIZE)) {
    const listing = batch
      .map((t, i) => {
        const desc = t.merchant_name || t.raw_description || "(no description)";
        return `${i + 1}. "${desc}", ${t.amount} ${t.currency}`;
      })
      .join("\n");
    const prompt = `You are categorizing personal bank transactions for a finance app. The only allowed categories are:\n${categoryNames.join(", ")}\n\nFor each numbered transaction below, pick the single best-fitting category from that exact list (use "Other" only if truly nothing fits, or the closest available category if there's no "Other"). Reply with ONLY a JSON array of category name strings, same order, no other text, e.g. ["Groceries","Transport"].\n\n${listing}`;

    let reply: string;
    try {
      reply = await chatCompletion(client, [{ role: "user", content: prompt }], 500);
    } catch (err) {
      if (err instanceof OpenRouterConfigError) throw err;
      errors.push(`Batch failed: ${(err as Error).message}`);
      continue;
    }

    let picks: unknown;
    try {
      const jsonMatch = reply.match(/\[[\s\S]*\]/);
      picks = JSON.parse(jsonMatch ? jsonMatch[0] : reply);
    } catch {
      errors.push(`Batch: could not parse model response as JSON ("${reply.slice(0, 80)}").`);
      continue;
    }
    if (!Array.isArray(picks) || picks.length !== batch.length) {
      errors.push(`Batch: model returned ${Array.isArray(picks) ? picks.length : "non-array"} picks for ${batch.length} transactions, skipped.`);
      continue;
    }

    for (let i = 0; i < batch.length; i++) {
      const pickName = String(picks[i] ?? "").toLowerCase();
      const categoryId = categoryByName.get(pickName);
      if (!categoryId) {
        errors.push(`"${picks[i]}" doesn't match any existing category, left as needs review.`);
        continue;
      }
      suggestions.set(batch[i].id, categoryId);
    }
  }

  return { suggestions, errors };
}
