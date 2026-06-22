"""
Rule-based extraction of structured attributes from Airbnb listing descriptions.
No LLM required — uses regex and keyword matching.

Usage:
    from analytics.description_parser import parse_description
    attrs = parse_description(name, description)
"""

import re
from dataclasses import dataclass, field


@dataclass
class ListingAttributes:
    floor_level:         str | None       = None   # 'ground' | 'low' | 'high' | 'top'
    view:                list[str]        = field(default_factory=list)
    size_sqm:            int | None       = None
    building_features:   list[str]        = field(default_factory=list)
    proximity_beach_min: int | None       = None
    proximity_center_min:int | None       = None
    proximity_airport_min:int | None      = None
    guest_profile:       list[str]        = field(default_factory=list)
    host_type:           str | None       = None   # 'business' | 'individual'
    description_quality: str | None       = None   # 'rich' | 'minimal' | 'boilerplate'
    notes:               list[str]        = field(default_factory=list)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm(text: str) -> str:
    """Lowercase + collapse whitespace."""
    return re.sub(r"\s+", " ", text.lower())


def _any_kw(text: str, keywords: list[str]) -> bool:
    return any(kw in text for kw in keywords)


def _first_number_before(text: str, keywords: list[str]) -> int | None:
    """Find 'X min' or 'X km' before/after any keyword."""
    for kw in keywords:
        # pattern: <number> min(utes)? (walk|drive)? ... keyword
        m = re.search(rf"(\d+)\s*(?:min|minute)s?(?:\s*(?:walk|drive|away))?\s*(?:from\s*)?(?:the\s*)?{re.escape(kw)}", text)
        if m:
            return int(m.group(1))
        # pattern: keyword ... <number> min
        m = re.search(rf"{re.escape(kw)}[^.]*?(\d+)\s*(?:min|minute)s?", text)
        if m:
            return int(m.group(1))
    return None


# ── Extractors ────────────────────────────────────────────────────────────────

def _host_type(text: str) -> str | None:
    if "host as a business" in text or "hosts as a business" in text:
        return "business"
    if "host as an individual" in text or "hosts as an individual" in text:
        return "individual"
    return None


def _description_quality(raw: str) -> str:
    boilerplate_markers = [
        "solely responsible for offering this listing",
        "consumer protection laws don't apply",
        "to help protect yourself from fraud",
        "business registration number",
        "cvr number",
    ]
    low = raw.lower()
    if any(m in low for m in boilerplate_markers):
        # Check if there's real content beyond the legal block
        # Strip the legal boilerplate and see what's left
        real_lines = [
            ln for ln in raw.splitlines()
            if ln.strip() and not any(m in ln.lower() for m in boilerplate_markers)
            and "airbnb" not in ln.lower()
            and "help center" not in ln.lower()
        ]
        real_text = " ".join(real_lines).strip()
        if len(real_text) < 80:
            return "boilerplate"
    if len(raw.strip()) < 100:
        return "minimal"
    return "rich"


def _floor_level(text: str) -> str | None:
    # Top floor signals
    if _any_kw(text, ["top floor", "penthouse", "rooftop apartment", "last floor", "uppermost"]):
        return "top"
    # Ground floor
    if _any_kw(text, ["ground floor", "ground level", "garden level"]):
        return "ground"
    # Explicit floor number — e.g. "12th floor", "on the 4th floor"
    m = re.search(r"(?:on the\s+)?(\d+)(?:st|nd|rd|th)\s+floor", text)
    if m:
        n = int(m.group(1))
        if n == 1:
            return "low"
        elif n <= 3:
            return "low"
        else:
            return "high"
    # Named floor patterns in title — "SkyHigh", "High Floor"
    if _any_kw(text, ["high floor", "skyhigh", "sky high", "upper floor"]):
        return "high"
    if _any_kw(text, ["first floor", "1st floor", "second floor", "2nd floor"]):
        return "low"
    return None


def _view(text: str) -> list[str]:
    views = []
    if _any_kw(text, ["sea view", "ocean view", "sea front", "seafront", "beachfront",
                       "sea facing", "overlooking the sea", "overlooking the ocean"]):
        views.append("sea")
    if _any_kw(text, ["park view", "overlooking the park", "overlooking a park",
                       "opposite a park", "opposite the park"]):
        views.append("park")
    if _any_kw(text, ["forest", "pine trees", "pine forest", "overlooking the forest"]):
        views.append("forest")
    if _any_kw(text, ["mountain view", "mountain views", "overlooking the mountain"]):
        views.append("mountain")
    if _any_kw(text, ["city view", "city skyline", "skyline", "panoramic view",
                       "panoramic views", "overlooking the city"]):
        views.append("city")
    if _any_kw(text, ["pool view", "overlooking the pool"]):
        views.append("pool")
    if _any_kw(text, ["garden view", "overlooking the garden", "overlooking a garden"]):
        views.append("garden")
    return views


def _size_sqm(text: str) -> int | None:
    m = re.search(r"(\d{2,4})\s*(?:sqm|sq\.?\s*m|m²|square\s*met(?:er|re)s?)", text)
    return int(m.group(1)) if m else None


def _building_features(text: str) -> list[str]:
    features = []
    checks = [
        (["pool", "swimming pool"],                     "pool"),
        (["gym", "fitness center", "fitness centre"],   "gym"),
        (["jacuzzi", "hot tub"],                        "jacuzzi"),
        (["sauna"],                                     "sauna"),
        (["rooftop pool", "rooftop bar", "rooftop terrace", "rooftop access"], "rooftop"),
        (["concierge", "24/7 reception", "reception"],  "concierge"),
        (["private parking", "parking space", "parking available", "car parking"], "parking"),
        (["elevator", "lift"],                          "elevator"),
        (["bbq", "barbecue"],                           "bbq"),
        (["fireplace", "log fire", "wood burning"],     "fireplace"),
    ]
    for keywords, label in checks:
        if _any_kw(text, keywords):
            features.append(label)
    return features


def _proximity(text: str) -> tuple[int | None, int | None, int | None]:
    beach = _first_number_before(text, ["beach", "beaches", "the sea", "the coast"])
    center = _first_number_before(text, ["center", "centre", "city center", "town center",
                                          "village center", "town", "downtown"])
    airport = _first_number_before(text, ["airport"])
    return beach, center, airport


def _guest_profile(raw_text: str, title: str) -> list[str]:
    text = raw_text + " " + title
    profiles = []
    if _any_kw(text, ["ideal for families", "perfect for families", "family friendly",
                       "family-friendly", "suitable for families", "kids", "children"]):
        profiles.append("families")
    if _any_kw(text, ["perfect for couples", "ideal for couples", "romantic", "honeymoon"]):
        profiles.append("couples")
    if _any_kw(text, ["university", "students", "student"]):
        profiles.append("students")
    if _any_kw(text, ["business traveler", "business traveller", "business trip",
                       "corporate", "work from"]):
        profiles.append("business")
    if _any_kw(text, ["groups", "group of friends", "large group"]):
        profiles.append("groups")
    return profiles


def _notes(text: str, title: str) -> list[str]:
    combined = text + " " + title
    found = []
    checks = [
        (["newly renovated", "recently renovated", "fully renovated"], "newly renovated"),
        (["traditional", "stone house", "village house", "heritage"],  "traditional property"),
        (["historic", "old town", "walled city", "old city"],          "historic area"),
        (["luxury", "5 star", "five star", "premium", "high-end"],     "luxury"),
        (["private pool", "own pool"],                                  "private pool"),
        (["sea front", "seafront", "beachfront", "steps from the beach"], "beachfront"),
    ]
    for keywords, label in checks:
        if _any_kw(combined, keywords):
            found.append(label)
    return found


# ── Main entry point ──────────────────────────────────────────────────────────

def parse_description(name: str, description: str | None) -> ListingAttributes:
    """
    Extract structured attributes from a listing name + description.
    Returns ListingAttributes with None/empty for fields that could not be determined.
    """
    if not description:
        return ListingAttributes(description_quality="boilerplate")

    norm = _norm(description)
    norm_full = _norm(name + " " + description)

    beach_min, center_min, airport_min = _proximity(norm)

    return ListingAttributes(
        floor_level          = _floor_level(norm_full),
        view                 = _view(norm_full),
        size_sqm             = _size_sqm(norm),
        building_features    = _building_features(norm),
        proximity_beach_min  = beach_min,
        proximity_center_min = center_min,
        proximity_airport_min= airport_min,
        guest_profile        = _guest_profile(norm, name.lower()),
        host_type            = _host_type(norm),
        description_quality  = _description_quality(description),
        notes                = _notes(norm, name.lower()),
    )
