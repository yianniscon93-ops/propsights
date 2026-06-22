# CLAUDE.md

Python-based Airbnb scraping and analysis system for Cyprus STR listings. Bronze/silver/gold pipeline in DuckDB. See [DATA_MODEL.md](DATA_MODEL.md) for full schema.

## Running

```bash
python3.13 run_availability.py   # availability only (runs every 2 days on server)
python3.13 run_discovery.py      # listing discovery (monthly on server)
python3.13 run_pricing.py        # pricing (weekly on server)
python3.13 run_enrichment.py     # listing detail enrichment (weekly on server)
```

## Structure

```
run_availability.py / run_discovery.py / run_pricing.py
run_enrichment.py           # listing detail enrichment (amenities, ratings, superhost)
run_bazaraki_sale.py / run_bazaraki_rental.py / run_bazaraki_enrich.py
enrich_listings_areas.py    # assigns district/municipality/community → writes listings_v2
                            # auto-called by run_discovery.py and run_pricing.py
scraper/airbnb_client.py    # get_api_key(), search_by_area(), get_calendar()
scraper/areas.py            # bounding box definitions
storage/storage.py          # DuckDB layer — init_db(), write_bronze(), update_silver()
areas_cyprus/               # cyprus_area_assigner.py + cyprus_areas.csv
bnb.duckdb                  # database (server: /opt/bnb_git/bnb.duckdb)
```

## Key Notes

**API client** — uses `curl_cffi` with `impersonate="chrome124"`. Do not swap for `requests` (Airbnb TLS fingerprint check). `get_api_key()` scrapes a live rotating key; call once per session.

**Price** — the calendar endpoint returns no price. Price comes from `search_by_area()`, attached to calendar records by `listing_id`.

**Booking detection** — `update_silver()` detects `true→false` availability flips by JOINing incoming bronze against existing silver *before* the upsert overwrites old state.

**Area enrichment** — `enrich_listings_areas.py` rebuilds `listings_v2` (listings + area columns). The swap `listings_v2 → listings` is manual after review.

**listings_archived** — original listings table before area enrichment swap; kept as safety net.
