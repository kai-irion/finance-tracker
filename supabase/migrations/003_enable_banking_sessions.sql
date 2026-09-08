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
