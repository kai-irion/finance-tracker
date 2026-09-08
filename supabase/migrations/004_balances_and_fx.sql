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
