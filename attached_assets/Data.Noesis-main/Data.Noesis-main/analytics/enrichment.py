"""
Static enrichment helpers for the gold layer.

Two concerns, both deterministic and date-driven:

  1. amenity_flags(amenities_json) — parse the raw Airbnb amenities JSON from
     listings.amenities into a dict of boolean flags. Matching is case-insensitive
     substring on the amenity title. Order of priority within each flag is the
     widest reasonable interpretation (e.g. "Sea view" matches "Ocean view" too).

  2. calendar_context(d) — return season / day_of_week / is_weekend / is_holiday /
     holiday_name for a calendar date. Cyprus-specific tourism calendar and the
     Republic of Cyprus public holidays (Greek Cypriot side only).
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from functools import lru_cache
from typing import Iterable

from dateutil.easter import easter, EASTER_ORTHODOX


# ── Amenity flag definitions ──────────────────────────────────────────────────
# Each flag is matched against an amenity title using lowercase substring search.
# A flag is True if ANY of its patterns match ANY available amenity on the listing.
# Patterns are intentionally broad — Airbnb varies wording across regions / listings.
_AMENITY_FLAG_RULES: dict[str, tuple[str, ...]] = {
    # Pool / spa / wellness water
    "has_pool":               ("pool",),
    "has_hot_tub":            ("hot tub", "jacuzzi", "sauna"),
    # Views — each view kind is its own flag; sea & ocean collapsed
    "has_sea_view":           ("sea view", "ocean view"),
    "has_mountain_view":      ("mountain view",),
    "has_beach_view":         ("beach view",),
    "has_city_view":          ("city skyline view", "city view"),
    "has_garden_view":        ("garden view",),
    # Outdoor space (note: "private patio or balcony" matches via "patio or balcony")
    "has_patio_or_balcony":   ("patio or balcony",),
    "has_backyard":           ("backyard",),
    # "garden" is broad — guard so "garden view" doesn't trigger it.
    # We special-case this in apply_amenity_flags below.
    "has_garden":             ("garden",),
    "has_bbq":                ("bbq grill", "bbq", "barbecue"),
    "has_outdoor_furniture":  ("outdoor furniture",),
    # Beach access (distinct from beach view — implies physical access)
    "has_beach_access":       ("beach access", "beachfront", "waterfront"),
    # Family-friendly
    "has_crib":               ("crib",),
    "has_high_chair":         ("high chair",),
    "has_pack_n_play":        ("pack 'n play", "pack n play", "pack-n-play", "travel crib"),
    "has_kids_toys":          ("children's books and toys", "kids' books", "children's toys"),
    # Pets
    "is_pet_friendly":        ("pets allowed",),
    # Work
    "has_workspace":          ("dedicated workspace",),
    "has_fast_wifi":          ("fast wifi",),
    # Vehicle
    "has_ev_charger":         ("ev charger",),
    "has_free_parking":       ("free parking on premises",),
    # Wellness
    "has_gym":                ("gym",),
    "has_exercise_equipment": ("exercise equipment",),
    # Booking constraints
    "long_term_stays_allowed":("long term stays allowed",),
}

AMENITY_FLAG_NAMES: tuple[str, ...] = tuple(_AMENITY_FLAG_RULES.keys())


def parse_amenities(amenities_json: str | None) -> list[str]:
    """Parse the listings.amenities VARCHAR(JSON) into a list of available titles."""
    if not amenities_json:
        return []
    try:
        items = json.loads(amenities_json)
    except (ValueError, TypeError):
        return []
    out: list[str] = []
    for it in items:
        if isinstance(it, dict) and it.get("available"):
            title = it.get("title")
            if isinstance(title, str):
                out.append(title)
    return out


def amenity_flags(amenities_json: str | None) -> dict[str, bool]:
    """Compute the full set of amenity flag booleans for a listing.

    All flags in AMENITY_FLAG_NAMES are present in the result (False if no match),
    so the caller can index by column name without KeyError handling.
    """
    titles = [t.lower() for t in parse_amenities(amenities_json)]
    flags: dict[str, bool] = {name: False for name in AMENITY_FLAG_NAMES}
    if not titles:
        return flags

    for flag, patterns in _AMENITY_FLAG_RULES.items():
        for title in titles:
            # Special case: has_garden must not trigger on "garden view"
            if flag == "has_garden" and "garden view" in title:
                continue
            if any(p in title for p in patterns):
                flags[flag] = True
                break
    return flags


# ── Calendar context — Cyprus tourism season + Republic of Cyprus holidays ────

# Cyprus STR demand bucketing — observed seasonality (June–Sep dominant)
_PEAK_MONTHS     = {6, 7, 8, 9}
_SHOULDER_MONTHS = {4, 5, 10}
# Everything else: November–March = off-season

# Fixed-date Republic of Cyprus public holidays (Greek Cypriot side).
# Stored as (month, day) → name. Movable feasts handled separately via Orthodox Easter.
_FIXED_HOLIDAYS: dict[tuple[int, int], str] = {
    (1,  1): "New Year's Day",
    (1,  6): "Epiphany",
    (3, 25): "Greek Independence Day",
    (4,  1): "Cyprus National Day",
    (5,  1): "Labour Day",
    (8, 15): "Assumption of the Theotokos",
    (10, 1): "Cyprus Independence Day",
    (10,28): "Ohi Day",
    (12,24): "Christmas Eve",
    (12,25): "Christmas Day",
    (12,26): "Boxing Day",
    (12,31): "New Year's Eve",
}


@lru_cache(maxsize=32)
def _movable_holidays_for_year(year: int) -> dict[date, str]:
    """Orthodox-Easter-derived holidays for a given year."""
    easter_sun = easter(year, EASTER_ORTHODOX)
    return {
        easter_sun - timedelta(days=48): "Green Monday",
        easter_sun - timedelta(days=2):  "Good Friday",
        easter_sun:                      "Easter Sunday",
        easter_sun + timedelta(days=1):  "Easter Monday",
        easter_sun + timedelta(days=50): "Holy Spirit Monday",
    }


def season(d: date) -> str:
    """peak / shoulder / off — Cyprus tourism calendar."""
    if d.month in _PEAK_MONTHS:
        return "peak"
    if d.month in _SHOULDER_MONTHS:
        return "shoulder"
    return "off"


def holiday_lookup(d: date) -> str | None:
    """Returns the holiday name if d is a Cyprus public holiday, else None."""
    fixed = _FIXED_HOLIDAYS.get((d.month, d.day))
    if fixed:
        return fixed
    return _movable_holidays_for_year(d.year).get(d)


def calendar_context(d: date) -> dict:
    """Per-date calendar fields. dow is 0-indexed (Mon=0..Sun=6)."""
    name = holiday_lookup(d)
    return {
        "day_of_week":  d.weekday(),
        "is_weekend":   d.weekday() >= 5,
        "season":       season(d),
        "is_holiday":   name is not None,
        "holiday_name": name,
    }


# ── Booking dynamics — group consecutive booked dates into stays ──────────────

def compute_booking_blocks(
    bookings_for_listing: Iterable[tuple],  # iter of (calendar_date, booked_at)
    listing_id: int,
) -> dict[date, dict]:
    """Group a listing's booked dates into contiguous stays.

    Input: iterable of (calendar_date, booked_at) tuples for ONE listing.
    Output: {calendar_date: {booking_id, stay_length_nights, stay_position,
                             booking_lead_time_days}}

    A "stay" is a run of consecutive calendar_dates (gap = 1 day). The same
    booked_at across a run is the strongest signal that the run is a single
    booking, but adjacent dates with different booked_at values are still
    treated as one stay — guests can extend bookings, and the bookings table
    only records first-detection time, not the actual reservation event.

    booking_id is synthetic: f"{listing_id}_{first_date_iso}".
    booking_lead_time_days = calendar_date − booked_at.date(). May be negative
    if a date was booked retroactively (detection lag at scrape boundaries).
    """
    rows = sorted(bookings_for_listing, key=lambda r: r[0])
    out: dict[date, dict] = {}

    i = 0
    while i < len(rows):
        # Find the end of this contiguous run
        run_start_idx = i
        while (
            i + 1 < len(rows)
            and (rows[i + 1][0] - rows[i][0]).days == 1
        ):
            i += 1
        run = rows[run_start_idx : i + 1]
        first_date = run[0][0]
        stay_length = len(run)
        booking_id = f"{listing_id}_{first_date.isoformat()}"

        for pos, (cal_date, booked_at) in enumerate(run, start=1):
            lead = (cal_date - booked_at.date()).days if booked_at else None
            out[cal_date] = {
                "booking_id":             booking_id,
                "booking_detected_at":    booked_at,
                "stay_length_nights":     stay_length,
                "stay_position":          pos,
                "booking_lead_time_days": lead,
            }
        i += 1

    return out
