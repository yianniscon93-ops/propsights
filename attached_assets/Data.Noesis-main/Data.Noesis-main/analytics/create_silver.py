"""
Standalone silver update — run independently of run_availability.py.

Usage (server):
    cd /opt/bnb_git && /opt/bnb_git/venv/bin/python3 analytics/create_silver.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
from datetime import datetime

from storage.storage import init_db, update_silver

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH = "bnb.duckdb"

if __name__ == "__main__":
    execution_timestamp = datetime.now()
    log.info(f"Silver update started — {execution_timestamp:%Y-%m-%d %H:%M:%S}")

    conn = init_db(DB_PATH)
    try:
        summary = update_silver(conn, execution_timestamp)
        log.info(
            f"Silver done — total: {summary['total']}  "
            f"new/changed: {summary['new_or_changed']}  "
            f"newly booked: {summary['newly_booked']}  "
            f"booking events: {summary['newly_booked_detected']}"
        )
    finally:
        conn.close()
