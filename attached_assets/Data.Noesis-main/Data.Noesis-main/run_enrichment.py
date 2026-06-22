"""
One-off bulk listing enrichment.

Fetches amenities, ratings, superhost, and verified status for every listing
that has never been enriched. Safe to interrupt and re-run — the details_fetched_at
watermark ensures already-enriched listings are skipped.

After the first full run, ongoing enrichment is handled automatically by
run_discovery.py (200 listings per weekly run, refreshing every 30 days).

Run time estimate: ~13k listings × 1s delay ≈ 3.5–4 hours.
To run use: nohup /opt/bnb/venv/bin/python3 run_enrichment.py >> /opt/bnb_git/logs/enrichment.log 2>&1 &

"""

import os
import time
import logging
import smtplib
from email.mime.text import MIMEText
from datetime import datetime

from scraper.airbnb_client import get_listing_details
from storage.storage import init_db, get_listings_needing_details, write_listing_details

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH       = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bnb.duckdb")
PROXY_URL     = os.getenv("WEBSHARE_PROXY_URL", "")
BATCH_SIZE    = 25   # write to DB every N listings
ENRICH_DELAY  = 1.0  # seconds between detail page fetches

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


def run():
    started_at = datetime.now()
    log.info(f"Enrichment run started — {started_at:%Y-%m-%d %H:%M:%S}")

    conn = init_db(DB_PATH)
    try:
        listing_ids = get_listings_needing_details(conn, limit=None)
        n = len(listing_ids)
        log.info(f"Listings needing enrichment: {n}")
        _notify(f"Enrichment started — {n} listings to process")

        if not n:
            log.info("Nothing to do.")
            return

        batch    = []
        enriched = 0
        failed   = 0

        for i, (listing_id, name) in enumerate(listing_ids):
            details = get_listing_details(listing_id, proxy_url=PROXY_URL)
            if details:
                details["name"] = name
                batch.append(details)
                enriched += 1
            else:
                failed += 1
                log.debug(f"No data returned for listing {listing_id} (delisted or blocked)")

            if len(batch) >= BATCH_SIZE or i == n - 1:
                if batch:
                    write_listing_details(conn, batch)
                    batch = []

            if (i + 1) % 25 == 0 or i == n - 1:
                elapsed = (datetime.now() - started_at).total_seconds()
                rate    = (i + 1) / elapsed if elapsed > 0 else 0
                eta_sec = int((n - i - 1) / rate) if rate > 0 else 0
                log.info(
                    f"{i + 1}/{n}  enriched={enriched}  failed={failed}  "
                    f"ETA {eta_sec // 60}m {eta_sec % 60}s"
                )

            if i < n - 1:
                time.sleep(ENRICH_DELAY)

    except Exception as e:
        log.exception("Enrichment run failed")
        _notify(f"Enrichment FAILED: {e}")
        raise
    finally:
        conn.close()

    elapsed_sec = int((datetime.now() - started_at).total_seconds())
    log.info(f"Done — {enriched}/{n} enriched, {failed} failed, elapsed {elapsed_sec // 60}m {elapsed_sec % 60}s")
    _notify(f"Enrichment done ✓ — {enriched}/{n} enriched  {elapsed_sec // 60}m {elapsed_sec % 60}s")


if __name__ == "__main__":
    run()
