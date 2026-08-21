"""Extract organizer records from Ticketbox event pages into organizers.csv."""
import json
import logging
import re
import time
from pathlib import Path

import pandas as pd
from bs4 import BeautifulSoup
from selenium import webdriver

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data_ticketbox"
EVENTS_CSV = DATA_DIR / "events.csv"
OUTPUT_CSV = DATA_DIR / "organizers.csv"
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
EVENT_LOAD_WAIT = 3
BETWEEN_EVENTS_SLEEP = 1
HEADLESS = True

logging.basicConfig(filename=LOG_DIR / "ticketbox_organizer_crawler.log", level=logging.INFO,
                    format="%(asctime)s - %(levelname)s - %(message)s", encoding="utf-8")


def clean(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def find_first(data, names):
    """Find a value in Ticketbox's nested Next.js payload without assuming a version."""
    if isinstance(data, dict):
        for key, value in data.items():
            if key in names and value:
                return clean(value)
            found = find_first(value, names)
            if found:
                return found
    elif isinstance(data, list):
        for value in data:
            found = find_first(value, names)
            if found:
                return found
    return ""


def parse_organizer(html, fallback_name, fallback_description):
    script = BeautifulSoup(html, "html.parser").find("script", id="__NEXT_DATA__")
    if not script:
        return None
    payload = json.loads(script.text)
    info = payload.get("props", {}).get("pageProps", {}).get("infoEvent", {}) or {}
    name = clean(info.get("orgName")) or clean(fallback_name)
    if not name:
        return None
    organizer_data = info.get("organizer") or info.get("organization") or {}
    return {
        "source": "ticketbox",
        "source_organizer_id": clean(organizer_data.get("id")) if isinstance(organizer_data, dict) else "",
        "display_name": name,
        "description": clean(info.get("orgDescription")) or clean(fallback_description),
        "logo_url": (find_first(organizer_data, {"logo", "logoUrl", "logoURL", "avatar", "avatarUrl"})
                     or find_first(info, {"orgLogo", "orgLogoUrl", "orgLogoURL"})),
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
                    organizer["source_organizer_id"] = organizer["source_organizer_id"] or organizer["display_name"].casefold()
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
