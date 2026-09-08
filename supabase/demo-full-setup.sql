-- FinanceHub-demo: ONE-FILE setup. Paste the whole file into the Supabase SQL Editor and run once.
-- Contains: migrations 001-014 in order, base categories (seed.sql), then demo-setup.sql (disables RLS for keyless demo access).
-- Safe to re-run: all statements are IF NOT EXISTS / upsert-safe, except demo-setup which is idempotent.


-- ============================================================
-- SOURCE: supabase/migrations/001_init.sql
-- ============================================================
-- FinanceHub — initial schema
-- Run this once in the Supabase SQL Editor for your project.

create extension if not exists pgcrypto;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  name text not null,
  currency text not null,
  account_type text not null,
  external_account_id text,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references categories(id) on delete set null,
  icon text,
  is_income boolean not null default false
);

create table if not exists mcc_codes (
  mcc text primary key,
  description text,
  default_category_id uuid references categories(id) on delete set null
);

create table if not exists merchant_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  category_id uuid references categories(id) on delete set null,
  created_by text not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  external_id text,
  booked_at timestamptz not null,
  amount numeric not null,
  currency text not null,
  raw_description text,
  merchant_name text,
  mcc text references mcc_codes(mcc) on delete set null,
  category_id uuid references categories(id) on delete set null,
  category_source text,
  is_internal_transfer boolean not null default false,
  matched_transfer_id uuid references transactions(id) on delete set null,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);

create table if not exists sync_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null,
  message text,
  transactions_synced int not null default 0,
  synced_at timestamptz not null default now()
);

create index if not exists idx_transactions_account_id on transactions(account_id);
create index if not exists idx_transactions_category_id on transactions(category_id);
create index if not exists idx_transactions_booked_at on transactions(booked_at);
create index if not exists idx_categories_parent_id on categories(parent_id);

-- ============================================================
-- SOURCE: supabase/migrations/002_disable_rls.sql
-- ============================================================
-- (Intentionally empty: the original 002 file is just a "done" marker, not SQL.
-- RLS is disabled for the demo by demo-setup.sql at the end of this file.)

-- ============================================================
-- SOURCE: supabase/migrations/003_enable_banking_sessions.sql
-- ============================================================
-- Tracks the active Enable Banking (PSD2 aggregator) consent per provider, e.g. Revolut.
-- One row per provider: a fresh consent (re-run of /accounts/connect-revolut, whether
-- routine after the 90-day PSD2 expiry or ad-hoc) replaces the previous row rather than
-- accumulating history, since only the most recent session is ever usable.
create table if not exists enable_banking_sessions (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  session_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table enable_banking_sessions disable row level security;

-- ============================================================
-- SOURCE: supabase/migrations/004_balances_and_fx.sql
-- ============================================================
-- Adds balance tracking to accounts and a cached FX/crypto rate table (Section A:
-- account balance sync + EUR reference-currency conversion for display).

alter table accounts
  add column if not exists balance numeric,
  add column if not exists balance_currency text,
  add column if not exists balance_updated_at timestamptz;

-- One row per currency code (ISO fiat code or crypto symbol, e.g. "USD", "BTC"),
-- refreshed at most once a day by src/lib/fxRates.ts. rate_to_eur is "how many EUR
-- is 1 unit of this currency worth" so EUR amounts are always `amount * rate_to_eur`.
create table if not exists fx_rates (
  currency text primary key,
  rate_to_eur numeric not null,
  updated_at timestamptz not null default now()
);

alter table fx_rates disable row level security;

-- ============================================================
-- SOURCE: supabase/migrations/005_categories_recurring.sql
-- ============================================================
-- Section C: distinguishes recurring/ongoing spending categories (groceries, subscriptions)
-- from one-off ones (fines, deposits, large one-time purchases) for future budgeting/analysis.
alter table categories add column if not exists is_recurring boolean not null default true;

-- ============================================================
-- SOURCE: supabase/migrations/006_translate_category_names.sql
-- ============================================================
-- Renames the originally German-seeded category names to English, matching the
-- English-only UI. Matches by old name only, so it's a no-op (and safe to re-run) once
-- applied — categories created after this point already use English names via seed.sql.
update categories set name = 'Groceries' where name = 'Lebensmittel';
update categories set name = 'Restaurants & Cafes' where name = 'Restaurants & Cafés';
update categories set name = 'Housing' where name = 'Wohnen';
update categories set name = 'Subscriptions & Services' where name = 'Abos & Services';
update categories set name = 'Travel' where name = 'Reisen';
update categories set name = 'Health' where name = 'Gesundheit';
update categories set name = 'Leisure & Entertainment' where name = 'Freizeit & Unterhaltung';
update categories set name = 'Income' where name = 'Einkommen';
update categories set name = 'Internal Transfer' where name = 'Interner Transfer';
update categories set name = 'Other' where name = 'Sonstiges';

-- ============================================================
-- SOURCE: supabase/migrations/007_accounts_archive.sql
-- ============================================================
-- Section D: soft-archiving accounts (hidden from active views/dashboard, data kept).
alter table accounts add column if not exists is_archived boolean not null default false;

-- ============================================================
-- SOURCE: supabase/migrations/008_balance_snapshots.sql
-- ============================================================
-- Section E: daily net-worth snapshots for the dashboard trend chart. One row per calendar
-- date, written on the first sync of that day (see src/lib/balanceSnapshots.ts).
create table if not exists balance_snapshots (
  date date primary key,
  total_balance_eur numeric not null,
  created_at timestamptz not null default now()
);

alter table balance_snapshots disable row level security;

-- ============================================================
-- SOURCE: supabase/migrations/009_app_settings.sql
-- ============================================================
-- Generic key/value store for app-level settings entered through the UI (e.g. the OpenRouter
-- API key on /settings) instead of .env.local — consistent with this being a private,
-- single-user, local-only app (see 002_disable_rls.sql) where the anon key already has full
-- access, so storing this here isn't a meaningfully different trust boundary than a .env file
-- sitting on the same machine.
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table app_settings disable row level security;

-- ============================================================
-- SOURCE: supabase/migrations/010_enable_rls.sql
-- ============================================================
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

-- ============================================================
-- SOURCE: supabase/migrations/011_investment_holdings.sql
-- ============================================================
-- Per-position TradeRepublic holdings (ETFs, shares, etc.) — one row per ISIN currently held
-- in the Depot account, synced by python-sync/sync_traderepublic.py via pytr's Portfolio class.
-- A fully-sold position is deleted rather than zeroed, so this table always reflects what's
-- actually held right now. Powers the "Investment holdings" section on /analysis and the
-- Depot account's detail page.
create table if not exists investment_holdings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  isin text not null,
  name text not null,
  quantity numeric not null,
  price numeric not null,
  avg_buy_in numeric not null,
  market_value numeric not null,
  currency text not null default 'EUR',
  updated_at timestamptz not null default now(),
  unique (account_id, isin)
);

create index if not exists idx_investment_holdings_account_id on investment_holdings(account_id);

-- 010_enable_rls.sql already ran, so it won't retroactively pick up this new table — set RLS
-- up directly here instead, same reasoning as 009_app_settings.sql setting its own RLS state
-- at creation time. Same single-user policy shape as every table in 010's loop.
alter table investment_holdings enable row level security;
create policy owner_full_access on investment_holdings for all
  using (auth.jwt() ->> 'email' = 'kaidanielirion@gmail.com')
  with check (auth.jwt() ->> 'email' = 'kaidanielirion@gmail.com');

-- ============================================================
-- SOURCE: supabase/migrations/012_google_maps_cache.sql
-- ============================================================
-- Caches Google Places lookups keyed by merchant name so the Maps-based categorizer
-- (src/lib/googlePlaces.ts) never pays for the same billed Text Search request twice — once a
-- merchant has been looked up, both a hit (matched_category_id set) and a miss (null) are
-- remembered, since misses are just as worth avoiding as hits are worth reusing. A hit also
-- gets turned into a merchant_rules row (see applyMerchantRule), which is what actually drives
-- future categorization; this table exists purely to bound repeat API spend on re-runs.
create table if not exists place_lookup_cache (
  merchant_key text primary key,
  place_types text[],
  matched_category_id uuid references categories(id) on delete set null,
  looked_up_at timestamptz not null default now()
);

alter table place_lookup_cache enable row level security;
drop policy if exists owner_full_access on place_lookup_cache;
create policy owner_full_access on place_lookup_cache for all
  using (auth.jwt() ->> 'email' = 'kaidanielirion@gmail.com')
  with check (auth.jwt() ->> 'email' = 'kaidanielirion@gmail.com');

-- ============================================================
-- SOURCE: supabase/migrations/013_ai_widgets.sql
-- ============================================================
-- AI-generated dashboard/analysis widgets: each row is one chart the user asked the AI
-- chat (see src/components/ai-widget-chat.tsx) to build, stored as a validated declarative
-- spec (never AI-generated code or SQL — src/lib/ai-widgets/spec.ts is the source of truth
-- for what a spec is allowed to contain) so it can be re-executed and re-rendered on every
-- page load via src/lib/ai-widgets/execute.ts.
create table if not exists ai_widgets (
  id uuid primary key default gen_random_uuid(),
  page text not null check (page in ('dashboard', 'analysis')),
  title text not null,
  spec jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_widgets_page on ai_widgets(page);

-- Same single-user RLS policy as every other table (see 010_enable_rls.sql) — kept
-- self-contained here rather than editing that migration.
do $$
declare
  allowed_email text := 'kaidanielirion@gmail.com';
begin
  execute 'alter table ai_widgets enable row level security';
  execute 'drop policy if exists owner_full_access on ai_widgets';
  execute format(
    'create policy owner_full_access on ai_widgets for all using (auth.jwt() ->> ''email'' = %L) with check (auth.jwt() ->> ''email'' = %L)',
    allowed_email, allowed_email
  );
end $$;

-- ============================================================
-- SOURCE: supabase/migrations/014_ai_widgets_position.sql
-- ============================================================
-- Reorderable AI widgets: manual drag-and-drop / arrow ordering in the app
-- (see src/components/ai-widgets-panel.tsx). Fractional positions are not needed —
-- widget counts are small, so we store a dense 0-based order per page.
alter table if exists ai_widgets
  add column if not exists position integer not null default 0;

-- Backfill existing rows: oldest first gets position 0, 1, 2, ... per page.
do $$
declare
  r record;
  i integer;
  cur_page text;
begin
  for cur_page in select distinct page from ai_widgets loop
    i := 0;
    for r in select id from ai_widgets where page = cur_page order by created_at asc loop
      update ai_widgets set position = i where id = r.id;
      i := i + 1;
    end loop;
  end loop;
end $$;

create index if not exists idx_ai_widgets_page_position on ai_widgets(page, position, created_at);

-- ============================================================
-- SOURCE: supabase/seed.sql
-- ============================================================
-- FinanceHub — base category seed
-- Run after 001_init.sql in the Supabase SQL Editor.

insert into categories (name, is_income) values
  ('Groceries', false),
  ('Restaurants & Cafes', false),
  ('Transport', false),
  ('Housing', false),
  ('Shopping', false),
  ('Subscriptions & Services', false),
  ('Travel', false),
  ('Health', false),
  ('Leisure & Entertainment', false),
  ('Investment', false),
  ('Income', true),
  ('Internal Transfer', false),
  ('Other', false);

-- ============================================================
-- SOURCE: supabase/demo-setup.sql
-- ============================================================
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
