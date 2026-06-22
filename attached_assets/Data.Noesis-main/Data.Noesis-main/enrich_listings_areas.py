"""
Enrich listings with geographic area data from cyprus_area_assigner.
Writes results to listings_v2 (listings table unchanged — swap manually after review).

Can be run standalone or imported and called via run(db_path).
"""
import sys
import logging
from pathlib import Path
import pandas as pd
import duckdb

sys.path.insert(0, str(Path(__file__).parent / "areas_cyprus"))
from cyprus_area_assigner import AreaAssigner

log = logging.getLogger(__name__)

CSV_PATH = Path(__file__).parent / "areas_cyprus" / "cyprus_areas.csv"
DB_PATH  = Path(__file__).parent / "bnb.duckdb"


def run(db_path: Path | str | None = None) -> int:
    """
    Enrich all listings with area data and write to listings_v2.
    Returns number of rows written.
    """
    db_path = Path(db_path) if db_path else DB_PATH

    log.info("Area enrichment: loading areas...")
    assigner = AreaAssigner(CSV_PATH)
    log.info(f"Area enrichment: {len(assigner.areas)} areas loaded")

    con = duckdb.connect(str(db_path))
    try:
        df = con.execute("SELECT listing_id, name, area, latitude, longitude FROM listings").fetchdf()
        log.info(f"Area enrichment: {len(df)} listings read")

        enriched = assigner.enrich_dataframe(df, lat_col="latitude", lng_col="longitude", prefix="area_")
        new_cols = [c for c in enriched.columns if c.startswith("area_")]
        log.info(f"Area enrichment: columns added — {new_cols}")

        # Stats
        COL_LABEL = "area_area_label"
        total   = len(enriched)
        labeled = enriched[COL_LABEL].notna().sum() if COL_LABEL in enriched.columns else 0
        log.info(f"Area enrichment: {labeled}/{total} listings matched to an area label")

        # Write listings_v2
        con.execute("DROP TABLE IF EXISTS listings_v2")
        full_df  = con.execute("SELECT * FROM listings").fetchdf()
        area_cols = enriched[["listing_id"] + new_cols].copy()
        full_v2  = full_df.merge(area_cols, on="listing_id", how="left")
        con.register("_listings_v2_tmp", full_v2)
        con.execute("CREATE TABLE listings_v2 AS SELECT * FROM _listings_v2_tmp")
        count = con.execute("SELECT COUNT(*) FROM listings_v2").fetchone()[0]
        log.info(f"Area enrichment: listings_v2 written — {count} rows, {len(full_v2.columns)} columns")

    finally:
        con.close()

    return count


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)s  %(message)s",
        datefmt="%H:%M:%S",
    )

    count = run()

    # Detailed stats for manual review when run standalone
    con = duckdb.connect(str(DB_PATH))
    try:
        enriched = con.execute("SELECT * FROM listings_v2").fetchdf()
        COL_LABEL   = "area_area_label"
        COL_MUNI    = "area_municipality"
        COL_COMM    = "area_community"
        COL_DIST    = "area_distance_km"
        COL_CONF    = "area_confidence"
        COL_TOURIST = "area_tourist_area"

        total   = len(enriched)
        labeled = enriched[COL_LABEL].notna().sum()
        print(f"\n{'='*60}")
        print(f"TOTAL LISTINGS PROCESSED : {total}")
        print(f"WITH area_label          : {labeled}")
        print(f"WITHOUT area_label (null): {total - labeled}")

        print("\n── Top 20 municipalities ─────────────────────────────────")
        for name, cnt in enriched[COL_MUNI].fillna("(none)").value_counts().head(20).items():
            print(f"  {cnt:>5}  {name}")

        print("\n── Top 30 communities ────────────────────────────────────")
        for name, cnt in enriched[COL_COMM].fillna("(none)").value_counts().head(30).items():
            print(f"  {cnt:>5}  {name}")

        max_dist    = enriched[COL_DIST].max()
        bad_geocode = enriched[enriched[COL_DIST] > 15]
        print(f"\n── Distance sanity ───────────────────────────────────────")
        print(f"  Max area_distance_km : {max_dist:.3f} km")
        print(f"  Listings >15 km away : {len(bad_geocode)}")

        print("\n── Confidence breakdown ──────────────────────────────────")
        for k, v in enriched[COL_CONF].fillna("(none)").value_counts().items():
            print(f"  {v:>5}  {k}")

        print("\n── 20 random listings: old area vs new area_label ────────")
        sample = enriched[["listing_id", "name", "area", COL_LABEL, COL_DIST, COL_CONF]].sample(20, random_state=42)
        for _, row in sample.iterrows():
            old  = row["area"] or "(null)"
            new  = row[COL_LABEL] or "(null)"
            dist = f"{row[COL_DIST]:.3f}km" if pd.notna(row[COL_DIST]) else "?"
            conf = row[COL_CONF] or "?"
            print(f"  {str(row['listing_id']):<20}  {old:<30}  →  {new}  ({dist}, {conf})")

        protaras = enriched[enriched[COL_LABEL].str.contains("Protaras", na=False)]
        print(f"\n── Protaras check ────────────────────────────────────────")
        print(f"  Listings with 'Protaras' in area_label: {len(protaras)}")

        print(f"\nDone. Validate diff above then swap: ALTER TABLE listings RENAME TO listings_old; ALTER TABLE listings_v2 RENAME TO listings;")
    finally:
        con.close()
