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
