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
