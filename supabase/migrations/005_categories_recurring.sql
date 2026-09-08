-- Section C: distinguishes recurring/ongoing spending categories (groceries, subscriptions)
-- from one-off ones (fines, deposits, large one-time purchases) for future budgeting/analysis.
alter table categories add column if not exists is_recurring boolean not null default true;
