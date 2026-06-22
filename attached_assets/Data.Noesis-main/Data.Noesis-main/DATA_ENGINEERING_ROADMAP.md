# Data Engineering Roadmap

Pipeline-side roadmap for the bronze/silver/gold layers and downstream analytics tables.
Distinct from `ROADMAP.md` (which tracks product, infra, and go-to-market work).

---

## 1. Gold layer — booking dynamics, calendar context, denormalized attributes ✓

Extend `gold` with three groups of analytics-ready columns so dashboard and downstream
queries can slice by stay length, lead time, weekend/season, amenities, and superhost
without re-joining or re-windowing.

- **Booking dynamics** (from `bookings` + windowing): `booking_lead_time_days`,
  `stay_length_nights`, `stay_position`, `booking_id`
- **Calendar context** (deterministic per date): `day_of_week`, `is_weekend`,
  `season` (peak/shoulder/off), `is_holiday`, `holiday_name`
- **Denormalized listing attributes** (from `listings`, refreshed each gold run):
  `property_type`, `bedrooms`, `beds`, `size_sqm`, `is_superhost`, `is_guest_fav`,
  `proximity_beach_min`, `proximity_center_min`, plus parsed amenity flags
  (`has_pool`, `has_seaview`, `has_aircon`, `has_parking`, `is_pet_friendly`)

See `DATA_MODEL.md` `gold` table for the full column reference.

---

## 2. Revenue model — beyond `price × occupancy`

**Status:** planned. **Trigger:** after pricing has 4+ weeks of history per listing.

The naive estimate is `revenue ≈ price_per_night × booking_confidence` summed over
dates. This is wrong in three ways for us, given the pricing layer we now have:

### Why naive `price × confidence` is wrong

1. **Booked-at price ≠ current price.** Once a date is booked, Airbnb stops updating
   its displayed price. The last *unbooked* price we captured in `pricing_silver`
   (or `pricing_bronze`) is the closest proxy to the actual nightly rate the guest paid.
   We need to look back in `pricing_bronze` to find the price as of the snapshot
   *immediately before* the date flipped to unavailable.
2. **Lead-time pricing.** Hosts often raise/drop prices as check-in approaches.
   The realised revenue for a date booked 60 days out is the price *at the booking
   detection date*, not the price now or at check-in.
3. **Cleaning fees, length-of-stay discounts, taxes.** The displayed nightly rate
   on a 3-night window differs from a 7-night window. Pricing snapshots are taken
   in fixed window sizes; revenue per night depends on the actual stay length
   (now available as `stay_length_nights` in gold).

### Proposed approach

Build `pricing_gold` (already stubbed in `DATA_MODEL.md`) as the input layer, then
derive `revenue_per_date` in `gold` from it:

```
realised_price_per_night(listing, date) =
    pricing_bronze snapshot for `date`
    taken at the execution_timestamp closest to (and ≤) booked_at
    falling back to pricing_silver.price_per_night when no historical match exists

revenue_estimate(listing, date) =
    realised_price_per_night × booking_confidence
    × stay_length_multiplier(stay_length_nights)   -- discount/premium adjustment
```

Three things to model later:

- **`stay_length_multiplier`** — empirically estimated from pricing windows of
  different lengths once we have enough data. Captures weekly/monthly discounts.
- **Cleaning fee allocation** — amortise over `stay_length_nights` so revenue per
  date includes a share of the one-off fee. Requires pulling cleaning fee from
  listing detail enrichment.
- **Tax & platform fee adjustment** — gross vs net revenue. Cyprus VAT on STR +
  Airbnb host fee (~3%) = ~12% deduction baseline.

### Dependencies

- 4+ weeks of `pricing_bronze` history so the temporal join has signal
- Cleaning fee field in `listings` (requires enrichment work in `run_enrichment.py`)
- Decision on gross vs net (we'll likely store both)

### Output columns (in `gold`, populated later)

- `realised_price_per_night` DOUBLE — historical price at time of booking
- `revenue_estimate_gross` DOUBLE — `realised_price × confidence × stay_length_adj`
- `revenue_estimate_net` DOUBLE — after VAT + platform fees

Until this is built, the dashboard can sum `price_per_night × booking_confidence`
from `gold` as a crude proxy — but flag the limitation.

---

## 3. Pricing gold 🚧

Already scoped in `DATA_MODEL.md`. Implements per-(listing, date) price history
analytics — `price_first_seen`, `price_changes`, `days_to_checkin`,
`last_changed_at`. Prerequisite for the revenue model in (2).

---

## 4. Listing-level rollups (planned)

A `listing_stats` table — one row per listing, refreshed daily — holding
pre-aggregated metrics that the dashboard currently recomputes on every request:

- 30/90/365-day occupancy (raw + effective)
- 30-day avg nightly price, percentile rank within area
- Total revenue estimate (rolling)
- Booking velocity (nights booked in last 30 days)
- Avg lead time, avg stay length

Pure performance play — no new signal, just denormalisation. Build when dashboard
latency becomes a complaint.

---

## 5. Area-level rollups (planned)

Same idea, one row per (area, bedrooms, property_type) per month. Powers the
area comparison views without scanning gold every time.
