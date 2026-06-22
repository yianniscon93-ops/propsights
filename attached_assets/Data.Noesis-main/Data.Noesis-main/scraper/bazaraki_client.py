"""
Bazaraki.com property listing client.

Uses the map geometry API endpoint which returns listings with lat/lng coordinates.
No session/CSRF/bot protection — clean JSON GET requests, curl_cffi sufficient.

Rubrics (category IDs used by the map API):
  apartments_sale: rubric=3528, c=17357   (~15,900 listings)
  houses_sale:     rubric=678,  c=8423
  apartments_rent: rubric=3529, c=5445    (~5,200 listings)
  houses_rent:     rubric=681,  c=1767    (~1,500 listings)

Pipeline:
  search_sale_listings()    → sale records with price + coordinates
  search_rental_listings()  → rental records with monthly_rent + coordinates
  get_listing_details(url)  → enriched detail fields from the listing page
"""

import re
import time
import logging
from urllib.parse import urlencode
from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

_API_URL = "https://www.bazaraki.com/api/items/adverts-geometry/"

_RUBRICS = {
    "apartments_sale": {"rubric": "3528", "c": "17357"},
    "houses_sale":     {"rubric": "678",  "c": "8423"},
    "apartments_rent": {"rubric": "3529", "c": "5445"},
    "houses_rent":     {"rubric": "681",  "c": "1767"},
}

# Center of Cyprus + radius that covers the whole island (~140 km)
_BASE_PARAMS = {
    "lat":        "35.15",
    "lng":        "33.4",
    "radius":     "140000",
    "zoom_level": "8",
    "ordering":   "",
    "q":          "",
}

_BEDROOMS_RE  = re.compile(r"(\d+)-bedroom", re.IGNORECASE)
_PROP_TYPE_RE = re.compile(
    r"\b(apartment|flat|house|villa|maisonette|bungalow|studio|penthouse|"
    r"detached|semi-detached|townhouse|cottage|loft|chalet)\b",
    re.IGNORECASE,
)


def _parse_price(s: str) -> float | None:
    """
    Parse Bazaraki price strings:
      '€405K '   → 405000
      '€2,2K '   → 2200   (European decimal: comma = decimal separator)
      '€1,95K '  → 1950
      '€185,000' → 185000 (comma = thousand separator in non-K prices)
    """
    if not s:
        return None
    s = s.strip().lstrip("€").strip()
    try:
        if s.upper().endswith("K"):
            return float(s[:-1].replace(",", ".")) * 1000
        else:
            return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _parse_bedrooms(title: str) -> int | None:
    m = _BEDROOMS_RE.search(title)
    return int(m.group(1)) if m else None


def _parse_property_type(title: str) -> str | None:
    m = _PROP_TYPE_RE.search(title)
    return m.group(1).lower() if m else None


def _scrape_rubric(
    rubric_key: str,
    proxy_url: str,
    delay: float,
    max_pages: int | None = None,
) -> list[dict]:
    """Paginate all results for one rubric. Returns deduplicated listing dicts."""
    params = {**_BASE_PARAMS, **_RUBRICS[rubric_key]}
    url: str | None = f"{_API_URL}?{urlencode(params)}"

    session = curl_requests.Session()
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    seen: dict[int, dict] = {}
    page = 1

    while url:
        for attempt in range(3):
            try:
                resp = session.get(url, proxies=proxies, impersonate="chrome124", timeout=30)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                if attempt < 2:
                    log.warning(f"  page {page} attempt {attempt+1}/3 failed: {e} — retrying in 5s")
                    time.sleep(5)
                else:
                    log.warning(f"  page {page} failed after 3 attempts — stopping pagination")
                    return list(seen.values())

        for item in data.get("results", []):
            lid = item.get("id")
            if lid and lid not in seen:
                geo = item.get("geometry") or [None, None]
                seen[lid] = {
                    "listing_id":    lid,
                    "title":         item.get("title", ""),
                    "price":         _parse_price(item.get("price", "")),
                    "latitude":      geo[0],
                    "longitude":     geo[1],
                    "bedrooms":      _parse_bedrooms(item.get("title", "")),
                    "property_type": _parse_property_type(item.get("title", "")),
                    "url":           "https://www.bazaraki.com" + item.get("absolute_url", ""),
                }

        total = data.get("count", 0)
        if page % 10 == 0 or page == 1:
            log.info(f"  [{rubric_key}] page {page} — {len(seen)}/{total} unique listings")

        url = data.get("next")
        page += 1
        if max_pages and page > max_pages:
            log.info(f"  [{rubric_key}] max_pages={max_pages} reached — stopping")
            break
        if url:
            time.sleep(delay)

    log.info(f"  [{rubric_key}] done — {len(seen)} unique listings")
    return list(seen.values())


def search_sale_listings(
    proxy_url: str = "",
    delay: float = 0.5,
    max_pages: int | None = None,
) -> list[dict]:
    """
    Fetch all for-sale listings (apartments + houses).
    Returns deduplicated list with price + coordinates.
    max_pages: limit pages per rubric (for testing).
    """
    results = []
    for rubric_key in ("apartments_sale", "houses_sale"):
        results.extend(_scrape_rubric(rubric_key, proxy_url, delay, max_pages))

    merged = {r["listing_id"]: r for r in results}
    log.info(f"Sale total: {len(merged)} unique listings")
    return list(merged.values())


def search_rental_listings(
    proxy_url: str = "",
    delay: float = 0.5,
) -> list[dict]:
    """
    Fetch all rental listings (apartments + houses).
    Returns deduplicated list with monthly_rent + coordinates.
    """
    results = []
    for rubric_key in ("apartments_rent", "houses_rent"):
        results.extend(_scrape_rubric(rubric_key, proxy_url, delay))

    merged = {r["listing_id"]: r for r in results}
    log.info(f"Rental total: {len(merged)} unique listings")
    return list(merged.values())


# ---------------------------------------------------------------------------
# Detail page enrichment
# ---------------------------------------------------------------------------

_SIZE_RE  = re.compile(r"([\d,.]+)\s*m", re.IGNORECASE)
_YEAR_RE  = re.compile(r"\b(19|20)\d{2}\b")
_INT_RE   = re.compile(r"\d+")


def _parse_characteristics(soup: BeautifulSoup) -> dict:
    """
    Parse the .announcement-characteristics list into a flat key→value dict.
    Each <li> renders as "Key: | Value" when joined with |.
    """
    chars = {}
    for li in soup.select(".announcement-characteristics li"):
        parts = [p.strip() for p in li.get_text("|", strip=True).split("|") if p.strip()]
        if len(parts) == 2:
            key = parts[0].rstrip(":").strip()
            chars[key] = parts[1].strip()
    return chars


_DETAIL_HEADERS = {
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer":         "https://www.bazaraki.com/real-estate/",
    "Cache-Control":   "no-cache",
    "Pragma":          "no-cache",
    "Upgrade-Insecure-Requests": "1",
}


def get_listing_details(
    listing_id: int,
    url: str,
    session: curl_requests.Session,
    proxy_url: str = "",
) -> dict | None:
    """
    Fetch a Bazaraki detail page and return enriched fields.
    Returns None on fetch failure.

    Fields returned:
      listing_id, size_m2, floor, parking, condition, furnishing,
      included, air_conditioning, construction_year, energy_efficiency,
      bathrooms, postal_code, description
    """
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    for attempt in range(3):
        try:
            resp = session.get(url, headers=_DETAIL_HEADERS, proxies=proxies, impersonate="chrome131", timeout=30)
            if resp.status_code == 404:
                log.debug(f"  [{listing_id}] 404 — listing removed")
                return {"listing_id": listing_id, "expired": True}
            resp.raise_for_status()
            break
        except Exception as e:
            if attempt < 2:
                log.warning(f"  [{listing_id}] attempt {attempt+1}/3 failed: {e} — retrying in 5s")
                time.sleep(5)
            else:
                log.warning(f"  [{listing_id}] failed after 3 attempts — skipping")
                return None

    soup = BeautifulSoup(resp.text, "html.parser")

    expired_el = soup.select_one(".phone-author__subtext")
    if expired_el and "expired" in expired_el.get_text().lower():
        log.debug(f"  [{listing_id}] ad expired")
        return {"listing_id": listing_id, "expired": True}

    chars = _parse_characteristics(soup)

    # size_m2
    size_m2 = None
    raw_area = chars.get("Property area", "")
    m = _SIZE_RE.search(raw_area)
    if m:
        try:
            size_m2 = float(m.group(1).replace(",", "."))
        except ValueError:
            pass

    # construction_year
    construction_year = None
    raw_year = chars.get("Construction year", "")
    m = _YEAR_RE.search(raw_year)
    if m:
        construction_year = int(m.group(0))

    # bathrooms
    bathrooms = None
    raw_baths = chars.get("Bathrooms", "")
    m = _INT_RE.search(raw_baths)
    if m:
        bathrooms = int(m.group(0))

    # description
    description = None
    desc_el = soup.select_one(".announcement-description")
    if desc_el:
        description = desc_el.get_text("\n", strip=True) or None

    return {
        "listing_id":        listing_id,
        "size_m2":           size_m2,
        "floor":             chars.get("Floor"),
        "parking":           chars.get("Parking"),
        "condition":         chars.get("Condition"),
        "furnishing":        chars.get("Furnishing"),
        "included":          chars.get("Included"),
        "air_conditioning":  chars.get("Air conditioning"),
        "construction_year": construction_year,
        "energy_efficiency": chars.get("Energy Efficiency"),
        "bathrooms":         bathrooms,
        "postal_code":       chars.get("Postal code"),
        "description":       description,
    }
