# FinanceHub-demo — public demo with dummy data

A copy of FinanceHub running on generated dummy data: no login, no real bank
connections, no private API keys. Everything else (dashboard, transactions,
review queue, analysis charts, rules, categories) works against the seed data.

## What is different from the private app

- `NEXT_PUBLIC_DEMO_MODE=true` bypasses the Google login (`auth-gate.tsx`), hides
  bank sync/connect buttons, the API-key settings tab and the AI chat, and makes
  the sync/classify API routes return 403 (`src/lib/demo-mode.ts`).
- AI features (AI categorization, Maps enrichment, AI chart builder, emoji
  suggestions) need private API keys and are disabled — the UI says so where
  they would normally appear.
- The database holds only generated data (`scripts/seed-demo-data.ts`) and has
  Row Level Security disabled (`supabase/demo-setup.sql`), so no login is needed.
  Anyone with the link can read and edit — that is intentional; reseed anytime.

## Setup (manual steps)

### 1. New Supabase project

Create a free project at supabase.com. In its **SQL Editor** → **New query**,
paste the entire contents of `supabase/demo-full-setup.sql` and run it once.
(That single file contains migrations `001`→`014`, the base categories, and the
demo access setup, in order. Safe to re-run.)

Skip the MCC import — the demo does not need it.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in from the **new demo project** (Dashboard → Project Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server-only, never NEXT_PUBLIC_-prefixed
NEXT_PUBLIC_DEMO_MODE=true
```

Nothing else is needed. No Coinbase/Enable Banking/Google keys.

### 3. Seed the dummy data (~2 years, ~3000 transactions, <1 min)

```bash
npm install
npm run seed:demo
```

Re-run with `npm run seed:demo -- --force` to wipe and regenerate (deletes all
demo transactions/accounts first — only ever point this at the demo project).

### 4. Run / deploy

```bash
npm run dev    # http://localhost:3000
```

Public link via Vercel: push this folder to a new GitHub repo, import it in
Vercel, and set the same 4 env vars above in the project settings. No other
configuration is needed.
