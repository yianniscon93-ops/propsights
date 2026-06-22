"""
cyprus_area_assigner.py
========================
Drop-in module to enrich listings with Cyprus administrative hierarchy.

Usage:
    from cyprus_area_assigner import AreaAssigner
    assigner = AreaAssigner("cyprus_areas.csv")
    result = assigner.assign(lat=34.7252, lng=33.1382)
    # => {
    #   'district': 'Limassol',
    #   'municipality': 'Germasogeia',
    #   'community': 'Agios Tychon',
    #   'quarter': None,
    #   'area_label': 'Limassol / Germasogeia / Agios Tychon',
    #   'area_id': 'C5124',
    #   'match_distance_km': 0.42,
    # }

    # Or in a pandas pipeline:
    import pandas as pd
    df = pd.read_parquet("listings.parquet")
    df = assigner.enrich_dataframe(df, lat_col="latitude", lng_col="longitude")
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Area:
    area_id: str
    name_en: str
    name_el: str
    type: str
    district: str
    parent_id: str
    latitude: float
    longitude: float
    search_radius_km: float
    priority: int
    confidence: str


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


class AreaAssigner:
    def __init__(self, csv_path: str | Path):
        self.areas: list[Area] = []
        with open(csv_path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                self.areas.append(Area(
                    area_id=row["area_id"],
                    name_en=row["name_en"],
                    name_el=row["name_el"],
                    type=row["type"],
                    district=row["district"],
                    parent_id=row["parent_id"],
                    latitude=float(row["latitude"]),
                    longitude=float(row["longitude"]),
                    search_radius_km=float(row["search_radius_km"]),
                    priority=int(row["priority"]),
                    confidence=row["confidence"],
                ))
        # Pre-sort by priority so specific types are tried first
        self.areas.sort(key=lambda a: a.priority)

        # Index by type for fast per-level lookup
        self._by_type: dict[str, list[Area]] = {}
        for a in self.areas:
            self._by_type.setdefault(a.type, []).append(a)

    def _nearest_within(self, lat: float, lng: float,
                        areas: list[Area]) -> tuple[Area, float] | None:
        """Nearest area whose distance is within its search_radius_km."""
        best: tuple[Area, float] | None = None
        for a in areas:
            d = haversine_km(lat, lng, a.latitude, a.longitude)
            if d > a.search_radius_km:
                continue
            if best is None or d < best[1]:
                best = (a, d)
        return best

    def _nearest(self, lat: float, lng: float,
                 areas: list[Area]) -> tuple[Area, float] | None:
        """Nearest area regardless of radius."""
        if not areas:
            return None
        best = min(areas, key=lambda a: haversine_km(lat, lng, a.latitude, a.longitude))
        return best, haversine_km(lat, lng, best.latitude, best.longitude)

    def assign(self, lat: float, lng: float) -> dict:
        """
        Assign a listing to its most specific administrative area.

        Returns a dict with district / municipality / community / quarter / parish
        names, a human-readable area_label, and the area_id + distance for audit.
        """
        result = {
            "district": None,
            "municipality": None,
            "community": None,
            "quarter": None,
            "parish": None,
            "tourist_area": None,
            "area_id": None,
            "area_label": None,
            "match_distance_km": None,
            "match_confidence": None,
        }

        # District: always assign to nearest (radius is wide)
        d = self._nearest(lat, lng, self._by_type.get("district", []))
        if d:
            result["district"] = d[0].name_en

        # Municipality: nearest within radius
        m = self._nearest_within(lat, lng, self._by_type.get("municipality", []))
        if m:
            result["municipality"] = m[0].name_en

        # Community: nearest within radius
        c = self._nearest_within(lat, lng, self._by_type.get("community", []))
        if c:
            result["community"] = c[0].name_en

        # Tourist area: nearest within radius (special sub-areas like Protaras)
        t = self._nearest_within(lat, lng, self._by_type.get("tourist_area", []))
        if t:
            result["tourist_area"] = t[0].name_en
            # Tourist areas know their parent municipality — use it instead
            # of nearest-neighbour which can pick the wrong one (e.g. Protaras
            # is in Paralimni municipality, not Agia Napa even if Agia Napa
            # is geographically closer).
            if t[0].parent_id:
                parent = next((a for a in self.areas if a.area_id == t[0].parent_id), None)
                if parent and parent.type == "municipality":
                    result["municipality"] = parent.name_en

        # Quarter: nearest within radius (only relevant inside city limits)
        q = self._nearest_within(lat, lng, self._by_type.get("quarter", []))
        if q:
            result["quarter"] = q[0].name_en

        # Parish: even finer (Strovolos/Lakatamia/Agios Dometios subdivisions)
        p = self._nearest_within(lat, lng, self._by_type.get("parish", []))
        if p:
            result["parish"] = p[0].name_en

        # Pick the most specific match as the primary label
        best = None
        for candidate in (p, q, t, c, m, d):
            if candidate is not None:
                best = candidate
                break

        if best:
            area, dist = best
            result["area_id"] = area.area_id
            result["match_distance_km"] = round(dist, 3)
            result["match_confidence"] = area.confidence

            # Human-readable hierarchical label. Tourist_area beats community
            # at the leaf level because it's what STR users recognize.
            leaf = (result["tourist_area"]
                    or result["parish"]
                    or result["quarter"]
                    or result["community"])
            parts = [x for x in [
                result["district"],
                result["municipality"],
                leaf,
            ] if x]
            # dedupe consecutive duplicates (e.g., Larnaca district + Larnaca municipality)
            deduped = []
            for x in parts:
                if not deduped or deduped[-1] != x:
                    deduped.append(x)
            result["area_label"] = " / ".join(deduped) if deduped else None

        return result

    def enrich_dataframe(self, df, lat_col: str = "latitude",
                         lng_col: str = "longitude",
                         prefix: str = "area_"):
        """
        Add area columns to a pandas DataFrame.

        New columns (prefixed): district, municipality, community, quarter,
        parish, id, label, distance_km, confidence.
        """
        import pandas as pd
        results = [self.assign(lat, lng) for lat, lng in zip(df[lat_col], df[lng_col])]
        enriched = pd.DataFrame(results)
        enriched.columns = [prefix + c.replace("match_", "") for c in enriched.columns]
        return pd.concat([df.reset_index(drop=True), enriched], axis=1)


if __name__ == "__main__":
    # Smoke test
    import sys
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "cyprus_areas.csv"
    a = AreaAssigner(csv_path)
    print(f"Loaded {len(a.areas)} areas\n")

    test_points = [
        ("Agios Tychon villa",    34.7252, 33.1382),
        ("Nicosia old town",      35.1735, 33.3635),
        ("Paphos harbour",        34.7549, 32.4075),
        ("Protaras beach",        35.0122, 34.0591),
        ("Kato Paphos resort",    34.7624, 32.4178),
        ("Strovolos apartment",   35.1518, 33.3570),
        ("Limassol marina",       34.6702, 33.0404),
        ("Troodos mountains",     34.9219, 32.8794),
    ]
    for label, lat, lng in test_points:
        r = a.assign(lat, lng)
        print(f"{label:<25} → {r['area_label']}  ({r['match_distance_km']}km, {r['match_confidence']})")
