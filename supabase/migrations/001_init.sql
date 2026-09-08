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
