import logging
import re
import signal
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pandas as pd
# cticket sits behind Cloudflare, which fingerprints the TLS handshake. Plain
# `requests` gets a 403; curl_cffi impersonates Chrome's TLS to get through.
from curl_cffi import requests

# Windows consoles default to cp1252, which crashes on Vietnamese text.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# =========================
# CONFIG
# =========================

HOME_URL = "https://cticket.vn"
# cticket is a fully client-rendered Next.js app; its event pages serve only a
# skeleton over HTTP. The public JSON API behind the page is what we hit instead.
API_TEMPLATE = "https://cticket.vn/tix/public/events/v2/{slug}"
SITEMAPS = [
    "https://cticket.vn/event/sitemap.xml",
    "https://cticket.vn/sitemap.xml",
]

DATA_DIR = Path("data_cticket")
IMAGE_DIR = DATA_DIR / "images"
LOG_DIR = Path("logs")

DATA_DIR.mkdir(exist_ok=True)
IMAGE_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)

CSV_PATH = DATA_DIR / "events.csv"
VISITED_EVENTS_PATH = DATA_DIR / "visited_events.txt"
FAILED_EVENTS_PATH = DATA_DIR / "failed_events.txt"
DISCOVERED_EVENTS_PATH = DATA_DIR / "discovered_events.txt"

# Keep these gentle. The goal is to leave the crawler running for a long time.
BETWEEN_EVENTS_SLEEP = 2
REQUEST_TIMEOUT = 30
MAX_EVENTS_PER_RUN = 0  # 0 means no limit.
RETRY_FAILED_EVENTS = True

# cticket event detail URLs look like https://cticket.vn/event/<slug>.
# The /en/ locale variant points at the same event, so we skip it to avoid
# crawling every event twice.
EVENT_URL_PATTERN = re.compile(r"^https://cticket\.vn/event/[^/?#]+/?$")

# =========================
# LOGGING
# =========================

logging.basicConfig(
    filename=LOG_DIR / "cticket_crawler.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    encoding="utf-8",
)

console = logging.StreamHandler()
console.setLevel(logging.INFO)
logging.getLogger().addHandler(console)

# =========================
# SESSION
# =========================

http = requests.Session(impersonate="chrome")
http.headers.update(
    {
        "Accept-Language": "vi,en;q=0.9",
        "Referer": "https://cticket.vn/",
    }
)

# =========================
# SHUTDOWN
# =========================


def graceful_shutdown(signum, frame):
    logging.info("Shutting down...")
    sys.exit(0)


signal.signal(signal.SIGINT, graceful_shutdown)
signal.signal(signal.SIGTERM, graceful_shutdown)

# =========================
# HELPERS
# =========================


def safe_filename(text):
    text = str(text or "event")
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"\s+", "_", text.strip())
    return text[:120] or "event"


def normalize_url(url):
    if not url:
        return ""

    url = urljoin(HOME_URL, url)
    parsed = urlparse(url)

    if parsed.scheme not in {"http", "https"}:
        return ""

    clean = parsed._replace(query="", fragment="")
    return clean.geturl().rstrip("/")


def read_lines(path):
    if not path.exists():
        return set()

    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def append_line(path, value):
    with open(path, "a", encoding="utf-8") as f:
        f.write(value + "\n")


def load_existing_events():
    if not CSV_PATH.exists():
        return []

    try:
        return pd.read_csv(CSV_PATH, encoding="utf-8-sig").to_dict("records")
    except Exception as e:
        logging.error(f"Cannot read existing CSV: {e}")
        return []


def save_events(events):
    df = pd.DataFrame(events)
    df = df.drop_duplicates(subset=["source_url"], keep="last")
    df.to_csv(CSV_PATH, index=False, encoding="utf-8-sig")


def is_event_url(url):
    return bool(EVENT_URL_PATTERN.match(url))


def slug_from_url(url):
    path = urlparse(url).path.rstrip("/")
    return path.rsplit("/", 1)[-1]


def download_image(url, title, event_id=None):
    if not url:
        return ""

    try:
        parsed = urlparse(url)
        ext = Path(parsed.path).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
            ext = ".jpg"

        prefix = str(event_id or "").strip()
        filename = safe_filename(f"{prefix}_{title}" if prefix else title) + ext
        filepath = IMAGE_DIR / filename

        if filepath.exists() and filepath.stat().st_size > 0:
            return str(filepath)

        r = http.get(url, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()

        with open(filepath, "wb") as f:
            f.write(r.content)

        logging.info(f"Image saved: {filepath}")
        return str(filepath)

    except Exception as e:
        logging.error(f"Download image error: {e}")
        return ""

# =========================
# LINK DISCOVERY (sitemaps)
# =========================


def collect_event_links():
    discovered_events = read_lines(DISCOVERED_EVENTS_PATH)

    logging.info("Discovering event links from sitemaps...")

    for sitemap_url in SITEMAPS:
        try:
            r = http.get(sitemap_url, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            root = ET.fromstring(r.content)
        except Exception as e:
            logging.error(f"Sitemap failed: {sitemap_url} - {e}")
            continue

        new_events = 0
        # Sitemap namespaces vary; match the <loc> tag by local name.
        for loc in root.iter():
            if not loc.tag.endswith("loc") or not loc.text:
                continue

            link = normalize_url(loc.text.strip())
            if is_event_url(link) and link not in discovered_events:
                discovered_events.add(link)
                append_line(DISCOVERED_EVENTS_PATH, link)
                new_events += 1

        logging.info(f"Sitemap {sitemap_url}: new events {new_events}")

    logging.info(f"Discovery finished. Total event links: {len(discovered_events)}")
    return sorted(discovered_events)

# =========================
# JSON API PARSER
# =========================


def parse_price(event):
    prices = [
        c.get("price")
        for c in event.get("ticket_categories", [])
        if isinstance(c, dict) and isinstance(c.get("price"), (int, float))
    ]
    return min(prices) if prices else ""


def parse_event(url):
    slug = slug_from_url(url)
    api_url = API_TEMPLATE.format(slug=slug)
    logging.info(f"Fetching API: {api_url}")

    r = http.get(api_url, timeout=REQUEST_TIMEOUT, headers={"Accept": "application/json"})
    r.raise_for_status()
    event = r.json()

    if not isinstance(event, dict) or not event.get("id"):
        raise Exception("API returned no event payload")

    occurrences = event.get("occurrences") or []
    starts = [o.get("start_time") for o in occurrences if o.get("start_time")]
    ends = [o.get("end_time") for o in occurrences if o.get("end_time")]

    venue = event.get("venue_name") or ""
    address = ", ".join(
        p for p in (event.get("venue_address"), event.get("venue_city")) if p
    )

    organizer = event.get("organizer") or {}

    event_id = event.get("id") or slug
    image_url = event.get("cover_image") or event.get("thumbnail_image") or ""

    result = {
        "event_id": event_id,
        "event_name": event.get("name"),
        "status": event.get("selling_status") or event.get("publicity_status"),
        "image_url": image_url,
        "event_start": min(starts) if starts else "",
        "event_end": max(ends) if ends else "",
        "venue": venue,
        "address": address,
        "producer": organizer.get("name"),
        "producer_description": organizer.get("description"),
        "category": event.get("category"),
        "price": parse_price(event),
        "source_url": url,
    }

    result["local_image"] = download_image(
        result["image_url"],
        result["event_name"],
        event_id=event_id,
    )

    return result

# =========================
# MAIN
# =========================


def main():
    all_events = load_existing_events()
    existing_urls = {
        normalize_url(row.get("source_url"))
        for row in all_events
        if row.get("source_url")
    }
    visited_events = read_lines(VISITED_EVENTS_PATH) | existing_urls
    failed_events = read_lines(FAILED_EVENTS_PATH)
    saved_this_run = 0

    event_links = collect_event_links()
    logging.info(f"Existing events: {len(existing_urls)}")

    pending_links = [
        url
        for url in event_links
        if url not in visited_events
        and (RETRY_FAILED_EVENTS or url not in failed_events)
    ]

    if MAX_EVENTS_PER_RUN > 0:
        pending_links = pending_links[:MAX_EVENTS_PER_RUN]

    total = len(pending_links)

    for idx, url in enumerate(pending_links, start=1):
        logging.info(f"Parsing discovered event [{idx}/{total}]")

        success = False
        for attempt in range(3):
            try:
                event = parse_event(url)
                all_events.append(event)
                save_events(all_events)

                visited_events.add(url)
                append_line(VISITED_EVENTS_PATH, url)
                saved_this_run += 1
                success = True
                logging.info(f"Saved event: {event.get('event_name')}")
                break

            except Exception as e:
                logging.error(f"Attempt {attempt + 1}: {url} - {e}")
                time.sleep(5)

        if not success:
            logging.error(f"FAILED: {url}")
            append_line(FAILED_EVENTS_PATH, url)

        time.sleep(BETWEEN_EVENTS_SLEEP)

    save_events(all_events)

    logging.info(f"Saved CSV: {CSV_PATH}")
    logging.info(f"New events this run: {saved_this_run}")
    if CSV_PATH.exists() and all_events:
        logging.info(
            f"Total events in CSV: {len(pd.read_csv(CSV_PATH, encoding='utf-8-sig'))}"
        )


if __name__ == "__main__":
    main()
