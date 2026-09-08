-- Caches Google Places lookups keyed by merchant name so the Maps-based categorizer
-- (src/lib/googlePlaces.ts) never pays for the same billed Text Search request twice — once a
-- merchant has been looked up, both a hit (matched_category_id set) and a miss (null) are
-- remembered, since misses are just as worth avoiding as hits are worth reusing. A hit also
-- gets turned into a merchant_rules row (see applyMerchantRule), which is what actually drives
-- future categorization; this table exists purely to bound repeat API spend on re-runs.
create table if not exists place_lookup_cache (
  merchant_key text primary key,
  place_types text[],
  matched_category_id uuid references categories(id) on delete set null,
  looked_up_at timestamptz not null default now()
);

alter table place_lookup_cache enable row level security;
drop policy if exists owner_full_access on place_lookup_cache;
create policy owner_full_access on place_lookup_cache for all
  using (auth.jwt() ->> 'email' = 'kaidanielirion@gmail.com')
  with check (auth.jwt() ->> 'email' = 'kaidanielirion@gmail.com');
