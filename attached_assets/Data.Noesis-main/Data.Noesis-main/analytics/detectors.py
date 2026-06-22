"""
Calendar date detectors for identifying non-booking blocks.

Each detector returns a dict mapping date_str → annotation dict with keys:
  flags       : list[str]
  flag_details: dict
  dead_inventory: bool   (True = exclude from both numerator and denominator)
  transition_detected: bool
"""

import statistics
from datetime import date, timedelta
from collections import defaultdict


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_date(d) -> date:
    if isinstance(d, date):
        return d
    return date.fromisoformat(str(d))


def get_blocked_ranges(rows: list[dict]) -> list[dict]:
    """
    Group consecutive available=False rows into contiguous ranges.
    rows must be sorted by calendar_date.
    Returns list of {start, end, dates, length}.
    """
    ranges = []
    current = None

    for row in rows:
        if not row["available"]:
            d = _parse_date(row["calendar_date"])
            if current is None:
                current = {"start": d, "end": d, "dates": [d], "rows": [row]}
            elif d == current["end"] + timedelta(days=1):
                current["end"] = d
                current["dates"].append(d)
                current["rows"].append(row)
            else:
                current["length"] = len(current["dates"])
                ranges.append(current)
                current = {"start": d, "end": d, "dates": [d], "rows": [row]}
        else:
            if current is not None:
                current["length"] = len(current["dates"])
                ranges.append(current)
                current = None

    if current is not None:
        current["length"] = len(current["dates"])
        ranges.append(current)

    return ranges


def get_available_gaps(rows: list[dict]) -> list[dict]:
    """
    Find contiguous runs of available=True dates that are sandwiched between
    blocked periods (not at the start/end of the calendar).
    Returns list of {start, end, dates, length, min_nights_in_gap}.
    """
    # Index rows by date for quick lookup
    by_date = {_parse_date(r["calendar_date"]): r for r in rows}
    sorted_dates = sorted(by_date.keys())
    if not sorted_dates:
        return []

    gaps = []
    current = None
    preceded_by_block = False

    for d in sorted_dates:
        row = by_date[d]
        if row["available"]:
            if current is None:
                current = {"start": d, "end": d, "dates": [d], "rows": [row],
                           "preceded_by_block": preceded_by_block}
            else:
                current["end"] = d
                current["dates"].append(d)
                current["rows"].append(row)
        else:
            if current is not None and current["preceded_by_block"]:
                # Gap is between two blocked periods — record it
                min_nights_vals = [r.get("min_nights") for r in current["rows"] if r.get("min_nights")]
                current["length"] = len(current["dates"])
                current["min_nights_in_gap"] = (
                    int(statistics.median(min_nights_vals)) if min_nights_vals else 1
                )
                gaps.append(current)
            current = None
            preceded_by_block = True

    return gaps


def get_short_blocked_runs(rows: list[dict]) -> list[dict]:
    """
    Find short contiguous runs of available=False dates that are sandwiched
    between longer blocked periods.  When such a run is shorter than
    min_nights, it cannot be a real booking — it is a host-blocked orphan gap.

    Returns list of {start, end, dates, length, min_nights_in_run,
                     prev_block_length, next_block_length}.
    """
    sorted_rows = sorted(rows, key=lambda r: _parse_date(r["calendar_date"]))
    blocked_ranges = get_blocked_ranges(sorted_rows)

    if len(blocked_ranges) < 2:
        return []

    results = []
    for i in range(1, len(blocked_ranges) - 1):
        rng = blocked_ranges[i]
        prev_rng = blocked_ranges[i - 1]
        next_rng = blocked_ranges[i + 1]

        # Only flag if the surrounding blocks are longer than this one —
        # a short block between two long bookings is the orphan pattern.
        if prev_rng["length"] > rng["length"] and next_rng["length"] > rng["length"]:
            min_nights_vals = [
                r.get("min_nights") for r in rng["rows"] if r.get("min_nights")
            ]
            min_nights = (
                int(statistics.median(min_nights_vals)) if min_nights_vals else 1
            )
            if rng["length"] < min_nights:
                results.append({
                    "start":             rng["start"],
                    "end":               rng["end"],
                    "dates":             rng["dates"],
                    "length":            rng["length"],
                    "min_nights_in_run": min_nights,
                    "prev_block_length": prev_rng["length"],
                    "next_block_length": next_rng["length"],
                })

    return results


# ---------------------------------------------------------------------------
# Owner Block Detector
# ---------------------------------------------------------------------------

def detect_owner_blocks(
    listing_rows: list[dict],
    prev_snapshot_rows: list[dict],   # rows from the previous bronze execution (may be empty)
) -> dict[str, dict]:
    """
    Score each blocked range for likelihood of being an owner block.
    Returns {date_str: {flags, flag_details, owner_block_score}}.
    """
    results: dict[str, dict] = {}
    if not listing_rows:
        return results

    sorted_rows = sorted(listing_rows, key=lambda r: _parse_date(r["calendar_date"]))
    blocked_ranges = get_blocked_ranges(sorted_rows)

    # Build prev-snapshot lookup for batch-blocking detection
    prev_available: dict[str, bool] = {
        str(r["calendar_date"]): r["available"] for r in prev_snapshot_rows
    }

    # Price lookup by date
    prices = {_parse_date(r["calendar_date"]): r.get("price_per_night") for r in sorted_rows}

    for rng in blocked_ranges:
        score = 0.0
        signals = {}

        # --- Signal 1: Block length ---
        if rng["length"] > 30:
            score += 0.35
            signals["long_block"] = rng["length"]
        elif rng["length"] > 14:
            score += 0.15

        # --- Signal 2: Price continuity around block edges ---
        def _avg_price_near(target_date: date, direction: int, window: int = 3):
            vals = []
            for i in range(1, window + 1):
                p = prices.get(target_date + timedelta(days=direction * i))
                if p is not None:
                    vals.append(float(p))
            return statistics.mean(vals) if len(vals) >= 2 else None

        price_before = _avg_price_near(rng["start"], direction=-1)
        price_after  = _avg_price_near(rng["end"],   direction=+1)
        if price_before and price_after and price_before > 0:
            relative_change = abs(price_after - price_before) / price_before
            if relative_change < 0.05:
                score += 0.25
                signals["price_stable"] = True

        # --- Signal 3: Recurring yearly pattern (disabled until 12+ months of data) ---
        # TODO: enable once silver has rows from the same calendar week one year prior.
        # signals["recurring"] = False

        # --- Signal 4: Batch blocking (many dates became unavailable in the same scrape) ---
        batch_size = sum(
            1 for d in rng["dates"]
            if prev_available.get(str(d)) is True   # was available → now blocked
        )
        if batch_size > 14:
            score += 0.20
            signals["batch_block"] = batch_size

        is_owner_block = score >= 0.50

        for d in rng["dates"]:
            results[str(d)] = {
                "flags":         ["owner_block"] if is_owner_block else [],
                "flag_details":  {"owner_block_score": round(score, 3), **signals},
            }

    return results


# ---------------------------------------------------------------------------
# Min-Stay Gap Detector
# ---------------------------------------------------------------------------

def detect_min_stay_gaps(listing_rows: list[dict]) -> dict[str, dict]:
    """
    Mark dates that fall in unbookable gaps as dead_inventory.

    Catches three patterns:
      1. available=true gaps shorter than min_nights (classic orphan gap)
      2. available=false blocks shorter than min_nights sandwiched between
         longer bookings — host blocked an orphan gap, not a real booking
      3. (handled in gold.py) API bookable=false on available dates

    Returns {date_str: {flags, flag_details, dead_inventory}}.
    """
    results: dict[str, dict] = {}
    if not listing_rows:
        return results

    sorted_rows = sorted(listing_rows, key=lambda r: _parse_date(r["calendar_date"]))

    # Pattern 1: available gaps shorter than min_nights
    gaps = get_available_gaps(sorted_rows)
    for gap in gaps:
        min_stay = gap["min_nights_in_gap"]
        if gap["length"] < min_stay:
            for d in gap["dates"]:
                results[str(d)] = {
                    "flags":         ["min_stay_gap"],
                    "flag_details":  {
                        "gap_length":         gap["length"],
                        "min_stay_required":  min_stay,
                        "effectively_blocked": True,
                    },
                    "dead_inventory": True,
                }

    # Pattern 2: short unavailable blocks that can't be real bookings
    # (block_length < min_nights, sandwiched between longer blocks)
    short_blocks = get_short_blocked_runs(sorted_rows)
    for block in short_blocks:
        for d in block["dates"]:
            d_str = str(d)
            if d_str not in results:  # don't overwrite pattern 1
                results[d_str] = {
                    "flags":         ["min_stay_gap"],
                    "flag_details":  {
                        "block_length":        block["length"],
                        "min_stay_required":   block["min_nights_in_run"],
                        "host_blocked_orphan": True,
                    },
                    "dead_inventory": True,
                }

    return results


# ---------------------------------------------------------------------------
# Stale Listing Detector
# ---------------------------------------------------------------------------

def detect_stale_listing(
    listing_rows: list[dict],
    execution_timestamps: list,     # all distinct scrape timestamps for this listing in bronze
    market_avg_price: float | None,
    market_std_price: float | None,
    min_scrapes: int = 4,
    price_zscore_threshold: float = 3.0,
) -> bool:
    """
    Returns True if the listing appears stale / inactive.
    """
    if not listing_rows:
        return False

    # Method 1: No transitions across ≥4 scrapes
    if len(execution_timestamps) >= min_scrapes:
        # A transition = any date in silver with date_changed matching one of the recent timestamps
        has_transition = any(
            r.get("date_changed") is not None and r.get("date_changed") != r.get("last_seen")
            for r in listing_rows
        )
        if not has_transition:
            # Check if calendar was completely static: all rows have the same available value
            avail_values = {r["available"] for r in listing_rows}
            if len(avail_values) == 1:
                return True  # never had any mix of available/unavailable

    # Method 2: Absurd pricing (>3σ above market)
    if market_avg_price and market_std_price and market_std_price > 0:
        prices = [float(r["price_per_night"]) for r in listing_rows if r.get("price_per_night")]
        if prices:
            avg = statistics.mean(prices)
            if (avg - market_avg_price) / market_std_price > price_zscore_threshold:
                return True

    # Method 3: All dates available across all seen data
    if all(r["available"] for r in listing_rows):
        if len(execution_timestamps) >= min_scrapes:
            return True

    return False


# ---------------------------------------------------------------------------
# Seasonal Shutdown Detector
# ---------------------------------------------------------------------------

# Cyprus off-season: November through March
_OFF_SEASON_MONTHS = {11, 12, 1, 2, 3}


def detect_seasonal_shutdown(
    listing_rows: list[dict],
    min_block_months: int = 2,
) -> dict[str, dict]:
    """
    Identify blocked ranges spanning ≥2 full calendar months with ≥70% overlap
    with the Cyprus off-season (Nov–Mar).
    Returns {date_str: {flags, flag_details}}.
    """
    results: dict[str, dict] = {}
    if not listing_rows:
        return results

    sorted_rows = sorted(listing_rows, key=lambda r: _parse_date(r["calendar_date"]))
    blocked_ranges = get_blocked_ranges(sorted_rows)

    for rng in blocked_ranges:
        # Count full calendar months covered
        months_seen: set[tuple[int, int]] = set()
        for d in rng["dates"]:
            months_seen.add((d.year, d.month))

        # A "full month" = all days of that month appear in the block
        full_months = 0
        for (yr, mo) in months_seen:
            first = date(yr, mo, 1)
            if mo == 12:
                last = date(yr + 1, 1, 1) - timedelta(days=1)
            else:
                last = date(yr, mo + 1, 1) - timedelta(days=1)
            month_dates = {first + timedelta(days=i) for i in range((last - first).days + 1)}
            if month_dates.issubset(set(rng["dates"])):
                full_months += 1

        if full_months < min_block_months:
            continue

        # Compute overlap with off-season
        off_season_count = sum(1 for d in rng["dates"] if d.month in _OFF_SEASON_MONTHS)
        overlap = off_season_count / rng["length"] if rng["length"] > 0 else 0.0

        if overlap >= 0.70:
            for d in rng["dates"]:
                results[str(d)] = {
                    "flags":        ["seasonal_shutdown"],
                    "flag_details": {
                        "months_blocked":     full_months,
                        "offseason_overlap":  round(overlap, 3),
                    },
                }

    return results
