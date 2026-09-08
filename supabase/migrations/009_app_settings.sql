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
