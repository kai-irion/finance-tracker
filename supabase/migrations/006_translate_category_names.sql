-- Renames the originally German-seeded category names to English, matching the
-- English-only UI. Matches by old name only, so it's a no-op (and safe to re-run) once
-- applied — categories created after this point already use English names via seed.sql.
update categories set name = 'Groceries' where name = 'Lebensmittel';
update categories set name = 'Restaurants & Cafes' where name = 'Restaurants & Cafés';
update categories set name = 'Housing' where name = 'Wohnen';
update categories set name = 'Subscriptions & Services' where name = 'Abos & Services';
update categories set name = 'Travel' where name = 'Reisen';
update categories set name = 'Health' where name = 'Gesundheit';
update categories set name = 'Leisure & Entertainment' where name = 'Freizeit & Unterhaltung';
update categories set name = 'Income' where name = 'Einkommen';
update categories set name = 'Internal Transfer' where name = 'Interner Transfer';
update categories set name = 'Other' where name = 'Sonstiges';
