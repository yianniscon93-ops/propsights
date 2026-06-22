"""
FastAPI backend for the STR Insights dashboard.

Run with:
    uvicorn api.main:app --reload --port 8000
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .db import get_conn

app = FastAPI(title="STR Insights API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_dates() -> tuple[str, str]:
    today = date.today()
    return (today - timedelta(days=90)).isoformat(), today.isoformat()


def _parse_list(s: Optional[str]) -> list[str]:
    """Parse comma-separated filter string into list. Empty string → []."""
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def _build_listing_filter(
    areas: list[str],
    bedrooms: list[str],
    property_types: list[str],
) -> tuple[str, list]:
    """
    Build SQL WHERE fragments and params for listings-level filters.
    Returns (clause_str, params_list).
    Clause is empty string if no filters active.
    """
    clauses: list[str] = []
    params: list = []

    if areas:
        placeholders = ", ".join(["?"] * len(areas))
        clauses.append(f"l.area IN ({placeholders})")
        params.extend(areas)

    if bedrooms:
        bed_clauses = []
        for b in bedrooms:
            if b == "4+":
                bed_clauses.append("l.bedrooms >= 4")
            elif b == "studio":
                bed_clauses.append("(l.bedrooms = 0 OR l.bedrooms IS NULL)")
            else:
                try:
                    bed_clauses.append(f"l.bedrooms = {int(b)}")
                except ValueError:
                    pass
        if bed_clauses:
            clauses.append(f"({' OR '.join(bed_clauses)})")

    if property_types:
        placeholders = ", ".join(["?"] * len(property_types))
        clauses.append(f"l.room_type IN ({placeholders})")
        params.extend(property_types)

    return (" AND " + " AND ".join(clauses)) if clauses else "", params


# ---------------------------------------------------------------------------
# Adjusted occupancy SQL fragment (reused across endpoints)
# ---------------------------------------------------------------------------
# adj_occ = SUM(booking_confidence) / (total_days - dead_inventory_days) * 100
# Returns NULL for windows where gold has no coverage (all booking_confidence IS NULL)

_ADJ_OCC_SQL = """
    CASE
        WHEN SUM(CASE WHEN g.booking_confidence IS NOT NULL THEN 1 ELSE 0 END) = 0
        THEN NULL
        ELSE ROUND(
            SUM(CASE WHEN g.booking_confidence IS NOT NULL THEN g.booking_confidence ELSE 0 END) * 100.0
            / NULLIF(
                SUM(CASE WHEN g.booking_confidence IS NOT NULL THEN 1 ELSE 0 END)
                - SUM(CASE WHEN g.booking_confidence IS NOT NULL AND COALESCE(g.dead_inventory, false) = true THEN 1 ELSE 0 END),
                0
            ),
            1
        )
    END
"""

_RAW_OCC_SQL = """
    ROUND(
        SUM(CASE WHEN al.available = false THEN 1.0 ELSE 0.0 END) * 100.0
        / NULLIF(COUNT(*), 0),
        1
    )
"""


# ---------------------------------------------------------------------------
# /api/meta  — data range available in the DB
# ---------------------------------------------------------------------------

@app.get("/api/meta")
def meta():
    conn = get_conn()
    row = conn.execute("""
        SELECT
            MIN(calendar_date)::VARCHAR AS date_min,
            MAX(calendar_date)::VARCHAR AS date_max
        FROM availability_latest
    """).fetchone()
    return {"date_min": row[0], "date_max": row[1]}


# ---------------------------------------------------------------------------
# /api/summary
# ---------------------------------------------------------------------------

@app.get("/api/summary")
def summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    areas: Optional[str] = None,
    bedrooms: Optional[str] = None,
    property_types: Optional[str] = None,
):
    """
    Top-level stats + per-area breakdown.
    All metrics computed over the requested date window (default: last 90 days).
    Includes both raw and adjusted occupancy.
    """
    df, dt = _default_dates()
    date_from = date_from or df
    date_to = date_to or dt

    area_list = _parse_list(areas)
    bed_list = _parse_list(bedrooms)
    pt_list = _parse_list(property_types)
    listing_filter, filter_params = _build_listing_filter(area_list, bed_list, pt_list)

    try:
        conn = get_conn()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DB unavailable: {e}")

    # Per-area: raw + adjusted occupancy + avg price
    rows = conn.execute(f"""
        SELECT
            l.area,
            COUNT(DISTINCT l.listing_id)                                     AS listing_count,
            {_RAW_OCC_SQL}                                                   AS raw_occ,
            {_ADJ_OCC_SQL}                                                   AS adj_occ,
            ROUND(AVG(NULLIF(al.price_per_night, 0)), 0)                     AS avg_price
        FROM availability_latest al
        JOIN listings l ON al.listing_id = l.listing_id
        LEFT JOIN gold g ON al.listing_id = g.listing_id
                         AND al.calendar_date = g.calendar_date
        WHERE al.calendar_date BETWEEN ? AND ?
          AND l.area IS NOT NULL AND l.area != ''
          {listing_filter}
        GROUP BY l.area
        ORDER BY listing_count DESC
    """, [date_from, date_to] + filter_params).fetchall()

    by_area = []
    total_listings = 0
    raw_occ_wsum = adj_occ_wsum = price_wsum = 0.0
    raw_occ_wcount = adj_occ_wcount = price_wcount = 0

    for area, listing_count, raw_occ, adj_occ, avg_price in rows:
        by_area.append({
            "area":          area,
            "listing_count": listing_count,
            "raw_occ":       raw_occ,
            "adj_occ":       adj_occ,
            "avg_price":     avg_price,
            # backwards compat alias
            "occupancy_pct": adj_occ if adj_occ is not None else raw_occ,
        })
        total_listings += listing_count
        if raw_occ is not None:
            raw_occ_wsum += raw_occ * listing_count
            raw_occ_wcount += listing_count
        if adj_occ is not None:
            adj_occ_wsum += adj_occ * listing_count
            adj_occ_wcount += listing_count
        if avg_price is not None:
            price_wsum += avg_price * listing_count
            price_wcount += listing_count

    # Pricing silver override (more reliable prices)
    pricing_exists = conn.execute("""
        SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'pricing_silver'
    """).fetchone()[0] > 0

    if pricing_exists:
        price_rows = conn.execute(f"""
            SELECT l.area, ROUND(AVG(ps.price_per_night), 0) AS avg_price
            FROM pricing_silver ps
            JOIN listings l ON ps.listing_id = l.listing_id
            WHERE ps.calendar_date BETWEEN ? AND ?
              AND l.area IS NOT NULL AND l.area != ''
              {listing_filter}
            GROUP BY l.area
        """, [date_from, date_to] + filter_params).fetchall()

        price_map = {r[0]: r[1] for r in price_rows}
        if price_map:
            price_wsum = price_wcount = 0
            for row in by_area:
                p = price_map.get(row["area"])
                if p is not None:
                    row["avg_price"] = p
                    price_wsum += p * row["listing_count"]
                    price_wcount += row["listing_count"]

    last_updated = conn.execute(
        "SELECT MAX(last_seen) FROM availability_latest"
    ).fetchone()[0]

    return {
        "summary": {
            "total_listings":  total_listings,
            "avg_raw_occ":     round(raw_occ_wsum / raw_occ_wcount, 1) if raw_occ_wcount else None,
            "avg_adj_occ":     round(adj_occ_wsum / adj_occ_wcount, 1) if adj_occ_wcount else None,
            # backwards compat
            "avg_occupancy":   round(adj_occ_wsum / adj_occ_wcount, 1) if adj_occ_wcount else None,
            "avg_price":       round(price_wsum / price_wcount, 0) if price_wcount else None,
            "last_updated":    str(last_updated)[:10] if last_updated else None,
            "date_from":       date_from,
            "date_to":         date_to,
        },
        "by_area": by_area,
    }


# ---------------------------------------------------------------------------
# /api/trends
# ---------------------------------------------------------------------------

@app.get("/api/trends")
def trends(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    areas: Optional[str] = None,
    bedrooms: Optional[str] = None,
    property_types: Optional[str] = None,
):
    """
    Monthly raw + adjusted occupancy % over the requested window.
    adj_occ is NULL for months with no gold coverage (> ~60 days ago).
    """
    df, dt = _default_dates()
    # For trends, default to last 6 months
    df = (date.today() - timedelta(days=180)).isoformat()
    date_from = date_from or df
    date_to = date_to or dt

    area_list = _parse_list(areas)
    bed_list = _parse_list(bedrooms)
    pt_list = _parse_list(property_types)
    listing_filter, filter_params = _build_listing_filter(area_list, bed_list, pt_list)

    try:
        conn = get_conn()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DB unavailable: {e}")

    rows = conn.execute(f"""
        SELECT
            strftime(al.calendar_date, '%Y-%m')  AS month,
            l.area,
            {_RAW_OCC_SQL}                       AS raw_occ,
            {_ADJ_OCC_SQL}                       AS adj_occ
        FROM availability_latest al
        JOIN listings l ON al.listing_id = l.listing_id
        LEFT JOIN gold g ON al.listing_id = g.listing_id
                         AND al.calendar_date = g.calendar_date
        WHERE al.calendar_date BETWEEN ? AND ?
          AND l.area IS NOT NULL AND l.area != ''
          {listing_filter}
        GROUP BY month, l.area
        ORDER BY month, l.area
    """, [date_from, date_to] + filter_params).fetchall()

    from collections import defaultdict
    by_month: dict = defaultdict(dict)
    for month, area, raw_occ, adj_occ in rows:
        by_month[month][area] = {"raw": raw_occ, "adj": adj_occ}

    result = []
    for month in sorted(by_month.keys()):
        entry: dict = {"month": month}
        raw_vals, adj_vals = [], []
        for area, vals in by_month[month].items():
            entry[area] = vals["raw"]
            entry[f"{area}_adj"] = vals["adj"]
            if vals["raw"] is not None:
                raw_vals.append(vals["raw"])
            if vals["adj"] is not None:
                adj_vals.append(vals["adj"])

        entry["overall"] = round(sum(raw_vals) / len(raw_vals), 1) if raw_vals else None
        entry["overall_adj"] = round(sum(adj_vals) / len(adj_vals), 1) if adj_vals else None
        result.append(entry)

    return {"trends": result}


# ---------------------------------------------------------------------------
# /api/listings
# ---------------------------------------------------------------------------

@app.get("/api/listings")
def listings(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    areas: Optional[str] = None,
    bedrooms: Optional[str] = None,
    property_types: Optional[str] = None,
):
    """
    Per-listing data for the map and scatter chart.
    Returns coordinates, raw + adjusted occupancy, avg price, area, bedrooms, property_type.
    Scatter aggregates per area client-side.
    """
    df, dt = _default_dates()
    date_from = date_from or df
    date_to = date_to or dt

    area_list = _parse_list(areas)
    bed_list = _parse_list(bedrooms)
    pt_list = _parse_list(property_types)
    listing_filter, filter_params = _build_listing_filter(area_list, bed_list, pt_list)

    try:
        conn = get_conn()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DB unavailable: {e}")

    rows = conn.execute(f"""
        SELECT
            l.listing_id,
            l.name,
            l.area,
            l.latitude,
            l.longitude,
            l.property_type,
            l.room_type,
            COALESCE(l.bedrooms, 0)              AS bedrooms,
            {_RAW_OCC_SQL}                       AS raw_occ,
            {_ADJ_OCC_SQL}                       AS adj_occ,
            ROUND(AVG(NULLIF(al.price_per_night, 0)), 0) AS avg_price
        FROM availability_latest al
        JOIN listings l ON al.listing_id = l.listing_id
        LEFT JOIN gold g ON al.listing_id = g.listing_id
                         AND al.calendar_date = g.calendar_date
        WHERE al.calendar_date BETWEEN ? AND ?
          AND l.latitude IS NOT NULL
          AND l.longitude IS NOT NULL
          AND l.area IS NOT NULL AND l.area != ''
          {listing_filter}
        GROUP BY l.listing_id, l.name, l.area, l.latitude, l.longitude, l.property_type, l.room_type, l.bedrooms
    """, [date_from, date_to] + filter_params).fetchall()

    listings_out = [
        {
            "id":            str(r[0]),
            "name":          r[1],
            "area":          r[2],
            "lat":           r[3],
            "lng":           r[4],
            "property_type": r[5],
            "room_type":     r[6],
            "bedrooms":      r[7],
            "raw_occ":       r[8],
            "adj_occ":       r[9],
            "avg_price":     r[10],
        }
        for r in rows
    ]

    # Enrich with latest review data from gold
    review_rows = conn.execute(f"""
        SELECT g.listing_id,
               AVG(g.avg_rating)    AS avg_rating,
               MAX(g.review_count)  AS review_count
        FROM gold g
        WHERE g.listing_id IN ({','.join('?' for _ in listings_out)})
          AND g.avg_rating IS NOT NULL
        GROUP BY g.listing_id
    """, [int(r["id"]) for r in listings_out]).fetchall() if listings_out else []
    review_map = {str(r[0]): {"avg_rating": round(r[1], 2), "review_count": r[2]} for r in review_rows}

    for r in listings_out:
        rev = review_map.get(r["id"], {})
        r["avg_rating"]   = rev.get("avg_rating")
        r["review_count"] = rev.get("review_count")

    return {"listings": listings_out, "count": len(listings_out)}


# ---------------------------------------------------------------------------
# /api/pricing-trends
# ---------------------------------------------------------------------------

@app.get("/api/pricing-trends")
def pricing_trends(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    areas: Optional[str] = None,
    bedrooms: Optional[str] = None,
    property_types: Optional[str] = None,
):
    """
    Monthly average nightly price by area from pricing_silver.
    Returns { "trends": [{ "month": "2026-03", "Limassol": 120, ..., "overall": 108 }] }
    """
    df, dt = _default_dates()
    # Default to last 6 months for pricing trends
    df = (date.today() - timedelta(days=180)).isoformat()
    date_from = date_from or df
    date_to   = date_to   or dt

    area_list = _parse_list(areas)
    bed_list  = _parse_list(bedrooms)
    pt_list   = _parse_list(property_types)
    listing_filter, filter_params = _build_listing_filter(area_list, bed_list, pt_list)

    try:
        conn = get_conn()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DB unavailable: {e}")

    rows = conn.execute(f"""
        SELECT
            strftime(ps.calendar_date, '%Y-%m') AS month,
            l.area,
            ROUND(AVG(ps.price_per_night), 0)   AS avg_price
        FROM pricing_silver ps
        JOIN listings l ON ps.listing_id = l.listing_id
        WHERE ps.calendar_date BETWEEN ? AND ?
          AND l.area IS NOT NULL AND l.area != ''
          AND ps.price_per_night IS NOT NULL
          AND ps.price_per_night > 0
          {listing_filter}
        GROUP BY month, l.area
        ORDER BY month, l.area
    """, [date_from, date_to] + filter_params).fetchall()

    from collections import defaultdict
    by_month: dict = defaultdict(dict)
    for month, area, avg_price in rows:
        by_month[month][area] = avg_price

    result = []
    for month in sorted(by_month.keys()):
        entry: dict = {"month": month}
        prices = []
        for area, price in by_month[month].items():
            entry[area] = price
            if price is not None:
                prices.append(price)
        entry["overall"] = round(sum(prices) / len(prices), 0) if prices else None
        result.append(entry)

    return {"trends": result}
