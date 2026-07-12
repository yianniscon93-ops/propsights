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
    text: "Everything on this dashboard is tracked and refreshed daily from live market data. The date shows when data was last collected.",
  },
} as const satisfies Record<string, Explainer>;

export type ExplainerId = keyof typeof EXPLAINERS;
