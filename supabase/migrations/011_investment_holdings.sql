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
