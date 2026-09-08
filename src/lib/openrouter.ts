import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting, OPENROUTER_API_KEY_SETTING } from "@/lib/appSettings";
import type { Database } from "@/lib/supabase/types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
// A specific free model can be temporarily overloaded even while listed — trying a few
// candidates in order is more resilient than committing to just one.
const MAX_MODEL_ATTEMPTS = 3;

export class OpenRouterConfigError extends Error {}

async function getApiKey(client: SupabaseClient<Database>): Promise<string> {
  const key = await getSetting(client, OPENROUTER_API_KEY_SETTING);
  if (!key) {
    throw new OpenRouterConfigError(
      "OpenRouter API key not set. Add one on the Settings page (get a free key at openrouter.ai/keys)."
    );
  }
  return key;
}

type OpenRouterModel = {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  architecture?: { output_modalities?: string[] };
};

let cachedFreeModels: { ids: string[]; fetchedAt: number } | null = null;

// OpenRouter's ":free" model roster rotates week to week as providers add/pull/reprice
// models — hardcoding one would silently break whenever it's pulled. This fetches the live
// list and picks from whatever's currently free (pricing.prompt/completion both "0"),
// preferring larger context windows as a rough capability proxy. Cached in-memory for an
// hour so every categorize/emoji call doesn't re-fetch the full model list.
async function getFreeModelCandidates(): Promise<string[]> {
  if (cachedFreeModels && Date.now() - cachedFreeModels.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cachedFreeModels.ids;
  }
  const res = await fetch(OPENROUTER_MODELS_URL);
  if (!res.ok) throw new Error(`Could not list OpenRouter models (status ${res.status}).`);
  const data = (await res.json()) as { data: OpenRouterModel[] };
  const free = data.data
    .filter((m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0")
    // Pricing alone isn't enough — free-tier "0"/"0" pricing also covers models that don't
    // return text at all (e.g. Google's Lyria music-generation models output audio). Require
    // output to be text-only so every candidate is actually usable for a chat completion.
    .filter((m) => {
      const outputs = m.architecture?.output_modalities;
      return !outputs || (outputs.length === 1 && outputs[0] === "text");
    })
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
    .map((m) => m.id);
  if (free.length === 0) throw new Error("No free models are currently listed on OpenRouter.");
  cachedFreeModels = { ids: free, fetchedAt: Date.now() };
  return free;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function callModel(apiKey: string, model: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter's attribution headers for its public rankings — harmless for a local app.
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "FinanceHub",
    },
    // Several free models are "reasoning" models that, unless told otherwise, spend the
    // entire token budget on a chain-of-thought preamble ("Here's a thinking process: ...")
    // before ever reaching the actual answer — fatal for short replies like a single emoji or
    // category name. Models that don't support this parameter simply ignore it.
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, reasoning: { enabled: false } }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error ${res.status} (${model}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`OpenRouter response (${model}) had no content.`);
  return content;
}

export async function chatCompletion(
  client: SupabaseClient<Database>,
  messages: ChatMessage[],
  maxTokens = 300
): Promise<string> {
  const apiKey = await getApiKey(client);
  const candidates = await getFreeModelCandidates();

  let lastError: Error | null = null;
  for (const model of candidates.slice(0, MAX_MODEL_ATTEMPTS)) {
    try {
      return await callModel(apiKey, model, messages, maxTokens);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("All OpenRouter free-model attempts failed.");
}
