"""
Grid-based area configuration for the BNB scraper.

generate_grid() yields non-overlapping tiles covering the target city area.
assign_neighborhood() maps a listing's coordinates to a named neighbourhood label.
"""

# City bounding boxes
NICOSIA_BBOX          = {"ne_lat": 35.22, "ne_lng": 33.47, "sw_lat": 35.09, "sw_lng": 33.29}
NICOSIA_SUBURBS_BBOX  = {"ne_lat": 35.10, "ne_lng": 33.55, "sw_lat": 34.95, "sw_lng": 33.15}  # Strovolos, Lakatamia, Latsia, Aglantzia, Dali, Tseri
PAPHOS_BBOX           = {"ne_lat": 34.82, "ne_lng": 32.47, "sw_lat": 34.70, "sw_lng": 32.36}
PAPHOS_COAST_BBOX     = {"ne_lat": 34.90, "ne_lng": 32.55, "sw_lat": 34.65, "sw_lng": 32.25}  # Kato Paphos, Chloraka, Coral Bay, Peyia, Yeroskipou
DROUSHIA_BBOX         = {"ne_lat": 35.04, "ne_lng": 32.44, "sw_lat": 34.93, "sw_lng": 32.32}  # Droushia + Inia
POLIS_LATCHI_BBOX     = {"ne_lat": 35.10, "ne_lng": 32.65, "sw_lat": 34.93, "sw_lng": 32.44}  # Polis, Latchi, Neo Chorio, Akamas Peninsula
PISSOURI_BBOX         = {"ne_lat": 34.75, "ne_lng": 32.85, "sw_lat": 34.60, "sw_lng": 32.55}  # coastal village between Limassol and Paphos
LIMASSOL_BBOX         = {"ne_lat": 34.85, "ne_lng": 33.25, "sw_lat": 34.55, "sw_lng": 32.85}  # City, Marina, Agios Tychonas, Mouttagiaka, Amathunta
LARNACA_BBOX          = {"ne_lat": 35.05, "ne_lng": 33.85, "sw_lat": 34.75, "sw_lng": 33.10}  # City, Mackenzie, Pervolia, Kiti, Salt Lake — extended west to 33.10 to close Troodos gap
TROODOS_BBOX          = {"ne_lat": 35.05, "ne_lng": 33.10, "sw_lat": 34.85, "sw_lng": 32.65}  # Platres, Kakopetria, wine villages
KOKKINOCHORIA_BBOX    = {"ne_lat": 35.10, "ne_lng": 34.00, "sw_lat": 34.95, "sw_lng": 33.80}  # Red villages between Larnaca and Famagusta
AYIA_NAPA_BBOX        = {"ne_lat": 35.15, "ne_lng": 34.35, "sw_lat": 34.93, "sw_lng": 34.00}  # Ayia Napa, Fig Tree Bay, Protaras, Paralimni, Deryneia, Cape Greko
SOUTH_COAST_BBOX      = {"ne_lat": 34.75, "ne_lng": 33.85, "sw_lat": 34.55, "sw_lng": 33.25}  # Governor's Beach, Mazotos, Cape Kiti, Zygi — south coast between Limassol and Larnaca
LARNACA_SOUTH_BBOX    = {"ne_lat": 34.93, "ne_lng": 34.35, "sw_lat": 34.55, "sw_lng": 33.85}  # Coastal strip south/east of Larnaca: Dhekelia coast, Xylofagou, east coast
NICOSIA_EAST_BBOX     = {"ne_lat": 35.10, "ne_lng": 33.80, "sw_lat": 34.95, "sw_lng": 33.55}  # Inland corridor between Nicosia suburbs and Kokkinochoria

GRID_STEP = 0.02  # degrees per cell (~1.5–2 km); reduce to 0.01 if a tile returns >200 listings


# Neighbourhood polygon definitions: list of (lat, lng) vertices forming a closed polygon.
# These are approximate — replace with OSM-derived boundaries for production accuracy.
# Polygons must be non-overlapping; a listing is assigned to the first matching polygon.
NICOSIA_NEIGHBORHOODS: dict[str, list[tuple[float, float]]] = {
    "nicosia_downtown": [
        (35.182, 33.352), (35.182, 33.385),
        (35.162, 33.385), (35.162, 33.352),
    ],
    "agios_antonios": [
        (35.182, 33.372), (35.182, 33.354),
        (35.168, 33.354), (35.168, 33.372),
    ],
    "agioi_omologites": [
        (35.168, 33.345), (35.168, 33.374),
        (35.148, 33.374), (35.148, 33.345),
    ],
    "akropoli": [
        (35.162, 33.352), (35.162, 33.385),
        (35.133, 33.385), (35.133, 33.352),
    ],
    "aglantzia": [
        (35.168, 33.383), (35.168, 33.441),
        (35.118, 33.441), (35.118, 33.383),
    ],
}

# Keep old name as alias for backward compatibility
NEIGHBORHOODS = NICOSIA_NEIGHBORHOODS

# City configuration: bbox, named neighbourhoods, and fallback area label
CITY_CONFIG: dict[str, dict] = {
    "nicosia": {
        "bbox":          NICOSIA_BBOX,
        "neighborhoods": NICOSIA_NEIGHBORHOODS,
        "fallback":      "nicosia_other",
    },
    "nicosia_suburbs": {
        "bbox":          NICOSIA_SUBURBS_BBOX,
        "neighborhoods": {},
        "fallback":      "nicosia_suburbs_other",
    },
    "paphos": {
        "bbox":          PAPHOS_BBOX,
        "neighborhoods": {},
        "fallback":      "paphos_other",
    },
    "paphos_coast": {
        "bbox":          PAPHOS_COAST_BBOX,
        "neighborhoods": {},
        "fallback":      "paphos_coast_other",
    },
    "droushia": {
        "bbox":          DROUSHIA_BBOX,
        "neighborhoods": {},
        "fallback":      "droushia_other",
    },
    "polis_latchi": {
        "bbox":          POLIS_LATCHI_BBOX,
        "neighborhoods": {},
        "fallback":      "polis_latchi_other",
    },
    "pissouri": {
        "bbox":          PISSOURI_BBOX,
        "neighborhoods": {},
        "fallback":      "pissouri_other",
    },
    "limassol": {
        "bbox":          LIMASSOL_BBOX,
        "neighborhoods": {},
        "fallback":      "limassol_other",
    },
    "larnaca": {
        "bbox":          LARNACA_BBOX,
        "neighborhoods": {},
        "fallback":      "larnaca_other",
    },
    "troodos": {
        "bbox":          TROODOS_BBOX,
        "neighborhoods": {},
        "fallback":      "troodos_other",
    },
    "kokkinochoria": {
        "bbox":          KOKKINOCHORIA_BBOX,
        "neighborhoods": {},
        "fallback":      "kokkinochoria_other",
    },
    "ayia_napa": {
        "bbox":          AYIA_NAPA_BBOX,
        "neighborhoods": {},
        "fallback":      "ayia_napa_other",
    },
    "south_coast": {
        "bbox":          SOUTH_COAST_BBOX,
        "neighborhoods": {},
        "fallback":      "south_coast_other",
    },
    "larnaca_south": {
        "bbox":          LARNACA_SOUTH_BBOX,
        "neighborhoods": {},
        "fallback":      "larnaca_south_other",
    },
    "nicosia_east": {
        "bbox":          NICOSIA_EAST_BBOX,
        "neighborhoods": {},
        "fallback":      "nicosia_east_other",
    },
}


def generate_grid(city: str = "nicosia", step: float = GRID_STEP):
    """Yield non-overlapping search cell dicts (ne_lat, ne_lng, sw_lat, sw_lng)."""
    bbox = CITY_CONFIG[city]["bbox"]
    lat = bbox["sw_lat"]
    while lat < bbox["ne_lat"]:
        lng = bbox["sw_lng"]
        while lng < bbox["ne_lng"]:
            yield {
                "ne_lat": round(min(lat + step, bbox["ne_lat"]), 6),
                "ne_lng": round(min(lng + step, bbox["ne_lng"]), 6),
                "sw_lat": round(lat, 6),
                "sw_lng": round(lng, 6),
            }
            lng = round(lng + step, 6)
        lat = round(lat + step, 6)


def assign_neighborhood(lat: float, lng: float, city: str = "nicosia") -> str:
    """Return the neighbourhood name for a coordinate, or the city fallback label."""
    cfg = CITY_CONFIG.get(city, CITY_CONFIG["nicosia"])
    if lat is None or lng is None:
        return cfg["fallback"]
    for name, poly in cfg["neighborhoods"].items():
        if _point_in_polygon(lat, lng, poly):
            return name
    return cfg["fallback"]


def _point_in_polygon(lat: float, lng: float, poly: list[tuple[float, float]]) -> bool:
    """Ray-casting point-in-polygon test."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > lng) != (yj > lng)) and (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside
