"""
Incremental and Resumable CGV Vietnam Movie Event Scraper & Asset Pipeline.

Crawls currently available movies from https://www.cgv.vn, downloads poster images
and trailer videos to dedicated local folders (data/cgv/images, data/cgv/videos),
persists progress movie-by-movie into a local SQLite state database (data/cgv/index.sqlite),
and writes directly importable CSV files and asset metadata incrementally.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
import re
import signal
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import yt_dlp

# Force UTF-8 on Windows terminals
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# ==============================================================================
# DIRECTORY & PATH CONFIGURATION
# ==============================================================================

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "cgv"
IMAGES_DIR = DATA_DIR / "images"
VIDEOS_DIR = DATA_DIR / "videos"
LOGS_DIR = DATA_DIR / "logs"

DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_DB_PATH = DATA_DIR / "index.sqlite"
EVENTS_CSV_PATH = DATA_DIR / "events.csv"
ORGANIZERS_CSV_PATH = DATA_DIR / "organizers.csv"
ASSETS_METADATA_CSV_PATH = DATA_DIR / "assets_metadata.csv"
EVENTS_COMPACT_CSV_PATH = DATA_DIR / "events_import_compact.csv"
LOG_FILE_PATH = LOGS_DIR / "cgv_crawler.log"

# ==============================================================================
# LOGGING SETUP
# ==============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)

# ==============================================================================
# CONSTANTS & SCHEMA CONFIGURATION
# ==============================================================================

CGV_BASE_URL = "https://www.cgv.vn"
CGV_NOW_SHOWING_URL = "https://www.cgv.vn/default/movies/now-showing.html"
CGV_COMING_SOON_URL = "https://www.cgv.vn/default/movies/coming-soon.html"
CGV_HOMEPAGE_URL = "https://www.cgv.vn/"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 (TixHub-CGV-Crawler/2.0)"
)

DEFAULT_ORGANIZER_ID = 500
DEFAULT_ORGANIZER_USER_ID = 500
CGV_ORGANIZER_DISPLAY_NAME = "CJ CGV Vietnam"
CGV_ORGANIZER_DESCRIPTION = (
    "CJ CGV là một trong top 5 cụm rạp chiếu phim lớn nhất toàn cầu và là nhà phát hành, "
    "cụm rạp chiếu phim lớn nhất Việt Nam, mang đến trải nghiệm điện ảnh đỉnh cao với các "
    "công nghệ hiện đại như IMAX, 4DX, ScreenX, Starium, Gold Class và L'amour."
)
CGV_ORGANIZER_LOGO_URL = "https://www.cgv.vn/skin/frontend/cgv/default/images/cgvlogo.png"

DEFAULT_CATEGORY_ID = 3  # 'theatre' in catalog

DEFAULT_REFUND_POLICY = (
    "Theo quy định của CGV: Vé đã mua không thể hoàn tiền hoặc đổi sang suất chiếu khác "
    "trừ trường hợp sự cố kỹ thuật bất khả kháng từ phía rạp chiếu."
)

ALLOWED_AGE_RESTRICTIONS = {"all", "13+", "16+", "18+"}
ALLOWED_EVENT_TYPES = {"general_admission", "seated"}
ALLOWED_EVENT_STATUSES = {"draft", "on_sale", "finished", "cancelled"}
ALLOWED_MODERATION_STATUSES = {"pending_review", "approved", "flagged", "removed"}

PAGE_LOAD_WAIT_SECONDS = 3
BETWEEN_REQUESTS_DELAY_SECONDS = 1.0
REQUEST_TIMEOUT_SECONDS = 30


# ==============================================================================
# UTILITY FUNCTIONS
# ==============================================================================

def normalize_title(title: str) -> str:
    """Normalizes title string for deterministic deduplication."""
    return re.sub(r"\s+", " ", str(title or "").strip().lower())


def compute_fingerprint(normalized_title: str, release_date: str, source_url: str) -> str:
    """Generates a deterministic SHA256 fingerprint for a movie record."""
    norm_url = source_url.split("?")[0].split("#")[0].rstrip("/")
    key = f"{normalized_title}|{release_date.strip()}|{norm_url}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def normalize_age_restriction(rated_str: str) -> tuple[str, str]:
    """
    Normalizes CGV age rating string into schema enum and descriptive text.
    """
    raw = (rated_str or "").strip()
    upper = raw.upper()

    if "18" in upper or "T18" in upper or "C18" in upper:
        code = "18+"
    elif "16" in upper or "T16" in upper or "C16" in upper:
        code = "16+"
    elif "13" in upper or "T13" in upper or "C13" in upper:
        code = "13+"
    else:
        code = "all"

    description = raw if raw else f"Phân loại độ tuổi: {code}"
    return code, description


def parse_duration_minutes(duration_str: str) -> int | None:
    """Extracts integer duration in minutes from strings like '145 phút' or '145 min'."""
    if not duration_str:
        return None
    match = re.search(r"(\d+)", duration_str)
    if match:
        try:
            val = int(match.group(1))
            return val if val > 0 else None
        except ValueError:
            return None
    return None


def parse_pg_array(items: list[str]) -> str:
    """Formats a Python list of strings as a PostgreSQL array literal e.g. {"item1", "item2"}."""
    cleaned = []
    for item in items:
        item_str = str(item).strip()
        if not item_str:
            continue
        escaped = item_str.replace("\\", "\\\\").replace('"', '\\"')
        cleaned.append(f'"{escaped}"')
    return "{" + ", ".join(cleaned) + "}"


def infer_country(language_str: str, title: str, description: str) -> str:
    """Infers movie production country from spoken language and metadata."""
    audio_part = language_str.split("-")[0].lower() if "-" in language_str else language_str.lower()
    combined = f"{audio_part} {title} {description}".lower()

    if "nhật" in audio_part or "japanese" in audio_part or "nhật bản" in combined:
        return "Nhật Bản"
    if "hàn" in audio_part or "korean" in audio_part or "hàn quốc" in combined:
        return "Hàn Quốc"
    if "việt" in audio_part or "vietnamese" in audio_part or "việt nam" in combined:
        return "Việt Nam"
    if "trung" in audio_part or "chinese" in audio_part or "hồng kông" in combined or "hoa" in audio_part:
        return "Trung Quốc"
    if "thái" in audio_part or "thai" in audio_part:
        return "Thái Lan"
    if "indonesia" in audio_part or "danur" in combined:
        return "Indonesia"
    if "anh" in audio_part or "mỹ" in audio_part or "english" in audio_part or "hollywood" in combined:
        return "Mỹ"
    if "pháp" in audio_part or "french" in audio_part:
        return "Pháp"
    return "Quốc tế"


# ==============================================================================
# BROWSER DRIVER MANAGER (Self-Healing)
# ==============================================================================

class BrowserManager:
    """Manages Chrome WebDriver lifecycle with automatic reconnection and crash recovery."""

    def __init__(self) -> None:
        self.driver: webdriver.Chrome | None = None
        self.http_session = requests.Session()
        self.http_session.headers.update({"User-Agent": USER_AGENT})

    def get_driver(self) -> webdriver.Chrome:
        """Gets active driver or creates a fresh one."""
        if self.driver is not None:
            try:
                # Test connectivity
                _ = self.driver.title
                return self.driver
            except Exception:
                self.quit_driver()

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument(f"user-agent={USER_AGENT}")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-notifications")
        options.add_argument("--blink-settings=imagesEnabled=true")

        self.driver = webdriver.Chrome(options=options)
        self.driver.set_page_load_timeout(REQUEST_TIMEOUT_SECONDS)
        return self.driver

    def quit_driver(self) -> None:
        """Safely quits existing driver."""
        if self.driver is not None:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None

    def fetch_page_source(self, url: str, max_retries: int = 3) -> str:
        """Fetches page source with automatic retry and reconnection."""
        for attempt in range(1, max_retries + 1):
            try:
                driver = self.get_driver()
                driver.get(url)
                time.sleep(PAGE_LOAD_WAIT_SECONDS)

                # Sync cookies with HTTP session
                try:
                    for cookie in driver.get_cookies():
                        self.http_session.cookies.set(cookie["name"], cookie["value"], domain=cookie.get("domain", ""))
                except Exception:
                    pass

                return driver.page_source

            except Exception as exc:
                logging.warning("Error fetching %s (attempt %d/%d): %s", url, attempt, max_retries, exc)
                self.quit_driver()
                time.sleep(attempt * 2)

        raise RuntimeError(f"Failed to fetch {url} after {max_retries} attempts.")


# ==============================================================================
# PERSISTENT SQLITE STATE DATABASE
# ==============================================================================

class CGVIndexDatabase:
    """
    Manages persistent SQLite storage for incremental progress, resume capability,
    and reliable deduplication.
    """

    def __init__(self, db_path: Path = SQLITE_DB_PATH) -> None:
        self.db_path = db_path
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        """Initializes database tables and indexes if they do not exist."""
        with self.conn:
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS movie_crawl_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    movie_id INTEGER UNIQUE NOT NULL,
                    fingerprint TEXT UNIQUE NOT NULL,
                    source_url TEXT UNIQUE NOT NULL,
                    slug TEXT UNIQUE NOT NULL,
                    source_slug TEXT NOT NULL,
                    title TEXT NOT NULL,
                    normalized_title TEXT NOT NULL,
                    original_title TEXT,
                    description TEXT NOT NULL,
                    director TEXT,
                    cast TEXT,
                    genre_json TEXT NOT NULL DEFAULT '[]',
                    lineup_json TEXT NOT NULL DEFAULT '[]',
                    release_date TEXT,
                    duration_minutes INTEGER,
                    duration_raw TEXT,
                    language TEXT,
                    country TEXT,
                    age_restriction TEXT NOT NULL DEFAULT 'all',
                    age_description TEXT,
                    remote_image_url TEXT,
                    local_image_path TEXT,
                    image_download_status TEXT NOT NULL DEFAULT 'pending',
                    image_size_bytes INTEGER NOT NULL DEFAULT 0,
                    remote_trailer_url TEXT,
                    local_trailer_path TEXT,
                    trailer_download_status TEXT NOT NULL DEFAULT 'pending',
                    trailer_size_bytes INTEGER NOT NULL DEFAULT 0,
                    event_type TEXT NOT NULL DEFAULT 'seated',
                    status TEXT NOT NULL DEFAULT 'on_sale',
                    moderation_status TEXT NOT NULL DEFAULT 'approved',
                    is_featured INTEGER NOT NULL DEFAULT 0,
                    refund_policy TEXT,
                    seo_title TEXT,
                    seo_description TEXT,
                    crawl_status TEXT NOT NULL DEFAULT 'pending',
                    first_crawled_at TEXT NOT NULL,
                    last_updated_at TEXT NOT NULL
                )
                """
            )
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_crawl_fingerprint ON movie_crawl_state(fingerprint)"
            )
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_crawl_slug ON movie_crawl_state(slug)"
            )
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_crawl_source_url ON movie_crawl_state(source_url)"
            )
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_crawl_status ON movie_crawl_state(crawl_status)"
            )

    def get_max_movie_id(self) -> int:
        """Returns highest assigned movie_id or 0."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT COALESCE(MAX(movie_id), 0) FROM movie_crawl_state")
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def find_by_url(self, source_url: str) -> dict[str, Any] | None:
        """Finds record by exact source URL."""
        norm_url = source_url.split("?")[0].split("#")[0].rstrip("/")
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM movie_crawl_state WHERE source_url = ?",
            (norm_url,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def find_by_fingerprint(self, fingerprint: str) -> dict[str, Any] | None:
        """Finds record by deterministic fingerprint."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM movie_crawl_state WHERE fingerprint = ?",
            (fingerprint,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def upsert_movie_state(self, movie: dict[str, Any]) -> None:
        """Inserts or updates a movie record in the persistent SQLite index."""
        now_iso = datetime.now(timezone.utc).isoformat()
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO movie_crawl_state (
                    movie_id, fingerprint, source_url, slug, source_slug,
                    title, normalized_title, original_title, description,
                    director, cast, genre_json, lineup_json,
                    release_date, duration_minutes, duration_raw,
                    language, country, age_restriction, age_description,
                    remote_image_url, local_image_path, image_download_status, image_size_bytes,
                    remote_trailer_url, local_trailer_path, trailer_download_status, trailer_size_bytes,
                    event_type, status, moderation_status, is_featured,
                    refund_policy, seo_title, seo_description,
                    crawl_status, first_crawled_at, last_updated_at
                ) VALUES (
                    :movie_id, :fingerprint, :source_url, :slug, :source_slug,
                    :title, :normalized_title, :original_title, :description,
                    :director, :cast, :genre_json, :lineup_json,
                    :release_date, :duration_minutes, :duration_raw,
                    :language, :country, :age_restriction, :age_description,
                    :remote_image_url, :local_image_path, :image_download_status, :image_size_bytes,
                    :remote_trailer_url, :local_trailer_path, :trailer_download_status, :trailer_size_bytes,
                    :event_type, :status, :moderation_status, :is_featured,
                    :refund_policy, :seo_title, :seo_description,
                    :crawl_status, :first_crawled_at, :last_updated_at
                )
                ON CONFLICT(source_url) DO UPDATE SET
                    title = excluded.title,
                    normalized_title = excluded.normalized_title,
                    original_title = excluded.original_title,
                    description = excluded.description,
                    director = excluded.director,
                    cast = excluded.cast,
                    genre_json = excluded.genre_json,
                    lineup_json = excluded.lineup_json,
                    release_date = excluded.release_date,
                    duration_minutes = excluded.duration_minutes,
                    duration_raw = excluded.duration_raw,
                    language = excluded.language,
                    country = excluded.country,
                    age_restriction = excluded.age_restriction,
                    age_description = excluded.age_description,
                    remote_image_url = excluded.remote_image_url,
                    local_image_path = excluded.local_image_path,
                    image_download_status = excluded.image_download_status,
                    image_size_bytes = excluded.image_size_bytes,
                    remote_trailer_url = excluded.remote_trailer_url,
                    local_trailer_path = excluded.local_trailer_path,
                    trailer_download_status = excluded.trailer_download_status,
                    trailer_size_bytes = excluded.trailer_size_bytes,
                    refund_policy = excluded.refund_policy,
                    seo_title = excluded.seo_title,
                    seo_description = excluded.seo_description,
                    crawl_status = excluded.crawl_status,
                    last_updated_at = excluded.last_updated_at
                """,
                {
                    "movie_id": movie["movie_id"],
                    "fingerprint": movie["fingerprint"],
                    "source_url": movie["source_url"],
                    "slug": movie["slug"],
                    "source_slug": movie["source_slug"],
                    "title": movie["title"],
                    "normalized_title": movie["normalized_title"],
                    "original_title": movie.get("original_title", ""),
                    "description": movie["description"],
                    "director": movie.get("director", ""),
                    "cast": movie.get("cast", ""),
                    "genre_json": json.dumps(movie.get("genre", []), ensure_ascii=False),
                    "lineup_json": json.dumps(movie.get("lineup", []), ensure_ascii=False),
                    "release_date": movie.get("release_date", ""),
                    "duration_minutes": movie.get("duration_minutes"),
                    "duration_raw": movie.get("duration_raw", ""),
                    "language": movie.get("language", ""),
                    "country": movie.get("country", ""),
                    "age_restriction": movie.get("age_restriction", "all"),
                    "age_description": movie.get("age_description", ""),
                    "remote_image_url": movie.get("remote_image_url", ""),
                    "local_image_path": movie.get("local_image_path", ""),
                    "image_download_status": movie.get("image_download_status", "pending"),
                    "image_size_bytes": movie.get("image_size_bytes", 0),
                    "remote_trailer_url": movie.get("remote_trailer_url", ""),
                    "local_trailer_path": movie.get("local_trailer_path", ""),
                    "trailer_download_status": movie.get("trailer_download_status", "pending"),
                    "trailer_size_bytes": movie.get("trailer_size_bytes", 0),
                    "event_type": movie.get("event_type", "seated"),
                    "status": movie.get("status", "on_sale"),
                    "moderation_status": movie.get("moderation_status", "approved"),
                    "is_featured": 1 if movie.get("is_featured") else 0,
                    "refund_policy": movie.get("refund_policy", DEFAULT_REFUND_POLICY),
                    "seo_title": movie.get("seo_title", ""),
                    "seo_description": movie.get("seo_description", ""),
                    "crawl_status": movie.get("crawl_status", "pending"),
                    "first_crawled_at": movie.get("first_crawled_at", now_iso),
                    "last_updated_at": now_iso,
                },
            )

    def get_all_movies(self) -> list[dict[str, Any]]:
        """Retrieves all movies sorted by movie_id."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM movie_crawl_state ORDER BY movie_id ASC")
        rows = cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["genre"] = json.loads(d["genre_json"]) if d["genre_json"] else []
            d["lineup"] = json.loads(d["lineup_json"]) if d["lineup_json"] else []
            d["is_featured"] = bool(d["is_featured"])
            results.append(d)
        return results

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass


# ==============================================================================
# CSV EXPORT SYNCHRONIZER
# ==============================================================================

class IncrementalCSVManager:
    """
    Manages incremental and atomic persistence of CSV datasets on disk after each movie.
    """

    def __init__(self, db: CGVIndexDatabase) -> None:
        self.db = db
        self._ensure_organizers_csv()

    def _ensure_organizers_csv(self) -> None:
        organizer_rows = [
            {
                "id": DEFAULT_ORGANIZER_ID,
                "user_id": DEFAULT_ORGANIZER_USER_ID,
                "display_name": CGV_ORGANIZER_DISPLAY_NAME,
                "description": CGV_ORGANIZER_DESCRIPTION,
                "logo_url": CGV_ORGANIZER_LOGO_URL,
                "status": "approved",
                "review_note": "Verified Official Cinema Partner",
                "applied_at": "2026-01-01T00:00:00Z",
                "approved_at": "2026-01-01T00:00:00Z",
                "approved_by": 1,
                "created_at": "2026-01-01T00:00:00Z",
            }
        ]
        with open(ORGANIZERS_CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(organizer_rows[0].keys()))
            writer.writeheader()
            writer.writerows(organizer_rows)

    def sync_all_csvs(self) -> None:
        """Synchronizes all CSV files atomically from SQLite index."""
        movies = self.db.get_all_movies()
        if not movies:
            return

        event_fieldnames = [
            "id", "slug", "organizer_id", "category_id", "title", "original_title",
            "description", "age_restriction", "age_description", "duration_minutes",
            "genre", "lineup", "image_url", "trailer_url", "refund_policy",
            "is_featured", "event_type", "status", "moderation_status",
            "review_note", "seo_title", "seo_description", "created_at", "updated_at",
        ]

        compact_fieldnames = [
            "id", "slug", "organizer_id", "category_id", "title",
            "description", "image_url", "event_type", "status", "moderation_status",
        ]

        asset_fieldnames = [
            "movie_id", "slug", "title", "source_url", "release_date", "duration_minutes",
            "language", "country", "director", "cast", "genre", "age_restriction",
            "age_description", "local_image_path", "remote_image_url",
            "image_download_status", "image_size_bytes", "local_trailer_path",
            "remote_trailer_url", "trailer_download_status", "trailer_size_bytes",
        ]

        event_rows = []
        compact_rows = []
        asset_rows = []

        for m in movies:
            image_url_val = m["local_image_path"] if m["local_image_path"] else m["remote_image_url"]
            trailer_url_val = m["local_trailer_path"] if m["local_trailer_path"] else m["remote_trailer_url"]

            event_rows.append({
                "id": m["movie_id"],
                "slug": m["slug"],
                "organizer_id": DEFAULT_ORGANIZER_ID,
                "category_id": DEFAULT_CATEGORY_ID,
                "title": m["title"],
                "original_title": m["original_title"],
                "description": m["description"],
                "age_restriction": m["age_restriction"],
                "age_description": m["age_description"],
                "duration_minutes": m["duration_minutes"] if m["duration_minutes"] is not None else "",
                "genre": parse_pg_array(m["genre"]),
                "lineup": parse_pg_array(m["lineup"]),
                "image_url": image_url_val,
                "trailer_url": trailer_url_val,
                "refund_policy": m["refund_policy"] or DEFAULT_REFUND_POLICY,
                "is_featured": m["is_featured"],
                "event_type": m["event_type"],
                "status": m["status"],
                "moderation_status": m["moderation_status"],
                "review_note": "",
                "seo_title": m["seo_title"],
                "seo_description": m["seo_description"],
                "created_at": m["first_crawled_at"],
                "updated_at": m["last_updated_at"],
            })

            compact_rows.append({
                "id": m["movie_id"],
                "slug": m["slug"],
                "organizer_id": DEFAULT_ORGANIZER_ID,
                "category_id": DEFAULT_CATEGORY_ID,
                "title": m["title"],
                "description": m["description"],
                "image_url": image_url_val,
                "event_type": m["event_type"],
                "status": m["status"],
                "moderation_status": m["moderation_status"],
            })

            asset_rows.append({
                "movie_id": m["movie_id"],
                "slug": m["slug"],
                "title": m["title"],
                "source_url": m["source_url"],
                "release_date": m["release_date"],
                "duration_minutes": m["duration_minutes"],
                "language": m["language"],
                "country": m["country"],
                "director": m["director"],
                "cast": m["cast"],
                "genre": ", ".join(m["genre"]),
                "age_restriction": m["age_restriction"],
                "age_description": m["age_description"],
                "local_image_path": m["local_image_path"],
                "remote_image_url": m["remote_image_url"],
                "image_download_status": m["image_download_status"],
                "image_size_bytes": m["image_size_bytes"],
                "local_trailer_path": m["local_trailer_path"],
                "remote_trailer_url": m["remote_trailer_url"],
                "trailer_download_status": m["trailer_download_status"],
                "trailer_size_bytes": m["trailer_size_bytes"],
            })

        temp_events = EVENTS_CSV_PATH.with_suffix(".tmp")
        with open(temp_events, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=event_fieldnames)
            writer.writeheader()
            writer.writerows(event_rows)
            f.flush()
            os.fsync(f.fileno())
        temp_events.replace(EVENTS_CSV_PATH)

        temp_compact = EVENTS_COMPACT_CSV_PATH.with_suffix(".tmp")
        with open(temp_compact, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=compact_fieldnames)
            writer.writeheader()
            writer.writerows(compact_rows)
            f.flush()
            os.fsync(f.fileno())
        temp_compact.replace(EVENTS_COMPACT_CSV_PATH)

        temp_assets = ASSETS_METADATA_CSV_PATH.with_suffix(".tmp")
        with open(temp_assets, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=asset_fieldnames)
            writer.writeheader()
            writer.writerows(asset_rows)
            f.flush()
            os.fsync(f.fileno())
        temp_assets.replace(ASSETS_METADATA_CSV_PATH)


# ==============================================================================
# INCREMENTAL & RESUMABLE CRAWLER
# ==============================================================================

class ResumableCGVCrawler:
    def __init__(self) -> None:
        self.db = CGVIndexDatabase()
        self.csv_manager = IncrementalCSVManager(self.db)
        self.browser = BrowserManager()
        self.start_timestamp = datetime.now(timezone.utc).isoformat()
        self.running = True

        self.stats = {
            "total_discovered": 0,
            "already_stored_skipped": 0,
            "newly_stored": 0,
            "resumed_incomplete": 0,
            "successful_images": 0,
            "successful_trailers": 0,
            "failed_downloads": 0,
            "duplicates_skipped": 0,
            "validation_errors": 0,
        }

        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

        self._reconcile_startup_state()

    def _handle_signal(self, signum: int, frame: Any) -> None:
        logging.info("Received termination signal (%s). Finishing current movie and shutting down cleanly...", signum)
        self.running = False

    def close(self) -> None:
        self.browser.quit_driver()
        self.db.close()

    def _reconcile_startup_state(self) -> None:
        """Reconciles disk files with SQLite state records."""
        logging.info("Reconciling startup state from SQLite and storage directories...")
        existing_movies = self.db.get_all_movies()
        reconciled_count = 0

        for m in existing_movies:
            needs_update = False
            img_path = BASE_DIR / m["local_image_path"] if m["local_image_path"] else None
            vid_path = BASE_DIR / m["local_trailer_path"] if m["local_trailer_path"] else None

            # Reconcile image
            if img_path and img_path.exists() and img_path.stat().st_size > 0:
                if m["image_size_bytes"] != img_path.stat().st_size or m["image_download_status"] != "completed":
                    m["image_size_bytes"] = img_path.stat().st_size
                    m["image_download_status"] = "completed"
                    needs_update = True
            elif m["local_image_path"]:
                logging.warning("Image file missing for [%s]: %s; resetting status.", m["slug"], m["local_image_path"])
                m["local_image_path"] = ""
                m["image_size_bytes"] = 0
                m["image_download_status"] = "pending"
                needs_update = True

            # Reconcile trailer
            if vid_path and vid_path.exists() and vid_path.stat().st_size > 0:
                if m["trailer_size_bytes"] != vid_path.stat().st_size or m["trailer_download_status"] != "completed":
                    m["trailer_size_bytes"] = vid_path.stat().st_size
                    m["trailer_download_status"] = "completed"
                    needs_update = True

            if needs_update:
                m["crawl_status"] = "incomplete"
                self.db.upsert_movie_state(m)
                reconciled_count += 1

        self.csv_manager.sync_all_csvs()
        logging.info("Startup reconciliation complete. Found %d existing records (%d reconciled).", len(existing_movies), reconciled_count)

    def discover_all_movie_urls(self) -> list[str]:
        """Discovers all available movie URLs across all sections."""
        logging.info("Starting exhaustive movie URL discovery across CGV...")
        target_sections = [
            CGV_HOMEPAGE_URL,
            CGV_NOW_SHOWING_URL,
            f"{CGV_NOW_SHOWING_URL}?limit=all",
            CGV_COMING_SOON_URL,
            f"{CGV_COMING_SOON_URL}?limit=all",
            f"{CGV_BASE_URL}/default/movies.html",
        ]

        skip_patterns = [
            "theaters", "cinemas", "news", "promox", "customer", "faq",
            "contacts", "privacy", "terms", "careers", "now-showing",
            "coming-soon", "movies", "user", "checkout", "booking", "online-store",
            "special",
        ]

        discovered_dict: dict[str, str] = {}
        visited_pages: set[str] = set()

        for page_url in target_sections:
            if not self.running:
                break
            if page_url in visited_pages:
                continue
            visited_pages.add(page_url)

            logging.info("Discovering from: %s", page_url)
            try:
                html = self.browser.fetch_page_source(page_url)
                soup = BeautifulSoup(html, "html.parser")

                for a in soup.find_all("a", href=True):
                    href = a["href"].split("?")[0].split("#")[0].rstrip("/")
                    if not href.endswith(".html"):
                        continue
                    if not href.startswith(CGV_BASE_URL + "/default/"):
                        continue
                    if any(p in href for p in skip_patterns):
                        continue

                    slug = href.rsplit("/", 1)[-1].replace(".html", "")
                    if slug and slug not in discovered_dict:
                        discovered_dict[slug] = href
                        logging.info("  [Discovered] %s -> %s", slug, href)

                pager_links = soup.select(".pages a, .pager a")
                for pl in pager_links:
                    p_href = pl.get("href", "").split("#")[0]
                    if p_href and p_href not in visited_pages and "http" in p_href:
                        target_sections.append(p_href)

            except Exception as exc:
                logging.error("Discovery error on %s: %s", page_url, exc)

        self.stats["total_discovered"] = len(discovered_dict)
        logging.info("Discovery finished. Found %d unique movie links.", len(discovered_dict))
        return [discovered_dict[k] for k in sorted(discovered_dict.keys())]

    def parse_movie_detail(self, url: str) -> dict[str, Any] | None:
        """Parses full detail from a single movie page."""
        try:
            html = self.browser.fetch_page_source(url)
            soup = BeautifulSoup(html, "html.parser")

            title_el = soup.select_one(".product-name .h1, h1")
            if not title_el:
                return None
            title = title_el.get_text(strip=True)
            if not title:
                return None

            slug_raw = url.rsplit("/", 1)[-1].replace(".html", "")
            slug = f"{slug_raw}-cgv"

            info_map: dict[str, str] = {}
            for div in soup.select(".movie-info"):
                lbl = div.select_one("label")
                val = div.select_one(".std")
                if lbl and val:
                    key = lbl.get_text(strip=True).replace(":", "")
                    info_map[key] = val.get_text(strip=True)

            director = info_map.get("Đạo diễn", "").strip()
            cast_raw = info_map.get("Diễn viên", "").strip()
            genre_raw = info_map.get("Thể loại", "").strip()
            release_raw = info_map.get("Khởi chiếu", "").strip()
            duration_raw = info_map.get("Thời lượng", "").strip()
            language_raw = info_map.get("Ngôn ngữ", "").strip()

            rated_el = soup.select_one(".movie-rating .std, .movie-rated-web .std")
            rated_raw = rated_el.get_text(strip=True) if rated_el else info_map.get("Rated", "")
            age_restriction, age_description = normalize_age_restriction(rated_raw)

            duration_minutes = parse_duration_minutes(duration_raw)

            desc_el = soup.select_one(
                ".product-collateral .tab-content .std, .movie-collateral .std, .tab-content .std"
            )
            description = desc_el.get_text(separator="\n", strip=True) if desc_el else ""
            if not description:
                description = f"Thông tin chi tiết và lịch chiếu bộ phim {title} tại hệ thống rạp CJ CGV Vietnam."

            genres = [g.strip() for g in re.split(r"[,/]+", genre_raw) if g.strip()]
            if not genres:
                genres = ["Điện Ảnh", "Chiếu Rạp"]

            lineup_items: list[str] = []
            if director:
                lineup_items.append(f"Đạo diễn: {director}")
            if cast_raw:
                cast_members = [c.strip() for c in re.split(r"[,/]+", cast_raw) if c.strip()]
                lineup_items.extend(cast_members)

            img_el = soup.select_one(
                ".product-image-gallery img#image-main, .product-image-gallery img, .product-image img"
            )
            remote_image_url = ""
            if img_el:
                remote_image_url = (img_el.get("data-zoom-image") or img_el.get("src") or "").strip()

            remote_trailer_url = ""
            trailer_iframe = soup.select_one(".product_view_trailer iframe, iframe[src*='youtube']")
            if trailer_iframe:
                src = (trailer_iframe.get("src") or "").strip()
                if src.startswith("//"):
                    src = "https:" + src
                remote_trailer_url = src
            else:
                yt_match = re.search(r"(https?://www\.youtube\.com/embed/[a-zA-Z0-9_-]+)", html)
                if yt_match:
                    remote_trailer_url = yt_match.group(1)

            country = infer_country(language_raw, title, description)
            norm_title = normalize_title(title)
            fingerprint = compute_fingerprint(norm_title, release_raw, url)

            return {
                "fingerprint": fingerprint,
                "slug": slug,
                "source_slug": slug_raw,
                "source_url": url,
                "title": title,
                "normalized_title": norm_title,
                "original_title": slug_raw.replace("-", " ").title(),
                "description": description,
                "director": director,
                "cast": cast_raw,
                "lineup": lineup_items,
                "genre": genres,
                "release_date": release_raw,
                "duration_minutes": duration_minutes,
                "duration_raw": duration_raw,
                "language": language_raw,
                "country": country,
                "age_restriction": age_restriction,
                "age_description": age_description,
                "remote_image_url": remote_image_url,
                "remote_trailer_url": remote_trailer_url,
                "event_type": "seated",
                "status": "on_sale",
                "moderation_status": "approved",
                "is_featured": False,
                "refund_policy": DEFAULT_REFUND_POLICY,
                "seo_title": f"{title} | CJ CGV Vietnam",
                "seo_description": description[:160],
            }

        except Exception as exc:
            logging.error("Error parsing movie detail for %s: %s", url, exc)
            return None

    def download_image_immediately(self, movie: dict[str, Any]) -> tuple[str, str, int]:
        """Downloads poster image immediately to data/cgv/images."""
        url = movie.get("remote_image_url", "")
        slug = movie["source_slug"]
        if not url:
            return "", "missing_source_url", 0

        parsed = urlparse(url)
        ext = Path(parsed.path).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
            ext = ".jpg"

        filename = f"{slug}_poster{ext}"
        file_path = IMAGES_DIR / filename
        rel_path = f"data/cgv/images/{filename}"

        if file_path.exists() and file_path.stat().st_size > 0:
            return rel_path, "completed", file_path.stat().st_size

        # Attempt download via requests session first
        try:
            r = self.browser.http_session.get(url, timeout=20)
            if r.status_code == 200 and len(r.content) > 0:
                with open(file_path, "wb") as f:
                    f.write(r.content)
                size = len(r.content)
                logging.info("  Saved image: %s (%d bytes)", rel_path, size)
                return rel_path, "completed", size
        except Exception as e:
            logging.warning("HTTP session download failed for %s: %s; trying browser XHR", url, e)

        # Fallback to browser execution
        try:
            driver = self.browser.get_driver()
            img_bytes = driver.execute_async_script(
                """
                var uri = arguments[0];
                var callback = arguments[1];
                var xhr = new XMLHttpRequest();
                xhr.open('GET', uri, true);
                xhr.responseType = 'arraybuffer';
                xhr.onload = function() {
                    if (xhr.status === 200) {
                        var byteArray = new Uint8Array(xhr.response);
                        var binaryString = '';
                        for (var i = 0; i < byteArray.byteLength; i++) {
                            binaryString += String.fromCharCode(byteArray[i]);
                        }
                        callback({success: true, data: btoa(binaryString)});
                    } else {
                        callback({success: false, status: xhr.status});
                    }
                };
                xhr.onerror = function() { callback({success: false, error: 'Network error'}); };
                xhr.send();
                """,
                url,
            )

            import base64
            if img_bytes and img_bytes.get("success"):
                content = base64.b64decode(img_bytes["data"])
                with open(file_path, "wb") as f:
                    f.write(content)
                size = len(content)
                logging.info("  Saved image via browser: %s (%d bytes)", rel_path, size)
                return rel_path, "completed", size

            return "", "failed_network", 0

        except Exception as exc:
            logging.error("Failed to download image for [%s]: %s", slug, exc)
            return "", f"failed: {str(exc)[:40]}", 0

    def download_trailer_immediately(self, movie: dict[str, Any]) -> tuple[str, str, int]:
        """Downloads trailer video using yt-dlp immediately to data/cgv/videos."""
        url = movie.get("remote_trailer_url", "")
        slug = movie["source_slug"]
        if not url:
            return "", "no_trailer_available", 0

        watch_url = url
        if "youtube.com/embed/" in url:
            vid_id = url.split("youtube.com/embed/")[1].split("?")[0]
            watch_url = f"https://www.youtube.com/watch?v={vid_id}"

        target_name = f"{slug}_trailer"
        out_template = str(VIDEOS_DIR / f"{target_name}.%(ext)s")
        expected_mp4 = VIDEOS_DIR / f"{target_name}.mp4"
        rel_path = f"data/cgv/videos/{target_name}.mp4"

        if expected_mp4.exists() and expected_mp4.stat().st_size > 0:
            return rel_path, "completed", expected_mp4.stat().st_size

        try:
            ydl_opts = {
                "format": "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
                "outtmpl": out_template,
                "merge_output_format": "mp4",
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "socket_timeout": 20,
            }

            logging.info("  Downloading trailer via yt-dlp: %s", watch_url)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([watch_url])

            if expected_mp4.exists() and expected_mp4.stat().st_size > 0:
                size = expected_mp4.stat().st_size
                logging.info("  Saved trailer: %s (%d bytes)", rel_path, size)
                return rel_path, "completed", size

            candidates = list(VIDEOS_DIR.glob(f"{target_name}.*"))
            if candidates and candidates[0].stat().st_size > 0:
                cand = candidates[0]
                found_rel = f"data/cgv/videos/{cand.name}"
                return found_rel, "completed", cand.stat().st_size

            return "", "failed_remote_only", 0

        except Exception as exc:
            logging.warning("  Could not download trailer for [%s]: %s. Recorded remote URL.", slug, exc)
            return "", "failed_remote_only", 0

    def process_single_movie(self, url: str) -> None:
        """Processes an individual movie with immediate persistent storage."""
        logging.info(">>> Processing URL: %s", url)

        existing = self.db.find_by_url(url)
        is_resume = False

        if existing and existing.get("crawl_status") == "completed":
            img_ok = bool(
                existing.get("local_image_path")
                and (BASE_DIR / existing["local_image_path"]).exists()
                and (BASE_DIR / existing["local_image_path"]).stat().st_size > 0
            )
            trailer_status = existing.get("trailer_download_status")
            trailer_ok = trailer_status in {"completed", "failed_remote_only", "no_trailer_available"}

            if img_ok and trailer_ok:
                logging.info("  [ALREADY STORED & VALIDATED] [%s] '%s' -> Skipping", existing["slug"], existing["title"])
                self.stats["already_stored_skipped"] += 1
                return
            else:
                logging.info("  [RESUME] Incomplete assets for existing movie: [%s]", existing["slug"])
                is_resume = True

        movie = self.parse_movie_detail(url)
        if not movie:
            logging.warning("  Failed to extract valid movie metadata from %s", url)
            self.stats["validation_errors"] += 1
            return

        existing_fp = self.db.find_by_fingerprint(movie["fingerprint"])
        if existing_fp and existing_fp["source_url"] != movie["source_url"]:
            logging.info("  [DEDUPLICATE] Movie already exists under different URL: '%s'", movie["title"])
            self.stats["duplicates_skipped"] += 1
            return

        if existing:
            movie["movie_id"] = existing["movie_id"]
            movie["first_crawled_at"] = existing["first_crawled_at"]
        else:
            movie["movie_id"] = self.db.get_max_movie_id() + 1
            movie["first_crawled_at"] = datetime.now(timezone.utc).isoformat()

        # Download Image immediately
        img_path, img_status, img_size = self.download_image_immediately(movie)
        movie["local_image_path"] = img_path
        movie["image_download_status"] = img_status
        movie["image_size_bytes"] = img_size
        if img_status == "completed":
            self.stats["successful_images"] += 1
        else:
            self.stats["failed_downloads"] += 1

        # Download Trailer immediately
        trailer_path, trailer_status, trailer_size = self.download_trailer_immediately(movie)
        movie["local_trailer_path"] = trailer_path
        movie["trailer_download_status"] = trailer_status
        movie["trailer_size_bytes"] = trailer_size
        if trailer_status == "completed":
            self.stats["successful_trailers"] += 1
        elif trailer_status == "failed_remote_only":
            self.stats["failed_downloads"] += 1

        movie["crawl_status"] = "completed" if (img_path or not movie["remote_image_url"]) else "incomplete"

        # 1. Commit immediately to SQLite
        self.db.upsert_movie_state(movie)

        # 2. Flush immediately to CSV files
        self.csv_manager.sync_all_csvs()

        if is_resume:
            self.stats["resumed_incomplete"] += 1
            logging.info("  [RESUMED & PERSISTED] [%s] '%s'", movie["slug"], movie["title"])
        else:
            self.stats["newly_stored"] += 1
            logging.info("  [NEWLY STORED & PERSISTED] [%s] '%s'", movie["slug"], movie["title"])

        time.sleep(BETWEEN_REQUESTS_DELAY_SECONDS)

    def run(self) -> None:
        """Executes the full resumable crawling workflow."""
        start_time = time.time()
        logging.info("=========================================================")
        logging.info("STARTING RESUMABLE CGV MOVIE PIPELINE")
        logging.info("Timestamp: %s", self.start_timestamp)
        logging.info("SQLite Index: %s", SQLITE_DB_PATH)
        logging.info("=========================================================")

        urls = self.discover_all_movie_urls()
        logging.info("Found %d candidate URLs to process.", len(urls))

        for idx, url in enumerate(urls, 1):
            if not self.running:
                logging.info("Interruption requested. Stopping loop gracefully.")
                break
            logging.info("Processing [%d/%d]", idx, len(urls))
            self.process_single_movie(url)

        self.generate_readme()

        elapsed = time.time() - start_time
        total_in_db = len(self.db.get_all_movies())

        logging.info("=========================================================")
        logging.info("RESUMABLE CGV MOVIE PIPELINE SUMMARY")
        logging.info("=========================================================")
        logging.info("Elapsed Time:                  %.2f seconds", elapsed)
        logging.info("Total Discovered Movies:       %d", self.stats["total_discovered"])
        logging.info("Total Persisted in Database:   %d", total_in_db)
        logging.info("Already Stored (Skipped):      %d", self.stats["already_stored_skipped"])
        logging.info("Newly Stored Records:          %d", self.stats["newly_stored"])
        logging.info("Resumed/Incomplete Records:    %d", self.stats["resumed_incomplete"])
        logging.info("Successful Poster Downloads:   %d", self.stats["successful_images"])
        logging.info("Successful Trailer Downloads:  %d", self.stats["successful_trailers"])
        logging.info("Failed Downloads / Remote Only:%d", self.stats["failed_downloads"])
        logging.info("Duplicates Skipped:            %d", self.stats["duplicates_skipped"])
        logging.info("Validation Errors:             %d", self.stats["validation_errors"])
        logging.info("=========================================================")

    def generate_readme(self) -> None:
        """Generates README.md documenting the incremental and resumable crawler."""
        readme_path = DATA_DIR / "README.md"
        total_in_db = len(self.db.get_all_movies())
        content = f"""# CGV Vietnam Movie Event Crawler & Dataset (Incremental & Resumable)

## 1. Overview
This dataset contains movie events crawled from [CJ CGV Vietnam](https://www.cgv.vn) for the TixHub Event Ticketing Platform. Each movie is modeled as an **Event** record belonging to a single verified **Organizer** representing **CJ CGV Vietnam**, strictly compliant with the PostgreSQL database schema and domain specifications (`0001_auth.sql`, `0002_catalog.sql`, and `SCHEMA_DATABASE.md`).

- **Architecture:** Incremental, movie-by-movie persistent storage with atomic SQLite commit & CSV synchronization.
- **Resumability:** Persistent SQLite index (`data/cgv/index.sqlite`) tracks crawl states, image sizes, and trailer download statuses. Interrupted runs resume seamlessly without duplicates.
- **Source Website:** [https://www.cgv.vn](https://www.cgv.vn)
- **Last Crawl Timestamp:** `{datetime.now(timezone.utc).isoformat()}`

---

## 2. Execution Summary & Metrics

| Metric | Value |
|---|---|
| **Total URLs Discovered** | `{self.stats['total_discovered']}` |
| **Total Persisted Records** | `{total_in_db}` |
| **Already Stored / Skipped** | `{self.stats['already_stored_skipped']}` |
| **Newly Stored Records** | `{self.stats['newly_stored']}` |
| **Resumed / Incomplete Records** | `{self.stats['resumed_incomplete']}` |
| **Organizer Records** | `1 (CJ CGV Vietnam)` |
| **Poster Images Successfully Stored** | `{self.stats['successful_images']}` |
| **Trailer Videos Downloaded Locally** | `{self.stats['successful_trailers']}` |
| **Trailers Recorded Remote Only** | `{self.stats['failed_downloads']}` |
| **Duplicate Movies Skipped** | `{self.stats['duplicates_skipped']}` |
| **Validation Errors** | `{self.stats['validation_errors']}` |

---

## 3. Persistent Directory & Asset Structure

```
data/cgv/
├── README.md                     # Comprehensive documentation & execution guide
├── index.sqlite                  # Persistent SQLite state index & resume manifest
├── events.csv                    # Full database-compatible Event records (flushed incrementally)
├── events_import_compact.csv     # 10-column compact Event import format
├── organizers.csv                # Organizer record for CJ CGV Vietnam
├── assets_metadata.csv           # Detailed asset mapping and download status
├── images/                       # Local official high-resolution movie posters
│   ├── spider-brand-new-day_poster.jpg
│   ├── shin-yokai-vacation_poster.jpg
│   └── ...
├── videos/                       # Local official trailer videos (.mp4)
│   ├── spider-brand-new-day_trailer.mp4
│   ├── the-odyssey_trailer.mp4
│   └── ...
└── logs/
    └── cgv_crawler.log           # Detailed execution and download logs
```

---

## 4. Field Mapping & Schema Normalization

| Database Field (`events`) | CGV Source Field | Data Type / Constraint | Mapping & Fallback Rule |
|---|---|---|---|
| `id` | Generated sequence | `BIGINT` | Stable sequential integer ID from SQLite index |
| `slug` | CGV URL path | `TEXT UNIQUE NOT NULL` | Extracted from URL (e.g. `spider-brand-new-day-cgv`) |
| `organizer_id` | CGV Organizer | `BIGINT NOT NULL REFERENCES organizers(id)` | Foreign key pointing to CJ CGV Vietnam (`500`) |
| `category_id` | Fixed Category | `SMALLINT NOT NULL REFERENCES event_categories(id)` | `3` (`theatre` / Sân khấu & Điện ảnh) |
| `title` | Tên phim | `TEXT NOT NULL` | Official Vietnamese display title in UTF-8 |
| `original_title` | Tên gốc | `TEXT` | Extracted or normalized from slug / title |
| `description` | Nội dung phim | `TEXT NOT NULL` | Full synopsis from CGV movie detail page |
| `age_restriction` | Rated | `TEXT CHECK (IN ('all', '13+', '16+', '18+'))` | `P`/`K` -> `'all'`, `T13`/`C13` -> `'13+'`, `T16`/`C16` -> `'16+'`, `T18`/`C18` -> `'18+'` |
| `age_description` | Rated text | `TEXT` | Full descriptive text (e.g. `T13 - Phim được phổ biến đến người xem từ đủ 13 tuổi trở lên`) |
| `duration_minutes` | Thời lượng | `INT` | Parsed numeric minutes (e.g. `145` from `145 phút`) |
| `genre` | Thể loại | `TEXT[] NOT NULL` | PostgreSQL array format (e.g. `{{"Hành Động", "Phiêu Lưu"}}`) |
| `lineup` | Đạo diễn & Diễn viên | `TEXT[] NOT NULL` | PostgreSQL array containing director and cast members |
| `image_url` | Poster Image | `TEXT` | Relative local path `data/cgv/images/<slug>_poster.jpg` |
| `trailer_url` | Trailer Video | `TEXT` | Relative local path `data/cgv/videos/<slug>_trailer.mp4` or official remote trailer URL |
| `refund_policy` | Chính sách hoàn vé | `TEXT` | Standard CGV ticket cancellation and refund terms |
| `event_type` | Loại sự kiện | `TEXT CHECK (IN ('general_admission', 'seated'))` | `'seated'` (Cinema seated inventory) |
| `status` | Trạng thái sự kiện | `TEXT CHECK (IN ('draft', 'on_sale', 'finished', 'cancelled'))` | `'on_sale'` |
| `moderation_status`| Duyệt sự kiện | `TEXT CHECK (IN ('pending_review', 'approved', 'flagged', 'removed'))`| `'approved'` |
| `seo_title` | SEO Title | `TEXT` | `<Movie Title> | CJ CGV Vietnam` |
| `seo_description` | SEO Description | `TEXT` | First 160 characters of synopsis |

---

## 5. Incremental Processing & Deduplication Strategy

1. **Persistent Manifest (`index.sqlite`):**
   - Stores each movie record immediately upon extraction.
   - Computes deterministic SHA256 fingerprint: `SHA256(normalized_title + release_date + source_url)`.
   - Prevents duplicate crawling across repeated runs or intersecting CGV listings.

2. **Resume Capability:**
   - On restart, reconciles database states with filesystem files.
   - Fully saved movies with intact assets are skipped instantly without network overhead.
   - Incomplete records (e.g. interrupted trailer download) resume seamlessly.

3. **Incremental CSV Sync:**
   - Flushes and syncs CSV files (`events.csv`, `organizers.csv`, `assets_metadata.csv`) after each movie record is committed.
   - Data is immediately usable even if the process is terminated at any point.

---

## 6. How to Run the Crawler

### Prerequisites
- Python 3.10+
- Chrome browser installed (for headless Selenium rendering)
- Dependencies: `pip install -r CrawlData/requirements.txt`

### Command to Execute
```powershell
# From the project root:
.\\myenv\\Scripts\\python.exe CrawlData\\cgv_scraper.py
```
"""
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(content)
        logging.info("Wrote updated README: %s", readme_path)


# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================

def main() -> None:
    crawler = ResumableCGVCrawler()
    try:
        crawler.run()
    finally:
        crawler.close()


if __name__ == "__main__":
    main()
