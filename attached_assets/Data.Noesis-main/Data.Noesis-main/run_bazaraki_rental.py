"""
Bazaraki.com — long-term rental property listings scraper.

Pipeline:
  search_rental_listings() → bazaraki_rental_log (append) → bazaraki_rental_latest (upsert)

Schedule: monthly.
Run with nohup on server:
  nohup /opt/bnb/venv/bin/python3 run_bazaraki_rental.py >> /opt/bnb_git/logs/bazaraki_rental.log 2>&1 &
"""

import os
import logging
import smtplib
import argparse
from email.mime.text import MIMEText
from datetime import datetime

from scraper.bazaraki_client import search_rental_listings
from storage.storage import init_db, init_bazaraki_tables, write_bazaraki_log, update_bazaraki_latest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bnb.duckdb")
PROXY_URL  = os.getenv("WEBSHARE_PROXY_URL", "")
DELAY      = 0.5

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


def run() -> None:
    execution_timestamp = datetime.now()
    log.info(f"Bazaraki rental scraper started — {execution_timestamp:%Y-%m-%d %H:%M:%S}")
    _notify(f"Bazaraki rental run started — {execution_timestamp:%Y-%m-%d %H:%M}")

    conn = init_db(DB_PATH)
    try:
        init_bazaraki_tables(conn)

        listings = search_rental_listings(proxy_url=PROXY_URL, delay=DELAY)

        written = write_bazaraki_log(conn, listings, "rental", execution_timestamp)
        summary = update_bazaraki_latest(conn, "rental", execution_timestamp)
        log.info(
            f"Done — {written} rows logged | "
            f"total: {summary['total']}  new: {summary['new_listings']}  "
            f"price changes: {summary['price_changes']}"
        )

    except Exception as e:
        log.exception("Bazaraki rental run failed")
        _notify(f"Bazaraki rental run FAILED: {e}")
        raise
    finally:
        conn.close()

    elapsed = int((datetime.now() - execution_timestamp).total_seconds())
    log.info(f"Elapsed: {elapsed // 60}m {elapsed % 60}s")
    _notify(
        f"Bazaraki rental done ✓ — {elapsed // 60}m {elapsed % 60}s  "
        f"{summary['total']} listings  {summary['new_listings']} new"
    )


if __name__ == "__main__":
    run()
