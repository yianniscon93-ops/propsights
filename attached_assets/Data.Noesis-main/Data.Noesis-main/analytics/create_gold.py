"""
Standalone gold update — run independently of run_availability.py.

Assumes silver is already up to date. Processes listings in microbatches
of 200 to keep memory bounded (safe on 4GB server with no swap).

Usage (server):
    cd /opt/bnb_git && /opt/bnb_git/venv/bin/python3 analytics/create_gold.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
from datetime import datetime

from storage.storage import init_db
from analytics.gold import update_gold

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH = "bnb.duckdb"

if __name__ == "__main__":
    execution_timestamp = datetime.now()
    log.info(f"Gold update started — {execution_timestamp:%Y-%m-%d %H:%M:%S}")

    conn = init_db(DB_PATH)
    try:
        summary = update_gold(conn, execution_timestamp)
        log.info(
            f"Gold done — rows: {summary['gold_rows_written']}  "
            f"listings: {summary['listings_processed']}  "
            f"stale: {summary['stale_flagged']}  "
            f"owner_blocks: {summary['owner_blocks']}"
        )
    finally:
        conn.close()
