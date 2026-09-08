-- Section E: daily net-worth snapshots for the dashboard trend chart. One row per calendar
-- date, written on the first sync of that day (see src/lib/balanceSnapshots.ts).
create table if not exists balance_snapshots (
  date date primary key,
  total_balance_eur numeric not null,
  created_at timestamptz not null default now()
);

alter table balance_snapshots disable row level security;
