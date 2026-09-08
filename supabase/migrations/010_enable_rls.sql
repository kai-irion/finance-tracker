-- Re-enables Row Level Security on every table (undoing 002_disable_rls.sql and the
-- per-table "disable row level security" statements in 003/004/008/009), now that the app
-- authenticates through Supabase Auth (Google sign-in, see src/components/auth-gate.tsx)
-- instead of having no auth layer at all.
--
-- Single-user app, so the policy is simple: every table gets one FOR ALL policy that only
-- lets the signed-in session through if its JWT email matches the one allowed account —
-- the exact same check auth-gate.tsx already does client-side, just now enforced at the
-- database level too, so the anon key alone (e.g. extracted from the client bundle) is no
-- longer enough to read/write/delete data. Update ALLOWED_EMAIL below if that account ever
-- changes, and keep it in sync with NEXT_PUBLIC_ALLOWED_EMAIL in .env.local.
--
-- Server-side code (API routes, python-sync) has no browser session to authenticate this
-- way — it uses a separate service-role client (src/lib/supabase/admin-client.ts) that
-- bypasses RLS entirely by design, exactly like this app relied on the anon key doing before.

do $$
declare
  allowed_email text := 'kaidanielirion@gmail.com';
  t text;
begin
  for t in
    select unnest(array[
      'accounts',
      'categories',
      'mcc_codes',
      'merchant_rules',
      'transactions',
      'sync_log',
      'enable_banking_sessions',
      'fx_rates',
      'balance_snapshots',
      'app_settings'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists owner_full_access on %I', t);
    execute format(
      'create policy owner_full_access on %I for all using (auth.jwt() ->> ''email'' = %L) with check (auth.jwt() ->> ''email'' = %L)',
      t, allowed_email, allowed_email
    );
  end loop;
end $$;
