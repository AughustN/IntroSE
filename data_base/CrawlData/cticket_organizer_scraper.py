"""Extract organizers referenced by the already-crawled CTicket events.

The CSV is deliberately shaped for the `organizers` schema.  `user_id` is not
available on public websites, so an importer must create/link the local user
using (source, source_organizer_id) before inserting the organizer row.
"""
import logging
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
from curl_cffi import requests

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data_cticket"
EVENTS_CSV = DATA_DIR / "events.csv"
OUTPUT_CSV = DATA_DIR / "organizers.csv"
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
API_TEMPLATE = "https://cticket.vn/tix/public/events/v2/{slug}"
REQUEST_TIMEOUT = 30
BETWEEN_REQUESTS_SLEEP = 1

logging.basicConfig(filename=LOG_DIR / "cticket_organizer_crawler.log", level=logging.INFO,
                    format="%(asctime)s - %(levelname)s - %(message)s", encoding="utf-8")
http = requests.Session(impersonate="chrome")
http.headers.update({"Accept-Language": "vi,en;q=0.9", "Referer": "https://cticket.vn/"})


def clean(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def slug_from_url(url):
    return urlparse(clean(url)).path.rstrip("/").rsplit("/", 1)[-1]


def first_value(data, *keys):
    for key in keys:
        value = data.get(key)
        if value:
            return clean(value)
    return ""


def parse_organizer(event):
    organizer = event.get("organizer") or {}
    if not isinstance(organizer, dict):
        return None
    name = first_value(organizer, "name", "display_name", "title")
    if not name:
        return None
    # These are the public counterparts of organizers.display_name,
    # organizers.description and organizers.logo_url.
    return {
        "source": "cticket",
        "source_organizer_id": first_value(organizer, "id", "uuid", "slug") or name.casefold(),
        "display_name": name,
        "description": first_value(organizer, "description", "bio", "about"),
        "logo_url": first_value(organizer, "logo", "logo_url", "avatar", "avatar_url", "image"),
        "status": "pending",
    }


def main():
    if not EVENTS_CSV.exists():
        raise FileNotFoundError(f"Missing event input: {EVENTS_CSV}")
    events = pd.read_csv(EVENTS_CSV, encoding="utf-8-sig")
    organizers = []
    for _, row in events.iterrows():
        slug = slug_from_url(row.get("source_url"))
        if not slug:
            continue
        try:
            response = http.get(API_TEMPLATE.format(slug=slug), timeout=REQUEST_TIMEOUT,
                                headers={"Accept": "application/json"})
            response.raise_for_status()
            organizer = parse_organizer(response.json())
            if organizer:
                organizers.append(organizer)
        except Exception as exc:
            logging.warning("Cannot extract organizer for %s: %s", slug, exc)
        time.sleep(BETWEEN_REQUESTS_SLEEP)

    columns = ["source", "source_organizer_id", "display_name", "description", "logo_url", "status"]
    result = pd.DataFrame(organizers, columns=columns)
    result = result.drop_duplicates(subset=["source", "source_organizer_id"], keep="last")
    result.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    logging.info("Saved %s organizers to %s", len(result), OUTPUT_CSV)


if __name__ == "__main__":
    main()
