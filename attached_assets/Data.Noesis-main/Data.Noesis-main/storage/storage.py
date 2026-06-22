"""
DuckDB storage layer — all tables.

Airbnb STR:
  listings:             one row per listing_id — name, area, coordinates
  availability_log:     append-only daily snapshots with execution_timestamp
  availability_latest:  one row per (listing_id, calendar_date) — latest state, date_changed tracking
  bookings:             one row per (listing_id, calendar_date) — first time we detected it flip to unavailable
  gold:                 enriched analytics per (listing_id, calendar_date) — confidence, flags, price, reviews
  reviews_bronze:       append-only rating snapshots per listing per discovery run
  pricing_bronze:       append-only price snapshots per (listing_id, calendar_date) per pricing run
  pricing_silver:       one row per (listing_id, calendar_date) — latest known price

Bazaraki (Cyprus property market):
  bazaraki_sale_log:      append-only for-sale snapshots — price, coordinates, bedrooms, property_type
  bazaraki_sale_latest:   one row per listing_id — latest sale price, price_changed tracking
  bazaraki_rental_log:    append-only long-term rental snapshots — monthly_rent, coordinates
  bazaraki_rental_latest: one row per listing_id — latest monthly_rent, price_changed tracking
"""

import json
import duckdb
from datetime import datetime


def init_db(db_path: str = "bnb.duckdb") -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect(db_path)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS listings (
            listing_id    BIGINT PRIMARY KEY,
            name          VARCHAR,
            area          VARCHAR,
            latitude      DOUBLE,
            longitude     DOUBLE,
            first_seen    TIMESTAMP,
            last_seen_at  TIMESTAMP,
            property_type VARCHAR,
            bedrooms      INTEGER,
            beds          INTEGER
        )
    """)

    # Migrate existing databases that were created before this schema version
    for col, typedef in [
        ("property_type",    "VARCHAR"),
        ("bedrooms",         "INTEGER"),
        ("beds",             "INTEGER"),
        ("city",             "VARCHAR"),
        ("last_seen_at",     "TIMESTAMP"),
        ("is_superhost",     "BOOLEAN"),
        ("is_guest_fav",     "BOOLEAN"),
        ("room_type",        "VARCHAR"),
        ("amenities",              "VARCHAR"),
        ("ratings",                "VARCHAR"),
        ("is_verified",            "BOOLEAN"),
        ("description",            "TEXT"),
        ("details_fetched_at",     "TIMESTAMP"),
        # parsed from description
        ("floor_level",            "VARCHAR"),
        ("view_tags",              "VARCHAR"),
        ("size_sqm",               "INTEGER"),
        ("building_features",      "VARCHAR"),
        ("proximity_beach_min",    "INTEGER"),
        ("proximity_center_min",   "INTEGER"),
        ("proximity_airport_min",  "INTEGER"),
        ("guest_profile",          "VARCHAR"),
        ("host_type",              "VARCHAR"),
        ("description_quality",    "VARCHAR"),
        ("property_notes",         "VARCHAR"),
    ]:
        try:
            conn.execute(f"ALTER TABLE listings ADD COLUMN {col} {typedef}")
        except Exception:
            pass  # column already exists

    # Backfill: listings scraped before city column existed are all Nicosia
    conn.execute("UPDATE listings SET city = 'nicosia' WHERE city IS NULL")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS availability_log (
            listing_id              BIGINT,
            area                    VARCHAR,
            calendar_date           DATE,
            available               BOOLEAN,
            min_nights              INTEGER,
            max_nights              INTEGER,
            available_for_checkin   BOOLEAN,
            available_for_checkout  BOOLEAN,
            bookable                BOOLEAN,
            price_per_night         DECIMAL(10, 2),
            execution_timestamp     TIMESTAMP
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS availability_latest (
            listing_id              BIGINT,
            area                    VARCHAR,
            calendar_date           DATE,
            available               BOOLEAN,
            min_nights              INTEGER,
            max_nights              INTEGER,
            available_for_checkin   BOOLEAN,
            available_for_checkout  BOOLEAN,
            bookable                BOOLEAN,
            price_per_night         DECIMAL(10, 2),
            last_seen               TIMESTAMP,
            date_changed            TIMESTAMP,
            PRIMARY KEY (listing_id, calendar_date)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            listing_id     BIGINT,
            calendar_date  DATE,
            booked_at      TIMESTAMP,
            PRIMARY KEY (listing_id, calendar_date)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS gold (
            listing_id         BIGINT,
            calendar_date      DATE,
            booking_confidence DOUBLE,
            dead_inventory     BOOLEAN,
            flags              VARCHAR,
            flag_details       VARCHAR,
            computed_at        TIMESTAMP,
            PRIMARY KEY (listing_id, calendar_date)
        )
    """)

    # Migrate gold table for new columns
    for col, typedef in [
        ("avg_rating",       "DOUBLE"),
        ("review_count",     "INTEGER"),
        ("stale_listing",    "BOOLEAN"),
        ("available",        "BOOLEAN"),
        ("price_per_night",  "DECIMAL(10,2)"),
        ("weight_reason",    "VARCHAR"),
        ("area",             "VARCHAR"),
        # Booking dynamics (per-date, derived from bookings table windowing)
        ("booking_id",             "VARCHAR"),
        ("booking_detected_at",    "TIMESTAMP"),   # first scrape that saw the date as unavailable
        ("booking_lead_time_days", "INTEGER"),
        ("stay_length_nights",     "INTEGER"),
        ("stay_position",          "INTEGER"),
        # Consecutive-unavailable run metadata — feeds the confidence rubric.
        # Computed across ALL unavailable dates, not just those with booking_id.
        ("run_length",             "INTEGER"),     # length of the unavailable run this date sits in
        ("run_ends_at_horizon",    "BOOLEAN"),     # run terminates at the listing's furthest scraped date
        # Calendar context
        ("day_of_week",  "SMALLINT"),   # 0 = Monday … 6 = Sunday
        ("is_weekend",   "BOOLEAN"),
        ("season",       "VARCHAR"),    # peak / shoulder / off
        ("is_holiday",   "BOOLEAN"),
        ("holiday_name", "VARCHAR"),
        # Denormalized listing attributes
        ("property_type",        "VARCHAR"),
        ("bedrooms",             "INTEGER"),
        ("beds",                 "INTEGER"),
        ("size_sqm",             "INTEGER"),
        ("is_superhost",         "BOOLEAN"),
        ("is_guest_fav",         "BOOLEAN"),
        ("proximity_beach_min",  "INTEGER"),
        ("proximity_center_min", "INTEGER"),
        # Amenity flags (parsed from listings.amenities JSON)
        ("has_pool",               "BOOLEAN"),
        ("has_hot_tub",            "BOOLEAN"),
        ("has_sea_view",           "BOOLEAN"),
        ("has_mountain_view",      "BOOLEAN"),
        ("has_beach_view",         "BOOLEAN"),
        ("has_city_view",          "BOOLEAN"),
        ("has_garden_view",        "BOOLEAN"),
        ("has_patio_or_balcony",   "BOOLEAN"),
        ("has_backyard",           "BOOLEAN"),
        ("has_garden",             "BOOLEAN"),
        ("has_bbq",                "BOOLEAN"),
        ("has_outdoor_furniture",  "BOOLEAN"),
        ("has_beach_access",       "BOOLEAN"),
        ("has_crib",               "BOOLEAN"),
        ("has_high_chair",         "BOOLEAN"),
        ("has_pack_n_play",        "BOOLEAN"),
        ("has_kids_toys",          "BOOLEAN"),
        ("is_pet_friendly",        "BOOLEAN"),
        ("has_workspace",          "BOOLEAN"),
        ("has_fast_wifi",          "BOOLEAN"),
        ("has_ev_charger",         "BOOLEAN"),
        ("has_free_parking",       "BOOLEAN"),
        ("has_gym",                "BOOLEAN"),
        ("has_exercise_equipment", "BOOLEAN"),
        ("long_term_stays_allowed","BOOLEAN"),
    ]:
        try:
            conn.execute(f"ALTER TABLE gold ADD COLUMN {col} {typedef}")
        except Exception:
            pass

    conn.execute("""
        CREATE TABLE IF NOT EXISTS reviews_bronze (
            listing_id          BIGINT,
            avg_rating          DOUBLE,
            review_count        INTEGER,
            execution_timestamp TIMESTAMP
        )
    """)

    return conn


def write_listings(conn: duckdb.DuckDBPyConnection, listings: list[dict], timestamp: datetime, city: str = "nicosia"):
    """Upsert listing metadata (name, area, coordinates, property features).
    Area is taken from l['_area'] on each listing dict (set by assign_neighborhood in run.py).
    """
    rows = [
        (
            int(l["room_id"]),
            l.get("name", ""),
            l.get("_area", "nicosia_other"),
            l.get("coordinates", {}).get("latitude"),
            l.get("coordinates", {}).get("longitude"),
            timestamp,
            timestamp,
            l.get("property_type"),
            l.get("bedrooms"),
            l.get("beds"),
            city,
            l.get("is_superhost"),
            l.get("is_guest_fav"),
            l.get("room_type"),
        )
        for l in listings
    ]
    conn.executemany("""
        INSERT INTO listings (listing_id, name, area, latitude, longitude, first_seen, last_seen_at, property_type, bedrooms, beds, city, is_superhost, is_guest_fav, room_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (listing_id) DO UPDATE SET
            last_seen_at  = excluded.last_seen_at,
            property_type = COALESCE(excluded.property_type, listings.property_type),
            bedrooms      = COALESCE(excluded.bedrooms,      listings.bedrooms),
            beds          = COALESCE(excluded.beds,          listings.beds),
            city          = COALESCE(excluded.city,          listings.city),
            is_superhost  = COALESCE(excluded.is_superhost,  listings.is_superhost),
            is_guest_fav  = COALESCE(excluded.is_guest_fav,  listings.is_guest_fav),
            room_type     = COALESCE(excluded.room_type,     listings.room_type)
    """, rows)


def write_reviews_bronze(
    conn: duckdb.DuckDBPyConnection,
    listings: list[dict],
    execution_timestamp: datetime,
) -> int:
    """Append rating snapshots to reviews_bronze. One row per listing per run."""
    rows = [
        (
            int(l["room_id"]),
            l.get("rating", {}).get("value"),
            l.get("rating", {}).get("review_count"),
            execution_timestamp,
        )
        for l in listings
        if l.get("rating", {}).get("review_count")
    ]
    if not rows:
        return 0
    conn.executemany(
        "INSERT INTO reviews_bronze VALUES (?, ?, ?, ?)", rows
    )
    return len(rows)


def get_listings_needing_details(conn: duckdb.DuckDBPyConnection, limit: int | None = 200) -> list[tuple[int, str]]:
    """Return (listing_id, name) pairs where description is missing.
    Covers: new listings never enriched, and listings where enrichment ran but returned no description.
    Pass limit=None to return all (used by bulk enrichment script).
    """
    sql = """
        SELECT listing_id, COALESCE(name, '') FROM listings
        WHERE description IS NULL
        ORDER BY first_seen DESC
    """
    rows = conn.execute(sql + (" LIMIT ?" if limit is not None else ""),
                        [limit] if limit is not None else []).fetchall()
    return [(r[0], r[1]) for r in rows]


def write_listing_details(conn: duckdb.DuckDBPyConnection, details_list: list[dict]) -> int:
    """Update listings with enrichment data fetched from the listing detail page.
    Also runs the rule-based description parser and writes extracted attributes.
    """
    from analytics.description_parser import parse_description

    rows = []
    for d in details_list:
        p = parse_description(d.get("name", ""), d.get("description"))
        rows.append((
            json.dumps(d["amenities"]) if d.get("amenities") is not None else None,
            json.dumps(d["ratings"])   if d.get("ratings")   is not None else None,
            d.get("is_superhost"),
            d.get("is_verified"),
            d.get("description"),
            # parsed fields
            p.floor_level,
            json.dumps(p.view)               if p.view               else None,
            p.size_sqm,
            json.dumps(p.building_features)  if p.building_features  else None,
            p.proximity_beach_min,
            p.proximity_center_min,
            p.proximity_airport_min,
            json.dumps(p.guest_profile)      if p.guest_profile      else None,
            p.host_type,
            p.description_quality,
            json.dumps(p.notes)              if p.notes              else None,
            int(d["listing_id"]),
        ))

    conn.executemany("""
        UPDATE listings
        SET
            amenities             = ?,
            ratings               = ?,
            is_superhost          = COALESCE(?, is_superhost),
            is_verified           = COALESCE(?, is_verified),
            description           = COALESCE(?, description),
            floor_level           = COALESCE(?, floor_level),
            view_tags             = COALESCE(?, view_tags),
            size_sqm              = COALESCE(?, size_sqm),
            building_features     = COALESCE(?, building_features),
            proximity_beach_min   = COALESCE(?, proximity_beach_min),
            proximity_center_min  = COALESCE(?, proximity_center_min),
            proximity_airport_min = COALESCE(?, proximity_airport_min),
            guest_profile         = COALESCE(?, guest_profile),
            host_type             = COALESCE(?, host_type),
            description_quality   = ?,
            property_notes        = COALESCE(?, property_notes),
            details_fetched_at    = now()
        WHERE listing_id = ?
    """, rows)
    return len(rows)


def init_pricing_tables(conn: duckdb.DuckDBPyConnection) -> None:
    """Create pricing_bronze and pricing_silver tables if they don't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pricing_bronze (
            listing_id          BIGINT,
            calendar_date       DATE,
            price_per_night     DECIMAL(10, 2),
            execution_timestamp TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pricing_silver (
            listing_id      BIGINT,
            calendar_date   DATE,
            price_per_night DECIMAL(10, 2),
            last_seen       TIMESTAMP,
            date_changed    TIMESTAMP,
            PRIMARY KEY (listing_id, calendar_date)
        )
    """)


def write_pricing_bronze(
    conn: duckdb.DuckDBPyConnection,
    records: list[dict],
    execution_timestamp: datetime,
) -> int:
    """Append per-date price snapshots to pricing_bronze. Returns rows written."""
    if not records:
        return 0
    rows = [
        (int(r["listing_id"]), r["calendar_date"], r["price_per_night"], execution_timestamp)
        for r in records
    ]
    conn.executemany("INSERT INTO pricing_bronze VALUES (?, ?, ?, ?)", rows)
    return len(rows)


def update_pricing_silver(conn: duckdb.DuckDBPyConnection, execution_timestamp: datetime) -> dict:
    """Upsert latest pricing_bronze batch into pricing_silver. Tracks price changes via date_changed."""
    conn.execute("""
        INSERT INTO pricing_silver (listing_id, calendar_date, price_per_night, last_seen, date_changed)
        SELECT listing_id, calendar_date, price_per_night, execution_timestamp, execution_timestamp
        FROM pricing_bronze
        WHERE execution_timestamp = ?
        ON CONFLICT (listing_id, calendar_date) DO UPDATE SET
            price_per_night = excluded.price_per_night,
            last_seen       = excluded.last_seen,
            date_changed    = CASE
                                WHEN pricing_silver.price_per_night IS DISTINCT FROM excluded.price_per_night
                                THEN excluded.last_seen
                                ELSE pricing_silver.date_changed
                              END
    """, [execution_timestamp])

    summary = conn.execute("""
        SELECT
            COUNT(*)                                       AS total,
            COUNT(*) FILTER (WHERE date_changed = ?)      AS new_or_changed
        FROM pricing_silver
        WHERE last_seen = ?
    """, [execution_timestamp, execution_timestamp]).fetchone()

    return {"total": summary[0], "new_or_changed": summary[1]}


def write_bronze(
    conn: duckdb.DuckDBPyConnection,
    records: list[dict],
    area: str,
    execution_timestamp: datetime,
) -> int:
    """Append calendar day records to bronze. Returns number of rows written."""
    if not records:
        return 0

    rows = [
        (
            int(r["listingId"]),
            area,
            r["calendarDate"],
            r["available"],
            r.get("minNights"),
            r.get("maxNights"),
            r.get("availableForCheckin"),
            r.get("availableForCheckout"),
            r.get("bookable"),
            r.get("price_per_night"),
            execution_timestamp,
        )
        for r in records
    ]

    conn.executemany("""
        INSERT INTO availability_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)

    return len(rows)


def update_silver(conn: duckdb.DuckDBPyConnection, execution_timestamp: datetime) -> dict:
    """
    Upsert the latest bronze batch into silver.
    - New rows: insert, date_changed = execution_timestamp
    - Existing, available unchanged: update fields, keep date_changed
    - Existing, available changed: update fields, set date_changed = execution_timestamp

    Also detects true→false availability transitions and records them in bookings.
    Booking detection runs BEFORE the silver upsert so we can compare old vs new state.
    """
    # Detect bookings: calendar days that flipped from available → unavailable this run
    conn.execute("""
        INSERT INTO bookings (listing_id, calendar_date, booked_at)
        SELECT b.listing_id, b.calendar_date, b.execution_timestamp
        FROM availability_log b
        JOIN availability_latest s ON s.listing_id = b.listing_id AND s.calendar_date = b.calendar_date
        WHERE b.execution_timestamp = ?
          AND s.available = true
          AND b.available = false
        ON CONFLICT (listing_id, calendar_date) DO UPDATE SET
            booked_at = excluded.booked_at
    """, [execution_timestamp])

    newly_booked_detected = conn.execute(
        "SELECT COUNT(*) FROM bookings WHERE booked_at = ?", [execution_timestamp]
    ).fetchone()[0]

    conn.execute("""
        INSERT INTO availability_latest (
            listing_id, area, calendar_date, available, min_nights, max_nights,
            available_for_checkin, available_for_checkout, bookable,
            price_per_night, last_seen, date_changed
        )
        SELECT
            b.listing_id,
            b.area,
            b.calendar_date,
            b.available,
            b.min_nights,
            b.max_nights,
            b.available_for_checkin,
            b.available_for_checkout,
            b.bookable,
            b.price_per_night,
            b.execution_timestamp,
            b.execution_timestamp
        FROM availability_log b
        WHERE b.execution_timestamp = ?
          AND b.calendar_date >= CURRENT_DATE

        ON CONFLICT (listing_id, calendar_date) DO UPDATE SET
            available               = excluded.available,
            min_nights              = excluded.min_nights,
            max_nights              = excluded.max_nights,
            available_for_checkin   = excluded.available_for_checkin,
            available_for_checkout  = excluded.available_for_checkout,
            bookable                = excluded.bookable,
            price_per_night         = excluded.price_per_night,
            last_seen               = excluded.last_seen,
            date_changed            = CASE
                                        WHEN availability_latest.available != excluded.available
                                        THEN excluded.last_seen
                                        ELSE availability_latest.date_changed
                                      END
    """, [execution_timestamp])

    conn.execute("""
        UPDATE listings
        SET last_seen_at = ?
        WHERE listing_id IN (
            SELECT DISTINCT listing_id FROM availability_log
            WHERE execution_timestamp = ?
        )
    """, [execution_timestamp, execution_timestamp])

    summary = conn.execute("""
        SELECT
            COUNT(*)                                                    AS total,
            COUNT(*) FILTER (WHERE date_changed = ?)                   AS new_or_changed,
            COUNT(*) FILTER (WHERE available = false AND date_changed = ?) AS newly_booked
        FROM availability_latest
        WHERE last_seen = ?
    """, [execution_timestamp, execution_timestamp, execution_timestamp]).fetchone()

    return {
        "total":                   summary[0],
        "new_or_changed":          summary[1],
        "newly_booked":            summary[2],
        "newly_booked_detected":   newly_booked_detected,
    }


# ---------------------------------------------------------------------------
# Bazaraki tables
# ---------------------------------------------------------------------------

def init_bazaraki_tables(conn: duckdb.DuckDBPyConnection) -> None:
    """Create the four Bazaraki tables if they don't exist."""

    for table, price_col in [("bazaraki_sale_log", "price"), ("bazaraki_rental_log", "monthly_rent")]:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                listing_id          BIGINT,
                title               VARCHAR,
                {price_col}         DECIMAL(12, 2),
                latitude            DOUBLE,
                longitude           DOUBLE,
                bedrooms            INTEGER,
                property_type       VARCHAR,
                url                 VARCHAR,
                execution_timestamp TIMESTAMP
            )
        """)

    for table, price_col in [("bazaraki_sale_latest", "price"), ("bazaraki_rental_latest", "monthly_rent")]:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                listing_id         BIGINT PRIMARY KEY,
                title              VARCHAR,
                {price_col}        DECIMAL(12, 2),
                latitude           DOUBLE,
                longitude          DOUBLE,
                bedrooms           INTEGER,
                property_type      VARCHAR,
                url                VARCHAR,
                first_seen         TIMESTAMP,
                last_seen          TIMESTAMP,
                price_changed      TIMESTAMP,
                -- detail columns (populated by run_bazaraki_enrich.py)
                size_m2            FLOAT,
                floor              VARCHAR,
                parking            VARCHAR,
                condition          VARCHAR,
                furnishing         VARCHAR,
                included           VARCHAR,
                air_conditioning   VARCHAR,
                construction_year  INTEGER,
                energy_efficiency  VARCHAR,
                bathrooms          INTEGER,
                postal_code        VARCHAR,
                description        TEXT,
                details_fetched_at TIMESTAMP,
                expired_at         TIMESTAMP
            )
        """)
        # Migrate existing tables — add detail columns if they don't exist yet
        detail_cols = [
            ("size_m2",            "FLOAT"),
            ("floor",              "VARCHAR"),
            ("parking",            "VARCHAR"),
            ("condition",          "VARCHAR"),
            ("furnishing",         "VARCHAR"),
            ("included",           "VARCHAR"),
            ("air_conditioning",   "VARCHAR"),
            ("construction_year",  "INTEGER"),
            ("energy_efficiency",  "VARCHAR"),
            ("bathrooms",          "INTEGER"),
            ("postal_code",        "VARCHAR"),
            ("description",        "TEXT"),
            ("details_fetched_at", "TIMESTAMP"),
            ("expired_at",         "TIMESTAMP"),
        ]
        for col, dtype in detail_cols:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}")
            except Exception:
                pass


def write_bazaraki_log(
    conn: duckdb.DuckDBPyConnection,
    records: list[dict],
    listing_type: str,
    execution_timestamp: datetime,
) -> int:
    """
    Append records to bazaraki_sale_log or bazaraki_rental_log.
    listing_type: 'sale' or 'rental'
    Returns rows written.
    """
    if not records:
        return 0
    table = "bazaraki_sale_log" if listing_type == "sale" else "bazaraki_rental_log"
    rows = [
        (
            int(r["listing_id"]),
            r.get("title"),
            r.get("price"),
            r.get("latitude"),
            r.get("longitude"),
            r.get("bedrooms"),
            r.get("property_type"),
            r.get("url"),
            execution_timestamp,
        )
        for r in records
    ]
    conn.executemany(f"INSERT INTO {table} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return len(rows)


def update_bazaraki_latest(
    conn: duckdb.DuckDBPyConnection,
    listing_type: str,
    execution_timestamp: datetime,
) -> dict:
    """
    Upsert latest log batch into bazaraki_sale_latest or bazaraki_rental_latest.
    Tracks price changes. Returns summary dict.
    listing_type: 'sale' or 'rental'
    """
    log_table    = "bazaraki_sale_log"    if listing_type == "sale" else "bazaraki_rental_log"
    latest_table = "bazaraki_sale_latest" if listing_type == "sale" else "bazaraki_rental_latest"
    price_col    = "price"                if listing_type == "sale" else "monthly_rent"

    conn.execute(f"""
        INSERT INTO {latest_table} (
            listing_id, title, {price_col}, latitude, longitude,
            bedrooms, property_type, url, first_seen, last_seen, price_changed
        )
        SELECT
            listing_id, title, {price_col}, latitude, longitude,
            bedrooms, property_type, url,
            execution_timestamp, execution_timestamp, execution_timestamp
        FROM {log_table}
        WHERE execution_timestamp = ?
        ON CONFLICT (listing_id) DO UPDATE SET
            title         = excluded.title,
            {price_col}   = excluded.{price_col},
            latitude      = COALESCE(excluded.latitude,      {latest_table}.latitude),
            longitude     = COALESCE(excluded.longitude,     {latest_table}.longitude),
            bedrooms      = COALESCE(excluded.bedrooms,      {latest_table}.bedrooms),
            property_type = COALESCE(excluded.property_type, {latest_table}.property_type),
            url           = excluded.url,
            last_seen     = excluded.last_seen,
            price_changed = CASE
                              WHEN {latest_table}.{price_col} IS DISTINCT FROM excluded.{price_col}
                              THEN excluded.last_seen
                              ELSE {latest_table}.price_changed
                            END
    """, [execution_timestamp])

    summary = conn.execute(f"""
        SELECT
            COUNT(*)                                          AS total,
            COUNT(*) FILTER (WHERE first_seen = ?)           AS new_listings,
            COUNT(*) FILTER (WHERE price_changed = ?
                               AND first_seen != ?)          AS price_changes
        FROM {latest_table}
        WHERE last_seen = ?
    """, [execution_timestamp, execution_timestamp, execution_timestamp, execution_timestamp]).fetchone()

    return {
        "total":         summary[0],
        "new_listings":  summary[1],
        "price_changes": summary[2],
    }


def get_bazaraki_needing_details(
    conn: duckdb.DuckDBPyConnection,
    listing_type: str,
    limit: int | None = 500,
) -> list[tuple[int, str]]:
    """
    Return (listing_id, url) pairs where detail enrichment hasn't run yet.
    listing_type: 'sale' or 'rental'
    """
    table = "bazaraki_sale_latest" if listing_type == "sale" else "bazaraki_rental_latest"
    sql = f"""
        SELECT listing_id, url FROM {table}
        WHERE details_fetched_at IS NULL AND url IS NOT NULL
          AND last_seen = (SELECT MAX(last_seen) FROM {table})
        ORDER BY listing_id
    """
    rows = conn.execute(sql + (" LIMIT ?" if limit is not None else ""),
                        [limit] if limit is not None else []).fetchall()
    return [(r[0], r[1]) for r in rows]


def write_bazaraki_details(
    conn: duckdb.DuckDBPyConnection,
    details_list: list[dict],
    listing_type: str,
    fetched_at,
) -> int:
    """
    Update detail columns in bazaraki_sale_latest or bazaraki_rental_latest.
    Returns number of rows updated.
    """
    if not details_list:
        return 0
    table = "bazaraki_sale_latest" if listing_type == "sale" else "bazaraki_rental_latest"
    for d in details_list:
        if d.get("expired"):
            conn.execute(f"""
                UPDATE {table} SET
                    expired_at         = COALESCE(expired_at, ?),
                    details_fetched_at = ?
                WHERE listing_id = ?
            """, [fetched_at, fetched_at, int(d["listing_id"])])
        else:
            conn.execute(f"""
                UPDATE {table} SET
                    size_m2            = ?,
                    floor              = ?,
                    parking            = ?,
                    condition          = ?,
                    furnishing         = ?,
                    included           = ?,
                    air_conditioning   = ?,
                    construction_year  = ?,
                    energy_efficiency  = ?,
                    bathrooms          = ?,
                    postal_code        = ?,
                    description        = ?,
                    expired_at         = NULL,
                    details_fetched_at = ?
                WHERE listing_id = ?
            """, [
                d.get("size_m2"),
                d.get("floor"),
                d.get("parking"),
                d.get("condition"),
                d.get("furnishing"),
                d.get("included"),
                d.get("air_conditioning"),
                d.get("construction_year"),
                d.get("energy_efficiency"),
                d.get("bathrooms"),
                d.get("postal_code"),
                d.get("description"),
                fetched_at,
                int(d["listing_id"]),
            ])
    return len(details_list)
