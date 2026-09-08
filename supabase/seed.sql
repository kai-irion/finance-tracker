-- FinanceHub — base category seed
-- Run after 001_init.sql in the Supabase SQL Editor.

insert into categories (name, is_income) values
  ('Groceries', false),
  ('Restaurants & Cafes', false),
  ('Transport', false),
  ('Housing', false),
  ('Shopping', false),
  ('Subscriptions & Services', false),
  ('Travel', false),
  ('Health', false),
  ('Leisure & Entertainment', false),
  ('Investment', false),
  ('Income', true),
  ('Internal Transfer', false),
  ('Other', false);
