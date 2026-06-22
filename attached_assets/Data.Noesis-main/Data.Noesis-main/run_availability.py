"""
Daily calendar scraper.

Loads all active listings from the listings table and fetches their
12-month availability calendar. Does NOT do tile searches — that is
handled by run_discovery.py which runs weekly.

Pipeline:
  listings table → get_calendar() per listing → bronze → silver → gold
"""

import os
import time
import logging
import smtplib
from email.mime.text import MIMEText
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from scraper.airbnb_client import get_api_key, get_calendar
from storage.storage import init_db, write_bronze, update_silver
from analytics.gold import update_gold

open("bnb.log", "w").close()  # clear log at start of each run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH          = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bnb.duckdb")
CURRENCY         = "EUR"
CALENDAR_WORKERS = 4    # concurrent calendar fetches — tile search no longer competes for rate limit
PROXY_URL        = os.getenv("WEBSHARE_PROXY_URL", "")

SMTP_USER       = "yianniscon93@gmail.com"
SMTP_PASSWORD   = "sscs irqs lops uggi"
ALERT_TO        = "yianniscon93@gmail.com"
NOTIFY_INTERVAL = 1800  # seconds between progress emails (30 min)


def _notify(subject: str, body: str = "") -> None:
    try:
        msg = MIMEText(body or subject)
        msg["Subject"] = f"[STR Insights] {subject}"
        msg["From"]    = SMTP_USER
        msg["To"]      = ALERT_TO
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as smtp:
            smtp.starttls()
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
    except Exception:
        pass


def _load_listings(conn) -> list[dict]:
    """
    Load all active listings from the listings table.
    Excludes listings not seen in the last 14 days (delisted),
    except those with last_seen_at IS NULL (pre-feature listings — include them).
    """
    rows = conn.execute("""
        SELECT listing_id, area, name
        FROM listings
        WHERE last_seen_at IS NULL
           OR last_seen_at >= current_date - INTERVAL 45 DAYS
    """).fetchall()
    return [{"room_id": r[0], "_area": r[1], "name": r[2] or ""} for r in rows]


def _fetch_calendars_parallel(
    api_key: str,
    listings: list[dict],
    conn,
    execution_timestamp: datetime,
) -> int:
    """
    Fetch calendars for all listings concurrently, write bronze on the main thread.
    Returns total bronze rows written.
    """
    area_map  = {str(l["room_id"]): l["_area"] for l in listings}
    name_map  = {str(l["room_id"]): l["name"]  for l in listings}

    total_bronze  = 0
    completed     = 0
    total         = len(listings)
    last_notified = time.time()

    def _fetch(listing: dict):
        room_id = str(listing["room_id"])
        return room_id, get_calendar(api_key, room_id, currency=CURRENCY, proxy_url=PROXY_URL)

    with ThreadPoolExecutor(max_workers=CALENDAR_WORKERS) as executor:
        future_to_listing = {executor.submit(_fetch, l): l for l in listings}
        for future in as_completed(future_to_listing):
            l = future_to_listing[future]
            room_id = str(l["room_id"])
            try:
                _, days = future.result()
                written = write_bronze(conn, days, area_map[room_id], execution_timestamp)
                total_bronze += written
                log.info(f"  {room_id}  {name_map[room_id][:40]:<40}  {written} days")
            except Exception as e:
                log.error(f"  {room_id} calendar failed: {e}")

            completed += 1
            if time.time() - last_notified >= NOTIFY_INTERVAL:
                pct = int(completed / total * 100)
                _notify(f"Progress: {completed}/{total} listings ({pct}%)")
                last_notified = time.time()

    return total_bronze


def run():
    execution_timestamp = datetime.now()
    log.info(f"Run started — {execution_timestamp:%Y-%m-%d %H:%M:%S}")
    _notify(f"Run started — {execution_timestamp:%Y-%m-%d %H:%M}")

    conn = init_db(DB_PATH)
    try:
        api_key = get_api_key(proxy_url=PROXY_URL)
        log.info("API key obtained")

        listings = _load_listings(conn)
        log.info(f"Loaded {len(listings)} active listings from DB")
        _notify(f"Loaded {len(listings)} listings — starting calendars ({CALENDAR_WORKERS} workers)")

        total_bronze = _fetch_calendars_parallel(api_key, listings, conn, execution_timestamp)
        log.info(f"Calendars done — {total_bronze} bronze rows")

        log.info("Updating silver...")
        summary = update_silver(conn, execution_timestamp)
        log.info(
            f"Silver — total: {summary['total']}  "
            f"new/changed: {summary['new_or_changed']}  "
            f"newly booked: {summary['newly_booked']}  "
            f"booking events detected: {summary['newly_booked_detected']}"
        )

        log.info("Updating gold...")
        update_gold(conn, execution_timestamp)

    except Exception as e:
        log.exception("Run failed")
        _notify(f"Run FAILED: {e}")
        raise
    finally:
        conn.close()

    elapsed = datetime.now() - execution_timestamp
    total_sec = int(elapsed.total_seconds())
    log.info(f"Done — elapsed {total_sec // 60}m {total_sec % 60}s")
    _notify(
        f"Run done ✓ — {total_sec // 60}m {total_sec % 60}s  "
        f"{len(listings)} listings  {summary['newly_booked_detected']} booked"
    )


if __name__ == "__main__":
    run()
