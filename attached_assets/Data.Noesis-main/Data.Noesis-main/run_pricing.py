"""
Pricing scraper — runs independently of run.py (availability) and reviews.

For each of 20 weekly sample dates across the next 4.5 months, searches all tiles
across all cities with a 3-night window to capture per-date nightly prices.

After pricing, any listing IDs discovered that are not yet in the listings table
have their full availability calendar fetched and written to availability_log/availability_latest.

Pipeline:
  search_by_area(check_in=date, check_out=date+3) per tile
    → pricing_bronze (append-only snapshots)
    → update_pricing_silver (upsert, tracks price changes via date_changed)
  New listing IDs (not in listings table):
    → write_listings()
    → get_calendar() → write_bronze() → update_silver() → availability_log / availability_latest
"""

import os
import time
import logging
import smtplib
from email.mime.text import MIMEText
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from scraper.airbnb_client import get_api_key, search_by_area, get_calendar
from scraper.areas import generate_grid, assign_neighborhood
from enrich_listings_areas import run as enrich_areas
from storage.storage import (
    init_db, init_pricing_tables,
    write_pricing_bronze, update_pricing_silver,
    write_listings, write_reviews_bronze, write_bronze, update_silver,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DB_PATH         = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bnb.duckdb")
CURRENCY        = "EUR"
PROXY_URL       = os.getenv("WEBSHARE_PROXY_URL", "")
SEARCH_DELAY    = 1      # seconds between tile searches
CALENDAR_DELAY  = 3      # seconds between calendar requests for new listings
SAMPLE_WEEKS    = 28     # one sample date per week → covers ~6.5 months
DATE_WORKERS    = 5      # dates searched in parallel — safe with rotating proxies (each request is a different IP)
PRICING_GRID_STEP = 0.05  # coarser grid for pricing (~5.6km × 4.5km tiles, ~526 tiles total vs 2,966 for discovery)
                          # discovery uses GRID_STEP=0.02 (areas.py default) — this constant only affects pricing
KNOWN_CITIES    = [
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


def _generate_sample_dates() -> list[str]:
    """
    Return two dates per week for the next SAMPLE_WEEKS weeks:
      - Tuesday (weekday pricing)
      - Friday (weekend pricing)
    Sorted chronologically.
    """
    from datetime import date
    today = date.today()
    # Find the Monday of the current week
    monday = today - timedelta(days=today.weekday())
    dates = []
    for i in range(SAMPLE_WEEKS):
        week_monday = monday + timedelta(weeks=i)
        dates.append((week_monday + timedelta(days=1)).isoformat())  # Tuesday
        dates.append((week_monday + timedelta(days=4)).isoformat())  # Friday
    return sorted(dates)


def _scrape_prices_for_date(
    api_key: str,
    sample_date: str,
    known_listing_ids: frozenset[int],
) -> tuple[list[dict], list[dict]]:
    """
    Search all tiles for a single sample date (no DB writes — runs in a thread).
    Returns (price records, new listing objects not yet in listings table).
    Deduplication of new listings across dates is handled by _fetch_calendars_for_new_listings.
    """
    check_in  = sample_date
    check_out = (datetime.strptime(sample_date, "%Y-%m-%d") + timedelta(days=3)).strftime("%Y-%m-%d")

    seen_ids: set[int] = set()
    records: list[dict] = []
    new_listings: list[dict] = []
    tiles_done = 0
    tiles_failed = 0

    all_tiles = [(city, tile) for city in KNOWN_CITIES for tile in generate_grid(city=city, step=PRICING_GRID_STEP)]
    total_tiles = len(all_tiles)

    for city, tile in all_tiles:
        tile_label = f"{tile['sw_lat']:.3f},{tile['sw_lng']:.3f}"
        results = None
        for attempt in range(3):
            try:
                results = search_by_area(
                    api_key,
                    check_in=check_in,
                    check_out=check_out,
                    currency=CURRENCY,
                    proxy_url=PROXY_URL,
                    **tile,
                )
                break
            except Exception as e:
                if attempt < 2:
                    log.warning(f"  [{sample_date}] tile {tile_label} failed (attempt {attempt + 1}/3): {e} — retrying in 5s")
                    time.sleep(5)
                else:
                    log.warning(f"  [{sample_date}] tile {tile_label} failed after 3 attempts — skipping")
                    tiles_failed += 1

        tiles_done += 1

        if results is None:
            time.sleep(SEARCH_DELAY)
            continue

        for listing in results:
            lid = listing["room_id"]
            if lid == 0 or lid in seen_ids:
                continue
            if listing["price_per_night"] is None:
                continue
            seen_ids.add(lid)
            records.append({
                "listing_id":      lid,
                "calendar_date":   sample_date,
                "price_per_night": listing["price_per_night"],
            })

            if lid not in known_listing_ids:
                coords = listing.get("coordinates", {})
                listing["_area"] = assign_neighborhood(
                    coords.get("latitude"), coords.get("longitude"), city=city
                )
                listing["_city"] = city
                new_listings.append(listing)

        # Progress log every 25 tiles
        if tiles_done % 25 == 0:
            pct = int(tiles_done / total_tiles * 100)
            log.info(f"  [{sample_date}] {tiles_done}/{total_tiles} tiles ({pct}%) — {len(records)} prices | {tiles_failed} failed")

        time.sleep(SEARCH_DELAY)

    log.info(f"  [{sample_date}] done — {len(records)} price records | {len(new_listings)} new listings | {tiles_failed}/{total_tiles} tiles failed")
    return records, new_listings


def _fetch_calendars_for_new_listings(
    api_key: str,
    conn,
    new_listings: list[dict],
    execution_timestamp: datetime,
) -> int:
    """
    For listings discovered by pricing but not yet in the listings table:
      - Write to listings table
      - Write reviews_bronze snapshot
      - Fetch 12-month availability calendar → bronze → silver
    Returns total bronze rows written.
    """
    # Deduplicate across dates (same listing may appear in multiple date searches)
    seen: set[int] = set()
    unique: list[dict] = []
    for l in new_listings:
        if l["room_id"] not in seen:
            seen.add(l["room_id"])
            unique.append(l)

    log.info(f"New listings discovered via pricing: {len(unique)} — fetching availability...")

    # Write listing metadata grouped by city (write_listings takes a single city param)
    by_city: dict[str, list[dict]] = defaultdict(list)
    for l in unique:
        by_city[l["_city"]].append(l)

    for city, city_listings in by_city.items():
        write_listings(conn, city_listings, execution_timestamp, city=city)
        write_reviews_bronze(conn, city_listings, execution_timestamp)

    # Fetch calendar for each new listing
    total_bronze = 0
    for listing in unique:
        room_id = str(listing["room_id"])
        try:
            days = get_calendar(api_key, room_id, currency=CURRENCY, proxy_url=PROXY_URL)
            for d in days:
                d["price_per_night"] = listing.get("price_per_night")
            written = write_bronze(conn, days, listing["_area"], execution_timestamp)
            total_bronze += written
            log.info(f"  {room_id}  {listing.get('name', '')[:40]:<40}  {written} days")
        except Exception as e:
            log.error(f"  {room_id} calendar failed: {e}")
        time.sleep(CALENDAR_DELAY)

    if total_bronze > 0:
        avail_summary = update_silver(conn, execution_timestamp)
        log.info(
            f"availability_latest updated — total: {avail_summary['total']}  "
            f"new/changed: {avail_summary['new_or_changed']}  "
            f"newly booked: {avail_summary['newly_booked']}"
        )

    return total_bronze


def run() -> None:
    execution_timestamp = datetime.now()
    log.info(f"Pricing scraper started — {execution_timestamp:%Y-%m-%d %H:%M:%S}  {SAMPLE_WEEKS} sample dates")
    _notify(f"Pricing run started — {execution_timestamp:%Y-%m-%d %H:%M}  {SAMPLE_WEEKS} sample dates")

    conn = init_db(DB_PATH)
    try:
        init_pricing_tables(conn)
        api_key = get_api_key(proxy_url=PROXY_URL)
        log.info("API key obtained")

        known_snapshot: frozenset[int] = frozenset(
            row[0] for row in conn.execute("SELECT listing_id FROM listings").fetchall()
        )
        log.info(f"Known listings in DB: {len(known_snapshot)}")

        dates = _generate_sample_dates()
        log.info(f"Sample dates: {len(dates)} total ({dates[0]} → {dates[-1]}) | {SAMPLE_WEEKS} weeks × 2 (Tue+Fri) | workers: {DATE_WORKERS}")

        all_records: list[dict] = []
        all_new_listings: list[dict] = []
        completed = 0
        total_dates = len(dates)
        run_start = time.time()
        last_notified = run_start

        with ThreadPoolExecutor(max_workers=DATE_WORKERS) as executor:
            future_to_date = {
                executor.submit(_scrape_prices_for_date, api_key, date, known_snapshot): date
                for date in dates
            }
            for future in as_completed(future_to_date):
                date = future_to_date[future]
                try:
                    records, new_listings = future.result()
                    all_records.extend(records)
                    all_new_listings.extend(new_listings)
                except Exception as e:
                    log.error(f"Date {date} failed: {e}")
                completed += 1
                elapsed = time.time() - run_start
                elapsed_min = int(elapsed / 60)
                if completed > 0:
                    # Divide by DATE_WORKERS because dates run in parallel
                    eta_sec = (elapsed / completed) * (total_dates - completed) / DATE_WORKERS
                    eta_min = int(eta_sec / 60)
                    eta_str = f"~{eta_min}m remaining"
                else:
                    eta_str = "calculating..."
                log.info(f"Dates: {completed}/{total_dates} done | {len(all_records)} price records | elapsed {elapsed_min}m | {eta_str}")
                if time.time() - last_notified >= NOTIFY_INTERVAL:
                    _notify(f"Pricing: {completed}/{total_dates} dates | {len(all_records)} records | {elapsed_min}m elapsed | {eta_str}")
                    last_notified = time.time()

        log.info(f"All dates done — {len(all_records)} price records, writing to bronze...")
        write_pricing_bronze(conn, all_records, execution_timestamp)

        log.info("Updating pricing silver...")
        summary = update_pricing_silver(conn, execution_timestamp)
        log.info(f"Pricing silver — total: {summary['total']}  new/changed: {summary['new_or_changed']}")

        if all_new_listings:
            _fetch_calendars_for_new_listings(api_key, conn, all_new_listings, execution_timestamp)

    except Exception as e:
        log.exception("Pricing run failed")
        _notify(f"Pricing run FAILED: {e}")
        raise
    finally:
        conn.close()

    if all_new_listings:
        enrich_areas(DB_PATH)

    elapsed = datetime.now() - execution_timestamp
    total_sec = int(elapsed.total_seconds())
    log.info(f"Done — elapsed {total_sec // 60}m {total_sec % 60}s")
    _notify(f"Pricing run done ✓ — {total_sec // 60}m {total_sec % 60}s  {summary['total']} price rows  {len(all_new_listings)} new listings")


if __name__ == "__main__":
    run()
