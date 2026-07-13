/**
 * Plain-language explanations for every statistic on the dashboard,
 * shown via the 💡 Explain component. Keep the copy honest about what
 * each number is and is not (data contract, 11 Jul 2026).
 */

export interface Explainer {
  title: string;
  text: string;
}

export const EXPLAINERS = {
  listings: {
    title: "Listings",
    text: "How many short-term rentals are live on the market in your selected area right now. Delisted and stale properties are excluded.",
  },
  eff_occ: {
    title: "Occupancy",
    text: "The share of nights that are actually booked by guests. We strip out nights the owner blocked, calendar gaps and stale listings — so this reflects real demand, not just an unavailable calendar.",
  },
  on_the_books: {
    title: "On the books",
    text: "For current and future weeks, occupancy shows bookings made so far. It will keep rising as the week gets closer — read it as booking pace, not a final result.",
  },
  median_adr: {
    title: "Median nightly rate (ADR)",
    text: "The middle nightly price across listings — half charge more, half charge less. We prefer the median because a few very expensive villas would distort a simple average.",
  },
  avg_adr: {
    title: "Average nightly rate",
    text: "The simple average of nightly prices. A few luxury listings can pull this up, which is why we lead with the median.",
  },
  revpar: {
    title: "RevPAR",
    text: "Revenue per available rental: nightly rate × occupancy. It combines how much hosts charge with how often they're booked — the single best measure of how hard a market is working.",
  },
  bookings: {
    title: "Avg bookings per listing",
    text: "Total new reservations detected across the selection, divided by the average number of listings — so the figure stays comparable regardless of how large or small your selection is.",
  },
  revenue_est: {
    title: "Avg est. revenue per listing",
    text: "A modelled estimate of guest spending divided by the average listing count in the selection. It's an estimate — not reported payouts — but it normalises for selection size so you can compare areas fairly.",
  },
  wow: {
    title: "Week-over-week change",
    text: "The change between the two most recent completed weeks. Forward-looking weeks are excluded so pace doesn't get mistaken for results.",
  },
  vs_benchmark: {
    title: "Compared to district & island",
    text: "How your selection performs against its wider district and all of Cyprus, computed with the same filters — so you're always comparing like for like.",
  },
  quartiles: {
    title: "Price & occupancy spread",
    text: "The 25th, 50th and 75th percentiles across listings in your selection, as of today. A wide spread means a mixed market; a narrow one means listings perform similarly.",
  },
  current_state: {
    title: "Current snapshot",
    text: "This card shows the market as it is right now. It does not change with the week range you've picked above.",
  },
  supply_mix: {
    title: "Supply mix",
    text: "What the rental stock looks like in your selection: bedroom sizes, property types and how common key amenities are.",
  },
  superhost: {
    title: "Superhost share",
    text: "The percentage of listings run by hosts with Superhost status — a rough proxy for how professionalised the market is.",
  },
  listing_count_trend: {
    title: "Tracked listings per week",
    text: "How many listings had calendar data in each week. If this moves a lot, occupancy swings may reflect supply changes rather than demand — read them together.",
  },
  forward_rates: {
    title: "Forward rates",
    text: "Asking prices for future, still-available nights, refreshed regularly. Nights that get booked drop out of this curve, so it reflects what you could book today.",
  },
  amenity_premium: {
    title: "Amenity premium",
    text: "How listings with an amenity (pool, sea view, hot tub) price and book compared to those without it, inside your current selection. Shown only when both groups are big enough to be meaningful.",
  },
  eur_m2: {
    title: "Price per m²",
    text: "The asking price divided by interior size, for listings that report their size. The median across the selection is shown.",
  },
  observed_supply: {
    title: "Listings observed",
    text: "Properties we've seen advertised. Some sold or withdrawn listings may still be counted while our expiry detection is being finalised, so treat counts as an upper bound.",
  },
  monthly_rent: {
    title: "Monthly rent",
    text: "The advertised long-term rental price per month. The median across listings in your selection is shown.",
  },
  range_agg: {
    title: "How these numbers are calculated",
    text: "Occupancy, rates and RevPAR are averages across completed weeks. Bookings and revenue are per-listing averages so they stay comparable across selections of different sizes. If your dates are entirely in the future, they show what's booked so far instead.",
  },
  benchmark_gap: {
    title: "Gap vs the market",
    text: "Your selection's occupancy minus the benchmark's, week by week. Bars above zero mean you outperform that week; below zero means the wider market is fuller than your selection.",
  },
  best_weeks: {
    title: "Strongest & weakest weeks",
    text: "The completed weeks in your selected dates with the highest and lowest occupancy — useful for spotting event spikes and shoulder-season dips worth repricing.",
  },
  price_by_bedrooms: {
    title: "Rate by bedrooms",
    text: "The median nightly rate for each property size in your selection, as of today. Use it to sanity-check what a listing of a given size can charge here.",
  },
  sweet_spot: {
    title: "Occupancy by price band",
    text: "Listings grouped by their nightly rate, showing the median occupancy in each band. The tallest bar is the market's sweet spot — where price still converts into bookings.",
  },
  freshness: {
    title: "Data freshness",
    text: "Everything on this dashboard is tracked and refreshed from live market data. The dates show when calendars and bookings were last collected — trust starts with knowing how fresh the numbers are.",
  },
  // --- Booking pace (booking_stays / area_pace) ---
  lead_time: {
    title: "Booking lead time",
    text: "How many days before arrival guests book, weighted by nights. It's a lower bound — we detect bookings within about 2 days of them happening. For future months it only reflects bookings made so far; late bookers will pull the true figure down.",
  },
  booking_window: {
    title: "Booking window",
    text: "For recently completed stays: the share of booked nights that were already reserved a given number of days before arrival. Use it to judge whether an empty calendar N days out is normal or a warning sign.",
  },
  stay_mix: {
    title: "Stay-length mix",
    text: "The split of bookings by trip length. A growing 15+ night share signals mid-term / digital-nomad demand — which changes what pricing and minimum-stay rules work.",
  },
  mid_term: {
    title: "Mid-term demand",
    text: "The share of bookings that are 15 nights or longer — remote workers, winter stayers and relocations. These guests book differently and care more about monthly value than nightly price.",
  },
  otb_pace: {
    title: "Pickup curve",
    text: "How 'full' a stay week looks as its date approaches, from calendar unavailability. Owner-blocked nights are included, so read the slope (how fast it fills), not the level. Compare weeks at the same days-out.",
  },
  // --- Pricing behaviour (pricing_behavior / booking_stays) ---
  discounting: {
    title: "Discounting index",
    text: "Of the dates still open two weeks before arrival, the share whose price was cut by at least 10% (or 20%), plus the typical depth of those cuts. High values mean hosts here blink first — useful for judging how firm asking rates really are.",
  },
  hold_vs_cut: {
    title: "Cut vs hold conversion",
    text: "Among dates still open two weeks out, how often cut dates ended up booked versus dates whose price was held. Only dates that were still open at T-14 are counted — it says cutting late converts better, not that cutting is always optimal.",
  },
  static_pricers: {
    title: "Static pricers",
    text: "The share of listings that never changed any price across our observation window. A rough measure of how unsophisticated the competition is — static pricers leave money on the table in peak weeks.",
  },
  early_bird: {
    title: "Early-bird economics",
    text: "The median nightly price guests actually locked in, grouped by how far ahead they booked. Prices are captured at booking time (from 26 Mar 2026 onward), so this reflects real transactions, not asking rates.",
  },
  tue_fri_sample: {
    title: "How rates are sampled",
    text: "Forward prices are currently sampled for Tuesday and Friday check-ins, 2–3 dates per week. Weekend-specific premiums aren't visible yet — day-of-week rotation is on the roadmap.",
  },
  // --- Buy & Rent (sale_listings + ltr_listings enrichment) ---
  str_revenue: {
    title: "Est. Airbnb earnings",
    text: "What a typical property here could gross per year on Airbnb: comparable listings' nightly rate × how often they're actually booked × 365. A modelled estimate from real neighbours, not reported income — treat it as a starting point.",
  },
  payback_years: {
    title: "Pays for itself in…",
    text: "The asking price divided by estimated yearly earnings, before costs — how many years of gross income it takes to earn the purchase price back. Shorter is better. It's the same maths as 'gross yield', just in human terms.",
  },
  verdict: {
    title: "Airbnb it or rent it out?",
    text: "We compare what the typical property here grosses per year on Airbnb versus with a long-term tenant. Airbnb usually earns more but takes work and depends on staying booked; the tenant is hands-off. The tipping point tells you how booked you'd need to stay for Airbnb to win.",
  },
  rent_supply: {
    title: "Long-term rentals",
    text: "Properties currently advertised for long-term rent in your selection, and the median advertised monthly rent. Bedrooms and property-type filters apply here too.",
  },
  sale_scope: {
    title: "How area matching works",
    text: "For-sale and rental listings aren't tagged to named areas yet, so a searched area is matched by distance from its centre (its search radius). Drawn areas are matched exactly. Bedrooms and property-type filters apply; Airbnb-only filters (amenities, superhost…) don't exist for these listings.",
  },
  dom: {
    title: "Days on market",
    text: "How long a listing has been advertised. We started tracking in mid-April 2026, so listings marked ≥ were already live before then and have been on the market at least that long.",
  },
  price_cuts: {
    title: "Price cuts",
    text: "Listings where we observed the asking price drop, with the total change since first seen. Sellers who have already cut once are statistically more open to offers.",
  },
  screener: {
    title: "Deal screener",
    text: "Active listings ranked by how fast their estimated Airbnb earnings pay back the asking price, kept honest: only listings with at least 5 comparable rentals and plausible numbers are shown. Always verify condition, title and licence status before acting on an estimate.",
  },
  // --- Revenue calculator ---
  rev_calc: {
    title: "Revenue calculator",
    text: "Everything is a slider: nightly rate, occupancy and costs start at your selected area's real numbers — drag to test your own scenario. Results are pre-tax, first-year estimates.",
  },
  occ_needed: {
    title: "Nights needed to break even",
    text: "The share of nights that must be booked before revenue covers your running costs (and mortgage, if enabled). If this is well below the area's actual occupancy, the numbers have room to breathe.",
  },
  buy_costs: {
    title: "What it costs to buy here",
    text: "Median asking price by bedroom count inside your searched or drawn area. Tap one to load it into the calculator. Breakdown by year of construction is coming soon — that attribute isn't in our synced data yet.",
  },
  mortgage: {
    title: "Mortgage",
    text: "Optional financing: down payment, interest rate and term produce a yearly loan payment that's subtracted from profit. Cash-in includes the down payment plus ~5% purchase costs.",
  },
  // --- Area health / supply ---
  composite_score: {
    title: "Area score",
    text: "A 0–100 blend of occupancy (40%), RevPAR (30%), booking growth (15%) and new-listing absorption (15%), scaled across districts. The weights are our v1 judgement call — the underlying columns are all shown so you can disagree.",
  },
  ramp_up: {
    title: "New-listing ramp-up",
    text: "Average occupancy of newly launched listings by weeks since they first appeared. Shows how long it typically takes a new property to find its footing in this market.",
  },
  absorption: {
    title: "Absorption",
    text: "Of listings that launched in the last 90 days, the share that has already taken at least one confident booking. High absorption means demand is soaking up new supply.",
  },
  churn: {
    title: "Supply churn",
    text: "Listings added versus delisted each month. Net growth with strong occupancy is a healthy market; net growth with falling occupancy means supply is outrunning demand.",
  },
} as const satisfies Record<string, Explainer>;

export type ExplainerId = keyof typeof EXPLAINERS;
