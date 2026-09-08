-- Section D: soft-archiving accounts (hidden from active views/dashboard, data kept).
alter table accounts add column if not exists is_archived boolean not null default false;
