import json
import logging
import os
import re
import signal
import sys
import time
from collections import deque
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pandas as pd
import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By

# Windows consoles default to cp1252, which crashes on non-ASCII text.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# =========================
# CONFIG
# =========================

HOME_URL = "https://www.eventbrite.com"

DATA_DIR = Path("data_eventbrite")
IMAGE_DIR = DATA_DIR / "images"
LOG_DIR = Path("logs")

DATA_DIR.mkdir(exist_ok=True)
IMAGE_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)

CSV_PATH = DATA_DIR / "events.csv"
VISITED_EVENTS_PATH = DATA_DIR / "visited_events.txt"
VISITED_PAGES_PATH = DATA_DIR / "visited_pages.txt"
FAILED_EVENTS_PATH = DATA_DIR / "failed_events.txt"
DISCOVERED_EVENTS_PATH = DATA_DIR / "discovered_events.txt"

# Keep these gentle. The goal is to leave the crawler running for a long time.
PAGE_LOAD_WAIT = 6
EVENT_LOAD_WAIT = 5
SCROLL_TIMES = 8
SCROLL_PAUSE = 2
BETWEEN_PAGES_SLEEP = 2
BETWEEN_EVENTS_SLEEP = 3
MAX_DISCOVERY_PAGES = 300
MAX_EVENTS_PER_RUN = 0  # 0 means no limit.
HEADLESS = False
RESUME_DISCOVERY_PAGES = False
RETRY_FAILED_EVENTS = True

SEED_URLS = [
    "https://www.eventbrite.com/d/online/all-events/",
    "https://www.eventbrite.com/d/online/business--events/",
    "https://www.eventbrite.com/d/online/music--events/",
    "https://www.eventbrite.com/d/online/science-and-tech--events/",
]

# Eventbrite event detail URLs end with "...-<digits>" and live under /e/.
# Country-specific TLDs (eventbrite.com / .es / .com.ar / .com.mx ...) all share the path shape.
EVENT_URL_PATTERN = re.compile(
    r"^https://www\.eventbrite\.[a-z.]+/e/[^/?#]+-\d+/?$"
)
STATIC_EXTENSIONS = (
    ".css",
    ".js",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".pdf",
)

# =========================
# LOGGING
# =========================

logging.basicConfig(
    filename=LOG_DIR / "eventbrite_crawler.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    encoding="utf-8",
)

console = logging.StreamHandler()
console.setLevel(logging.INFO)
logging.getLogger().addHandler(console)

# =========================
# DRIVER / SESSION
# =========================

driver = None
http = requests.Session()
http.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0 Safari/537.36"
        )
    }
)

# =========================
# SHUTDOWN
# =========================


def graceful_shutdown(signum, frame):
    logging.info("Shutting down...")

    try:
        if driver:
            driver.quit()
    except Exception:
        pass

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
    normalized = clean.geturl().rstrip("/")

    return normalized


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


def event_key(url):
    match = re.search(r"-(\d+)$", url.rstrip("/"))
    return match.group(1) if match else url


def is_event_url(url):
    return bool(EVENT_URL_PATTERN.match(url))


def is_crawlable_page(url):
    parsed = urlparse(url)

    if not parsed.netloc.endswith("eventbrite.com") and ".eventbrite." not in parsed.netloc:
        return False

    path = parsed.path.lower()

    if path.endswith(STATIC_EXTENSIONS):
        return False

    # Only follow discovery listings (/d/) and event pages (/e/). Everything
    # else (login, help, organizer dashboards, legal) is noise.
    if not (path.startswith("/d/") or path.startswith("/e/")):
        return False

    blocked_parts = (
        "/_next/",
        "/login",
        "/signin",
        "/help",
        "/organizer",
        "/privacy",
        "/terms",
        "/checkout",
    )

    return not any(part in path for part in blocked_parts)


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

        r = http.get(url, timeout=30)
        r.raise_for_status()

        with open(filepath, "wb") as f:
            f.write(r.content)

        logging.info(f"Image saved: {filepath}")
        return str(filepath)

    except Exception as e:
        logging.error(f"Download image error: {e}")
        return ""


def slow_scroll():
    last_height = 0

    for _ in range(SCROLL_TIMES):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(SCROLL_PAUSE)

        height = driver.execute_script("return document.body.scrollHeight;")
        if height == last_height:
            break

        last_height = height


def extract_links_from_current_page():
    links = set()

    for link in driver.find_elements(By.TAG_NAME, "a"):
        href = normalize_url(link.get_attribute("href"))
        if href:
            links.add(href)

    soup = BeautifulSoup(driver.page_source, "html.parser")
    for tag in soup.find_all("a", href=True):
        href = normalize_url(tag.get("href"))
        if href:
            links.add(href)

    return links

# =========================
# LINK DISCOVERY
# =========================


def collect_event_links(on_new_events=None):
    visited_pages = read_lines(VISITED_PAGES_PATH) if RESUME_DISCOVERY_PAGES else set()
    discovered_events = read_lines(DISCOVERED_EVENTS_PATH)
    queue = deque(normalize_url(url) for url in SEED_URLS)
    pages_this_run = 0

    logging.info("Discovering event links slowly...")

    while queue and pages_this_run < MAX_DISCOVERY_PAGES:
        page_url = queue.popleft()

        if not page_url or page_url in visited_pages or not is_crawlable_page(page_url):
            continue

        try:
            logging.info(f"Opening page: {page_url}")
            driver.get(page_url)
            time.sleep(PAGE_LOAD_WAIT)
            slow_scroll()

            links = extract_links_from_current_page()
            new_events = 0
            new_event_links = []
            new_pages = 0

            for link in sorted(links):
                if is_event_url(link):
                    if link not in discovered_events:
                        discovered_events.add(link)
                        append_line(DISCOVERED_EVENTS_PATH, link)
                        new_events += 1
                        new_event_links.append(link)
                    continue

                if is_crawlable_page(link) and link not in visited_pages:
                    queue.append(link)
                    new_pages += 1

            visited_pages.add(page_url)
            if RESUME_DISCOVERY_PAGES:
                append_line(VISITED_PAGES_PATH, page_url)
            pages_this_run += 1

            logging.info(
                f"Page done. New events: {new_events}. "
                f"Queued pages: {new_pages}. Total discovered: {len(discovered_events)}"
            )

            if on_new_events and new_event_links:
                on_new_events(sorted(new_event_links))

            time.sleep(BETWEEN_PAGES_SLEEP)

        except Exception as e:
            logging.error(f"Discover page failed: {page_url} - {e}")

    logging.info(f"Discovery finished. Total event links: {len(discovered_events)}")
    return sorted(discovered_events)

# =========================
# PARSERS (JSON-LD + __NEXT_DATA__)
# =========================


def find_event_ld(soup):
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.text)
        except Exception:
            continue

        candidates = data if isinstance(data, list) else [data]
        for item in candidates:
            if isinstance(item, dict) and "Event" in str(item.get("@type", "")):
                return item

    return None


def get_next_data(soup):
    script = soup.find("script", id="__NEXT_DATA__")
    if not script:
        return {}

    try:
        return json.loads(script.text)
    except Exception:
        return {}


def join_address(addr):
    if not isinstance(addr, dict):
        return ""

    parts = [
        addr.get("streetAddress"),
        addr.get("addressLocality"),
        addr.get("addressRegion"),
        addr.get("postalCode"),
        addr.get("addressCountry"),
    ]
    return ", ".join(p for p in parts if p)


def parse_event(url):
    logging.info(f"Opening event: {url}")

    driver.get(url)
    time.sleep(EVENT_LOAD_WAIT)

    soup = BeautifulSoup(driver.page_source, "html.parser")
    ld = find_event_ld(soup)

    if not ld:
        raise Exception("Event JSON-LD not found")

    next_data = get_next_data(soup)
    ctx = (
        next_data.get("props", {})
        .get("pageProps", {})
        .get("context", {})
    )
    basic = ctx.get("basicInfo", {}) or {}
    taxon = ctx.get("taxonomies", {}) or {}

    # Location: VirtualLocation has no address; physical Place carries name + address.
    loc = ld.get("location", {}) or {}
    if isinstance(loc, list):
        loc = loc[0] if loc else {}
    venue = loc.get("name", "")
    address = join_address(loc.get("address"))
    if not venue and loc.get("@type") == "VirtualLocation":
        venue = "Online"

    # Price from AggregateOffer (lowPrice) or single Offer.
    offers = ld.get("offers")
    price = ""
    if isinstance(offers, list) and offers:
        offers = offers[0]
    if isinstance(offers, dict):
        price = offers.get("lowPrice") or offers.get("price") or ""

    organizer = ld.get("organizer", {}) or {}
    if isinstance(organizer, list):
        organizer = organizer[0] if organizer else {}

    category = ", ".join(
        x for x in [taxon.get("category"), taxon.get("subcategory"), taxon.get("format")] if x
    )

    event_id = basic.get("id") or event_key(url)
    status = ld.get("eventStatus", "")
    if isinstance(status, str) and "/" in status:
        status = status.rsplit("/", 1)[-1]  # EventScheduled, EventCancelled, ...

    result = {
        "event_id": event_id,
        "event_name": ld.get("name") or basic.get("name"),
        "status": status or basic.get("status"),
        "image_url": ld.get("image"),
        "event_start": ld.get("startDate"),
        "event_end": ld.get("endDate"),
        "venue": venue,
        "address": address,
        "producer": organizer.get("name"),
        "producer_description": organizer.get("description"),
        "category": category,
        "price": price,
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


def create_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--disable-notifications")
    options.add_argument("--start-maximized")

    if HEADLESS:
        options.add_argument("--headless=new")

    return webdriver.Chrome(options=options)


def main():
    global driver

    driver = create_driver()
    all_events = load_existing_events()
    existing_urls = {
        normalize_url(row.get("source_url"))
        for row in all_events
        if row.get("source_url")
    }
    visited_events = read_lines(VISITED_EVENTS_PATH) | existing_urls
    failed_events = read_lines(FAILED_EVENTS_PATH)
    saved_this_run = 0

    def process_event_links(event_links):
        nonlocal all_events, saved_this_run

        pending_links = [
            url
            for url in event_links
            if url not in visited_events
            and (RETRY_FAILED_EVENTS or url not in failed_events)
        ]

        if MAX_EVENTS_PER_RUN > 0:
            remaining = MAX_EVENTS_PER_RUN - saved_this_run
            if remaining <= 0:
                return
            pending_links = pending_links[:remaining]

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

    try:
        event_links = collect_event_links(on_new_events=process_event_links)

        logging.info(f"Existing events: {len(existing_urls)}")
        process_event_links(event_links)

        save_events(all_events)

        logging.info(f"Saved CSV: {CSV_PATH}")
        logging.info(f"New events this run: {saved_this_run}")
        logging.info(f"Total events in CSV: {len(pd.read_csv(CSV_PATH, encoding='utf-8-sig'))}")

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
