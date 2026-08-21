"""Extract Eventbrite organizers referenced by the existing event crawl."""
import json
import logging
import time
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
from bs4 import BeautifulSoup
from selenium import webdriver

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data_eventbrite"
EVENTS_CSV = DATA_DIR / "events.csv"
OUTPUT_CSV = DATA_DIR / "organizers.csv"
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
EVENT_LOAD_WAIT = 3
BETWEEN_EVENTS_SLEEP = 1
HEADLESS = True

logging.basicConfig(filename=LOG_DIR / "eventbrite_organizer_crawler.log", level=logging.INFO,
                    format="%(asctime)s - %(levelname)s - %(message)s", encoding="utf-8")


def clean(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def find_event_ld(soup):
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.text)
        except (json.JSONDecodeError, TypeError):
            continue
        for item in data if isinstance(data, list) else [data]:
            if isinstance(item, dict) and "Event" in str(item.get("@type", "")):
                return item
    return {}


def organizer_identity(organizer, name):
    # JSON-LD commonly exposes a stable Eventbrite organizer URL; retain its ID/slug.
    url = clean(organizer.get("url"))
    if url:
        return urlparse(url).path.rstrip("/").rsplit("/", 1)[-1] or url
    return clean(organizer.get("@id")) or name.casefold()


def parse_organizer(html, fallback_name, fallback_description):
    event = find_event_ld(BeautifulSoup(html, "html.parser"))
    organizer = event.get("organizer") or {}
    if isinstance(organizer, list):
        organizer = organizer[0] if organizer else {}
    if not isinstance(organizer, dict):
        organizer = {}
    name = clean(organizer.get("name")) or clean(fallback_name)
    if not name:
        return None
    return {
        "source": "eventbrite",
        "source_organizer_id": organizer_identity(organizer, name),
        "display_name": name,
        "description": clean(organizer.get("description")) or clean(fallback_description),
        "logo_url": clean(organizer.get("image")) or clean(organizer.get("logo")),
        "status": "pending",
    }


def create_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--disable-notifications")
    if HEADLESS:
        options.add_argument("--headless=new")
    return webdriver.Chrome(options=options)


def main():
    if not EVENTS_CSV.exists():
        raise FileNotFoundError(f"Missing event input: {EVENTS_CSV}")
    events = pd.read_csv(EVENTS_CSV, encoding="utf-8-sig")
    organizers = []
    driver = create_driver()
    try:
        for _, row in events.iterrows():
            url = clean(row.get("source_url"))
            if not url:
                continue
            try:
                driver.get(url)
                time.sleep(EVENT_LOAD_WAIT)
                organizer = parse_organizer(driver.page_source, row.get("producer"), row.get("producer_description"))
                if organizer:
                    organizers.append(organizer)
            except Exception as exc:
                logging.warning("Cannot extract organizer for %s: %s", url, exc)
            time.sleep(BETWEEN_EVENTS_SLEEP)
    finally:
        driver.quit()

    columns = ["source", "source_organizer_id", "display_name", "description", "logo_url", "status"]
    result = pd.DataFrame(organizers, columns=columns).drop_duplicates(
        subset=["source", "source_organizer_id"], keep="last")
    result.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    logging.info("Saved %s organizers to %s", len(result), OUTPUT_CSV)


if __name__ == "__main__":
    main()
