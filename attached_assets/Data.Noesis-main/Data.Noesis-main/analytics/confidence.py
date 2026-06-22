"""
Confidence scoring for individual calendar dates and metric aggregation.
"""

import statistics


def compute_booking_confidence(
    available: bool,
    flags: list[str],
    flag_details: dict,
) -> float:
    """
    Returns a booking_confidence score in [0.0, 1.0] for a single calendar date.

    Scoring is driven by the length of the consecutive-unavailable run the date
    belongs to (`run_length` in flag_details), plus signal modifiers.

    Priority order:
      P1. Hard zeros — flags that definitively rule out a booking
      P2. Long-run heuristics (run_length ≥ 28) — calendar-edge / host-block territory
      P3. Length-based prior for normal-range runs
      P4. Boosts (transition_detected) and penalties (owner_block)
    """
    # Treat both True (available for booking) and None (unknown) as "not a booking".
    # NULL availability happens on stale gold rows where the denormalized join from
    # availability_latest returned nothing — we can't claim it's a booking.
    if available is None or available:
        return 0.0

    # ── P1: hard zeros ──────────────────────────────────────
    if "seasonal_shutdown" in flags or "min_stay_gap" in flags or "stale_listing" in flags:
        return 0.0

    run_length      = flag_details.get("run_length")
    ends_at_horizon = bool(flag_details.get("run_ends_at_horizon"))
    observed_flip   = bool(flag_details.get("transition_detected"))
    owner_score     = flag_details.get("owner_block_score", 0.0) if "owner_block" in flags else 0.0

    # ── P2: long-run heuristics ─────────────────────────────
    # Runs of 28+ consecutive unavailable nights are dominated by host blocks,
    # LTRs, and calendar-edge artifacts — not guest bookings.
    if run_length is not None and run_length >= 28:
        if not observed_flip:
            base = 0.05 if ends_at_horizon else 0.15
        else:
            # We caught the flip on a long run — could be a real LTR booking
            # through Airbnb. Cyprus has these.
            base = 0.75
        return max(0.0, min(1.0, base - owner_score * 0.8))

    # ── P3: length-based prior ──────────────────────────────
    if run_length is None:
        # Fallback — unavailable date with no run computed (shouldn't normally happen).
        confidence = 0.85
    elif 4 <= run_length <= 14:
        confidence = 0.95   # classic STR booking window
    elif 15 <= run_length <= 27:
        confidence = 0.80   # extended stay — slight discount
    else:  # 1, 2, or 3 — short / single-night booking (min_stay_gap already filtered)
        confidence = 0.85

    # ── P4: modifiers ───────────────────────────────────────
    if observed_flip:
        confidence = min(1.0, confidence + 0.05)

    confidence -= owner_score * 0.8

    return max(0.0, min(1.0, confidence))


def adjusted_occupancy(date_rows: list[dict]) -> dict:
    """
    Compute adjusted occupancy metrics from a list of annotated date rows.

    Each row must have: available, booking_confidence, dead_inventory.

    Returns:
        occupancy_pct        : raw occupancy (unavailable / total) * 100
        occupancy_adjusted   : confidence-weighted occupancy * 100
        confidence_std       : std dev of confidence scores for unavailable dates (scaled ×100)
        dead_inventory_count : number of dead-inventory dates excluded from denominator
    """
    if not date_rows:
        return {
            "occupancy_pct":        None,
            "occupancy_adjusted":   None,
            "confidence_std":       None,
            "dead_inventory_count": 0,
        }

    total = len(date_rows)
    dead  = sum(1 for r in date_rows if r.get("dead_inventory"))
    effective_total = total - dead

    raw_unavail = sum(1 for r in date_rows if not r["available"])
    raw_occ = round(raw_unavail * 100.0 / total, 1) if total > 0 else None

    if effective_total <= 0:
        return {
            "occupancy_pct":        raw_occ,
            "occupancy_adjusted":   None,
            "confidence_std":       None,
            "dead_inventory_count": dead,
        }

    conf_sum = sum(r.get("booking_confidence", 0.0) for r in date_rows if not r["available"])
    adj_occ = round(conf_sum * 100.0 / effective_total, 1)

    conf_vals = [r.get("booking_confidence", 0.0) for r in date_rows if not r["available"]]
    conf_std = round(statistics.stdev(conf_vals) * 100, 1) if len(conf_vals) >= 2 else 0.0

    return {
        "occupancy_pct":        raw_occ,
        "occupancy_adjusted":   adj_occ,
        "confidence_std":       conf_std,
        "dead_inventory_count": dead,
    }
