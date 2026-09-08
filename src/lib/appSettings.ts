import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export async function getSetting(client: SupabaseClient<Database>, key: string): Promise<string | null> {
  const { data } = await client.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function setSetting(client: SupabaseClient<Database>, key: string, value: string): Promise<void> {
  const { error } = await client
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    if (error.message.includes("Could not find the table") || error.code === "PGRST205") {
      throw new Error(
        'The app_settings table doesn\'t exist yet — run supabase/migrations/009_app_settings.sql in the Supabase SQL editor, then try again.'
      );
    }
    throw new Error(`Could not save setting "${key}": ${error.message}`);
  }
}

export const OPENROUTER_API_KEY_SETTING = "openrouter_api_key";
export const GOOGLE_MAPS_API_KEY_SETTING = "google_maps_api_key";
