# FinanceHub

Private, lokal laufende Finanz-Tracking-Webapp. Phase 1: Grundgerüst, Datenbank-Schema
und UI mit manueller Datenpflege — echte Kontenintegrationen (TradeRepublic, Revolut,
PayPal, Coinbase, Splitwise) folgen in Phase 2. Wise scheidet als API-Integration aus
(Balance-Statement-Endpoint ist für Consumer-Profile gesperrt) — Wise-Konten lassen
sich weiterhin manuell anlegen.

## Stack

- Next.js 15 (App Router, TypeScript)
- Tailwind CSS
- Supabase (Postgres)
- Recharts

## Setup

### 1. Dependencies installieren

```bash
npm install
```

### 2. Supabase-Projekt

Falls noch nicht vorhanden, lege unter [supabase.com](https://supabase.com) ein neues
Projekt an.

### 3. `.env.local` ausfüllen

Kopiere `.env.example` nach `.env.local` (falls noch nicht vorhanden) und trage deine
Projekt-URL und den Anon Key ein (Supabase Dashboard → Project Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### 4. Datenbank-Schema anlegen

Im Supabase Dashboard → **SQL Editor** → **New query**:

1. Inhalt von `supabase/migrations/001_init.sql` einfügen und ausführen (legt alle
   Tabellen an: `accounts`, `categories`, `mcc_codes`, `merchant_rules`,
   `transactions`, `sync_log`).
2. Inhalt von `supabase/seed.sql` einfügen und ausführen (legt die Basis-Kategorien an).

### 5. MCC-Codes importieren (optional, aber empfohlen)

Lädt die öffentliche MCC-Code-Liste herunter und importiert sie in `mcc_codes`:

```bash
npm run import:mcc
```

### 6. Testdaten seeden (optional)

Legt 3 Test-Konten und ~20 Fake-Transaktionen an, um das UI direkt auszuprobieren:

```bash
npm run seed:test-data
```

### 7. Dev-Server starten

```bash
npm run dev
```

Öffne [http://localhost:3000](http://localhost:3000).

## Projektstruktur

- `src/app/dashboard` — Assetverteilung nach Kontotyp (Pie-Chart)
- `src/app/transactions` — Transaktionsliste mit Filtern nach Konto/Kategorie
- `src/app/accounts` — Konten verwalten
- `src/app/rules` — Merchant-Regeln (Pattern → Kategorie) verwalten
- `src/lib/supabase` — Supabase-Client & DB-Typen
- `supabase/migrations` — SQL-Schema
- `supabase/seed.sql` — Basis-Kategorien
- `scripts/import-mcc-codes.ts` — MCC-Code-Import
- `scripts/seed-test-data.ts` — Test-Daten für lokale Entwicklung
- `python-sync/` — eigenständiges Python-Skript für den TradeRepublic-Sync (Details unten)

## Build

```bash
npm run build
```

## TradeRepublic-Sync (`python-sync/`)

Separates Python-Skript (nicht Teil der Next.js-App), das TradeRepublic-Timeline-Events
über [pytr](https://github.com/pytr-org/pytr) abruft und in Supabase schreibt. Volle
Setup-Anleitung inklusive 2FA-Push-Bestätigung: [`python-sync/README.md`](python-sync/README.md).

Manuell ausführen:

```bash
cd python-sync
.venv/bin/python sync_traderepublic.py
```

### Als täglicher Cronjob (macOS)

Der erste Lauf (und jeder Lauf nach Ablauf der gecachten Session) braucht eine manuelle
Push-Bestätigung in der TradeRepublic-App — ein unbeaufsichtigter Cronjob-Lauf schlägt in
dem Fall nach ~2 Minuten mit einer klaren Fehlermeldung im Log fehl (kein Hänger), solange
bis du das Skript einmal manuell ausführst und bestätigst. Für die Tage dazwischen, an
denen die Session noch gültig ist, läuft der Sync automatisch durch.

`crontab -e` und folgende Zeile einfügen (täglich um 07:00 Uhr, Pfad ggf. anpassen):

```
0 7 * * * cd /Users/kaiirion/Projects/FinanceHub/python-sync && .venv/bin/python sync_traderepublic.py >> /Users/kaiirion/Projects/FinanceHub/python-sync/sync.log 2>&1
```

`sync.log` landet in `python-sync/` und ist gitignored. Bei einem fehlgeschlagenen Lauf
(z. B. abgelaufene Session) dort oder im `sync_log`-Eintrag in Supabase (`provider =
'traderepublic'`) nachsehen.
