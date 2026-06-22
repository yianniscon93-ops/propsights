"""
Bazaraki detail page enrichment.

Fetches property detail pages for listings where details_fetched_at IS NULL
and writes: size_m2, floor, parking, condition, furnishing, included,
air_conditioning, construction_year, energy_efficiency, bathrooms,
postal_code, description.

Runs for both sale and rental tables.

Schedule: monthly (1st of month at 05:00), after run_bazaraki_sale/rental complete.
Run manually on server:
  nohup /opt/bnb/venv/bin/python3 /opt/bnb_git/run_bazaraki_enrich.py \
      >> /opt/bnb_git/logs/bazaraki_enrich.log 2>&1 &
"""

import os
import time
import logging
import smtplib
import argparse
from datetime import datetime
from email.mime.text import MIMEText

from curl_cffi import requests as curl_requests

from scraper.bazaraki_client import get_listing_details
from storage.storage import (
    init_db, init_bazaraki_tables,
    get_bazaraki_needing_details, write_bazaraki_details,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bnb.duckdb")
PROXY_URL = os.getenv("WEBSHARE_PROXY_URL", "")
DELAY     = 3.0       # seconds between requests
BATCH     = 50        # write to DB every N listings

SMTP_USER     = "yianniscon93@gmail.com"
SMTP_PASSWORD = "sscs irqs lops uggi"
ALERT_TO      = "yianniscon93@gmail.com"


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


def _enrich_type(conn, listing_type: str, limit: int | None, session) -> tuple[int, int, int]:
    """Enrich one listing type. Returns (enriched, expired, failed)."""
    listings = get_bazaraki_needing_details(conn, listing_type, limit=limit)
    total = len(listings)
    log.info(f"[{listing_type}] {total} listings need detail enrichment")
    if not total:
        return 0, 0, 0

    enriched = 0
    expired  = 0
    failed   = 0
    batch    = []
    fetched_at = datetime.now()

    for i, (listing_id, url) in enumerate(listings, 1):
        details = get_listing_details(listing_id, url, session, PROXY_URL)

        if details is None:
            failed += 1
        elif details.get("expired"):
            batch.append(details)
            expired += 1
        else:
            batch.append(details)
            enriched += 1

        if len(batch) >= BATCH:
            write_bazaraki_details(conn, batch, listing_type, fetched_at)
            batch = []

        if i % 100 == 0 or i == total:
            pct = i / total * 100
            log.info(f"  [{listing_type}] {i}/{total} ({pct:.0f}%)  enriched={enriched}  expired={expired}  failed={failed}")

        if i < total:
            time.sleep(DELAY)

    if batch:
        write_bazaraki_details(conn, batch, listing_type, fetched_at)

    return enriched, expired, failed


def run(limit: int | None = None, listing_types: list[str] | None = None) -> None:
    if listing_types is None:
        listing_types = ["sale", "rental"]
    started = datetime.now()
    log.info(f"Bazaraki enrichment started — {started:%Y-%m-%d %H:%M:%S}")
    _notify(f"Bazaraki enrich run started — {started:%Y-%m-%d %H:%M}")

    conn = init_db(DB_PATH)
    try:
        init_bazaraki_tables(conn)
        session = curl_requests.Session()

        total_enriched = 0
        total_expired  = 0
        total_failed   = 0
        for listing_type in listing_types:
            e, x, f = _enrich_type(conn, listing_type, limit, session)
            total_enriched += e
            total_expired  += x
            total_failed   += f

    except Exception as ex:
        log.exception("Bazaraki enrichment failed")
        _notify(f"Bazaraki enrich FAILED: {ex}")
        raise
    finally:
        conn.close()

    elapsed = int((datetime.now() - started).total_seconds())
    log.info(f"Done — enriched={total_enriched}  expired={total_expired}  failed={total_failed}  elapsed={elapsed // 60}m {elapsed % 60}s")
    _notify(
        f"Bazaraki enrich done ✓ — {elapsed // 60}m {elapsed % 60}s  "
        f"enriched={total_enriched}  expired={total_expired}  failed={total_failed}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max listings per type (for testing)")
    parser.add_argument("--type", choices=["sale", "rental", "both"], default="both", help="Which listing type to enrich")
    args = parser.parse_args()
    run(limit=args.limit, listing_types=[args.type] if args.type != "both" else ["sale", "rental"])
