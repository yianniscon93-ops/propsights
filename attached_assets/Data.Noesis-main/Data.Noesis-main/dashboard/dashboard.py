"""
Generates dashboard.html from the DuckDB database.
Usage:
    python3.13 dashboard.py [db_path]   (default: bnb.duckdb)
"""

import json
import sys
import duckdb
from datetime import datetime


DB_PATH  = "bnb.duckdb"
OUT_PATH = "dashboard.html"

AREA_COLOURS = {
    "agioi_omologites": "#4e79a7",
    "agios_antonios":   "#22d3ee",
    "aglantzia":        "#e15759",
    "akropoli":         "#59a14f",
    "nicosia_downtown": "#b07aa1",
    "paphos_other":     "#0ea5e9",
    "droushia_other":   "#8b5cf6",
}
DEFAULT_COLOUR = "#38bdf8"


def load_data(conn: duckdb.DuckDBPyConnection) -> dict:

    _gold_exists = conn.execute(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'gold'"
    ).fetchone()[0] > 0

    if _gold_exists:
        listing_monthly = conn.execute("""
            SELECT
                s.listing_id,
                l.name,
                s.area,
                l.city,
                strftime(s.calendar_date, '%Y-%m')                                                                  AS month,
                ROUND(COUNT(*) FILTER (WHERE s.available = false) * 100.0 / COUNT(*), 1)                           AS occupancy_pct,
                ROUND(
                    SUM(CASE WHEN s.available = false THEN COALESCE(g.booking_confidence, 0.85) ELSE 0 END)
                    / NULLIF(COUNT(*) - COUNT(*) FILTER (WHERE g.dead_inventory = true), 0)
                    * 100, 1
                )                                                                                                   AS occupancy_adjusted,
                ROUND(STDDEV(CASE WHEN s.available = false THEN COALESCE(g.booking_confidence, 0.85) END) * 100, 1) AS confidence_std,
                ROUND(AVG(s.price_per_night), 2)                                                                    AS avg_price
            FROM availability_latest s
            LEFT JOIN listings l ON s.listing_id = l.listing_id
            LEFT JOIN gold g ON g.listing_id = s.listing_id AND g.calendar_date = s.calendar_date
            WHERE s.calendar_date >= current_date - INTERVAL 12 MONTHS
            GROUP BY s.listing_id, l.name, s.area, l.city, month
            ORDER BY s.listing_id, month
        """).fetchdf().to_dict(orient="records")
    else:
        listing_monthly = conn.execute("""
            SELECT
                s.listing_id,
                l.name,
                s.area,
                l.city,
                strftime(s.calendar_date, '%Y-%m')                                          AS month,
                ROUND(COUNT(*) FILTER (WHERE s.available = false) * 100.0 / COUNT(*), 1)   AS occupancy_pct,
                NULL                                                                        AS occupancy_adjusted,
                NULL                                                                        AS confidence_std,
                ROUND(AVG(s.price_per_night), 2)                                            AS avg_price
            FROM availability_latest s
            LEFT JOIN listings l ON s.listing_id = l.listing_id
            WHERE s.calendar_date >= current_date - INTERVAL 12 MONTHS
            GROUP BY s.listing_id, l.name, s.area, l.city, month
            ORDER BY s.listing_id, month
        """).fetchdf().to_dict(orient="records")

    listings_meta = conn.execute("""
        SELECT
            listing_id,
            listing_id::VARCHAR AS listing_id_str,
            name,
            area,
            city,
            property_type,
            bedrooms,
            beds,
            latitude,
            longitude
        FROM listings
        ORDER BY area, listing_id
    """).fetchdf().to_dict(orient="records")
    for row in listings_meta:
        row["listing_url"] = f"https://www.airbnb.com/rooms/{row['listing_id_str']}"

    last_updated = conn.execute("SELECT MAX(last_seen)::VARCHAR FROM availability_latest").fetchone()[0] or ""

    try:
        bookings_raw = conn.execute("""
            SELECT
                listing_id,
                calendar_date::VARCHAR                          AS calendar_date,
                strftime(booked_at, '%Y-%m-%dT%H:%M:%S')       AS booked_at
            FROM bookings
            WHERE calendar_date >= current_date
            ORDER BY booked_at DESC
        """).fetchdf().to_dict(orient="records")
    except Exception:
        bookings_raw = []

    try:
        stays = conn.execute("""
            WITH ranked AS (
                SELECT listing_id, calendar_date,
                       (calendar_date - CAST(ROW_NUMBER() OVER (
                           PARTITION BY listing_id ORDER BY calendar_date
                       ) AS INTEGER)) AS grp
                FROM bookings
                WHERE calendar_date >= current_date
            ),
            grouped AS (
                SELECT listing_id, grp, COUNT(*) AS nights
                FROM ranked
                GROUP BY listing_id, grp
            )
            SELECT listing_id,
                   ROUND(AVG(nights), 1) AS avg_stay_nights,
                   COUNT(*)              AS num_stays
            FROM grouped
            GROUP BY listing_id
        """).fetchdf().to_dict(orient="records")
    except Exception:
        stays = []

    return {
        "listing_monthly":  listing_monthly,
        "listings_meta":    listings_meta,
        "last_updated":     last_updated,
        "bookings_raw":     bookings_raw,
        "stays":            stays,
    }


def generate(db_path: str = DB_PATH, out_path: str = OUT_PATH):
    conn = duckdb.connect(db_path, read_only=True)
    data = load_data(conn)
    conn.close()

    months         = sorted({r["month"] for r in data["listing_monthly"]})
    areas          = sorted({r["area"] for r in data["listings_meta"] if r["area"]})
    colours        = {a: AREA_COLOURS.get(a, DEFAULT_COLOUR) for a in areas}
    property_types = sorted({r["property_type"] for r in data["listings_meta"] if r["property_type"]})
    cities         = sorted({r["city"] for r in data["listings_meta"] if r.get("city")})

    generated_at  = datetime.now().strftime("%Y-%m-%d %H:%M")
    current_month = datetime.now().strftime("%Y-%m")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cyprus Short-Term Rental Intelligence</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#131c2b;color:#e2e8f0}}

header{{background:linear-gradient(135deg,#080e18 0%,#0d1e35 100%);color:#fff;padding:20px 36px;display:flex;justify-content:space-between;align-items:center}}
header h1{{font-size:1.15rem;font-weight:600;letter-spacing:-.01em}}
header .meta{{font-size:.75rem;opacity:.45;text-align:right;line-height:1.6}}

.filters{{background:#0c1624;padding:12px 36px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #1e3048;position:sticky;top:0;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.3)}}
.filters label{{font-size:.75rem;color:#64748b;font-weight:500}}
.filters select{{font-size:.8rem;padding:5px 10px;border:1px solid #1e3048;border-radius:6px;background:#131c2b;color:#e2e8f0;cursor:pointer}}
.filter-group{{display:flex;align-items:center;gap:7px;flex-wrap:wrap}}
.filter-divider{{width:1px;height:28px;background:#1e3048;margin:0 4px}}
.pill-group{{display:flex;gap:5px;flex-wrap:wrap}}
.pill{{font-size:.73rem;padding:4px 10px;border:1px solid #1e3048;border-radius:20px;background:#1a2638;color:#64748b;cursor:pointer;font-weight:500;user-select:none;transition:background .12s,border-color .12s,color .12s}}
.pill:hover{{border-color:#94a3b8;color:#e2e8f0}}
.pill.active{{background:#3b82f6;border-color:#3b82f6;color:#fff}}

/* KPI row */
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:24px 36px 0}}
.kpi{{background:#1a2638;border-radius:12px;padding:18px 20px 14px;box-shadow:0 2px 8px rgba(0,0,0,.3);border:1px solid #1e3048;border-left:4px solid #2563eb}}
.kpi .val{{font-size:2rem;font-weight:700;color:#e2e8f0;line-height:1}}
.kpi .lbl{{font-size:.67rem;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.06em;margin-top:6px}}
.kpi-raw{{font-size:.68rem;color:#94a3b8;margin-top:2px}}
.kpi-delta{{font-size:.68rem;margin-top:2px;font-weight:600}}
.kpi-delta.up{{color:#4ade80}}
.kpi-delta.dn{{color:#f87171}}
.zraw{{font-size:.68rem;color:#94a3b8;font-weight:400}}

/* Velocity row */
.velocity-row{{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;padding:14px 36px 0}}
.vel-card{{background:#1a2638;border-radius:10px;padding:14px 16px;border:1px solid #1e3048;box-shadow:0 1px 4px rgba(0,0,0,.2);text-align:center}}
.vel-card .vval{{font-size:1.6rem;font-weight:700;color:#e2e8f0}}
.vel-card .vlbl{{font-size:.65rem;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;margin-top:4px}}
.vel-section-label{{padding:18px 36px 0;font-size:.68rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}}

/* Zone comparison */
.zone-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;padding:24px 36px 0}}
.zone-card{{background:#1a2638;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.3);border:1px solid #1e3048;overflow:hidden}}
.zone-card-header{{padding:11px 16px;display:flex;justify-content:space-between;align-items:center;color:#fff;font-weight:600;font-size:.85rem}}
.zone-card-body{{padding:14px 16px}}
.zone-stat{{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid #1e3048}}
.zone-stat:last-child{{border-bottom:none}}
.zone-stat .zval{{font-size:1.15rem;font-weight:700;color:#e2e8f0}}
.zone-stat .zlbl{{font-size:.67rem;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em}}
.zone-vel{{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid #1e3048}}
.zone-vel-item{{text-align:center}}
.zone-vel-item .zvv{{font-size:1.1rem;font-weight:700;color:#e2e8f0}}
.zone-vel-item .zvl{{font-size:.6rem;color:#94a3b8;font-weight:500;text-transform:uppercase;margin-top:2px}}
.zone-warn{{padding:20px 16px;color:#94a3b8;font-size:.8rem;text-align:center;line-height:1.6}}
.zone-close{{background:rgba(255,255,255,.25);border:none;color:#fff;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:.9rem;line-height:1;display:flex;align-items:center;justify-content:center}}
.zone-close:hover{{background:rgba(255,255,255,.4)}}

/* Charts grid */
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:20px 36px}}
.card{{background:#1a2638;border-radius:12px;padding:22px 24px;box-shadow:0 2px 8px rgba(0,0,0,.3);border:1px solid #1e3048}}
.card.full{{grid-column:1/-1}}
.card h2{{font-size:.72rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:18px}}

/* Map controls */
.map-controls{{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}}
.map-status{{font-size:.8rem;color:#64748b;flex:1}}
.zone-legend{{display:flex;gap:10px;flex-wrap:wrap}}
.zone-badge{{display:flex;align-items:center;gap:5px;font-size:.75rem;font-weight:500;color:#64748b}}
.zone-dot{{width:10px;height:10px;border-radius:50%;flex-shrink:0}}
#clearAllBtn{{font-size:.75rem;padding:5px 14px;border:1px solid #1e3048;border-radius:6px;background:#1a2638;cursor:pointer;color:#f87171;font-weight:500;display:none}}
#clearAllBtn:hover{{background:#3f1515}}

/* Bedroom breakdown table */
table.breakdown{{width:100%;border-collapse:collapse;font-size:.82rem}}
table.breakdown th{{text-align:left;padding:9px 12px;border-bottom:2px solid #1e3048;color:#94a3b8;font-weight:500;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}}
table.breakdown td{{padding:10px 12px;border-bottom:1px solid #1e3048;color:#e2e8f0;font-variant-numeric:tabular-nums}}
table.breakdown tr:last-child td{{border-bottom:none}}
table.breakdown .num{{text-align:right;font-weight:600;color:#e2e8f0}}

.badge{{display:inline-block;padding:2px 9px;border-radius:10px;font-size:.7rem;font-weight:600}}
.badge.booked{{background:#3f1515;color:#f87171}}
.badge.free{{background:#14291a;color:#4ade80}}
.badge-realized{{background:#14291a;color:#4ade80;display:inline-block;padding:2px 9px;border-radius:10px;font-size:.7rem;font-weight:600}}
.badge-in-progress{{background:#2d2006;color:#fbbf24;display:inline-block;padding:2px 9px;border-radius:10px;font-size:.7rem;font-weight:600}}
.badge-projected{{background:#0f1f3d;color:#60a5fa;display:inline-block;padding:2px 9px;border-radius:10px;font-size:.7rem;font-weight:600}}

#tooltip{{position:fixed;background:rgba(15,23,42,.9);color:#fff;padding:6px 12px;border-radius:8px;font-size:.73rem;pointer-events:none;display:none;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.2)}}
#mapFsBtn,#colourModeBtn{{font-size:.75rem;padding:5px 12px;border:1px solid #1e3048;border-radius:6px;background:#1a2638;cursor:pointer;color:#e2e8f0;font-weight:500}}
#mapFsBtn:hover,#colourModeBtn:hover{{background:#243047}}
#map.map-fs{{position:fixed!important;top:0;left:0;width:100vw!important;height:100vh!important;z-index:9999;border-radius:0!important}}
#mapFsOverlay{{display:none;position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10001;gap:8px;align-items:center;background:rgba(10,18,32,.88);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 14px;box-shadow:0 4px 20px rgba(0,0,0,.5)}}
#mapFsOverlay.visible{{display:flex}}
#mapFsOverlay .fs-btn{{font-size:.8rem;padding:6px 14px;border:1px solid rgba(255,255,255,.15);border-radius:6px;background:transparent;cursor:pointer;color:#e2e8f0;font-weight:500;white-space:nowrap}}
#mapFsOverlay .fs-btn:hover{{background:rgba(255,255,255,.08)}}
#mapFsOverlay .fs-sep{{width:1px;height:22px;background:rgba(255,255,255,.12);margin:0 4px;flex-shrink:0}}
#mapFsOverlay #mapExitBtn{{border-color:rgba(248,113,113,.5);color:#f87171;font-weight:600}}
#mapFsOverlay #mapExitBtn:hover{{background:rgba(248,113,113,.15)}}
.marker-cluster-small{{background-color:rgba(34,211,238,.2)}}
.marker-cluster-small div{{background-color:rgba(34,211,238,.6);color:#fff;font-weight:700}}
.marker-cluster-medium{{background-color:rgba(99,102,241,.2)}}
.marker-cluster-medium div{{background-color:rgba(99,102,241,.65);color:#fff;font-weight:700}}
.marker-cluster-large{{background-color:rgba(248,113,113,.2)}}
.marker-cluster-large div{{background-color:rgba(248,113,113,.65);color:#fff;font-weight:700}}
</style>
<style>
#pwOverlay{{position:fixed;inset:0;z-index:99999;background:#0a1220;display:flex;align-items:center;justify-content:center}}
#pwBox{{background:#111827;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:40px 48px;display:flex;flex-direction:column;align-items:center;gap:20px;box-shadow:0 8px 40px rgba(0,0,0,.6)}}
#pwBox h2{{margin:0;font-size:1.2rem;color:#e2e8f0;font-weight:600;letter-spacing:.02em}}
#pwInput{{background:#1e293b;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px 16px;color:#e2e8f0;font-size:1rem;width:240px;outline:none;text-align:center}}
#pwInput:focus{{border-color:rgba(99,179,237,.5)}}
#pwBtn{{background:#3b82f6;border:none;border-radius:8px;padding:10px 32px;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer;width:100%}}
#pwBtn:hover{{background:#2563eb}}
#pwError{{color:#f87171;font-size:.85rem;min-height:1em}}
</style>
</head>
<body>
<div id="pwOverlay">
  <div id="pwBox">
    <h2>Cyprus STR Intelligence</h2>
    <input id="pwInput" type="password" placeholder="Password" autofocus/>
    <div id="pwError"></div>
    <button id="pwBtn">Enter</button>
  </div>
</div>
<script>
(function(){{
  var PW="portokalli_lagos";
  function attempt(){{
    if(document.getElementById("pwInput").value===PW){{
      document.getElementById("pwOverlay").remove();
    }} else {{
      var e=document.getElementById("pwError");
      e.textContent="Incorrect password";
      document.getElementById("pwInput").value="";
      document.getElementById("pwInput").focus();
    }}
  }}
  document.getElementById("pwBtn").addEventListener("click",attempt);
  document.getElementById("pwInput").addEventListener("keydown",function(e){{if(e.key==="Enter")attempt();}});
}})();
</script>
<div id="tooltip"></div>

<header>
  <h1>Cyprus Short-Term Rental Intelligence</h1>
  <div class="meta">Generated {generated_at}<br>Last scrape: <span id="lastUpdated"></span></div>
</header>

<div class="filters">
  <div class="filter-group"><label>From</label><select id="monthFrom"></select></div>
  <div class="filter-group"><label>To</label><select id="monthTo"></select></div>
  <div class="filter-divider"></div>
  <div class="filter-group">
    <label>Metric</label>
    <select id="metricSel">
      <option value="occupancy_pct">Occupancy %</option>
      <option value="avg_price">Avg price / night (€)</option>
    </select>
  </div>
  <div class="filter-divider"></div>
  <div class="filter-group"><label>Type</label><div class="pill-group" id="typeGroup"></div></div>
  <div class="filter-divider"></div>
  <div class="filter-group"><label>Bedrooms</label><div class="pill-group" id="bedroomsGroup"></div></div>
  <div class="filter-divider"></div>
  <div class="filter-group"><label>Region</label><select id="regionSel"><option value="">All regions</option></select></div>
</div>

<!-- KPIs / Zone comparison -->
<div id="zoneRow"></div>

<!-- Booking velocity -->
<div id="velocitySection"></div>

<!-- Charts -->
<div class="grid">

  <div class="card full">
    <h2>Market Map — Draw up to 3 zones to compare</h2>
    <div class="map-controls">
      <div class="zone-legend" id="zoneLegend"></div>
      <span class="map-status" id="mapStatus">Draw a rectangle or polygon to define a comparison zone</span>
      <button id="clearAllBtn">✕ Clear all zones</button>
      <button id="colourModeBtn">Colour: Occupancy</button>
      <button id="mapFsBtn">⛶ Fullscreen</button>
    </div>
    <div id="map" style="height:640px;border-radius:8px;z-index:1"></div>
    <div id="mapFsOverlay"></div>
  </div>

  <div class="card full">
    <h2 id="trendTitle">Occupancy % — Monthly Trend</h2>
    <canvas id="trendChart" height="70"></canvas>
  </div>

  <div class="card full">
    <h2>Seasonality — Avg Occupancy by Calendar Month</h2>
    <canvas id="seasonalityChart" height="60"></canvas>
  </div>

  <div class="card">
    <h2>Occupancy Distribution</h2>
    <canvas id="occDistChart" height="200"></canvas>
  </div>

  <div class="card">
    <h2>Price vs Occupancy</h2>
    <canvas id="scatterChart" height="200"></canvas>
  </div>

  <div class="card full">
    <h2>Nights Booked — Last 30 Days <span style="font-weight:400;color:#cbd5e1">(future dates only, detected per day)</span></h2>
    <canvas id="bookingChart" height="60"></canvas>
  </div>

  <div class="card full">
    <h2>Bedroom Breakdown <span style="font-weight:400;color:#cbd5e1" id="bedroomNote"></span></h2>
    <table class="breakdown">
      <thead>
        <tr>
          <th>Bedrooms</th>
          <th class="num">Listings</th>
          <th class="num">Avg Occupancy</th>
          <th class="num">Avg Price / Night</th>
          <th class="num">Est. Revenue / Month</th>
        </tr>
      </thead>
      <tbody id="bedroomBody"></tbody>
    </table>
  </div>

  <div class="card full">
    <h2>Monthly Breakdown <span style="font-weight:400;color:#94a3b8" id="monthlyBreakdownNote"></span></h2>
    <table class="breakdown">
      <thead>
        <tr>
          <th>Month</th>
          <th>Status</th>
          <th class="num">Listings</th>
          <th class="num">Avg Occupancy</th>
          <th class="num">MoM</th>
          <th class="num">Avg Price / Night</th>
          <th class="num">Est. Revenue / Month</th>
        </tr>
      </thead>
      <tbody id="monthlyBreakdownBody"></tbody>
    </table>
  </div>

  <div class="card full">
    <h2>Top Listings — by Adjusted Occupancy <span style="font-weight:400;color:#94a3b8" id="topNote"></span></h2>
    <table class="breakdown">
      <thead>
        <tr>
          <th>#</th>
          <th>Listing</th>
          <th>Area</th>
          <th class="num">Bedrooms</th>
          <th class="num">Avg Occupancy</th>
          <th class="num">Avg Price / Night</th>
          <th class="num">Est. Revenue / Month</th>
        </tr>
      </thead>
      <tbody id="topBody"></tbody>
    </table>
  </div>

  <div class="card">
    <h2>Property Type Mix</h2>
    <canvas id="propTypeChart" height="260"></canvas>
  </div>

  <div class="card">
    <h2>Price Distribution — Listings by Price / Night</h2>
    <canvas id="priceDistChart" height="260"></canvas>
  </div>

</div>

<script>
const RAW = {{
  listingMonthly: {json.dumps(data["listing_monthly"])},
  listingsMeta:   {json.dumps(data["listings_meta"])},
  lastUpdated:    {json.dumps(data["last_updated"])},
  bookingsRaw:    {json.dumps(data["bookings_raw"])},
  stays:          {json.dumps(data["stays"])},
}};
const ALL_MONTHS     = {json.dumps(months)};
const ALL_PROP_TYPES = {json.dumps(property_types)};
const COLOURS        = {json.dumps(colours)};
const ALL_AREAS      = {json.dumps(areas)};
const ALL_CITIES     = {json.dumps(cities)};
const CURRENT_MONTH  = "{current_month}";

function monthStatus(mo) {{
  if (mo < CURRENT_MONTH) return "realized";
  if (mo === CURRENT_MONTH) return "in_progress";
  return "projected";
}}

const ZONE_COLORS  = ["#3b82f6", "#10b981", "#8b5cf6"];
const ZONE_LABELS  = ["Zone A", "Zone B", "Zone C"];
const MIN_LISTINGS = 10;

Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#1e3048';

const META = {{}};
RAW.listingsMeta.forEach(r => META[r.listing_id] = r);

let state = {{
  zones:         [],
  monthFrom:     ALL_MONTHS[0]  || "",
  monthTo:       ALL_MONTHS[ALL_MONTHS.length - 1] || "",
  metric:        "occupancy_pct",
  propertyTypes: new Set(),
  bedrooms:      new Set(),
  region:        null,
}};

// ── Geo helpers ───────────────────────────────────────────────────────────────
function pointInPolygon(lat, lng, poly) {{
  let inside = false, j = poly.length - 1;
  for (let i = 0; i < poly.length; i++) {{
    const xi = poly[i].lat, yi = poly[i].lng, xj = poly[j].lat, yj = poly[j].lng;
    if ((yi > lng) !== (yj > lng) && lat < (xj - xi) * (lng - yi) / (yj - yi) + xi) inside = !inside;
    j = i;
  }}
  return inside;
}}

function _passesTypeAndBedrooms(m) {{
  if (!m) return true;
  if (state.region) {{
    if (ALL_CITIES.includes(state.region)) {{
      if (m.city !== state.region) return false;
    }} else {{
      if (m.area !== state.region) return false;
    }}
  }}
  if (state.propertyTypes.size > 0 && !state.propertyTypes.has(m.property_type)) return false;
  if (state.bedrooms.size > 0) {{
    if (m.bedrooms === null || m.bedrooms === undefined) return false;
    const bKey = m.bedrooms >= 4 ? "4" : String(m.bedrooms);
    if (!state.bedrooms.has(bKey)) return false;
  }}
  return true;
}}

function listingInZone(listing_id, zone) {{
  const m = META[listing_id];
  if (!m || m.latitude == null || m.longitude == null) return false;
  return pointInPolygon(m.latitude, m.longitude, zone.polygon) && _passesTypeAndBedrooms(m);
}}

function listingPassesFilter(listing_id) {{
  const m = META[listing_id];
  if (!_passesTypeAndBedrooms(m)) return false;
  if (state.zones.length === 0) return true;
  return state.zones.some(z => m && m.latitude != null && pointInPolygon(m.latitude, m.longitude, z.polygon));
}}

function filteredMonths() {{
  return ALL_MONTHS.filter(m => m >= state.monthFrom && m <= state.monthTo);
}}

// ── Booking velocity helper ───────────────────────────────────────────────────
function velocityFor(ids) {{
  const now = Date.now(), MS = 86400000;
  const bkgs = RAW.bookingsRaw.filter(r => ids.has(r.listing_id));
  return {{
    d1:    bkgs.filter(r => now - new Date(r.booked_at) <       MS).length,
    d7:    bkgs.filter(r => now - new Date(r.booked_at) <   7 * MS).length,
    d30:   bkgs.filter(r => now - new Date(r.booked_at) <  30 * MS).length,
    d30p:  bkgs.filter(r => now - new Date(r.booked_at) >= 30 * MS).length,
  }};
}}

// ── Stats helpers ─────────────────────────────────────────────────────────────
function computeStats(ids, months) {{
  const mRows  = RAW.listingMonthly.filter(r => ids.has(r.listing_id) && months.includes(r.month));
  const avgOccRaw = mRows.length ? +(mRows.reduce((s,r) => s + r.occupancy_pct, 0) / mRows.length).toFixed(1) : null;
  const adjRows   = mRows.filter(r => r.occupancy_adjusted != null);
  const avgOcc    = adjRows.length ? +(adjRows.reduce((s,r) => s + r.occupancy_adjusted, 0) / adjRows.length).toFixed(1) : avgOccRaw;
  const pRows     = mRows.filter(r => r.avg_price != null);
  const avgPrice  = pRows.length ? Math.round(pRows.reduce((s,r) => s + r.avg_price, 0) / pRows.length) : null;
  const estRev    = (avgOcc    !== null && avgPrice !== null) ? Math.round(avgOcc    / 100 * avgPrice * 30) : null;
  const estRevRaw = (avgOccRaw !== null && avgPrice !== null) ? Math.round(avgOccRaw / 100 * avgPrice * 30) : null;

  const staysF  = RAW.stays.filter(r => ids.has(r.listing_id));
  const totSt   = staysF.reduce((s,r) => s + r.num_stays, 0);
  const wNights = staysF.reduce((s,r) => s + r.avg_stay_nights * r.num_stays, 0);
  const avgStay = totSt > 0 ? +(wNights / totSt).toFixed(1) : null;

  const vel     = velocityFor(ids);
  const revPAN  = avgOcc !== null && avgPrice !== null ? +(avgOcc / 100 * avgPrice).toFixed(1) : null;
  const vacancy = avgOcc !== null ? +(100 - avgOcc).toFixed(1) : null;
  return {{ count: ids.size, avgOcc, avgOccRaw, avgPrice, estRev, estRevRaw, avgStay, vel, revPAN, vacancy }};
}}

function getZoneStats(zone) {{
  const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
  if (ids.size < MIN_LISTINGS) return {{ count: ids.size, insufficient: true }};
  return {{ ...computeStats(ids, filteredMonths()), insufficient: false }};
}}

function getGlobalStats() {{
  const ids = new Set(RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).map(r => r.listing_id));
  return computeStats(ids, filteredMonths());
}}

// ── Zone comparison / Global KPIs ─────────────────────────────────────────────
function fmt(val, prefix, suffix) {{
  return val !== null && val !== undefined ? (prefix||"") + val + (suffix||"") : "—";
}}

function buildZoneComparison() {{
  const row = document.getElementById("zoneRow");
  const velSec = document.getElementById("velocitySection");

  if (state.zones.length === 0) {{
    const g = getGlobalStats();
    const gIds = new Set(RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).map(r => r.listing_id));
    const dOcc = _monthDelta(gIds, "occupancy_adjusted") ?? _monthDelta(gIds, "occupancy_pct");
    const dRev = _monthDelta(gIds, "occupancy_adjusted");
    row.className = "kpis";
    row.innerHTML =
      kpiCard("#2563eb", fmt(g.count),                        "Active Listings") +
      kpiCard("#7c3aed", fmt(g.avgOcc, "", "%"),              "Avg Occupancy",        fmt(g.avgOccRaw, "", "%"), dOcc) +
      kpiCard("#0891b2", fmt(g.avgPrice, "€"),                "Avg Price / Night") +
      kpiCard("#059669", fmt(g.estRev, "€"),                  "Est. Revenue / Month", fmt(g.estRevRaw, "€"),     dRev) +
      kpiCard("#6366f1", fmt(g.revPAN, "€"),                  "RevPAN") +
      kpiCard("#0ea5e9", fmt(g.avgStay, "", " nts"),          "Avg Stay Length");

    velSec.innerHTML =
      "<div class='vel-section-label'>Booking Activity — Nights Booked</div>" +
      "<div class='velocity-row'>" +
      velCard(g.vel.d1,   "Last 24h",   "#2563eb") +
      velCard(g.vel.d7,   "Last 7 days","#2563eb") +
      velCard(g.vel.d30,  "Last 30 days","#2563eb") +
      velCard(g.vel.d30p, "30 days +",  "#94a3b8") +
      "</div>";
    return;
  }}

  velSec.innerHTML = "";
  row.className = "zone-grid";
  row.innerHTML = "";
  state.zones.forEach(zone => {{
    const s = getZoneStats(zone);
    const card = document.createElement("div");
    card.className = "zone-card";
    const closeBtn = "<button class='zone-close' data-id='" + zone.id + "'>×</button>";
    if (s.insufficient) {{
      card.innerHTML =
        "<div class='zone-card-header' style='background:" + zone.color + "'>" + zone.label + " " + closeBtn + "</div>" +
        "<div class='zone-warn'>Insufficient data<br><span style='font-size:.85em'>" + s.count + " listing" + (s.count !== 1 ? "s" : "") + " — minimum " + MIN_LISTINGS + " required</span></div>";
    }} else {{
      card.innerHTML =
        "<div class='zone-card-header' style='background:" + zone.color + "'>" + zone.label + " · " + s.count + " listings " + closeBtn + "</div>" +
        "<div class='zone-card-body'>" +
        zStat("Occupancy",         fmt(s.avgOcc, "", "%") + (s.avgOccRaw !== s.avgOcc ? "<span class='zraw'> raw: " + fmt(s.avgOccRaw, "", "%") + "</span>" : "")) +
        zStat("Avg Price / Night", fmt(s.avgPrice, "€")) +
        zStat("Est. Revenue / Mo", fmt(s.estRev, "€")   + (s.estRevRaw !== s.estRev   ? "<span class='zraw'> raw: " + fmt(s.estRevRaw, "€") + "</span>" : "")) +
        zStat("Avg Stay",          fmt(s.avgStay, "", " nts")) +
        "<div class='zone-vel'>" +
        zVel(s.vel.d1,   "24h") +
        zVel(s.vel.d7,   "7 days") +
        zVel(s.vel.d30,  "30 days") +
        zVel(s.vel.d30p, "30d +") +
        "</div></div>";
    }}
    row.appendChild(card);
  }});

  row.querySelectorAll(".zone-close").forEach(btn =>
    btn.addEventListener("click", () => removeZone(parseInt(btn.dataset.id)))
  );
}}

function kpiCard(color, val, lbl, rawVal, delta) {{
  const rawHtml   = rawVal != null && rawVal !== val ? "<div class='kpi-raw'>raw: " + rawVal + "</div>" : "";
  const deltaHtml = delta != null ? "<div class='kpi-delta " + (delta >= 0 ? "up" : "dn") + "'>" + (delta >= 0 ? "↑" : "↓") + Math.abs(delta) + "% vs prev mo</div>" : "";
  return "<div class='kpi' style='border-left-color:" + color + "'><div class='val'>" + val + "</div>" + rawHtml + deltaHtml + "<div class='lbl'>" + lbl + "</div></div>";
}}

function _monthDelta(ids, metric) {{
  const months = filteredMonths();
  if (months.length < 2) return null;
  const avg = m => {{
    const rows = RAW.listingMonthly.filter(r => ids.has(r.listing_id) && r.month === m && r[metric] != null);
    return rows.length ? rows.reduce((s,r) => s + r[metric], 0) / rows.length : null;
  }};
  const cur = avg(months[months.length - 1]);
  const prev = avg(months[months.length - 2]);
  if (cur === null || prev === null || prev === 0) return null;
  return +((cur - prev) / prev * 100).toFixed(1);
}}
function velCard(val, lbl, color) {{
  return "<div class='vel-card' style='border-top:3px solid " + color + "'><div class='vval'>" + val + "</div><div class='vlbl'>" + lbl + "</div></div>";
}}
function zStat(lbl, val) {{
  return "<div class='zone-stat'><span class='zlbl'>" + lbl + "</span><span class='zval'>" + val + "</span></div>";
}}
function zVel(val, lbl) {{
  return "<div class='zone-vel-item'><div class='zvv'>" + val + "</div><div class='zvl'>" + lbl + "</div></div>";
}}

// ── Trend chart ───────────────────────────────────────────────────────────────
let trendChart;
function _avgBy(rows, key, months) {{
  const byMonth = {{}};
  rows.forEach(r => {{
    const v = r[key]; if (v != null) {{ if (!byMonth[r.month]) byMonth[r.month] = []; byMonth[r.month].push(+v); }}
  }});
  return months.map(m => {{ const v = byMonth[m]; return v && v.length ? +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1) : null; }});
}}

function buildTrend() {{
  const months = filteredMonths();
  const isOcc  = state.metric === "occupancy_pct";
  document.getElementById("trendTitle").textContent =
    (isOcc ? "Occupancy %" : "Avg Price / Night (€)") + " — Monthly Trend";

  const sfx = isOcc ? "%" : "€";
  let datasets;

  if (state.zones.length === 0) {{
    const fRows = RAW.listingMonthly.filter(r => listingPassesFilter(r.listing_id));
    if (isOcc) {{
      const adjVals = _avgBy(fRows, "occupancy_adjusted", months);
      const rawVals = _avgBy(fRows, "occupancy_pct",       months);
      const stdVals = _avgBy(fRows, "confidence_std",      months);
      const upper = adjVals.map((v,i) => v != null && stdVals[i] != null ? +(v + stdVals[i]).toFixed(1) : v);
      const lower = adjVals.map((v,i) => v != null && stdVals[i] != null ? +Math.max(0, v - stdVals[i]).toFixed(1) : v);
      // Split adj line: solid for realized/in-progress, dashed for projected
      // Overlap at boundary by one point so the two segments connect visually
      const adjRealized  = adjVals.map((v, i) => {{
        const cur = monthStatus(months[i]), nxt = months[i+1] ? monthStatus(months[i+1]) : null;
        return (cur !== "projected" || nxt === "projected") ? v : v; // include boundary point
      }}).map((v, i) => monthStatus(months[i]) !== "projected" ? v : (months[i-1] && monthStatus(months[i-1]) !== "projected" ? v : null));
      const adjProjected = adjVals.map((v, i) => monthStatus(months[i]) === "projected" ? v : (months[i+1] && monthStatus(months[i+1]) === "projected" ? v : null));
      datasets = [
        {{ label: "±1σ band", data: upper, fill: "+1", borderWidth:0, borderColor:"transparent", pointRadius:0, backgroundColor:"rgba(37,99,235,0.10)", spanGaps:true }},
        {{ label: "",         data: lower, fill: false, borderWidth:0, borderColor:"transparent", pointRadius:0, spanGaps:true }},
        {{ label: "Realized", data: adjRealized,  borderColor:"#2563eb",   backgroundColor:"transparent", tension:0.35, fill:false, spanGaps:false, borderWidth:2, pointRadius:3 }},
        {{ label: "Projected",data: adjProjected, borderColor:"#2563eb88", backgroundColor:"transparent", tension:0.35, fill:false, spanGaps:false, borderWidth:2, borderDash:[6,4], pointRadius:3 }},
        {{ label: "Raw Occ",  data: rawVals, borderColor:"#94a3b8", backgroundColor:"transparent", tension:0.35, fill:false, spanGaps:true, borderWidth:1.5, borderDash:[5,4], pointRadius:0 }},
      ];
    }} else {{
      const vals = _avgBy(fRows, "avg_price", months);
      datasets = [{{ label: "All listings", borderColor:"#2563eb", backgroundColor:"#2563eb22", data:vals, tension:0.35, fill:false, spanGaps:true }}];
    }}
  }} else {{
    datasets = [];
    state.zones.forEach(zone => {{
      const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      const zRows = RAW.listingMonthly.filter(r => ids.has(r.listing_id));
      if (isOcc) {{
        const adjVals = _avgBy(zRows, "occupancy_adjusted", months);
        const rawVals = _avgBy(zRows, "occupancy_pct",       months);
        const stdVals = _avgBy(zRows, "confidence_std",      months);
        const upper = adjVals.map((v,i) => v != null && stdVals[i] != null ? +(v + stdVals[i]).toFixed(1) : v);
        const lower = adjVals.map((v,i) => v != null && stdVals[i] != null ? +Math.max(0, v - stdVals[i]).toFixed(1) : v);
        const adjRealized  = adjVals.map((v, i) => monthStatus(months[i]) !== "projected" ? v : (months[i-1] && monthStatus(months[i-1]) !== "projected" ? v : null));
        const adjProjected = adjVals.map((v, i) => monthStatus(months[i]) === "projected" ? v : (months[i+1] && monthStatus(months[i+1]) === "projected" ? v : null));
        datasets.push({{ label:"", data:upper, fill:"+1", borderWidth:0, borderColor:"transparent", pointRadius:0, backgroundColor:zone.color+"22", spanGaps:true }});
        datasets.push({{ label:"", data:lower, fill:false, borderWidth:0, borderColor:"transparent", pointRadius:0, spanGaps:true }});
        datasets.push({{ label:zone.label+" realized", data:adjRealized,  borderColor:zone.color,     backgroundColor:"transparent", tension:0.35, fill:false, spanGaps:false, borderWidth:2, pointRadius:3 }});
        datasets.push({{ label:zone.label+" projected",data:adjProjected, borderColor:zone.color+"88", backgroundColor:"transparent", tension:0.35, fill:false, spanGaps:false, borderWidth:2, borderDash:[6,4], pointRadius:3 }});
        datasets.push({{ label:zone.label+" raw", data:rawVals, borderColor:zone.color+"88", backgroundColor:"transparent", tension:0.35, fill:false, spanGaps:true, borderWidth:1.5, borderDash:[5,4], pointRadius:0 }});
      }} else {{
        const vals = _avgBy(zRows, "avg_price", months);
        datasets.push({{ label:zone.label, borderColor:zone.color, backgroundColor:zone.color+"22", data:vals, tension:0.35, fill:false, spanGaps:true }});
      }}
    }});
  }}

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById("trendChart"), {{
    type: "line", data: {{ labels: months, datasets }},
    options: {{ responsive: true,
      plugins: {{
        legend: {{ position:"bottom", labels:{{ boxWidth:12, font:{{size:11}}, filter: item => item.text !== "" && item.text !== "±1σ band" }} }},
        tooltip: {{ callbacks: {{ label: c => c.dataset.label ? " " + c.dataset.label + ": " + c.parsed.y + sfx : null }} }},
      }},
      scales: {{ y: {{ min:0, ticks:{{ callback: v => v+sfx }} }} }} }},
  }});
}}

// ── Occupancy distribution ────────────────────────────────────────────────────
let occDistChart;
function buildOccDist() {{
  const months = filteredMonths();
  const labels = ["0–20%","20–40%","40–60%","60–80%","80–100%"];
  let datasets;

  function occBuckets(ids) {{
    const perListing = {{}};
    RAW.listingMonthly.filter(r => ids.has(r.listing_id) && months.includes(r.month)).forEach(r => {{
      if (!perListing[r.listing_id]) perListing[r.listing_id] = [];
      perListing[r.listing_id].push(r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct);
    }});
    const b = [0,0,0,0,0];
    Object.values(perListing).forEach(vals => {{ b[Math.min(4, Math.floor(vals.reduce((a,c)=>a+c,0)/vals.length/20))]++; }});
    return b;
  }}

  if (state.zones.length === 0) {{
    const ids = new Set(RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).map(r => r.listing_id));
    const colors = ["#e2e8f0","#bfdbfe","#93c5fd","#3b82f6","#1d4ed8"];
    datasets = [{{ data: occBuckets(ids), backgroundColor: colors, borderRadius: 4 }}];
  }} else {{
    datasets = state.zones.map(zone => {{
      const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      return {{ label: zone.label, data: occBuckets(ids), backgroundColor: zone.color + "aa", borderRadius: 4 }};
    }});
  }}

  if (occDistChart) occDistChart.destroy();
  occDistChart = new Chart(document.getElementById("occDistChart"), {{
    type: "bar",
    data: {{ labels, datasets }},
    options: {{ responsive: true,
      plugins: {{ legend:{{display:state.zones.length>0,position:"bottom",labels:{{boxWidth:12,font:{{size:11}}}}}}, tooltip:{{callbacks:{{label:c=>" "+c.dataset.label+" "+c.parsed.y+" listings"}}}} }},
      scales: {{ y: {{ min:0, ticks:{{stepSize:1}}, title:{{display:true,text:"Listings",color:"#94a3b8",font:{{size:11}}}} }},
                 x: {{ grid:{{display:false}} }} }} }},
  }});
}}

// ── Price vs Occupancy scatter ────────────────────────────────────────────────
let scatterChart;
function buildScatter() {{
  const months = filteredMonths();
  const perListing = {{}};
  RAW.listingMonthly.filter(r => listingPassesFilter(r.listing_id) && months.includes(r.month)).forEach(r => {{
    if (!perListing[r.listing_id]) perListing[r.listing_id] = {{ occ:[], price:[], area:r.area, name:r.name, id:r.listing_id }};
    perListing[r.listing_id].occ.push(r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct);
    if (r.avg_price != null) perListing[r.listing_id].price.push(r.avg_price);
  }});

  let datasets;
  if (state.zones.length === 0) {{
    const points = Object.values(perListing)
      .filter(l => l.occ.length && l.price.length)
      .map(l => ({{
        x: +(l.price.reduce((a,b)=>a+b,0)/l.price.length).toFixed(0),
        y: +(l.occ.reduce((a,b)=>a+b,0)/l.occ.length).toFixed(1),
        label: l.name || l.id, area: l.area,
      }}));
    datasets = [{{ data: points, backgroundColor: points.map(p => COLOURS[p.area] || "#76b7b2"), pointRadius: 5, pointHoverRadius: 7 }}];
  }} else {{
    datasets = state.zones.map(zone => {{
      const zoneIds = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      const points = Object.values(perListing)
        .filter(l => zoneIds.has(l.id) && l.occ.length && l.price.length)
        .map(l => ({{
          x: +(l.price.reduce((a,b)=>a+b,0)/l.price.length).toFixed(0),
          y: +(l.occ.reduce((a,b)=>a+b,0)/l.occ.length).toFixed(1),
          label: l.name || l.id,
        }}));
      return {{ label: zone.label, data: points, backgroundColor: zone.color + "cc", pointRadius: 5, pointHoverRadius: 7 }};
    }});
  }}

  if (scatterChart) scatterChart.destroy();
  scatterChart = new Chart(document.getElementById("scatterChart"), {{
    type: "scatter", data: {{ datasets }},
    options: {{ responsive: true,
      plugins: {{ legend: {{ display: state.zones.length > 0, position:"bottom", labels:{{boxWidth:12,font:{{size:11}}}} }},
        tooltip: {{ callbacks: {{ label: c => " " + (c.raw.label||"") + " — €" + c.raw.x + "/night, " + c.raw.y + "% occ" }} }} }},
      scales: {{
        x: {{ title:{{display:true,text:"Avg Price / Night (€)",color:"#94a3b8",font:{{size:11}}}}, ticks:{{callback:v=>"€"+v}} }},
        y: {{ min:0, max:100, title:{{display:true,text:"Avg Occupancy %",color:"#94a3b8",font:{{size:11}}}}, ticks:{{callback:v=>v+"%"}} }},
      }} }},
  }});
}}

// ── Bedroom breakdown ─────────────────────────────────────────────────────────
function occColour(v) {{
  if (v === null || v === undefined) return "#94a3b8";
  if (v >= 45) return "#4ade80";
  if (v >= 20) return "#fbbf24";
  return "#f87171";
}}

function buildBedroomBreakdown() {{
  const months = filteredMonths();
  const order  = ["Studio","1 BR","2 BR","3 BR","4+ BR","Unknown"];
  const tbody  = document.getElementById("bedroomBody");
  const note   = document.getElementById("bedroomNote");
  tbody.innerHTML = "";

  function computeGroups(ids) {{
    const groups = {{}};
    RAW.listingMonthly.filter(r => ids.has(r.listing_id) && months.includes(r.month)).forEach(r => {{
      const m = META[r.listing_id];
      const b = m && m.bedrooms !== null && m.bedrooms !== undefined ? m.bedrooms : null;
      const key = b === null ? "Unknown" : b === 0 ? "Studio" : b >= 4 ? "4+ BR" : b + " BR";
      if (!groups[key]) groups[key] = {{ occ:[], occRaw:[], price:[], ids: new Set() }};
      groups[key].occ.push(r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct);
      groups[key].occRaw.push(r.occupancy_pct);
      if (r.avg_price != null) groups[key].price.push(r.avg_price);
      groups[key].ids.add(r.listing_id);
    }});
    return groups;
  }}

  function renderGroups(groups, zoneColor) {{
    order.filter(k => groups[k]).forEach(k => {{
      const g = groups[k];
      const occ    = g.occ.length    ? +(g.occ.reduce((a,b)=>a+b,0)/g.occ.length).toFixed(1)       : null;
      const occRaw = g.occRaw.length ? +(g.occRaw.reduce((a,b)=>a+b,0)/g.occRaw.length).toFixed(1) : null;
      const price  = g.price.length  ? Math.round(g.price.reduce((a,b)=>a+b,0)/g.price.length)     : null;
      const rev    = occ    !== null && price !== null ? Math.round(occ   /100*price*30) : null;
      const revRaw = occRaw !== null && price !== null ? Math.round(occRaw/100*price*30) : null;
      const occStr = occ !== null ? occ + "%" + (occRaw !== null && occRaw !== occ ? "<span class='zraw'> raw: " + occRaw + "%</span>" : "") : "—";
      const revStr = rev !== null ? "€" + rev + (revRaw !== null && revRaw !== rev ? "<span class='zraw'> raw: €" + revRaw + "</span>" : "") : "—";
      const tr = document.createElement("tr");
      if (zoneColor) tr.style.borderLeft = "3px solid " + zoneColor;
      tr.innerHTML =
        "<td><strong>" + k + "</strong></td>" +
        "<td class='num'>" + g.ids.size + "</td>" +
        "<td class='num' style='color:" + occColour(occ) + ";font-weight:600'>" + occStr + "</td>" +
        "<td class='num'>" + (price !== null ? "€" + price : "—") + "</td>" +
        "<td class='num'>" + revStr + "</td>";
      tbody.appendChild(tr);
    }});
  }}

  if (state.zones.length === 0) {{
    const ids = new Set(RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).map(r => r.listing_id));
    if (note) note.textContent = "— " + ids.size + " listings";
    renderGroups(computeGroups(ids), null);
  }} else {{
    if (note) note.textContent = "";
    state.zones.forEach(zone => {{
      const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      const hdr = document.createElement("tr");
      hdr.innerHTML = "<td colspan='5' style='background:" + zone.color + "22;color:" + zone.color + ";font-weight:600;padding:6px 12px;border-left:3px solid " + zone.color + "'>" + zone.label + " · " + ids.size + " listings</td>";
      tbody.appendChild(hdr);
      renderGroups(computeGroups(ids), zone.color);
    }});
  }}
  if (!tbody.children.length) tbody.innerHTML = "<tr><td colspan='5' style='color:#94a3b8;padding:14px 12px'>No data for current filters</td></tr>";
}}

// ── Booking timeline ──────────────────────────────────────────────────────────
let bookingChart;
function buildBookingTimeline() {{
  const now = Date.now(), MS = 86400000, MS30 = 30 * MS;
  const labels = [];
  for (let d = new Date(now - MS30); d <= new Date(now); d.setDate(d.getDate()+1))
    labels.push(d.toISOString().slice(0,10));

  function dayCounts(ids) {{
    const counts = {{}};
    RAW.bookingsRaw.filter(r => ids.has(r.listing_id) && new Date(r.booked_at) >= new Date(now - MS30))
      .forEach(r => {{ const day = r.booked_at.slice(0,10); counts[day] = (counts[day]||0) + 1; }});
    return labels.map(d => counts[d]||0);
  }}

  let datasets;
  if (state.zones.length === 0) {{
    const ids = new Set(RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).map(r => r.listing_id));
    datasets = [{{ data: dayCounts(ids), backgroundColor: "#2563ebaa", borderColor: "#2563eb", borderWidth: 1 }}];
  }} else {{
    datasets = state.zones.map(zone => {{
      const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      return {{ label: zone.label, data: dayCounts(ids), backgroundColor: zone.color + "aa", borderColor: zone.color, borderWidth: 1 }};
    }});
  }}

  if (bookingChart) bookingChart.destroy();
  bookingChart = new Chart(document.getElementById("bookingChart"), {{
    type: "bar",
    data: {{ labels: labels.map(d => d.slice(5)), datasets }},
    options: {{ responsive: true,
      plugins: {{ legend:{{display:state.zones.length>0,position:"bottom",labels:{{boxWidth:12,font:{{size:11}}}}}}, tooltip:{{callbacks:{{label:c=>" "+(c.dataset.label?c.dataset.label+" ":"")+c.parsed.y+" night"+(c.parsed.y!==1?"s":"")+" booked"}}}} }},
      scales: {{ y:{{min:0, ticks:{{stepSize:1}}}} }} }},
  }});
}}

// ── Property Type Distribution ────────────────────────────────────────────────
const PROP_COLOURS = ["#22d3ee","#34d399","#818cf8","#f472b6","#fb923c","#a3e635","#60a5fa","#e879f9","#94a3b8"];
let propTypeChart;
function buildPropTypeDist() {{
  if (propTypeChart) propTypeChart.destroy();

  if (state.zones.length === 0) {{
    const counts = {{}};
    RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).forEach(r => {{
      const t = r.property_type || "Unknown";
      counts[t] = (counts[t] || 0) + 1;
    }});
    const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
    let labels, data;
    if (sorted.length > 8) {{
      labels = sorted.slice(0,8).map(([l])=>l).concat(["Other"]);
      data   = sorted.slice(0,8).map(([,v])=>v).concat([sorted.slice(8).reduce((s,[,v])=>s+v,0)]);
    }} else {{
      labels = sorted.map(([l])=>l);
      data   = sorted.map(([,v])=>v);
    }}
    propTypeChart = new Chart(document.getElementById("propTypeChart"), {{
      type: "doughnut",
      data: {{ labels, datasets: [{{ data, backgroundColor: PROP_COLOURS.slice(0, labels.length), borderWidth: 0, hoverOffset: 6 }}] }},
      options: {{
        responsive: true,
        plugins: {{
          legend: {{ position: "right", labels: {{ font: {{ size: 11 }}, padding: 14, boxWidth: 12 }} }},
          tooltip: {{ callbacks: {{ label: c => " " + c.label + ": " + c.parsed + " listings" }} }},
        }},
        cutout: "60%",
      }},
    }});
  }} else {{
    // Grouped bar chart per zone — collect union of types across all zones
    const allTypes = new Set();
    const zoneCounts = state.zones.map(zone => {{
      const counts = {{}};
      const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      RAW.listingsMeta.filter(r => ids.has(r.listing_id)).forEach(r => {{
        const t = r.property_type || "Unknown";
        counts[t] = (counts[t]||0) + 1;
        allTypes.add(t);
      }});
      return counts;
    }});
    // Sort types by total count descending, cap at 8
    const typesSorted = [...allTypes].sort((a,b) =>
      zoneCounts.reduce((s,c)=>s+(c[b]||0),0) - zoneCounts.reduce((s,c)=>s+(c[a]||0),0)
    ).slice(0, 8);
    const datasets = state.zones.map((zone, i) => ({{
      label: zone.label,
      data: typesSorted.map(t => zoneCounts[i][t]||0),
      backgroundColor: zone.color + "aa",
      borderColor: zone.color,
      borderWidth: 1,
      borderRadius: 4,
    }}));
    propTypeChart = new Chart(document.getElementById("propTypeChart"), {{
      type: "bar",
      data: {{ labels: typesSorted, datasets }},
      options: {{
        responsive: true,
        plugins: {{
          legend: {{ display: true, position: "bottom", labels: {{ boxWidth: 12, font: {{ size: 11 }} }} }},
          tooltip: {{ callbacks: {{ label: c => " " + c.dataset.label + ": " + c.parsed.y + " listings" }} }},
        }},
        scales: {{
          y: {{ min:0, ticks: {{ stepSize:1 }} }},
          x: {{ grid: {{ display:false }} }},
        }},
      }},
    }});
  }}
}}

// ── Price Distribution ─────────────────────────────────────────────────────────
let priceDistChart;
function buildPriceDist() {{
  const months = filteredMonths();
  const BUCKETS = [
    {{ label: "<€50",    min:0,   max:50   }},
    {{ label: "€50–100", min:50,  max:100  }},
    {{ label: "€100–150",min:100, max:150  }},
    {{ label: "€150–200",min:150, max:200  }},
    {{ label: "€200–300",min:200, max:300  }},
    {{ label: "€300+",   min:300, max:Infinity }},
  ];

  function priceBuckets(ids) {{
    const priceByListing = {{}};
    RAW.listingMonthly.filter(r => ids.has(r.listing_id) && months.includes(r.month) && r.avg_price != null).forEach(r => {{
      if (!priceByListing[r.listing_id]) priceByListing[r.listing_id] = [];
      priceByListing[r.listing_id].push(r.avg_price);
    }});
    const counts = BUCKETS.map(() => 0);
    Object.values(priceByListing).forEach(prices => {{
      const avg = prices.reduce((a,b)=>a+b,0) / prices.length;
      const idx = BUCKETS.findIndex(b => avg >= b.min && avg < b.max);
      if (idx >= 0) counts[idx]++;
    }});
    return counts;
  }}

  let datasets;
  if (state.zones.length === 0) {{
    const ids = new Set(RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).map(r => r.listing_id));
    datasets = [{{ data: priceBuckets(ids), backgroundColor: "#22d3eeaa", borderColor: "#22d3ee", borderWidth: 1, borderRadius: 4 }}];
  }} else {{
    datasets = state.zones.map(zone => {{
      const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      return {{ label: zone.label, data: priceBuckets(ids), backgroundColor: zone.color + "aa", borderColor: zone.color, borderWidth: 1, borderRadius: 4 }};
    }});
  }}

  if (priceDistChart) priceDistChart.destroy();
  priceDistChart = new Chart(document.getElementById("priceDistChart"), {{
    type: "bar",
    data: {{ labels: BUCKETS.map(b => b.label), datasets }},
    options: {{
      responsive: true,
      plugins: {{ legend: {{ display: state.zones.length > 0, position:"bottom", labels:{{boxWidth:12,font:{{size:11}}}} }}, tooltip: {{ callbacks: {{ label: c => " " + (c.dataset.label ? c.dataset.label+" " : "") + c.parsed.y + " listings" }} }} }},
      scales: {{
        y: {{ min:0, ticks: {{ stepSize:1 }} }},
        x: {{ grid: {{ display: false }} }},
      }},
    }},
  }});
}}

// ── Zone management ───────────────────────────────────────────────────────────
function removeZone(id) {{
  const zone = state.zones.find(z => z.id === id);
  if (zone?.drawnLayer) window._map?.removeLayer(zone.drawnLayer);
  state.zones = state.zones.filter(z => z.id !== id);
  updateMapUI(); render();
}}

function clearAllZones() {{
  state.zones.forEach(z => z.drawnLayer && window._map?.removeLayer(z.drawnLayer));
  state.zones = [];
  updateMapUI(); render();
}}

function updateMapUI() {{
  const status = document.getElementById("mapStatus");
  const btn    = document.getElementById("clearAllBtn");
  const legend = document.getElementById("zoneLegend");
  legend.innerHTML = "";
  if (state.zones.length === 0) {{
    status.textContent = "Hover + scroll to zoom · Draw a rectangle or polygon to define a comparison zone";
    btn.style.display = "none";
  }} else {{
    status.textContent = state.zones.map(z => {{
      const n = RAW.listingsMeta.filter(r => listingInZone(r.listing_id, z)).length;
      return z.label + ": " + n + " listings";
    }}).join(" · ");
    btn.style.display = "";
    state.zones.forEach(z => {{
      const b = document.createElement("div");
      b.className = "zone-badge";
      b.innerHTML = "<span class='zone-dot' style='background:"+z.color+"'></span>"+z.label;
      legend.appendChild(b);
    }});
  }}
  // keep fullscreen overlay in sync
  const fsClear = document.getElementById("fsClearBtn");
  if (fsClear) fsClear.style.display = state.zones.length > 0 ? "" : "none";
}}

// ── Filters UI ────────────────────────────────────────────────────────────────
function buildFiltersUI() {{
  document.getElementById("lastUpdated").textContent = RAW.lastUpdated;
  document.getElementById("clearAllBtn").addEventListener("click", clearAllZones);

  const mFrom = document.getElementById("monthFrom");
  const mTo   = document.getElementById("monthTo");
  ALL_MONTHS.forEach(m => {{
    mFrom.innerHTML += "<option value='"+m+"'>"+m+"</option>";
    mTo.innerHTML   += "<option value='"+m+"'>"+m+"</option>";
  }});
  mFrom.value = state.monthFrom; mTo.value = state.monthTo;
  mFrom.addEventListener("change", () => {{ state.monthFrom = mFrom.value; render(); }});
  mTo.addEventListener("change",   () => {{ state.monthTo   = mTo.value;   render(); }});

  document.getElementById("metricSel").addEventListener("change", e => {{ state.metric = e.target.value; render(); }});

  // Property type pills
  const typeGroup = document.getElementById("typeGroup");
  ALL_PROP_TYPES.forEach(t => {{
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = t;
    pill.addEventListener("click", () => {{
      if (state.propertyTypes.has(t)) state.propertyTypes.delete(t);
      else state.propertyTypes.add(t);
      pill.classList.toggle("active", state.propertyTypes.has(t));
      render();
    }});
    typeGroup.appendChild(pill);
  }});

  // Region dropdown — grouped by city, with sub-areas for cities that have them
  const regionSel = document.getElementById("regionSel");
  const AREA_TO_CITY = {{}};
  RAW.listingsMeta.forEach(r => {{ if (r.area && r.city) AREA_TO_CITY[r.area] = r.city; }});
  ALL_CITIES.forEach(city => {{
    const cityAreas = ALL_AREAS.filter(a => AREA_TO_CITY[a] === city);
    const grp = document.createElement("optgroup");
    grp.label = city.charAt(0).toUpperCase() + city.slice(1);
    // City-wide option
    const cityOpt = document.createElement("option");
    cityOpt.value = city;
    cityOpt.textContent = city.charAt(0).toUpperCase() + city.slice(1) + " — All";
    grp.appendChild(cityOpt);
    // Sub-area options (skip if just one fallback area matching city name pattern)
    cityAreas.forEach(a => {{
      const subOpt = document.createElement("option");
      subOpt.value = a;
      subOpt.textContent = "\u00a0\u00a0" + a.replace(/_/g, " ").replace(/\\b\\w/g, c => c.toUpperCase());
      grp.appendChild(subOpt);
    }});
    regionSel.appendChild(grp);
  }});
  regionSel.addEventListener("change", e => {{ state.region = e.target.value || null; render(); }});

  // Bedroom pills
  const bedroomsGroup = document.getElementById("bedroomsGroup");
  [["0","Studio"],["1","1 BR"],["2","2 BR"],["3","3 BR"],["4","4+ BR"]].forEach(([val, lbl]) => {{
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = lbl;
    pill.addEventListener("click", () => {{
      if (state.bedrooms.has(val)) state.bedrooms.delete(val);
      else state.bedrooms.add(val);
      pill.classList.toggle("active", state.bedrooms.has(val));
      render();
    }});
    bedroomsGroup.appendChild(pill);
  }});
}}

// ── Monthly Breakdown ─────────────────────────────────────────────────────────
function buildMonthlyBreakdown() {{
  const months = filteredMonths();
  const tbody  = document.getElementById("monthlyBreakdownBody");
  const note   = document.getElementById("monthlyBreakdownNote");
  tbody.innerHTML = "";
  if (!months.length) {{ note.textContent = ""; return; }}
  note.textContent = "— " + months.length + " month" + (months.length > 1 ? "s" : "");

  function monthRow(mo, ids, prevOcc, col2Html, borderColor) {{
    const recs = RAW.listingMonthly.filter(r => ids.has(r.listing_id) && r.month === mo);
    const occs   = recs.map(r => r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct).filter(v => v != null);
    const prices = recs.map(r => r.avg_price).filter(v => v != null);
    const avgOcc   = occs.length   ? +(occs.reduce((a,b)=>a+b,0)   / occs.length).toFixed(1)   : null;
    const avgPrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0) / prices.length)    : null;
    const estRev   = avgOcc != null && avgPrice != null ? Math.round(avgOcc / 100 * avgPrice * 30) : null;
    const idCount  = new Set(recs.map(r => r.listing_id)).size;
    let momHtml = "<td class='num' style='color:#64748b'>—</td>";
    if (prevOcc !== null && avgOcc !== null && prevOcc !== 0) {{
      const delta = +((avgOcc - prevOcc) / prevOcc * 100).toFixed(1);
      momHtml = "<td class='num'><span class='kpi-delta " + (delta>=0?"up":"dn") + "'>" + (delta>=0?"↑":"↓") + Math.abs(delta) + "%</span></td>";
    }}
    const tr = document.createElement("tr");
    if (borderColor) tr.style.borderLeft = "3px solid " + borderColor;
    tr.innerHTML =
      "<td style='font-weight:500'>" + mo + "</td>" +
      col2Html +
      "<td class='num'>" + idCount.toLocaleString() + "</td>" +
      "<td class='num' style='color:" + occColour(avgOcc) + ";font-weight:600'>" + (avgOcc != null ? avgOcc + "%" : "—") + "</td>" +
      momHtml +
      "<td class='num'>" + (avgPrice != null ? "€" + avgPrice : "—") + "</td>" +
      "<td class='num'>" + (estRev   != null ? "€" + estRev.toLocaleString() : "—") + "</td>";
    tbody.appendChild(tr);
    return avgOcc;
  }}

  if (state.zones.length === 0) {{
    const ids = new Set(RAW.listingsMeta.filter(r => listingPassesFilter(r.listing_id)).map(r => r.listing_id));
    let prevOcc = null;
    months.forEach(mo => {{
      const st = monthStatus(mo);
      const badgeCls = st === "realized" ? "badge-realized" : st === "in_progress" ? "badge-in-progress" : "badge-projected";
      const badgeTxt = st === "realized" ? "✓ Realized"    : st === "in_progress" ? "◑ In Progress"     : "○ Projected";
      prevOcc = monthRow(mo, ids, prevOcc, "<td><span class='" + badgeCls + "'>" + badgeTxt + "</span></td>", null);
    }});
  }} else {{
    months.forEach(mo => {{
      state.zones.forEach((zone, zi) => {{
        const ids  = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
        const col2 = "<td><span style='display:inline-block;padding:2px 9px;border-radius:10px;font-size:.7rem;font-weight:600;background:" + zone.color + "22;color:" + zone.color + "'>" + zone.label + "</span></td>";
        // MoM vs same zone previous month
        const prevRecs = months.indexOf(mo) > 0
          ? RAW.listingMonthly.filter(r => ids.has(r.listing_id) && r.month === months[months.indexOf(mo)-1])
          : [];
        const prevOccs = prevRecs.map(r => r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct).filter(v=>v!=null);
        const prevOcc  = prevOccs.length ? +(prevOccs.reduce((a,b)=>a+b,0)/prevOccs.length).toFixed(1) : null;
        monthRow(mo, ids, prevOcc, col2, zone.color);
      }});
    }});
  }}
}}

// ── Top Listings ──────────────────────────────────────────────────────────────
function buildTopListings() {{
  const months = filteredMonths();
  const byListing = {{}};
  RAW.listingMonthly.filter(r => listingPassesFilter(r.listing_id) && months.includes(r.month)).forEach(r => {{
    if (!byListing[r.listing_id]) byListing[r.listing_id] = {{ occ:[], price:[] }};
    byListing[r.listing_id].occ.push(r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct);
    if (r.avg_price != null) byListing[r.listing_id].price.push(r.avg_price);
  }});
  const rows = Object.entries(byListing).map(([id, g]) => {{
    const occ   = g.occ.length   ? +(g.occ.reduce((a,b)=>a+b,0)/g.occ.length).toFixed(1)     : null;
    const price = g.price.length ? Math.round(g.price.reduce((a,b)=>a+b,0)/g.price.length)    : null;
    const rev   = occ !== null && price !== null ? Math.round(occ/100*price*30) : null;
    const m = META[+id];
    return {{ id:+id, occ, price, rev, name: m?.name||id, area: m?.area||"", bedrooms: m?.bedrooms }};
  }}).filter(r => r.occ !== null).sort((a,b) => b.occ - a.occ).slice(0,15);

  const tbody = document.getElementById("topBody");
  const note  = document.getElementById("topNote");
  tbody.innerHTML = "";
  if (note) note.textContent = "— top " + rows.length + " of " + Object.keys(byListing).length + " listings";
  rows.forEach((r, i) => {{
    const bdr = r.bedrooms === null || r.bedrooms === undefined ? "—" : r.bedrooms === 0 ? "Studio" : r.bedrooms + " BR";
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td style='color:#64748b;font-size:.8rem'>" + (i+1) + "</td>" +
      "<td style='max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + (r.name||r.id) + "</td>" +
      "<td style='color:#64748b'>" + r.area + "</td>" +
      "<td class='num'>" + bdr + "</td>" +
      "<td class='num' style='color:" + occColour(r.occ) + ";font-weight:600'>" + (r.occ !== null ? r.occ + "%" : "—") + "</td>" +
      "<td class='num'>" + (r.price !== null ? "€"+r.price : "—") + "</td>" +
      "<td class='num'>" + (r.rev   !== null ? "€"+r.rev   : "—") + "</td>";
    tbody.appendChild(tr);
  }});
  if (!tbody.children.length) tbody.innerHTML = "<tr><td colspan='7' style='color:#94a3b8;padding:14px 12px'>No data for current filters</td></tr>";
}}

// ── Seasonality chart ─────────────────────────────────────────────────────────
let seasonalityChart;
function buildSeasonality() {{
  const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  let datasets;
  if (state.zones.length === 0) {{
    const buckets = Array.from({{length:12}}, () => []);
    RAW.listingMonthly.filter(r => listingPassesFilter(r.listing_id)).forEach(r => {{
      const mo = parseInt(r.month.slice(5,7), 10) - 1;
      const v  = r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct;
      if (v != null) buckets[mo].push(+v);
    }});
    const avgs   = buckets.map(b => b.length ? +(b.reduce((a,c)=>a+c,0)/b.length).toFixed(1) : null);
    const colors = avgs.map(v => occColour(v) + "cc");
    datasets = [{{ label: "Avg Occupancy %", data: avgs, backgroundColor: colors, borderRadius: 4 }}];
  }} else {{
    datasets = state.zones.map(zone => {{
      const ids = new Set(RAW.listingsMeta.filter(r => listingInZone(r.listing_id, zone)).map(r => r.listing_id));
      const buckets = Array.from({{length:12}}, () => []);
      RAW.listingMonthly.filter(r => ids.has(r.listing_id)).forEach(r => {{
        const mo = parseInt(r.month.slice(5,7), 10) - 1;
        const v  = r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct;
        if (v != null) buckets[mo].push(+v);
      }});
      const data = buckets.map(b => b.length ? +(b.reduce((a,c)=>a+c,0)/b.length).toFixed(1) : null);
      return {{ label: zone.label, data, backgroundColor: zone.color + "aa", borderRadius: 4 }};
    }});
  }}
  if (seasonalityChart) seasonalityChart.destroy();
  seasonalityChart = new Chart(document.getElementById("seasonalityChart"), {{
    type: "bar",
    data: {{ labels: MONTH_LABELS, datasets }},
    options: {{
      responsive: true,
      plugins: {{ legend: {{ display: state.zones.length > 0, position:"bottom", labels:{{boxWidth:12,font:{{size:11}}}} }} }},
      scales: {{
        y: {{ min:0, max:100, ticks: {{ callback: v => v+"%" }} }},
        x: {{ grid: {{ display:false }} }},
      }},
    }},
  }});
}}

function render() {{
  buildZoneComparison();
  buildTrend();
  buildSeasonality();
  buildOccDist();
  buildScatter();
  buildBookingTimeline();
  buildBedroomBreakdown();
  buildMonthlyBreakdown();
  buildTopListings();
  buildPropTypeDist();
  buildPriceDist();
}}

// ── Map ───────────────────────────────────────────────────────────────────────
let _colourMode = "occ";
const _markers  = [];

function initMap() {{
  const mapEl = document.getElementById("map");
  const map = L.map("map", {{
    scrollWheelZoom: false,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 100,
    preferCanvas: true,
  }}).setView([35.0, 33.0], 9);
  window._map = map;
  mapEl.addEventListener("mouseenter", () => map.scrollWheelZoom.enable());
  mapEl.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());

  L.tileLayer("https://{{s}}.basemaps.cartocdn.com/rastertiles/voyager/{{z}}/{{x}}/{{y}}{{r}}.png", {{
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: "abcd", maxZoom: 19, keepBuffer: 4,
  }}).addTo(map);

  // Fullscreen overlay
  const fsOverlay = document.getElementById("mapFsOverlay");
  fsOverlay.innerHTML =
    "<button id='mapExitBtn' class='fs-btn'>✕ Exit Fullscreen <span style='font-size:.7rem;opacity:.6'>(Esc)</span></button>" +
    "<div class='fs-sep'></div>" +
    "<button id='mapDrawRectBtn' class='fs-btn'>▭ Rectangle</button>" +
    "<button id='mapDrawPolyBtn' class='fs-btn'>⬠ Polygon</button>" +
    "<div class='fs-sep'></div>" +
    "<button id='fsColourBtn' class='fs-btn'></button>" +
    "<button id='fsClearBtn' class='fs-btn' style='color:#f87171;display:none'>✕ Clear Zones</button>";

  function syncFsColourBtn() {{
    const btn = document.getElementById("fsColourBtn");
    if (btn) btn.textContent = "Colour: " + (_colourMode === "occ" ? "Occupancy" : "Area");
  }}
  function syncFsClearBtn() {{
    const btn = document.getElementById("fsClearBtn");
    if (btn) btn.style.display = state.zones.length > 0 ? "" : "none";
  }}
  syncFsColourBtn();
  syncFsClearBtn();

  document.getElementById("fsColourBtn").addEventListener("click", () => {{
    document.getElementById("colourModeBtn").click();
    syncFsColourBtn();
  }});
  document.getElementById("fsClearBtn").addEventListener("click", () => {{
    clearAllZones();
    syncFsClearBtn();
  }});

  function enterFullscreen() {{
    mapEl.classList.add("map-fs");
    fsOverlay.classList.add("visible");
    map.invalidateSize();
  }}
  function exitFullscreen() {{
    mapEl.classList.remove("map-fs");
    fsOverlay.classList.remove("visible");
    map.invalidateSize();
  }}

  document.getElementById("mapFsBtn").addEventListener("click", enterFullscreen);
  document.getElementById("mapExitBtn").addEventListener("click", exitFullscreen);
  document.addEventListener("keydown", e => {{ if (e.key === "Escape") exitFullscreen(); }});

  // Colour-by toggle (normal mode button)
  document.getElementById("colourModeBtn").addEventListener("click", () => {{
    _colourMode = _colourMode === "occ" ? "area" : "occ";
    document.getElementById("colourModeBtn").textContent = "Colour: " + (_colourMode === "occ" ? "Occupancy" : "Area");
    _markers.forEach(({{marker, areaCol, occCol}}) => {{
      const c = _colourMode === "occ" ? occCol : areaCol;
      marker.setStyle({{ color: c, fillColor: c }});
    }});
  }});

  // Build per-listing avg occupancy + price from monthly data
  const _lStats = {{}};
  RAW.listingMonthly.forEach(r => {{
    if (!_lStats[r.listing_id]) _lStats[r.listing_id] = {{occSum:0,priceSum:0,n:0,pn:0}};
    const s = _lStats[r.listing_id];
    const occ = r.occupancy_adjusted != null ? r.occupancy_adjusted : r.occupancy_pct;
    if (occ != null) {{ s.occSum += occ; s.n++; }}
    if (r.avg_price != null) {{ s.priceSum += r.avg_price; s.pn++; }}
  }});

  const clusterGroup = L.markerClusterGroup({{ maxClusterRadius: 40, disableClusteringAtZoom: 15 }});
  const markerBounds = [];
  RAW.listingsMeta.forEach(r => {{
    if (r.latitude == null || r.longitude == null) return;
    const areaCol = COLOURS[r.area] || "#76b7b2";
    const s = _lStats[r.listing_id] || {{}};
    const avgOcc   = s.n  ? (s.occSum   / s.n).toFixed(1)  : null;
    const avgPrice = s.pn ? Math.round(s.priceSum / s.pn)   : null;
    const occCol   = occColour(avgOcc ? +avgOcc : null);
    const initCol  = _colourMode === "occ" ? occCol : areaCol;
    const bdrLabel = r.bedrooms != null ? (r.bedrooms===0 ? "Studio" : r.bedrooms+"BR") : "";
    const url = r.listing_url || ("https://www.airbnb.com/rooms/" + r.listing_id);
    const popup = "<div style='min-width:175px;font-family:Inter,sans-serif;line-height:1.5'>" +
      "<a href='" + url + "' target='_blank' style='font-weight:600;color:#22d3ee;text-decoration:none;font-size:.85rem'>" +
        (r.name || ("Listing " + r.listing_id)) +
      "</a>" +
      "<div style='font-size:.72rem;color:#94a3b8;margin:2px 0 7px'>" +
        (r.property_type ? r.property_type + (bdrLabel ? " · " : "") : "") + bdrLabel +
      "</div>" +
      "<table style='width:100%;font-size:.78rem;border-collapse:collapse'>" +
        "<tr><td style='color:#94a3b8;padding:2px 0'>Occupancy</td>" +
            "<td style='text-align:right;font-weight:600;color:" + occCol + "'>" +
              (avgOcc != null ? avgOcc + "%" : "—") + "</td></tr>" +
        "<tr><td style='color:#94a3b8;padding:2px 0'>Avg Price</td>" +
            "<td style='text-align:right;font-weight:600'>" +
              (avgPrice != null ? "€" + avgPrice : "—") + "</td></tr>" +
        "<tr><td style='color:#94a3b8;padding:2px 0'>Area</td>" +
            "<td style='text-align:right'>" + (r.area || "—") + "</td></tr>" +
      "</table></div>";
    const marker = L.circleMarker([r.latitude, r.longitude], {{
      radius: 6, color: initCol, fillColor: initCol, fillOpacity: 0.8, weight: 1,
    }});
    marker.bindTooltip(r.name || ("Listing " + r.listing_id), {{sticky:true}});
    marker.bindPopup(popup, {{maxWidth:260}});
    _markers.push({{ marker, areaCol, occCol }});
    clusterGroup.addLayer(marker);
    markerBounds.push([r.latitude, r.longitude]);
  }});
  map.addLayer(clusterGroup);
  if (markerBounds.length) map.fitBounds(markerBounds, {{padding: [30, 30]}});

  const drawnItems = new L.FeatureGroup().addTo(map);
  const drawCtrlOptions = {{
    draw: {{ rectangle:true, polygon:true, circle:false, circlemarker:false, marker:false, polyline:false }},
    edit: {{ featureGroup:drawnItems, edit:false, remove:false }},
  }};
  map.addControl(new L.Control.Draw(drawCtrlOptions));

  // Fullscreen overlay draw buttons — trigger Leaflet draw handlers directly
  const rectHandler = new L.Draw.Rectangle(map, drawCtrlOptions.draw.rectangle||{{}});
  const polyHandler = new L.Draw.Polygon(map, drawCtrlOptions.draw.polygon||{{}});
  document.getElementById("mapDrawRectBtn").addEventListener("click", () => rectHandler.enable());
  document.getElementById("mapDrawPolyBtn").addEventListener("click", () => polyHandler.enable());

  map.on("draw:created", function(e) {{
    if (state.zones.length >= 3) {{
      alert("Maximum 3 comparison zones. Remove a zone first.");
      return;
    }}
    const slotId = [0,1,2].find(i => !state.zones.some(z => z.id===i));
    const color  = ZONE_COLORS[slotId], label = ZONE_LABELS[slotId];
    if (e.layer.setStyle) e.layer.setStyle({{color, fillColor:color, fillOpacity:0.15, weight:2}});
    drawnItems.addLayer(e.layer);

    let polygon;
    if (e.layerType === "rectangle") {{
      const b = e.layer.getBounds();
      polygon = [{{lat:b.getNorth(),lng:b.getWest()}},{{lat:b.getNorth(),lng:b.getEast()}},
                 {{lat:b.getSouth(),lng:b.getEast()}},{{lat:b.getSouth(),lng:b.getWest()}}];
    }} else {{
      polygon = e.layer.getLatLngs()[0].map(p=>(({{lat:p.lat,lng:p.lng}})));
    }}

    state.zones.push({{id:slotId, polygon, color, label, drawnLayer:e.layer}});
    updateMapUI(); render();
  }});
}}

buildFiltersUI();
render();
initMap();
</script>
</body>
</html>
"""

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Dashboard written → {out_path}")


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else DB_PATH
    generate(db_path=db)
