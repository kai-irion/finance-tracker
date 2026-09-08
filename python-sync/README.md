# TradeRepublic Sync

Eigenständiges Python-Skript, das TradeRepublic-Kontodaten und den Timeline-Event-Feed
(Käufe, Verkäufe, Dividenden, Zinsen, Kartenzahlungen, Überweisungen) in die FinanceHub
Supabase-Datenbank synced. Läuft getrennt von der Next.js-App, weil die einzigen
funktionierenden inoffiziellen TradeRepublic-Clients in Python sind
([pytr](https://github.com/pytr-org/pytr), aktiv gepflegt).

Jeder Lauf aktualisiert außerdem den Kontostand von Verrechnungskonto (Cash) und Depot
(Summe der Positions-Nettowerte, via `pytr`s eigener `Portfolio`-Klasse) in `accounts.balance`,
sowie die einzelnen Positionen (ETFs, Aktien, …) in der Tabelle `investment_holdings` — je
Zeile Name, ISIN, Stückzahl, aktueller Kurs, durchschnittlicher Einstandspreis und aktueller
Wert. Das speist den "Investment holdings"-Abschnitt auf `/analysis` und der Depot-Kontoseite.
Vollständig verkaufte Positionen werden aus der Tabelle gelöscht statt genullt.
Da TradeRepublics private API dafür nicht offiziell dokumentiert ist, läuft die
Saldo-/Positions-Abfrage best-effort: schlägt sie fehl, läuft der Transaktions-Sync trotzdem
weiter (siehe Log-Zeile "Kontostände/Positionen konnten nicht geladen werden").

## Setup

### 1. Python 3.10+ und venv

pytr braucht Python 3.10 oder neuer. Falls `python3 --version` etwas Älteres zeigt
(macOS bringt oft eine alte Systemversion mit), erst eine neuere Version installieren,
z. B. via Homebrew:

```bash
brew install python@3.12
```

Dann venv anlegen und Dependencies installieren:

```bash
cd python-sync
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

(`source .venv/bin/activate` muss in jeder neuen Terminal-Session vor dem Ausführen
des Skripts wiederholt werden — oder direkt `.venv/bin/python sync_traderepublic.py`
ohne Aktivierung aufrufen.)

### 2. `.env` ausfüllen

Kopiere `.env.example` nach `.env` und trage ein:

- `TR_PHONE_NUMBER` — deine TradeRepublic-Telefonnummer im Format `+4915112345678`
- `TR_PIN` — deine TradeRepublic-PIN
- `SUPABASE_URL` — dieselbe URL wie `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` der Next.js-App
- `SUPABASE_SERVICE_ROLE_KEY` — **nicht** der anon key! Supabase Dashboard →
  Project Settings → API → Abschnitt "Project API keys" → `service_role` Key kopieren.
  Dieser Key umgeht RLS vollständig und darf niemals ins Repo oder in den
  Next.js-Frontend-Code gelangen — er bleibt ausschließlich in dieser `.env`
  (steht in `.gitignore`).

### 3. Erster Lauf — 2FA-Push-Bestätigung

```bash
.venv/bin/python sync_traderepublic.py
```

Beim allerersten Lauf (und jedes Mal, wenn die gecachte Session abgelaufen ist)
passiert Folgendes:

1. Das Skript loggt sich mit Telefonnummer + PIN ein.
2. Konsolen-Ausgabe: `Bitte in der TradeRepublic App bestätigen... (Timeout: 120s)`
3. **Handy bereithalten**: In der TradeRepublic-App erscheint eine Login-Anfrage,
   die du wie beim normalen App-Login manuell bestätigen musst (Push-Freigabe).
   Das Skript kann diesen Schritt nicht automatisieren — das ist TradeRepublic's 2FA.
4. Nach Bestätigung läuft der Sync automatisch weiter und gibt am Ende aus, wie viele
   Transaktionen neu synced wurden.

Die Session wird danach in `python-sync/.session_cache/cookies.txt` gecacht (gitignored).
Solange die Session gültig ist, läuft jeder weitere Aufruf **ohne** erneute
Push-Bestätigung durch. Läuft die Session ab, meldet das Skript das klar in der Konsole
und verlangt beim nächsten Lauf wieder eine Bestätigung.

### 4. Danach: `/transactions` prüfen

Nach einem erfolgreichen Lauf sollten die TradeRepublic-Transaktionen (und zwei neue
Konten — "TradeRepublic Verrechnungskonto" und "TradeRepublic Depot") in der Next.js-App
unter `/accounts` bzw. `/transactions` auftauchen.

## Wie die Kategorisierung funktioniert

- Wertpapier-Käufe/-Verkäufe, Sparpläne, Splits, Spinoffs, Transfers → Kategorie
  **Investment**
- Dividenden, Zinsen, Steuererstattungen → Kategorie **Einkommen**
- Alles andere (Kartenzahlungen, Überweisungen, Einzahlungen, Steuern) bleibt
  unkategorisiert mit `needs_review = true` — dieselbe Fallback-Logik wie in der
  Next.js-Kategorisierungs-Pipeline (`src/lib/categorize.ts`), nur direkt im
  Python-Skript umgesetzt statt über MCC/Merchant-Regeln, da TradeRepublic keine
  MCC-Daten liefert.

## Wiederholte Läufe

Jeder Lauf holt nur Events seit der zuletzt gesyncten Transaktion (mit 3 Tagen
Überlappungspuffer für spät verbuchte Events), nicht die komplette Historie erneut.
Duplikate werden zusätzlich über `ON CONFLICT (account_id, external_id) DO NOTHING`
in der Datenbank abgefangen — das Skript ist daher beliebig oft wiederholbar.

## Fehlerbehandlung

- Einzelne fehlerhafte Events werden geloggt und übersprungen, der Sync läuft weiter.
- Abgelaufene Session vs. andere Fehler (Netzwerk, TradeRepublic-API down, falsche
  Zugangsdaten) werden mit unterscheidbaren Meldungen in der Konsole **und** als
  `sync_log`-Eintrag in Supabase protokolliert (`provider='traderepublic'`).

## Automatisierung (täglicher Cronjob)

Siehe Haupt-README.md im Projekt-Root für die crontab-Zeile.
