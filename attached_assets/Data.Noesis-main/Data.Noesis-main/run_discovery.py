"""
Weekly listing discovery.

Searches all configured Cyprus regions via a non-overlapping tile grid to
discover active listings. Writes listing metadata and review snapshots to
the DB. Does NOT fetch calendars — run.py handles that daily.

Run this once a week (Monday recommended) to pick up new listings and
refresh last_seen_at for delisted listing detection.
"""

import os
import sys
import time
import logging
import smtplib
from email.mime.text import MIMEText
from datetime import datetime

from scraper.airbnb_client import get_api_key, search_by_area, get_listing_details
from storage.storage import init_db, write_listings, write_reviews_bronze, get_listings_needing_details, write_listing_details
from scraper.areas import generate_grid, assign_neighborhood
from enrich_listings_areas import run as enrich_areas

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH      = "bnb.duckdb"
CURRENCY     = "EUR"
SEARCH_DELAY = 2  # seconds between tile searches
PROXY_URL    = os.getenv("WEBSHARE_PROXY_URL", "")

ENRICH_LIMIT = 200   # max listings to enrich per discovery run
ENRICH_DELAY = 1.0   # seconds between detail page fetches

TILE_SATURATION_THRESHOLD = 270
TILE_MIN_STEP = 0.005  # ~400m — don't split below this

KNOWN_CITIES = [
    "nicosia", "nicosia_suburbs",
    "paphos", "paphos_coast",
    "droushia", "polis_latchi",
    "pissouri",
    "limassol",
    "larnaca",
    "troodos",
    "kokkinochoria",
    "ayia_napa",
    "south_coast",
    "larnaca_south",
    "nicosia_east",
]

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


def _interactive() -> bool:
    return sys.stdin.isatty()


def _ask_city() -> list[str]:
    if not _interactive():
        return list(KNOWN_CITIES)
    raw = input("Which city? [name / all, default: all]: ").strip().lower()
    if raw in ("", "all"):
        return list(KNOWN_CITIES)
    if raw in KNOWN_CITIES:
        return [raw]
    print("Unknown city — running all.")
    return list(KNOWN_CITIES)


def _search_tile(api_key: str, tile: dict, depth: int = 0) -> list[dict]:
    """
    Fetch listings for a tile (no dates — returns all active listings).
    If saturated, split into 4 sub-tiles and recurse.
    """
    listings = search_by_area(api_key, currency=CURRENCY, proxy_url=PROXY_URL, **tile)

    step_lat = round(tile["ne_lat"] - tile["sw_lat"], 6)
    step_lng = round(tile["ne_lng"] - tile["sw_lng"], 6)

    if len(listings) >= TILE_SATURATION_THRESHOLD and step_lat > TILE_MIN_STEP and step_lng > TILE_MIN_STEP:
        tile_label = f"{tile['sw_lat']:.4f},{tile['sw_lng']:.4f}"
        log.warning(
            f"Tile {tile_label} saturated ({len(listings)} listings) — splitting into 4 sub-tiles (depth {depth})"
        )
        mid_lat = round(tile["sw_lat"] + step_lat / 2, 6)
        mid_lng = round(tile["sw_lng"] + step_lng / 2, 6)
        sub_tiles = [
            {"sw_lat": tile["sw_lat"], "sw_lng": tile["sw_lng"], "ne_lat": mid_lat,        "ne_lng": mid_lng},
            {"sw_lat": tile["sw_lat"], "sw_lng": mid_lng,        "ne_lat": mid_lat,        "ne_lng": tile["ne_lng"]},
            {"sw_lat": mid_lat,        "sw_lng": tile["sw_lng"], "ne_lat": tile["ne_lat"], "ne_lng": mid_lng},
            {"sw_lat": mid_lat,        "sw_lng": mid_lng,        "ne_lat": tile["ne_lat"], "ne_lng": tile["ne_lng"]},
        ]
        combined = []
        seen = set()
        for sub in sub_tiles:
            for l in _search_tile(api_key, sub, depth + 1):
                if l["room_id"] not in seen:
                    seen.add(l["room_id"])
                    combined.append(l)
        return combined

    return listings


def _discover_listings(
    cities: list[str],
    api_key: str,
    conn,
    execution_timestamp: datetime,
) -> int:
    """
    Search all tiles across all cities. Writes listing metadata and
    review snapshots to DB. Returns total unique listings found.
    """
    unique: list[dict] = []
    seen_ids: set[int] = set()

    for city in cities:
        log.info(f"--- Tile search: {city} ---")
        for tile in generate_grid(city=city):
            tile_label = f"{tile['sw_lat']:.3f},{tile['sw_lng']:.3f}"
            listings = None
            for attempt in range(3):
                try:
                    listings = _search_tile(api_key, tile)
                    break
                except Exception as e:
                    if attempt < 2:
                        log.warning(f"Tile {tile_label} failed (attempt {attempt + 1}/3): {e} — retrying in 30s")
                        time.sleep(30)
                    else:
                        log.warning(f"Tile {tile_label} failed after 3 attempts — skipping")
            if listings is None or not listings:
                time.sleep(SEARCH_DELAY)
                continue

            for l in listings:
                coords = l.get("coordinates", {})
                l["_area"] = assign_neighborhood(coords.get("latitude"), coords.get("longitude"), city=city)

            write_listings(conn, listings, execution_timestamp, city=city)
            write_reviews_bronze(conn, listings, execution_timestamp)

            for l in listings:
                lid = l["room_id"]
                if lid not in seen_ids:
                    seen_ids.add(lid)
                    unique.append(l)

            log.info(f"Tile {tile_label}  {len(listings)} listings  ({len(unique)} unique so far)")
            time.sleep(SEARCH_DELAY)

    return len(unique)


def _enrich_listing_details(conn, limit: int = ENRICH_LIMIT) -> int:
    """
    Fetch amenities, ratings, superhost, and verified status for listings
    that have never been enriched or haven't been refreshed in 30 days.
    Writes results in batches of 25. Returns count of successfully enriched listings.
    """
    listing_ids = get_listings_needing_details(conn, limit=limit)
    n = len(listing_ids)
    if not n:
        log.info("Enrichment: no listings needing details")
        return 0

    log.info(f"Enrichment: fetching details for {n} listings...")
    batch    = []
    enriched = 0

    for i, (listing_id, name) in enumerate(listing_ids):
        details = get_listing_details(listing_id, proxy_url=PROXY_URL)
        if details:
            details["name"] = name
            batch.append(details)
            enriched += 1

        if len(batch) >= 25 or i == n - 1:
            if batch:
                write_listing_details(conn, batch)
                batch = []

        if (i + 1) % 25 == 0 or i == n - 1:
            log.info(f"Enrichment: {i + 1}/{n} processed, {enriched} enriched")

        if i < n - 1:
            time.sleep(ENRICH_DELAY)

    return enriched


def run():
    cities = _ask_city()
    execution_timestamp = datetime.now()
    log.info(f"Discovery run started — {execution_timestamp:%Y-%m-%d %H:%M:%S}  cities={len(cities)}")
    _notify(f"Discovery run started — {execution_timestamp:%Y-%m-%d %H:%M}  {len(cities)} regions")

    conn = init_db(DB_PATH)
    try:
        api_key = get_api_key(proxy_url=PROXY_URL)
        log.info("API key obtained")

        total = _discover_listings(cities, api_key, conn, execution_timestamp)
        log.info(f"Discovery complete — {total} unique listings found")

        enriched = _enrich_listing_details(conn)
        log.info(f"Enrichment complete — {enriched} listings enriched")

    except Exception as e:
        log.exception("Discovery run failed")
        _notify(f"Discovery run FAILED: {e}")
        raise
    finally:
        conn.close()

    enrich_areas(DB_PATH)

    elapsed = datetime.now() - execution_timestamp
    total_sec = int(elapsed.total_seconds())
    log.info(f"Done — elapsed {total_sec // 60}m {total_sec % 60}s")
    _notify(f"Discovery done ✓ — {total_sec // 60}m {total_sec % 60}s  {total} listings found  {enriched} enriched")


if __name__ == "__main__":
    run()
