import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// SERVER-ONLY. Uses the service-role key, which bypasses Row Level Security entirely — the
// opposite of the browser `supabase` client in client.ts, which uses the anon key and is
// gated by the RLS policies in supabase/migrations/010_enable_rls.sql (scoped to the signed-in
// user's email). API routes and scripts run with no browser session to carry that identity, so
// they use this client instead. The `server-only` import makes any accidental import from a
// "use client" file fail the build, rather than silently bundling the service-role key into
// client-side JS.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Get the service role key from " +
      "Supabase Dashboard -> Settings -> API -> service_role, and add it to .env.local (never NEXT_PUBLIC_-prefixed)."
  );
}

export const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
