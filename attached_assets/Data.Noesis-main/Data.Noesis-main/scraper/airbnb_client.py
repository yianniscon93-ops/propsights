"""
Airbnb API client — implemented directly from the Airbnb GraphQL/REST API.
No pyairbnb dependency. Uses curl_cffi for TLS fingerprinting on search requests.

Four capabilities:
  1. get_api_key()        — scrape a valid API key from airbnb.com
  2. get_calendar()       — availability calendar for a listing (12 months)
  3. search_by_area()     — search listings in a bounding box, returns IDs + nightly prices
  4. get_listing_details() — amenities, ratings, superhost/verified from listing HTML page
"""

import re
import json
import time
import random
import logging
import base64
from datetime import datetime, timedelta
from urllib.parse import urlencode, quote
from curl_cffi import requests

log = logging.getLogger(__name__)

# Retry config for rate-limited requests
_BACKOFF_BASE    = 5    # seconds — first retry wait
_BACKOFF_MAX     = 300  # seconds — cap at 5 minutes
_BACKOFF_RETRIES = 6    # attempts before giving up


def _request_with_backoff(method: str, url: str, **kwargs) -> requests.Response:
    """
    Wrap a curl_cffi request with exponential backoff on 429/502/503.
    When a proxy is in use, 403 is retried with a short delay (blocked IP —
    rotating proxy assigns a fresh IP on the next connection).
    Without a proxy, 403 raises immediately (hard account block).
    """
    using_proxy = bool((kwargs.get("proxies") or {}).get("http"))
    delay = _BACKOFF_BASE
    for attempt in range(1, _BACKOFF_RETRIES + 1):
        response = getattr(requests, method)(url, **kwargs)

        if response.status_code == 403:
            if not using_proxy:
                raise RuntimeError(f"Hard block (403) — IP banned, no proxy configured: {url[:80]}")
            if attempt == _BACKOFF_RETRIES:
                raise RuntimeError(f"403 persists after {_BACKOFF_RETRIES} retries — proxy pool may be blocked")
            wait = random.uniform(2, 5)  # short wait — just enough for rotating proxy to assign new IP
            log.warning(f"Blocked IP via proxy (403) — rotating IP, retrying in {wait:.0f}s (attempt {attempt}/{_BACKOFF_RETRIES})")
            time.sleep(wait)
            continue

        if response.status_code in (429, 502, 503):
            if attempt == _BACKOFF_RETRIES:
                raise RuntimeError(f"Rate limit persists after {_BACKOFF_RETRIES} retries ({response.status_code})")
            jitter = random.uniform(0, delay * 0.3)
            wait = min(delay + jitter, _BACKOFF_MAX)
            log.warning(f"Rate limited ({response.status_code}) — waiting {wait:.0f}s (attempt {attempt}/{_BACKOFF_RETRIES})")
            time.sleep(wait)
            delay = min(delay * 2, _BACKOFF_MAX)
            continue

        return response
    raise RuntimeError("Backoff loop exhausted")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_nested_value(d: dict, key_path: str, default=None):
    """Safely traverse a nested dict using dot-separated key path."""
    current = d
    for key in key_path.split("."):
        if not isinstance(current, dict):
            return default
        current = current.get(key, {})
        if current == {} or current is None:
            return default
    return current


def parse_price_symbol(price_raw: str) -> tuple[float, str]:
    """Extract numeric amount and currency symbol from a price string like '$1,234.56'."""
    price_raw = price_raw.replace(",", "").replace("\xa0", "")
    match = re.search(r"\d+\.?\d*", price_raw)
    if not match:
        return 0.0, ""
    amount = float(match.group(0))
    if price_raw.startswith("-"):
        amount *= -1
    currency = price_raw.replace(match.group(0), "").replace(" ", "").replace("-", "")
    return amount, currency


_NIGHTLY_RE = re.compile(r"\d+\s+nights?\s+x\s+[^\d]*([\d.]+)", re.IGNORECASE)

def _extract_nightly_rate(description: str) -> float | None:
    """Parse nightly rate from a breakdown description like '3 nights x €47.00'."""
    match = _NIGHTLY_RE.search(description.replace("\xa0", "").replace(",", ""))
    return float(match.group(1)) if match else None


def encode_room_id(room_id: str, prefix: str = "StayListing") -> str:
    return base64.b64encode(f"{prefix}:{room_id}".encode()).decode()


def build_proxy(ip_or_domain: str, port: str, username: str, password: str) -> str:
    return f"http://{quote(username)}:{quote(password)}@{ip_or_domain}:{port}"


# ---------------------------------------------------------------------------
# API Key
# ---------------------------------------------------------------------------

_API_KEY_REGEX = re.compile(r'"api_config":\{"key":".+?"')

def get_api_key(proxy_url: str = "") -> str:
    """
    Scrape a valid Airbnb API key from the homepage.
    The key rotates occasionally — call this once per session and cache the result.
    """
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    response = requests.get("https://www.airbnb.com", headers=headers, proxies=proxies, timeout=60)
    response.raise_for_status()
    match = _API_KEY_REGEX.search(response.text)
    if not match:
        raise RuntimeError("Could not find API key in Airbnb homepage")
    return match.group(0).replace('"api_config":{"key":"', "").replace('"', "")


# ---------------------------------------------------------------------------
# Calendar (availability per day, 12 months)
# ---------------------------------------------------------------------------

_CALENDAR_HASH = "8f08e03c7bd16fcad3c92a3592c19a8b559a0d0855a84028d1163d4733ed9ade"
_CALENDAR_EP   = f"https://www.airbnb.com/api/v3/PdpAvailabilityCalendar/{_CALENDAR_HASH}/"

def get_calendar(api_key: str, room_id: str, currency: str = "EUR", proxy_url: str = "") -> list[dict]:
    """
    Fetch 12 months of calendar data for a listing.

    Returns a flat list of day dicts:
        {
            "listingId":             str,
            "calendarDate":          str  (YYYY-MM-DD),
            "available":             bool,
            "minNights":             int,
            "maxNights":             int,
            "availableForCheckin":   bool,
            "availableForCheckout":  bool,
            "bookable":              bool,
        }
    """
    today = datetime.today()
    variables = {
        "request": {
            "count": 12,
            "listingId": room_id,
            "month": today.month,
            "year": today.year,
        }
    }
    extension = {
        "persistedQuery": {"version": 1, "sha256Hash": _CALENDAR_HASH}
    }
    query = {
        "operationName": "PdpAvailabilityCalendar",
        "locale": "en",
        "currency": currency,
        "variables": json.dumps(variables),
        "extensions": json.dumps(extension),
    }
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Connection": "close",  # force new TCP connection per request — ensures rotating proxy assigns fresh IP
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-Airbnb-Api-Key": api_key,
    }
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    url = f"{_CALENDAR_EP}?{urlencode(query)}"

    response = _request_with_backoff("get", url, headers=headers, proxies=proxies, timeout=60)
    response.raise_for_status()

    calendar_months = get_nested_value(
        response.json(),
        "data.merlin.pdpAvailabilityCalendar.calendarMonths",
        []
    )

    days = []
    for month in calendar_months:
        for day in month.get("days", []):
            days.append({
                "listingId":            room_id,
                "calendarDate":         day.get("calendarDate", ""),
                "available":            day.get("available", False),
                "minNights":            day.get("minNights"),
                "maxNights":            day.get("maxNights"),
                "availableForCheckin":  day.get("availableForCheckin", False),
                "availableForCheckout": day.get("availableForCheckout", False),
                "bookable":             day.get("bookable", False),
            })
    return days


# ---------------------------------------------------------------------------
# Search by bounding box (returns listing IDs + nightly prices)
# ---------------------------------------------------------------------------

_SEARCH_FALLBACK_HASH = "9f945886dcc032b9ef4ba770d9132eb0aa78053296b5405483944c229617b00b"

_SEARCH_TREATMENT_FLAGS = [
    "feed_map_decouple_m11_treatment",
    "stays_search_rehydration_treatment_desktop",
    "stays_search_rehydration_treatment_moweb",
    "selective_query_feed_map_homepage_desktop_treatment",
    "selective_query_feed_map_homepage_moweb_treatment",
]


def fetch_search_hash(proxy_url: str = "") -> str:
    """
    Dynamically fetch the current StaysSearch operationId hash from Airbnb's JS bundle.
    Falls back to a hardcoded hash if extraction fails.
    """
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    try:
        homepage = requests.get("https://www.airbnb.com/", headers=headers, proxies=proxies, impersonate="chrome124")
        homepage.raise_for_status()

        bundle_match = re.search(
            r"https://a0\.muscache\.com/airbnb/static/packages/web/[^/]+/frontend/airmetro/browser/asyncRequire\.[^\"']+\.js",
            homepage.text,
        )
        if not bundle_match:
            return _SEARCH_FALLBACK_HASH

        bundle = requests.get(bundle_match.group(0), headers=headers, proxies=proxies, impersonate="chrome124")
        bundle.raise_for_status()

        module_match = re.search(
            r"common/frontend/stays-search/routes/StaysSearchRoute/StaysSearchRoute\.prepare\.[^\"']+\.js",
            bundle.text,
        )
        if not module_match:
            return _SEARCH_FALLBACK_HASH

        module_url = f"https://a0.muscache.com/airbnb/static/packages/web/{module_match.group(0)}"
        module = requests.get(module_url, headers=headers, proxies=proxies, impersonate="chrome124")
        module.raise_for_status()

        hash_match = re.search(r"operationId:['\"]([0-9a-f]{64})", module.text)
        return hash_match.group(1) if hash_match else _SEARCH_FALLBACK_HASH

    except Exception:
        return _SEARCH_FALLBACK_HASH


def search_by_area(
    api_key: str,
    ne_lat: float,
    ne_lng: float,
    sw_lat: float,
    sw_lng: float,
    check_in: str = "",   # YYYY-MM-DD, optional — price shown depends on dates
    check_out: str = "",  # YYYY-MM-DD, optional
    currency: str = "EUR",
    proxy_url: str = "",
    search_hash: str = "",
) -> list[dict]:
    """
    Search listings within a bounding box defined by NE and SW coordinates.

    Returns a list of listing dicts:
        {
            "room_id":         int,
            "name":            str,
            "coordinates":     {"latitude": float, "longitude": float},
            "price_per_night": float | None,  # None when no dates provided
            "rating":          {"value": float, "review_count": int},
        }

    Notes:
    - Prices are only populated when check_in/check_out are provided.
    - Paginates automatically; returns all results.
    - Uses TLS impersonation (curl_cffi chrome124) — required by Airbnb's bot detection.
    """
    operation_id = search_hash or _SEARCH_FALLBACK_HASH
    base_url = f"https://www.airbnb.com/api/v3/StaysSearch/{operation_id}"
    url = f"{base_url}?{urlencode({'operationName': 'StaysSearch', 'locale': 'en', 'currency': currency})}"

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
        "Cache-Control": "no-cache",
        "content-type": "application/json",
        "Connection": "close",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-Airbnb-Api-Key": api_key,
    }
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    all_results = []
    cursor = ""

    while True:
        raw_params = [
            {"filterName": "cdnCacheSafe",           "filterValues": ["false"]},
            {"filterName": "channel",                "filterValues": ["EXPLORE"]},
            {"filterName": "datePickerType",         "filterValues": ["calendar"]},
            {"filterName": "flexibleTripLengths",    "filterValues": ["one_week"]},
            {"filterName": "itemsPerGrid",           "filterValues": ["50"]},
            {"filterName": "monthlyLength",          "filterValues": ["3"]},
            {"filterName": "monthlyStartDate",       "filterValues": ["2024-02-01"]},
            {"filterName": "neLat",                  "filterValues": [str(ne_lat)]},
            {"filterName": "neLng",                  "filterValues": [str(ne_lng)]},
            {"filterName": "placeId",                "filterValues": ["ChIJpTeBx6wjq5oROJeXkPCSSSo"]},
            {"filterName": "priceFilterInputType",   "filterValues": ["0"]},
            {"filterName": "query",                  "filterValues": ["Galapagos Island, Ecuador"]},
            {"filterName": "screenSize",             "filterValues": ["large"]},
            {"filterName": "refinementPaths",        "filterValues": ["/homes"]},
            {"filterName": "searchByMap",            "filterValues": ["true"]},
            {"filterName": "swLat",                  "filterValues": [str(sw_lat)]},
            {"filterName": "swLng",                  "filterValues": [str(sw_lng)]},
            {"filterName": "tabId",                  "filterValues": ["home_tab"]},
            {"filterName": "version",                "filterValues": ["1.8.3"]},
            {"filterName": "zoomLevel",              "filterValues": ["12"]},
        ]

        if check_in and check_out:
            days = (datetime.strptime(check_out, "%Y-%m-%d") - datetime.strptime(check_in, "%Y-%m-%d")).days
            raw_params += [
                {"filterName": "checkin",                 "filterValues": [check_in]},
                {"filterName": "checkout",                "filterValues": [check_out]},
                {"filterName": "priceFilterNumNights",    "filterValues": [str(days)]},
            ]

        body = {
            "operationName": "StaysSearch",
            "extensions": {
                "persistedQuery": {"version": 1, "sha256Hash": operation_id}
            },
            "variables": {
                "skipExtendedSearchParams": False,
                "includeMapResults": True,
                "isLeanTreatment": False,
                "aiSearchEnabled": False,
                "staysMapSearchRequestV2": {
                    "cursor": cursor,
                    "requestedPageType": "STAYS_SEARCH",
                    "metadataOnly": False,
                    "source": "structured_search_input_header",
                    "searchType": "user_map_move",
                    "treatmentFlags": _SEARCH_TREATMENT_FLAGS,
                    "rawParams": raw_params,
                },
                "staysSearchRequest": {
                    "cursor": cursor,
                    "maxMapItems": 9999,
                    "requestedPageType": "STAYS_SEARCH",
                    "metadataOnly": False,
                    "source": "structured_search_input_header",
                    "searchType": "user_map_move",
                    "treatmentFlags": _SEARCH_TREATMENT_FLAGS,
                    "rawParams": raw_params,
                },
            },
        }

        response = _request_with_backoff("post", url, json=body, headers=headers, proxies=proxies, impersonate="chrome124")
        if response.status_code != 200:
            raise RuntimeError(f"Search failed: {response.status_code} — {response.text[:200]}")

        data = response.json()
        page_results = _parse_search_results(data)
        all_results.extend(page_results)

        next_cursor = get_nested_value(
            data,
            "data.presentation.staysSearch.results.paginationInfo.nextPageCursor"
        )
        if not next_cursor or not page_results:
            break
        cursor = next_cursor

    return all_results


_BEDROOM_RE = re.compile(r"(\d+)\s+bedroom", re.IGNORECASE)
_BED_RE     = re.compile(r"(\d+)\s+bed",    re.IGNORECASE)


def _parse_bed_info(primary_line: list[dict]) -> tuple[int | None, int | None]:
    """
    Extract bedroom count and total bed count from structuredContent.primaryLine BEDINFO items.
    Returns (bedrooms, beds). Studios (beds but no bedrooms) return (0, N).
    """
    bedrooms = None
    beds = None
    for item in primary_line:
        if item.get("type") != "BEDINFO":
            continue
        body = item.get("body", "")
        m = _BEDROOM_RE.search(body)
        if m:
            bedrooms = int(m.group(1))
            continue
        m = _BED_RE.search(body)
        if m:
            beds = (beds or 0) + int(m.group(1))
    if beds is not None and bedrooms is None:
        bedrooms = 0  # studio
    return bedrooms, beds


def _room_type(property_type: str | None) -> str:
    """Derive room_type from the property_type title prefix."""
    if not property_type:
        return "Entire place"
    pt = property_type.lower()
    if "shared room" in pt:
        return "Shared room"
    if any(k in pt for k in ("room", "guest suite")):
        return "Private room"
    if any(k in pt for k in ("hotel", "hostel")):
        return "Hotel room"
    return "Entire place"


def _parse_search_results(raw: dict) -> list[dict]:
    """Parse raw StaysSearch response into a clean list of listing dicts."""
    search_results = get_nested_value(raw, "data.presentation.staysSearch.results.searchResults", [])
    listings = []

    for result in search_results:
        if get_nested_value(result, "__typename") != "StaySearchResult":
            continue

        pr = get_nested_value(result, "structuredDisplayPrice", {})
        sc = result.get("structuredContent", {})
        primary_line = sc.get("primaryLine", [])

        listing_id = _decode_listing_id(get_nested_value(result, "demandStayListing.id", ""))

        # Property type from title (e.g. "Apartment in Nicosia" → "Apartment")
        title = result.get("title", "")
        property_type = title.split(" in ")[0] if " in " in title else title or None

        bedrooms, beds = _parse_bed_info(primary_line)

        # Superhost and guest favourite from badges + passportData
        badges = {b.get("loggingContext", {}).get("badgeType") for b in result.get("badges", [])}
        passport = result.get("passportData") or {}
        is_superhost  = bool(passport.get("isSuperhost")) or ("SUPERHOST" in badges)
        is_guest_fav  = "GUEST_FAVORITE" in badges or "TOP_X_GUEST_FAVORITE" in badges

        entry = {
            "room_id":         listing_id,
            "name":            get_nested_value(result, "demandStayListing.description.name.localizedStringWithTranslationPreference", ""),
            "coordinates": {
                "latitude":    get_nested_value(result, "demandStayListing.location.coordinate.latitude", 0),
                "longitude":   get_nested_value(result, "demandStayListing.location.coordinate.longitude", 0),
            },
            "price_per_night": None,
            "property_type":   property_type,
            "bedrooms":        bedrooms,
            "beds":            beds,
            "is_superhost":    is_superhost,
            "is_guest_fav":    is_guest_fav,
            "room_type":       _room_type(property_type),
            "rating":          {"value": 0.0, "review_count": 0},
        }

        # Extract per-night rate from the "N nights x €X.XX" breakdown line
        for detail in get_nested_value(pr, "explanationData.priceDetails", []):
            for item in detail.get("items", []):
                nightly = _extract_nightly_rate(item.get("description", ""))
                if nightly is not None:
                    entry["price_per_night"] = nightly

        # Rating
        avg = get_nested_value(result, "avgRatingLocalized", "")
        parts = avg.split(" ")
        if len(parts) == 2:
            try:
                entry["rating"]["value"] = float(parts[0].replace(",", "."))
                count_match = re.search(r"\d+", parts[1])
                if count_match:
                    entry["rating"]["review_count"] = int(count_match.group(0))
            except ValueError:
                pass

        listings.append(entry)

    return listings


def _decode_listing_id(base64_id: str) -> int:
    if not base64_id:
        return 0
    try:
        decoded = base64.b64decode(base64_id).decode("utf-8")
        match = re.search(r"(\d+)$", decoded)
        if match:
            return int(match.group(1))
    except Exception:
        pass
    return 0


# ---------------------------------------------------------------------------
# Listing detail page (amenities, ratings, superhost, verified)
# ---------------------------------------------------------------------------

_DEFERRED_STATE_RE = re.compile(
    r'<script[^>]+data-deferred-state-0[^>]*>(.*?)</script>', re.DOTALL
)


def get_listing_details(listing_id: int | str, proxy_url: str = "") -> dict | None:
    """
    Fetch enrichment data for a single listing from its HTML detail page.

    Airbnb bootstraps full section data in a `data-deferred-state-0` script tag —
    no API key required, just a browser-impersonated GET request.

    Returns a dict:
        {
            "listing_id":   int,
            "amenities":    [{"title": str, "available": bool}, ...] | None,
            "ratings":      {"cleanliness": float, "accuracy": float, "checkin": float,
                             "communication": float, "location": float, "value": float} | None,
            "is_superhost": bool | None,
            "is_verified":  bool | None,
        }
    Returns None if the page is inaccessible or the listing is delisted.
    """
    url = f"https://www.airbnb.com/rooms/{listing_id}"
    headers = {
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    try:
        resp = _request_with_backoff(
            "get", url, headers=headers, proxies=proxies, impersonate="chrome124", timeout=30
        )
        if resp.status_code != 200:
            return None
    except Exception:
        return None

    m = _DEFERRED_STATE_RE.search(resp.text)
    if not m:
        return None

    try:
        data = json.loads(m.group(1))
    except Exception:
        return None

    # Find the StaysPdpSections entry in niobeClientData
    sections = None
    for entry in data.get("niobeClientData", []):
        try:
            pdp = entry[1]["data"]["presentation"]["stayProductDetailPage"]
            sections = pdp["sections"]["sections"]
            break
        except (KeyError, IndexError, TypeError):
            continue

    if not sections:
        return None

    amenities    = None
    ratings      = None
    is_superhost = None
    is_verified  = None
    description  = None

    for section in sections:
        stype = section.get("sectionComponentType")
        sec   = section.get("section") or {}

        if stype == "PDP_DESCRIPTION_MODAL" and description is None:
            # First occurrence is the property description; subsequent ones are host/business blurbs
            parts = []
            for item in sec.get("items", []):
                html_text = (item.get("html") or {}).get("htmlText", "")
                for chunk in html_text.split("<br />"):
                    text = re.sub(r"<[^>]+>", "", chunk).strip()
                    if text:
                        parts.append(text)
            if parts:
                description = "\n\n".join(parts)

        elif stype == "AMENITIES_DEFAULT":
            amenities = []
            for group in sec.get("seeAllAmenitiesGroups", []):
                for amenity in group.get("amenities", []):
                    amenities.append({
                        "title":     amenity.get("title"),
                        "available": amenity.get("available", False),
                    })

        elif stype == "REVIEWS_DEFAULT":
            category_map = {}
            for r in sec.get("ratings") or []:
                cat = r.get("categoryType", "").lower()
                try:
                    category_map[cat] = float(r.get("localizedRating", 0))
                except (ValueError, TypeError):
                    pass
            if category_map:
                ratings = {
                    "cleanliness":   category_map.get("cleanliness"),
                    "accuracy":      category_map.get("accuracy"),
                    "checkin":       category_map.get("checkin"),
                    "communication": category_map.get("communication"),
                    "location":      category_map.get("location"),
                    "value":         category_map.get("value"),
                }

        elif stype == "MEET_YOUR_HOST":
            card = sec.get("cardData") or {}
            is_superhost = card.get("isSuperhost")
            is_verified  = card.get("isVerified")

    return {
        "listing_id":   int(listing_id),
        "amenities":    amenities,
        "ratings":      ratings,
        "is_superhost": is_superhost,
        "is_verified":  is_verified,
        "description":  description,
    }
