"""
Gold layer orchestrator.

update_gold(conn, execution_timestamp) recomputes the gold table for the
rolling analysis window (current_date − 60 days … current_date + 365 days).

--- Architecture overview ---

The gold layer is the final, analytics-ready layer in our medallion pipeline:
    bronze (raw snapshots) → silver (latest state per listing/date) → gold (enriched signals)

Gold adds three things that silver doesn't have:
  1. Booking confidence score  — how likely is an unavailable date a real guest booking
                                  (vs owner block, min-stay gap, stale listing, etc.)
  2. Flag annotations          — structured labels per date (owner_block, seasonal_shutdown, …)
  3. Review metadata           — avg_rating, review_count joined in from reviews_bronze

--- Detector window vs gold write window ---

Detectors run only on the tight lookahead window (−60 … +30 days) to avoid
lookahead bias. For example, seasonal_shutdown needs enough past data to
distinguish a genuine winter closure from a single blocked weekend. Running
detectors on dates 200 days in the future would produce noise.

Gold rows are written for the full future horizon (today → +365 days) so the
dashboard can show confidence-adjusted occupancy curves across all months —
detectors just won't fire on the far-future dates.

--- Memory design — why microbatches? ---

Silver has ~4.5M rows for 12k listings × 365 days. Loading all of that into
Python via fetchdf().to_dict() caused an OOM kill on our 4GB server (3.6GB used).

The fix mirrors what you'd do in PySpark with repartition("listing_id") +
mapPartitions: we process BATCH_SIZE listings at a time, fetch only their silver
rows from DuckDB, run Python detectors, then flush immediately to gold.
Peak RAM per batch ≈ 200 listings × 365 days × ~500 bytes ≈ ~36 MB.

--- Incremental / checkpoint pattern ---

After the first full run, MAX(computed_at) in gold acts as a watermark.
Subsequent runs only reprocess listings where silver.date_changed is newer
than that watermark — typically a small fraction of the 12k listings.
"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, date

import duckdb

from analytics.detectors import (
    detect_owner_blocks,
    detect_min_stay_gaps,
    detect_stale_listing,
    detect_seasonal_shutdown,
)
from analytics.confidence import compute_booking_confidence
from analytics.enrichment import (
    AMENITY_FLAG_NAMES,
    amenity_flags,
    calendar_context,
    compute_booking_blocks,
)

log = logging.getLogger(__name__)

# ── Detector window ────────────────────────────────────────────────────────────
# Detectors need historical context (trailing) and near-future signal (forward).
# Going too far forward produces noise (too few data points to pattern-match on).
DETECTOR_TRAILING_DAYS = 60  # look back 60 days for patterns (owner blocks, seasonal, etc.)
DETECTOR_FORWARD_DAYS  = 30  # look ahead 30 days only for signal computation

# ── Delisted threshold ─────────────────────────────────────────────────────────
# Listings not seen in a tile search for 14+ days are considered delisted.
# We exclude them from gold entirely — they clutter the dashboard and distort
# occupancy aggregates with stale unavailable dates.
DELISTED_THRESHOLD_DAYS = 35

# ── Gold write horizon ─────────────────────────────────────────────────────────
# We write gold rows up to 365 days forward so monthly occupancy charts
# can show the full seasonal curve, not just the near-term window.
GOLD_FORWARD_DAYS = 365

# ── Microbatch size ────────────────────────────────────────────────────────────
# 200 listings × 365 days × ~500 bytes ≈ 36 MB per batch — well within budget
# on our 4GB server. Increase if runtime is slow; decrease if RAM is tight.
BATCH_SIZE = 200


def update_gold(
    conn: duckdb.DuckDBPyConnection,
    execution_timestamp: datetime,
    start_date: date | None = None,
    listing_ids: list[int] | None = None,
) -> dict:
    """
    Recompute gold rows for all listings over the rolling window.

    High-level steps:
      1. Determine which listings need recomputing (incremental watermark check).
      2. Filter out delisted listings.
      3. Preload small global lookups (market stats, scrape counts, reviews).
      4. Microbatch loop: fetch silver → run detectors → upsert gold.

    If `listing_ids` is provided, the watermark logic is bypassed entirely and
    only those listings are processed (used for targeted backfills after an
    interrupted full run).

    Returns a summary dict with counts for monitoring/alerting.
    """
    # Tell DuckDB to cap its own internal memory and spill to disk if needed.
    # Without this, DuckDB can use all available RAM for its own query buffers,
    # which would compete with our Python layer and cause OOM.
    conn.execute("SET memory_limit='1.5GB'")

    today          = execution_timestamp.date()
    detector_start = today - timedelta(days=DETECTOR_TRAILING_DAYS)
    detector_end   = today + timedelta(days=DETECTOR_FORWARD_DAYS)
    gold_end       = today + timedelta(days=GOLD_FORWARD_DAYS)

    # ─────────────────────────────────────────────────────────────────────────
    # Step 1 — Incremental: find which listing IDs need recomputing
    #
    # We use MAX(computed_at) from the gold table as a watermark.
    # On the very first run, gold is empty → COALESCE returns 1970-01-01,
    # which means "all silver rows are newer" → full recompute.
    # On subsequent runs, only listings where silver changed after the last
    # gold write are included — typically a small fraction of the 12k listings.
    #
    # We check two change sources:
    #   (a) silver.date_changed  — availability or price changed in the calendar
    #   (b) reviews_bronze       — a new review scrape came in (affects avg_rating)
    # ─────────────────────────────────────────────────────────────────────────
    gold_cutoff = conn.execute("""
        SELECT COALESCE(MAX(computed_at), '1970-01-01'::TIMESTAMP) FROM gold
    """).fetchone()[0]

    is_first_run = gold_cutoff.year == 1970

    if listing_ids is not None:
        # Targeted backfill — skip watermark logic.
        # Use the same window semantics as a first run so historical dates
        # get populated for these listings (they have no gold rows yet).
        if start_date is not None:
            window_start = start_date
        else:
            earliest = conn.execute(
                "SELECT MIN(calendar_date) FROM availability_latest"
            ).fetchone()[0]
            window_start = earliest if earliest else today
        listings_to_process = list(listing_ids)
        changed_ids = set(listings_to_process)
        new_review_ids = set()
        log.info(f"Gold: targeted backfill — {len(listings_to_process)} listings from {window_start}")
    elif is_first_run:
        # Backfill from the earliest date we have in availability_latest so
        # historical occupancy rows exist from day one, not just from today forward.
        if start_date is not None:
            window_start = start_date
        else:
            earliest = conn.execute(
                "SELECT MIN(calendar_date) FROM availability_latest"
            ).fetchone()[0]
            window_start = earliest if earliest else today
        log.info(f"Gold: first run — full backfill from {window_start}")

        listings_to_process = [
            row[0] for row in conn.execute("""
                SELECT DISTINCT listing_id FROM availability_latest
                WHERE calendar_date BETWEEN ? AND ?
            """, [str(window_start), str(gold_end)]).fetchall()
        ]
    else:
        window_start = start_date if start_date is not None else today

        # Listings where any future calendar date changed since the last gold run
        changed_ids = set(row[0] for row in conn.execute("""
            SELECT DISTINCT listing_id FROM availability_latest
            WHERE date_changed >= ?
              AND calendar_date BETWEEN ? AND ?
        """, [gold_cutoff, str(window_start), str(gold_end)]).fetchall())

        # Listings with new review data since the last gold run
        new_review_ids = set(row[0] for row in conn.execute("""
            SELECT DISTINCT listing_id FROM reviews_bronze
            WHERE execution_timestamp >= ?
        """, [gold_cutoff]).fetchall())

        # Listings with new pricing data since the last gold run
        new_price_ids = set(row[0] for row in conn.execute("""
            SELECT DISTINCT listing_id FROM pricing_silver
            WHERE date_changed >= ?
              AND calendar_date BETWEEN ? AND ?
        """, [gold_cutoff, str(window_start), str(gold_end)]).fetchall())

        listings_to_process = list(changed_ids | new_review_ids | new_price_ids)

        if not listings_to_process:
            listings_to_process = [
                row[0] for row in conn.execute(
                    "SELECT DISTINCT listing_id FROM availability_latest WHERE calendar_date BETWEEN ? AND ?",
                    [str(today), str(gold_end)]
                ).fetchall()
            ]
            log.info("Gold: no incremental changes — running full recompute")

    if not listings_to_process:
        log.info("Gold: no listings to process — skipping")
        return {"gold_rows_written": 0, "listings_processed": 0}

    # ─────────────────────────────────────────────────────────────────────────
    # Step 2 — Filter out delisted listings
    #
    # A listing is "delisted" if it hasn't appeared in a tile search for
    # DELISTED_THRESHOLD_DAYS days. Writing gold rows for delisted listings
    # would pollute dashboard aggregates with stale unavailable dates
    # (e.g. a listing that closed in January still showing as "booked" in March).
    # ─────────────────────────────────────────────────────────────────────────
    delisted_cutoff = today - timedelta(days=DELISTED_THRESHOLD_DAYS)
    delisted_ids = set(row[0] for row in conn.execute("""
        SELECT listing_id FROM listings
        WHERE last_seen_at IS NOT NULL
          AND last_seen_at < ?
    """, [delisted_cutoff.isoformat()]).fetchall())

    listings_to_process = [lid for lid in listings_to_process if lid not in delisted_ids]
    if delisted_ids:
        log.info(f"Gold: skipped {len(delisted_ids)} delisted listings")

    if not listings_to_process:
        log.info("Gold: no listings remain after filtering delisted — skipping")
        return {"gold_rows_written": 0, "listings_processed": 0}

    # ─────────────────────────────────────────────────────────────────────────
    # Step 3 — Preload small global lookups (fit in RAM, used by every batch)
    #
    # These are aggregates — small enough to hold in Python dicts for the
    # lifetime of this run. Loading them once here avoids repeating the same
    # DuckDB queries 60+ times inside the microbatch loop.
    # ─────────────────────────────────────────────────────────────────────────

    # Market avg/std price per area over the next 30 days — used by detect_stale_listing
    # to flag listings whose price hasn't moved vs. the area market.
    market_by_area = {
        r[0]: {"avg_price": r[1], "std_price": r[2]}
        for r in conn.execute("""
            SELECT area, AVG(price_per_night), STDDEV(price_per_night)
            FROM availability_latest
            WHERE calendar_date BETWEEN ? AND ?
              AND price_per_night IS NOT NULL
            GROUP BY area
        """, [str(today), str(today + timedelta(days=30))]).fetchall()
    }

    # Total number of scrape runs per listing — a proxy for "how much history
    # do we have?" Used by detect_stale_listing (needs N scrapes to be confident).
    scrape_count_map = {
        int(r[0]): int(r[1])
        for r in conn.execute(
            "SELECT listing_id, COUNT(DISTINCT execution_timestamp) FROM availability_log GROUP BY listing_id"
        ).fetchall()
    }

    # Latest review snapshot per listing — joined into gold rows so the dashboard
    # can show ratings without hitting reviews_bronze directly.
    review_map = {
        int(r[0]): {"avg_rating": r[1], "review_count": r[2]}
        for r in conn.execute("""
            SELECT listing_id, avg_rating, review_count
            FROM reviews_bronze
            WHERE (listing_id, execution_timestamp) IN (
                SELECT listing_id, MAX(execution_timestamp)
                FROM reviews_bronze
                GROUP BY listing_id
            )
        """).fetchall()
    }

    # Listing attributes — denormalized into every gold row so the dashboard
    # can slice by property_type / bedrooms / amenities without joining listings.
    # Amenity flags are parsed once here from the raw JSON; cheap per-row lookup
    # for the rest of the run.
    listing_attrs: dict[int, dict] = {}
    for r in conn.execute("""
        SELECT
            listing_id,
            property_type,
            bedrooms,
            beds,
            size_sqm,
            is_superhost,
            is_guest_fav,
            proximity_beach_min,
            proximity_center_min,
            amenities
        FROM listings
    """).fetchall():
        listing_attrs[int(r[0])] = {
            "property_type":        r[1],
            "bedrooms":             r[2],
            "beds":                 r[3],
            "size_sqm":             r[4],
            "is_superhost":         r[5],
            "is_guest_fav":         r[6],
            "proximity_beach_min":  r[7],
            "proximity_center_min": r[8],
            "amenity_flags":        amenity_flags(r[9]),
        }

    # Bookings per listing — drives stay_length / stay_position / lead_time / booking_id.
    # Restricted to the same window as gold writes; far-historical bookings would
    # add memory pressure without affecting any current gold row.
    bookings_by_listing: dict[int, list[tuple]] = defaultdict(list)
    for r in conn.execute("""
        SELECT listing_id, calendar_date, booked_at
        FROM bookings
        WHERE calendar_date BETWEEN ? AND ?
    """, [str(window_start), str(gold_end)]).fetchall():
        bookings_by_listing[int(r[0])].append((r[1], r[2]))

    # The two most recent bronze snapshots (by execution_timestamp).
    # Owner-block detection compares the latest snapshot to the previous one:
    # if a block of dates flipped from available → unavailable between scrapes
    # without a plausible booking pattern, it's flagged as an owner block.
    ts_rows = conn.execute("""
        SELECT DISTINCT execution_timestamp
        FROM availability_log
        ORDER BY execution_timestamp DESC
        LIMIT 2
    """).fetchall()
    prev_ts = ts_rows[1][0] if len(ts_rows) >= 2 else None  # None if only 1 scrape ever run

    log.info(
        f"Gold: processing {len(listings_to_process)} listings in batches of {BATCH_SIZE} "
        f"(changed: {len(changed_ids)}, new reviews: {len(new_review_ids)})"
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Step 4 — Microbatch loop
    #
    # This is the core of the gold layer. For each batch of BATCH_SIZE listings:
    #   (a) Fetch their silver rows from DuckDB (narrow date window)
    #   (b) Group rows by listing_id into Python dicts (in-memory partition)
    #   (c) Fetch prev_bronze for owner-block detection
    #   (d) Run all detectors for each listing
    #   (e) Assemble gold rows (one per listing/date)
    #   (f) Upsert the batch to the gold table immediately, then discard from RAM
    #
    # This is the DuckDB/Python equivalent of PySpark's:
    #   silver_df.repartition("listing_id").mapPartitions(process_listing_partition)
    # except we control the partition size explicitly via BATCH_SIZE, and we
    # push to the sink (DuckDB) rather than collecting to the driver.
    # ─────────────────────────────────────────────────────────────────────────
    total_rows     = 0
    stale_count    = 0
    block_count    = 0
    dead_count     = 0
    seasonal_count = 0

    for batch_start in range(0, len(listings_to_process), BATCH_SIZE):
        batch        = listings_to_process[batch_start: batch_start + BATCH_SIZE]
        placeholders = ",".join("?" * len(batch))

        # (a) Fetch silver rows for just these listing IDs, for the full gold window.
        #     pricing_silver is preferred for price; falls back to availability_latest.
        #     ORDER BY listing_id, calendar_date so we can iterate in sequence.
        silver_rows = conn.execute(f"""
            SELECT
                al.listing_id,
                al.calendar_date,
                al.available,
                al.min_nights,
                CAST(COALESCE(ps.price_per_night, al.price_per_night) AS DOUBLE) AS price_per_night,
                al.last_seen,
                al.date_changed,
                al.area,
                al.bookable
            FROM availability_latest al
            LEFT JOIN pricing_silver ps
                   ON ps.listing_id    = al.listing_id
                  AND ps.calendar_date = al.calendar_date
            WHERE al.calendar_date BETWEEN ? AND ?
              AND al.listing_id IN ({placeholders})
            ORDER BY al.listing_id, al.calendar_date
        """, [str(window_start), str(gold_end)] + batch).fetchall()

        # (b) Group silver rows by listing_id — each entry is one listing's full
        #     calendar for the gold window. This is the "partition" in PySpark terms.
        by_listing: dict[int, list[dict]] = defaultdict(list)
        for r in silver_rows:
            by_listing[int(r[0])].append({
                "listing_id":      r[0],
                "calendar_date":   r[1],
                "available":       r[2],
                "min_nights":      r[3],
                "price_per_night": r[4],
                "last_seen":       r[5],
                "date_changed":    r[6],
                "area":            r[7],
                "bookable":        r[8],
            })

        # (c) Fetch the previous bronze snapshot for this batch — needed by
        #     detect_owner_blocks to compare availability flip-overs between scrapes.
        #     We limit to the detector window (−60…+30) since owner blocks only
        #     occur in the near term.
        prev_bronze: dict[int, list[dict]] = defaultdict(list)
        if prev_ts:
            pb_rows = conn.execute(f"""
                SELECT listing_id, calendar_date, available
                FROM availability_log
                WHERE execution_timestamp = ?
                  AND calendar_date BETWEEN ? AND ?
                  AND listing_id IN ({placeholders})
            """, [prev_ts, str(detector_start), str(detector_end)] + batch).fetchall()
            for r in pb_rows:
                prev_bronze[int(r[0])].append({
                    "listing_id":    r[0],
                    "calendar_date": r[1],
                    "available":     r[2],
                })

        # (d)/(e) Run detectors for each listing and assemble gold rows.
        gold_rows = []
        for listing_id, rows in by_listing.items():
            area      = rows[0].get("area", "")
            mkt       = market_by_area.get(area, {})
            n_scrapes = scrape_count_map.get(listing_id, 0)

            # Booking blocks for this listing — windowed into stays.
            booking_info = compute_booking_blocks(
                bookings_by_listing.get(listing_id, []),
                listing_id,
            )

            # Consecutive-unavailable run metadata (covers orphans too, unlike booking_info)
            run_info = _compute_run_info(rows)

            # Listing-level attributes (defaults if listing was never enriched).
            attrs = listing_attrs.get(listing_id, {})
            amen_flags = attrs.get("amenity_flags") or {name: False for name in AMENITY_FLAG_NAMES}

            # Narrow to detector window for signal computation.
            # Far-future rows (day +31 … +365) still get gold rows written,
            # but detectors don't fire on them — too little data to be meaningful.
            detector_rows = [
                r for r in rows
                if detector_start <= _as_date(r["calendar_date"]) <= detector_end
            ]

            # ── Detector 1: Stale listing ────────────────────────────────────
            # Returns True if this listing looks frozen: price never changes,
            # availability pattern is suspiciously static, or too few scrapes.
            # A stale listing's unavailable dates shouldn't be counted as bookings.
            is_stale = detect_stale_listing(
                listing_rows=detector_rows or rows,
                execution_timestamps=[None] * n_scrapes,  # we only need the count
                market_avg_price=mkt.get("avg_price"),
                market_std_price=mkt.get("std_price"),
            )

            # ── Detector 2: Owner blocks ─────────────────────────────────────
            # Returns a {date_str: annotation} map for dates that look like the
            # host blocked their own calendar (e.g. multi-week unavailability
            # that appeared between scrapes without a booking event).
            owner_block_map = detect_owner_blocks(detector_rows, prev_bronze.get(listing_id, []))

            # ── Detector 3: Min-stay gaps ────────────────────────────────────
            # Returns a {date_str: annotation} map for dates that are unavailable
            # only because no booking can satisfy the minimum stay requirement
            # (e.g. a 1-night gap between two bookings in a 3-night-min listing).
            # These are "dead inventory" — not real bookings, not owner blocks.
            min_stay_gap_map = detect_min_stay_gaps(rows)

            # ── Detector 4: Seasonal shutdown ────────────────────────────────
            # Returns a {date_str: annotation} map for dates that fall within a
            # recurring seasonal closure (e.g. listing always closed Nov–Mar).
            seasonal_map = detect_seasonal_shutdown(rows)

            # Build one gold row per (listing, date)
            for row in rows:
                d_str     = str(row["calendar_date"])
                available = bool(row["available"])
                bookable  = bool(row.get("bookable", True))
                flags: list[str] = []
                flag_details: dict = {}
                dead_inventory = False

                # ── Dead inventory: use API's bookable flag directly ──
                # A date that is available but not bookable (bookable=false)
                # means the guest can't select it due to min-nights rules.
                # This is the ground truth from Airbnb — no heuristic needed.
                if available and not bookable:
                    flags.append("min_stay_gap")
                    flag_details["bookable"] = False
                    flag_details["effectively_blocked"] = True
                    dead_inventory = True

                # Apply detector outputs in priority order.
                # All flags are additive — a date can be both stale AND owner_block.
                if is_stale:
                    flags.append("stale_listing")

                if d_str in owner_block_map and not available:
                    ann = owner_block_map[d_str]
                    flags.extend(ann["flags"])
                    flag_details.update(ann["flag_details"])

                # Heuristic min-stay gap detector as fallback — catches cases
                # where bookable is null/missing or where the API didn't flag it.
                if d_str in min_stay_gap_map and not dead_inventory:
                    ann = min_stay_gap_map[d_str]
                    flags.extend(ann["flags"])
                    flag_details.update(ann["flag_details"])
                    dead_inventory = ann.get("dead_inventory", False)

                if d_str in seasonal_map and not available:
                    ann = seasonal_map[d_str]
                    flags.extend(ann["flags"])
                    flag_details.update(ann["flag_details"])

                # Transition detection: if date_changed == last_seen and unavailable,
                # the most recent scrape is the one that first saw it as unavailable —
                # a strong signal that a booking just occurred.
                if row.get("date_changed") and row.get("last_seen"):
                    if row["date_changed"] == row["last_seen"] and not available:
                        flag_details["transition_detected"] = True

                # Run-length context — drives the length-based confidence rubric.
                # Populated only for unavailable dates; available dates score 0 anyway.
                ri = run_info.get(_as_date(row["calendar_date"]))
                run_length          = ri["run_length"]          if ri else None
                run_ends_at_horizon = ri["run_ends_at_horizon"] if ri else None
                if ri:
                    flag_details["run_length"]          = run_length
                    flag_details["run_ends_at_horizon"] = run_ends_at_horizon

                # Final confidence score: combines raw availability + all flags
                # into a 0.0–1.0 probability that the date is a real guest booking.
                confidence = compute_booking_confidence(available, flags, flag_details)
                review     = review_map.get(listing_id, {})

                # Primary reason confidence differs from baseline — first match wins.
                weight_reason = None
                for candidate in ("stale_listing", "seasonal_shutdown", "owner_block", "min_stay_gap"):
                    if candidate in flags:
                        weight_reason = candidate
                        break

                # Booking dynamics — only populated for dates in the bookings table
                bk = booking_info.get(_as_date(row["calendar_date"]))
                booking_id            = bk["booking_id"]             if bk else None
                booking_detected_at   = bk["booking_detected_at"]    if bk else None
                stay_length_nights    = bk["stay_length_nights"]     if bk else None
                stay_position         = bk["stay_position"]          if bk else None
                booking_lead_time     = bk["booking_lead_time_days"] if bk else None

                # Calendar context — deterministic from the date
                cal = calendar_context(_as_date(row["calendar_date"]))

                gold_rows.append((
                    listing_id,
                    d_str,
                    confidence,
                    dead_inventory,
                    json.dumps(sorted(set(flags))),  # dedup + sort for stable JSON
                    json.dumps(flag_details),
                    execution_timestamp.isoformat(),
                    review.get("avg_rating"),
                    review.get("review_count"),
                    is_stale,
                    available,
                    row.get("price_per_night"),
                    weight_reason,
                    area,
                    # Booking dynamics
                    booking_id,
                    booking_detected_at,
                    booking_lead_time,
                    stay_length_nights,
                    stay_position,
                    # Run-length context
                    run_length,
                    run_ends_at_horizon,
                    # Calendar context
                    cal["day_of_week"],
                    cal["is_weekend"],
                    cal["season"],
                    cal["is_holiday"],
                    cal["holiday_name"],
                    # Listing attributes
                    attrs.get("property_type"),
                    attrs.get("bedrooms"),
                    attrs.get("beds"),
                    attrs.get("size_sqm"),
                    attrs.get("is_superhost"),
                    attrs.get("is_guest_fav"),
                    attrs.get("proximity_beach_min"),
                    attrs.get("proximity_center_min"),
                    # Amenity flags (24 booleans, ordered per AMENITY_FLAG_NAMES)
                    *(amen_flags[name] for name in AMENITY_FLAG_NAMES),
                ))

        # (f) Bulk-upsert this batch to gold immediately, then let gold_rows be GC'd.
        #     DELETE + INSERT is far faster than executemany (72k individual parameterised
        #     statements per batch → single query pair).
        #     DELETE is scoped to the current write window only — historical gold rows
        #     (dates before today) are never touched and accumulate over time, giving
        #     the dashboard full historical adj_occ coverage as runs progress.
        if gold_rows:
            conn.execute(
                f"DELETE FROM gold WHERE listing_id IN ({placeholders}) AND calendar_date BETWEEN ? AND ?",
                batch + [str(window_start), str(gold_end)],
            )
            base_cols = [
                "listing_id", "calendar_date", "booking_confidence",
                "dead_inventory", "flags", "flag_details", "computed_at",
                "avg_rating", "review_count", "stale_listing",
                "available", "price_per_night", "weight_reason", "area",
                # Booking dynamics
                "booking_id", "booking_detected_at", "booking_lead_time_days",
                "stay_length_nights", "stay_position",
                # Run-length context
                "run_length", "run_ends_at_horizon",
                # Calendar context
                "day_of_week", "is_weekend", "season",
                "is_holiday", "holiday_name",
                # Listing attributes
                "property_type", "bedrooms", "beds", "size_sqm",
                "is_superhost", "is_guest_fav",
                "proximity_beach_min", "proximity_center_min",
            ]
            all_cols = base_cols + list(AMENITY_FLAG_NAMES)
            # Bypass pandas entirely: pandas 3.x emits Arrow-backed dtypes that
            # the server's DuckDB 1.2 rejects ("Data type 'str' not recognized")
            # whenever a column happens to be all-None within a batch.
            # executemany passes Python-native tuples directly, no dtype guesswork.
            col_list   = ", ".join(all_cols)
            placeholders = ", ".join("?" * len(all_cols))
            conn.executemany(
                f"INSERT INTO gold ({col_list}) VALUES ({placeholders})",
                gold_rows,
            )

            stale_count    += sum(1 for r in gold_rows if "stale_listing"     in r[4])
            block_count    += sum(1 for r in gold_rows if "owner_block"       in r[4])
            dead_count     += sum(1 for r in gold_rows if r[3])
            seasonal_count += sum(1 for r in gold_rows if "seasonal_shutdown" in r[4])
            total_rows     += len(gold_rows)

        # Progress log — ceiling division for total batch count: -(-n // b)
        n_done = batch_start + len(batch)
        pct    = int(n_done / len(listings_to_process) * 100)
        log.info(
            f"Gold batch {batch_start // BATCH_SIZE + 1}/{-(-len(listings_to_process) // BATCH_SIZE)} — "
            f"{n_done}/{len(listings_to_process)} listings ({pct}%) | "
            f"{len(gold_rows)} rows this batch | {total_rows} total written"
        )

    summary = {
        "gold_rows_written":  total_rows,
        "listings_processed": len(listings_to_process),
        "stale_flagged":      stale_count,
        "owner_blocks":       block_count,
        "dead_inventory":     dead_count,
        "seasonal_shutdown":  seasonal_count,
    }
    log.info(
        f"Gold — rows: {summary['gold_rows_written']}  "
        f"listings: {summary['listings_processed']}  "
        f"stale: {summary['stale_flagged']}  "
        f"owner_blocks: {summary['owner_blocks']}  "
        f"dead_inventory: {summary['dead_inventory']}  "
        f"seasonal: {summary['seasonal_shutdown']}"
    )
    return summary


def _as_date(val) -> date:
    """Coerce DuckDB date/datetime/string values to a Python date object."""
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if hasattr(val, "date"):
        return val.date()
    return date.fromisoformat(str(val))


def _compute_run_info(rows: list[dict]) -> dict[date, dict]:
    """Group consecutive unavailable dates into runs for ONE listing.

    Returns {date: {run_length, run_ends_at_horizon}} for every unavailable date.
    run_ends_at_horizon is True iff the run terminates at the listing's furthest
    scraped date (signals calendar-edge dead inventory).
    """
    if not rows:
        return {}
    sorted_rows = sorted(rows, key=lambda r: _as_date(r["calendar_date"]))
    horizon = _as_date(sorted_rows[-1]["calendar_date"])

    out: dict[date, dict] = {}
    i = 0
    while i < len(sorted_rows):
        if sorted_rows[i].get("available"):
            i += 1
            continue
        j = i
        while (
            j + 1 < len(sorted_rows)
            and not sorted_rows[j + 1].get("available")
            and (
                _as_date(sorted_rows[j + 1]["calendar_date"])
                - _as_date(sorted_rows[j]["calendar_date"])
            ).days == 1
        ):
            j += 1
        run_len = j - i + 1
        ends_at_horizon = _as_date(sorted_rows[j]["calendar_date"]) == horizon
        for k in range(i, j + 1):
            out[_as_date(sorted_rows[k]["calendar_date"])] = {
                "run_length":          run_len,
                "run_ends_at_horizon": ends_at_horizon,
            }
        i = j + 1
    return out
