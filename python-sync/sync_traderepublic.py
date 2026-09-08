#!/usr/bin/env python3
"""Syncs TradeRepublic account + timeline events into the FinanceHub Supabase project.

Run manually: python sync_traderepublic.py
The first run (and any run after the cached session expires) needs a manual
push-notification approval in the TradeRepublic app — see python-sync/README.md.
"""

import asyncio
import os
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
SESSION_CACHE_DIR = SCRIPT_DIR / ".session_cache"

load_dotenv(SCRIPT_DIR / ".env")

from pytr.utils import get_logger  # noqa: E402

log = get_logger("sync_traderepublic", verbosity="info")

import requests  # noqa: E402
from pytr.api import TradeRepublicApi  # noqa: E402
from pytr.event import ConditionalEventType, PPEventType, tr_event_type_mapping  # noqa: E402
from pytr.portfolio import Portfolio  # noqa: E402
from pytr.timeline import Timeline  # noqa: E402
from supabase import Client, create_client  # noqa: E402

PROVIDER = "traderepublic"

# Events that get an automatic category without going through the Next.js
# categorization pipeline (see FinanceHub's src/lib/categorize.ts for the
# equivalent MCC/merchant-rule concept applied to bank transactions).
INVESTMENT_EVENT_TYPES = {
    PPEventType.BUY,
    PPEventType.SELL,
    PPEventType.SPINOFF,
    PPEventType.SPLIT,
    PPEventType.SWAP,
    PPEventType.TRANSFER_IN,
    PPEventType.TRANSFER_OUT,
    ConditionalEventType.TRADE_INVOICE,
    ConditionalEventType.PRIVATE_MARKETS_ORDER,
}
INCOME_EVENT_TYPES = {
    PPEventType.DIVIDEND,
    PPEventType.INTEREST,
    PPEventType.TAX_REFUND,
}

# Late-settling events (e.g. card transactions clearing a few days after booking)
# can still change after a first sync saw them; re-fetch a small overlap window
# every run instead of trusting the previous run's cursor exactly.
RESYNC_OVERLAP_SECONDS = 3 * 24 * 60 * 60


class SyncError(Exception):
    """Raised for errors that should stop the sync with a clear, user-facing message."""


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SyncError(f"{name} ist nicht gesetzt. Bitte in python-sync/.env eintragen.")
    return value


def get_supabase() -> Client:
    url = require_env("SUPABASE_URL")
    key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def login() -> TradeRepublicApi:
    phone_no = require_env("TR_PHONE_NUMBER")
    pin = require_env("TR_PIN")

    SESSION_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cookies_file = SESSION_CACHE_DIR / "cookies.txt"

    tr = TradeRepublicApi(
        phone_no=phone_no,
        pin=pin,
        save_cookies=True,
        cookies_file=cookies_file,
        use_v2_login=True,
    )

    if tr.resume_websession():
        log.info("Bestehende Session wiederverwendet, keine erneute Bestätigung nötig.")
        return tr

    log.info("Keine gültige Session gefunden — Login mit Push-Bestätigung nötig.")
    try:
        countdown = tr.initiate_weblogin()
    except ValueError as e:
        raise SyncError(f"Login konnte nicht gestartet werden: {e}") from e

    if tr.weblogin_needs_authenticator:
        code = input("Code aus deiner Authenticator-App: ")
        try:
            tr.complete_weblogin(verify_code=code)
        except ValueError as e:
            raise SyncError(f"Authenticator-Code wurde abgelehnt: {e}") from e
    else:
        print(f"Bitte in der TradeRepublic App bestätigen... (Timeout: {int(countdown)}s)")
        try:
            tr.complete_weblogin()
        except TimeoutError as e:
            raise SyncError(
                "Die Push-Bestätigung wurde nicht rechtzeitig in der TradeRepublic App "
                "bestätigt. Bitte erneut ausführen und zügiger bestätigen."
            ) from e
        except ValueError as e:
            raise SyncError(f"Login wurde abgelehnt: {e}") from e

    log.info(f"Login erfolgreich. Session gecached in {cookies_file}.")
    return tr


def ensure_account(supabase: Client, name: str, currency: str, account_type: str, external_account_id: str) -> str:
    existing = (
        supabase.table("accounts")
        .select("id")
        .eq("provider", PROVIDER)
        .eq("external_account_id", external_account_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]["id"]

    created = (
        supabase.table("accounts")
        .insert(
            {
                "provider": PROVIDER,
                "name": name,
                "currency": currency,
                "account_type": account_type,
                "external_account_id": external_account_id,
            }
        )
        .execute()
    )
    return created.data[0]["id"]


def fetch_balances(tr: TradeRepublicApi) -> tuple[float | None, str, float | None, list[dict]]:
    """Returns (cash_amount, cash_currency, depot_value_in_cash_currency, positions). Reuses
    pytr's own Portfolio class (same one `pytr portfolio` uses) rather than reimplementing live
    ticker fetching — depot value is the sum of each position's netValue (price * netSize), and
    `positions` is the same per-ISIN detail (name, netSize, price, averageBuyIn, netValue) `pytr
    portfolio` prints, forwarded so the caller can sync it into investment_holdings. TR's
    private API isn't officially documented, so this is best-effort: on failure it returns
    (None, "EUR", None, []) and the caller logs a warning but still proceeds with the
    transaction sync, since missing balances/holdings shouldn't block that.
    """
    portfolio = Portfolio(tr)
    asyncio.run(portfolio.portfolio_loop())

    cash_amount: float | None = None
    cash_currency = "EUR"
    if portfolio.cash:
        cash_amount = float(portfolio.cash[0]["amount"])
        cash_currency = portfolio.cash[0].get("currencyId", "EUR")

    depot_value: float | None = None
    if portfolio.positions:
        depot_value = float(sum(Decimal(str(pos["netValue"])) for pos in portfolio.positions))
    else:
        depot_value = 0.0

    return cash_amount, cash_currency, depot_value, portfolio.positions


def update_account_balance(supabase: Client, account_id: str, amount: float, currency: str) -> None:
    supabase.table("accounts").update(
        {
            "balance": amount,
            "balance_currency": currency,
            "balance_updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", account_id).execute()


def sync_holdings(supabase: Client, account_id: str, positions: list[dict], currency: str) -> None:
    """Upserts one investment_holdings row per currently-held position (name, ISIN, quantity,
    price, average buy-in, market value — same fields pytr's own Portfolio.overview() prints),
    then deletes any existing row for this account whose ISIN isn't in `positions` anymore, so a
    fully-sold position doesn't linger. Real upsert (not ignore_duplicates) since price/value
    need to update every run, unlike transactions which are immutable once booked.
    """
    now = datetime.now(timezone.utc).isoformat()
    seen_isins: list[str] = []
    rows = []
    for pos in positions:
        isin = pos["instrumentId"]
        seen_isins.append(isin)
        rows.append(
            {
                "account_id": account_id,
                "isin": isin,
                "name": pos.get("name", isin),
                "quantity": float(pos["netSize"]),
                "price": float(pos["price"]),
                "avg_buy_in": float(pos["averageBuyIn"]),
                "market_value": float(pos["netValue"]),
                "currency": currency,
                "updated_at": now,
            }
        )

    if rows:
        supabase.table("investment_holdings").upsert(rows, on_conflict="account_id,isin").execute()

    stale_query = supabase.table("investment_holdings").delete().eq("account_id", account_id)
    if seen_isins:
        stale_query = stale_query.not_.in_("isin", seen_isins)
    stale_query.execute()


def latest_synced_timestamp(supabase: Client, account_id: str) -> float:
    result = (
        supabase.table("transactions")
        .select("booked_at")
        .eq("account_id", account_id)
        .order("booked_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return 0.0
    ts = datetime.fromisoformat(result.data[0]["booked_at"].replace("Z", "+00:00"))
    return ts.timestamp()


def classify_event(event: dict) -> tuple[str | None, str | None, bool]:
    """Returns (category_name, category_source, needs_review)."""
    event_type_str = (event.get("eventType") or "").upper()
    event_type = tr_event_type_mapping.get(event_type_str)
    if event_type in INVESTMENT_EVENT_TYPES:
        return "Investment", "rule", False
    if event_type in INCOME_EVENT_TYPES:
        return "Income", "rule", False
    return None, None, True


def is_card_event(event: dict) -> bool:
    return (event.get("eventType") or "").upper().startswith("CARD_")


def event_to_row(event: dict, account_id: str, category_lookup: dict[str, str]) -> dict:
    amount_info = event.get("amount") or {}
    amount = amount_info.get("value") or 0
    currency = amount_info.get("currency") or "EUR"
    title = event.get("title") or ""
    subtitle = event.get("subtitle") or ""
    category_name, category_source, needs_review = classify_event(event)
    category_id = category_lookup.get(category_name) if category_name else None

    return {
        "account_id": account_id,
        "external_id": event["id"],
        "booked_at": event["timestamp"],
        "amount": amount,
        "currency": currency,
        "raw_description": f"{title} - {subtitle}" if subtitle else title,
        "merchant_name": title if is_card_event(event) else None,
        "category_id": category_id,
        "category_source": category_source,
        "needs_review": needs_review,
    }


def fetch_timeline_events(tr: TradeRepublicApi, not_before: float) -> list[dict]:
    events: list[dict] = []
    timeline = Timeline(
        tr,
        output_path=SESSION_CACHE_DIR,
        not_before=not_before,
        store_event_database=False,
        dump_raw_data=False,
        event_callback=events.append,
    )
    asyncio.run(timeline.tl_loop())
    return events


DATE_TOLERANCE_SECONDS = 7 * 24 * 60 * 60
SAME_CURRENCY_ABS_TOLERANCE = 0.01
CROSS_CURRENCY_RELATIVE_TOLERANCE = 0.03
PAGE_SIZE = 1000

# See the matching PATTERNS comment in src/lib/matchInternalTransfers.ts — PayPal funded
# per-purchase from a bank account exports a generic account-level funding record (these
# patterns) on the PayPal side, while the bank side's FOLGELASTSCHRIFT carries the real
# merchant name. Only the PayPal leg should end up marked as a transfer.
PAYPAL_FUNDING_RECORD_PATTERNS = [
    re.compile(r"bankgutschrift auf paypal-konto", re.IGNORECASE),
    re.compile(r"rückbuchung allgemeiner einbehaltung", re.IGNORECASE),
]


def is_paypal_funding_record(description: str | None) -> bool:
    return description is not None and any(p.search(description) for p in PAYPAL_FUNDING_RECORD_PATTERNS)


# See the matching comment in src/lib/matchInternalTransfers.ts: cross-currency matching
# converts through *today's* cached fx_rates row, so a pair booked months ago can drift
# outside the 3% tolerance purely from FX movement even though it's obviously the same event
# (e.g. PayPal's own internal SEK<->EUR "Allgemeine Währungsumrechnung" conversion). An exact
# shared booked_at timestamp is stronger evidence than an amount ratio computed at the wrong
# point in time — but only counts when it carries real time-of-day precision, since
# CSV-imported/date-only rows commonly default to midnight UTC and could coincidentally
# collide.
def has_time_of_day_precision(ts: float) -> bool:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.hour != 0 or dt.minute != 0 or dt.second != 0


def match_internal_transfers(supabase: Client) -> None:
    """Python port of src/lib/matchInternalTransfers.ts, run after this script's own sync so
    a transfer leg synced only by TradeRepublic (e.g. a withdrawal to Revolut) still gets
    matched even though the Next.js app isn't necessarily running when this cron job fires.
    Keep the matching rules in sync between the two if either changes.
    """
    # PostgREST caps an unbounded select at 1000 rows by default — page through with .range()
    # so this doesn't silently stop matching once the table grows past that.
    candidates: list[dict] = []
    start = 0
    while True:
        result = (
            supabase.table("transactions")
            .select("id, account_id, amount, currency, booked_at, raw_description")
            .eq("is_internal_transfer", False)
            .is_("matched_transfer_id", "null")
            .order("booked_at", desc=False)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        page = result.data or []
        candidates.extend(page)
        if len(page) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    if len(candidates) < 2:
        return

    accounts_result = supabase.table("accounts").select("id, provider").execute()
    account_provider = {a["id"]: a["provider"] for a in (accounts_result.data or [])}

    currencies = {c["currency"] for c in candidates}
    eur_rate_by_currency: dict[str, float | None] = {}
    for currency in currencies:
        if currency == "EUR":
            eur_rate_by_currency[currency] = 1.0
            continue
        try:
            rate_result = (
                supabase.table("fx_rates").select("rate_to_eur").eq("currency", currency).limit(1).execute()
            )
            eur_rate_by_currency[currency] = rate_result.data[0]["rate_to_eur"] if rate_result.data else None
        except Exception:
            eur_rate_by_currency[currency] = None

    for c in candidates:
        rate = eur_rate_by_currency.get(c["currency"])
        c["eur_amount"] = c["amount"] * rate if rate is not None else None
        c["booked_at_ts"] = datetime.fromisoformat(c["booked_at"].replace("Z", "+00:00")).timestamp()

    # See the matching comment in src/lib/matchInternalTransfers.ts: PayPal sometimes posts the
    # "Bankgutschrift"/funding credit AND the actual outgoing payment (e.g. a person-to-person
    # "Handyzahlung", not a merchant checkout) as two separate rows on the same PayPal account
    # at the exact same instant. When that same-account twin exists, it — not the bank-side
    # FOLGELASTSCHRIFT that funded the credit — is the one true expense record, so the special
    # case below must not also keep the bank leg as a second counted expense.
    funding_records_with_twin: set[str] = set()
    by_account: dict[str, list[dict]] = {}
    for c in candidates:
        by_account.setdefault(c["account_id"], []).append(c)
    for account_candidates in by_account.values():
        for x in account_candidates:
            if not is_paypal_funding_record(x.get("raw_description")) or not has_time_of_day_precision(x["booked_at_ts"]):
                continue
            has_twin = any(
                y["id"] != x["id"]
                and y["booked_at_ts"] == x["booked_at_ts"]
                and y["currency"] == x["currency"]
                and abs(y["amount"] + x["amount"]) <= SAME_CURRENCY_ABS_TOLERANCE
                and not is_paypal_funding_record(y.get("raw_description"))
                for y in account_candidates
            )
            if has_twin:
                funding_records_with_twin.add(x["id"])

    claimed: set[str] = set()
    updates: list[dict] = []

    for i, a in enumerate(candidates):
        if a["id"] in claimed:
            continue
        for b in candidates[i + 1 :]:
            if b["booked_at_ts"] - a["booked_at_ts"] > DATE_TOLERANCE_SECONDS:
                break
            if b["id"] in claimed:
                continue
            if a["account_id"] == b["account_id"]:
                continue
            if a["amount"] == 0 or b["amount"] == 0:
                continue
            if (a["amount"] > 0) == (b["amount"] > 0):
                continue

            is_exact = a["currency"] == b["currency"] and abs(abs(a["amount"]) - abs(b["amount"])) <= max(
                SAME_CURRENCY_ABS_TOLERANCE, abs(a["amount"]) * 0.001
            )
            is_approx = False
            if not is_exact and a["eur_amount"] is not None and b["eur_amount"] is not None:
                diff = abs(abs(a["eur_amount"]) - abs(b["eur_amount"]))
                scale = max(abs(a["eur_amount"]), abs(b["eur_amount"]), 1)
                is_approx = diff / scale <= CROSS_CURRENCY_RELATIVE_TOLERANCE
            is_same_instant = (
                not is_exact
                and not is_approx
                and a["booked_at_ts"] == b["booked_at_ts"]
                and has_time_of_day_precision(a["booked_at_ts"])
            )
            if not is_exact and not is_approx and not is_same_instant:
                continue

            claimed.add(a["id"])
            claimed.add(b["id"])

            # A genuine PayPal-funded-purchase pair (Bankgutschrift credit <-> FOLGELASTSCHRIFT
            # debit) is an EXACT euro-for-euro reconciliation, never merely "close" — this
            # special case must require is_exact, not the looser is_approx cross-currency path,
            # or two same-currency but financially unrelated small transactions that happen to
            # land within the 3% tolerance of each other could be treated as a funding pair.
            a_is_paypal_funding = is_exact and account_provider.get(a["account_id"]) == "paypal" and is_paypal_funding_record(
                a.get("raw_description")
            )
            b_is_paypal_funding = is_exact and account_provider.get(b["account_id"]) == "paypal" and is_paypal_funding_record(
                b.get("raw_description")
            )
            a_is_spend_bearing = account_provider.get(a["account_id"]) not in ("paypal", "coinbase")
            b_is_spend_bearing = account_provider.get(b["account_id"]) not in ("paypal", "coinbase")

            a_is_transfer = True
            b_is_transfer = True
            if a_is_paypal_funding and b_is_spend_bearing and a["id"] not in funding_records_with_twin:
                b_is_transfer = False
            elif b_is_paypal_funding and a_is_spend_bearing and b["id"] not in funding_records_with_twin:
                a_is_transfer = False

            needs_review = is_approx or is_same_instant
            updates.append(
                {
                    "id": a["id"],
                    "is_internal_transfer": a_is_transfer,
                    "matched_transfer_id": b["id"],
                    "needs_review": needs_review if a_is_transfer else None,
                }
            )
            updates.append(
                {
                    "id": b["id"],
                    "is_internal_transfer": b_is_transfer,
                    "matched_transfer_id": a["id"],
                    "needs_review": needs_review if b_is_transfer else None,
                }
            )
            break

    for update in updates:
        fields = {"is_internal_transfer": update["is_internal_transfer"], "matched_transfer_id": update["matched_transfer_id"]}
        if update["needs_review"] is not None:
            fields["needs_review"] = update["needs_review"]
        supabase.table("transactions").update(fields).eq("id", update["id"]).execute()

    if updates:
        log.info(f"Interne Transfers erkannt: {len(updates) // 2} Paar(e).")


def record_daily_snapshot_if_needed(supabase: Client) -> None:
    """Python port of src/lib/balanceSnapshots.ts — see that file for why this is keyed by
    calendar date and safe to call from every sync entry point."""
    today = datetime.now(timezone.utc).date().isoformat()
    existing = supabase.table("balance_snapshots").select("date").eq("date", today).limit(1).execute()
    if existing.data:
        return

    accounts = (
        supabase.table("accounts")
        .select("balance, balance_currency, currency")
        .eq("is_archived", False)
        .not_.is_("balance", "null")
        .execute()
    ).data or []

    total = 0.0
    for account in accounts:
        currency = account["balance_currency"] or account["currency"]
        if currency == "EUR":
            total += account["balance"]
            continue
        rate_result = supabase.table("fx_rates").select("rate_to_eur").eq("currency", currency).limit(1).execute()
        if rate_result.data:
            total += account["balance"] * rate_result.data[0]["rate_to_eur"]

    supabase.table("balance_snapshots").insert({"date": today, "total_balance_eur": total}).execute()


def write_sync_log(supabase: Client, status: str, message: str | None, synced: int) -> None:
    try:
        supabase.table("sync_log").insert(
            {
                "provider": PROVIDER,
                "status": status,
                "message": message,
                "transactions_synced": synced,
            }
        ).execute()
    except Exception as e:
        log.error(f"sync_log Eintrag konnte nicht geschrieben werden: {e}")


def main() -> int:
    try:
        supabase = get_supabase()
    except SyncError as e:
        log.error(str(e))
        return 1

    try:
        tr = login()
    except SyncError as e:
        log.error(str(e))
        write_sync_log(supabase, "error", f"Login fehlgeschlagen: {e}", 0)
        return 1
    except requests.exceptions.RequestException as e:
        log.error(f"Netzwerkfehler beim Login: {e}")
        write_sync_log(supabase, "error", f"Netzwerkfehler beim Login: {e}", 0)
        return 1

    try:
        sec_acc_no = tr.settings().get("securitiesAccountNumber")
    except requests.exceptions.HTTPError as e:
        log.error(f"Sitzung ist ungültig, wahrscheinlich abgelaufen: {e}")
        write_sync_log(supabase, "error", f"Session abgelaufen: {e}", 0)
        return 1

    if not sec_acc_no:
        log.error("Konnte securitiesAccountNumber nicht aus den TR-Kontoeinstellungen lesen.")
        write_sync_log(supabase, "error", "securitiesAccountNumber fehlt in TR-Antwort.", 0)
        return 1

    try:
        # All timeline events (buys, sells, dividends, card payments, transfers, interest)
        # settle through the Verrechnungskonto in TR's own data model, so that's where
        # every transaction row is attached. The Depot account exists as a second row
        # purely so /accounts and the dashboard can show a broker account — TR's timeline
        # API has no per-position transaction data to attach to it (no shares/ISIN columns
        # in this schema), so it stays balance-free like every other account here.
        cash_account_id = ensure_account(
            supabase, "TradeRepublic Verrechnungskonto", "EUR", "bank", f"tr-cash-{sec_acc_no}"
        )
        depot_account_id = ensure_account(supabase, "TradeRepublic Depot", "EUR", "broker", f"tr-depot-{sec_acc_no}")
    except Exception as e:
        log.error(f"Konten konnten nicht angelegt/gefunden werden: {e}")
        write_sync_log(supabase, "error", f"Konten-Fehler: {e}", 0)
        return 1

    try:
        cash_amount, cash_currency, depot_value, positions = fetch_balances(tr)
        if cash_amount is not None:
            update_account_balance(supabase, cash_account_id, cash_amount, cash_currency)
        if depot_value is not None:
            update_account_balance(supabase, depot_account_id, depot_value, cash_currency)
        sync_holdings(supabase, depot_account_id, positions, cash_currency)
        log.info(
            f"Salden aktualisiert: Verrechnungskonto {cash_amount} {cash_currency}, Depot {depot_value} {cash_currency} "
            f"({len(positions)} Position(en))."
        )
    except Exception as e:
        log.warning(f"Kontostände/Positionen konnten nicht geladen werden, Transaktions-Sync läuft trotzdem weiter: {e}")

    not_before = latest_synced_timestamp(supabase, cash_account_id)
    if not_before > 0:
        not_before = max(0.0, not_before - RESYNC_OVERLAP_SECONDS)
        since = datetime.fromtimestamp(not_before, tz=timezone.utc)
        log.info(f"Hole Events seit {since.isoformat()} (mit Überlapp-Puffer)...")
    else:
        log.info("Keine vorherigen TradeRepublic-Transaktionen gefunden — hole komplette Historie.")

    try:
        events = fetch_timeline_events(tr, not_before)
    except Exception as e:
        log.error(f"Timeline konnte nicht geladen werden: {e}")
        write_sync_log(supabase, "error", f"Timeline-Fehler: {e}", 0)
        return 1

    log.info(f"{len(events)} Events von TradeRepublic erhalten. Verarbeite...")

    try:
        categories = supabase.table("categories").select("id, name").execute().data
    except Exception as e:
        log.error(f"Kategorien konnten nicht geladen werden: {e}")
        write_sync_log(supabase, "error", f"Kategorien-Fehler: {e}", 0)
        return 1
    category_lookup = {c["name"]: c["id"] for c in categories}

    rows = []
    errors: list[str] = []
    for event in events:
        try:
            rows.append(event_to_row(event, cash_account_id, category_lookup))
        except Exception as e:
            msg = f"Event {event.get('id', '?')} konnte nicht verarbeitet werden: {e}"
            errors.append(msg)
            log.warning(msg)

    synced = 0
    if rows:
        try:
            result = (
                supabase.table("transactions")
                .upsert(rows, on_conflict="account_id,external_id", ignore_duplicates=True)
                .execute()
            )
            synced = len(result.data or [])
        except Exception as e:
            msg = f"Transaktionen konnten nicht gespeichert werden: {e}"
            errors.append(msg)
            log.error(msg)

    try:
        match_internal_transfers(supabase)
    except Exception as e:
        log.warning(f"Interner-Transfer-Abgleich fehlgeschlagen: {e}")

    try:
        record_daily_snapshot_if_needed(supabase)
    except Exception as e:
        log.warning(f"Balance-Snapshot fehlgeschlagen: {e}")

    status = "success" if not errors else ("partial" if synced else "error")
    write_sync_log(supabase, status, "; ".join(errors) if errors else None, synced)

    if errors:
        log.warning(f"Fertig mit Fehlern: {synced} neue Transaktionen synced, {len(errors)} Fehler.")
    else:
        log.info(f"Fertig: {synced} neue Transaktionen synced.")

    return 0 if status != "error" else 1


if __name__ == "__main__":
    sys.exit(main())
