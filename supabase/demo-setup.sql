-- FinanceHub-demo: keyless public-demo access.
-- Run AFTER all files in supabase/migrations/ (010/011/013 enable RLS with an
-- owner-email policy, which would block every request without a Google login).
-- Disabling RLS makes policies irrelevant, so the anon key can read AND write —
-- that is intentional here: this database holds only generated dummy data, and
-- the seed script can re-create it at any time (npm run seed:demo -- --force).
-- NEVER run this against the private production project.

do $$
declare
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
      'app_settings',
      'investment_holdings',
      'ai_widgets',
      'place_lookup_cache'
    ])
  loop
    execute format('alter table if exists %I disable row level security', t);
  end loop;
end $$;
