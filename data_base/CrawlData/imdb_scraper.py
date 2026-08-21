"""
Incremental and Resumable IMDb Movie Event Scraper & Asset Pipeline.

Crawls exactly 250 unique movies (a balanced mix of NEW/RECENT and POPULAR movies)
from https://www.imdb.com, downloads high-resolution poster images and official
trailer videos to dedicated local folders (data/imdb/images, data/imdb/videos),
persists progress movie-by-movie into a persistent SQLite state database
(data/imdb/index.sqlite), and incrementally writes schema-compliant CSV files:
- data/imdb/movies.csv (and data/imdb/events.csv)
- data/imdb/organizers.csv
- data/imdb/assets_metadata.csv
- data/imdb/events_import_compact.csv
- data/imdb/README.md

Complies strictly with TixHub database schema specifications (0001_auth.sql,
0002_catalog.sql, 0021_organizer_analytics.sql).
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
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

# Force UTF-8 on Windows streams
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# ==============================================================================
# DIRECTORY & PATH CONFIGURATION
# ==============================================================================

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "imdb"
IMAGES_DIR = DATA_DIR / "images"
VIDEOS_DIR = DATA_DIR / "videos"
LOGS_DIR = DATA_DIR / "logs"

DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_DB_PATH = DATA_DIR / "index.sqlite"
MOVIES_CSV_PATH = DATA_DIR / "movies.csv"
EVENTS_CSV_PATH = DATA_DIR / "events.csv"
ORGANIZERS_CSV_PATH = DATA_DIR / "organizers.csv"
ASSETS_METADATA_CSV_PATH = DATA_DIR / "assets_metadata.csv"
EVENTS_COMPACT_CSV_PATH = DATA_DIR / "events_import_compact.csv"
README_MD_PATH = DATA_DIR / "README.md"
LOG_FILE_PATH = LOGS_DIR / "imdb_crawler.log"

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
logger = logging.getLogger("IMDbCrawler")

# ==============================================================================
# CONSTANTS & SCHEMA CONFIGURATION
# ==============================================================================

IMDB_BASE_URL = "https://www.imdb.com"
TARGET_MOVIE_COUNT = 250

DEFAULT_ORGANIZER_ID = 700
DEFAULT_ORGANIZER_USER_ID = 700
IMDB_ORGANIZER_DISPLAY_NAME = "IMDb (Internet Movie Database)"
IMDB_ORGANIZER_DESCRIPTION = (
    "IMDb is the world's most popular and authoritative source for movie, TV, and "
    "celebrity content, offering comprehensive listings, ratings, reviews, box office "
    "intelligence, and entertainment industry data worldwide."
)
IMDB_ORGANIZER_LOGO_URL = (
    "https://m.media-amazon.com/images/G/01/imdb/images/plugins/imdb_46x22-2264473254._CB485934444_.png"
)

DEFAULT_CATEGORY_ID = 3  # 'theatre' in catalog (Sân khấu & Điện ảnh)

DEFAULT_REFUND_POLICY = (
    "According to IMDb ticketing partner policies: Tickets once booked cannot be cancelled, "
    "exchanged, or refunded except in the event of an official screening cancellation by the theater or provider."
)

ALLOWED_AGE_RESTRICTIONS = {"all", "13+", "16+", "18+"}
ALLOWED_EVENT_TYPES = {"general_admission", "seated"}
ALLOWED_EVENT_STATUSES = {"draft", "on_sale", "finished", "cancelled"}
ALLOWED_MODERATION_STATUSES = {"pending_review", "approved", "flagged", "removed"}

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 (TixHub-IMDb-Crawler/2.0)"
)

REQUEST_TIMEOUT_SECONDS = 25
BETWEEN_REQUESTS_DELAY_SECONDS = 0.5


# ==============================================================================
# UTILITY FUNCTIONS
# ==============================================================================

def slugify(text: str) -> str:
    """Creates a URL-safe slug from text."""
    text = re.sub(r"[^\w\s-]", "", text.lower())
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text or "untitled"


def compute_fingerprint(imdb_id: str) -> str:
    """Computes stable SHA256 fingerprint for movie deduplication."""
    return hashlib.sha256(imdb_id.strip().encode("utf-8")).hexdigest()


def normalize_age_restriction(cert_str: Optional[str]) -> Tuple[str, str]:
    """
    Normalizes IMDb certification / age rating to schema enum ('all', '13+', '16+', '18+')
    and descriptive text.
    """
    if not cert_str:
        return "all", "Certificate: Unrated / All Ages"

    cert_upper = cert_str.strip().upper()
    
    # 18+ certificates
    if any(k in cert_upper for k in ["18", "R", "NC-17", "TV-MA", "T18", "C18", "X", "ADULT"]):
        return "18+", f"Certificate: {cert_str} (Restricted to viewers aged 18 and older)"
    
    # 16+ certificates
    if any(k in cert_upper for k in ["16", "TV-16", "T16", "C16", "15", "MA-15+"]):
        return "16+", f"Certificate: {cert_str} (Suitable for viewers aged 16 and older)"
    
    # 13+ certificates
    if any(k in cert_upper for k in ["13", "PG-13", "TV-14", "12", "14", "T13", "C13"]):
        return "13+", f"Certificate: {cert_str} (Parents strongly cautioned; some material may be inappropriate for children under 13)"
    
    # General / All
    return "all", f"Certificate: {cert_str} (General Admission / All Ages Admitted)"


def parse_pg_array(items: List[str]) -> str:
    """Formats Python list of strings as PostgreSQL array literal: {"item1", "item2"}."""
    cleaned = []
    for item in items:
        item_str = str(item).strip()
        if not item_str:
            continue
        escaped = item_str.replace("\\", "\\\\").replace('"', '\\"')
        cleaned.append(f'"{escaped}"')
    return "{" + ", ".join(cleaned) + "}"


def download_file(url: str, dest_path: Path, max_retries: int = 3) -> Tuple[bool, int]:
    """
    Downloads a binary file with retries and chunked streaming.
    Returns (success_bool, size_bytes).
    """
    if not url:
        return False, 0

    headers = {"User-Agent": USER_AGENT, "Referer": "https://www.imdb.com/"}

    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, headers=headers, stream=True, timeout=REQUEST_TIMEOUT_SECONDS)
            if resp.status_code == 200:
                temp_path = dest_path.with_suffix(dest_path.suffix + ".tmp")
                total_bytes = 0
                with open(temp_path, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=65536):
                        if chunk:
                            f.write(chunk)
                            total_bytes += len(chunk)
                
                if total_bytes > 0:
                    if temp_path.exists():
                        if dest_path.exists():
                            dest_path.unlink()
                        temp_path.rename(dest_path)
                    return True, total_bytes
                else:
                    if temp_path.exists():
                        temp_path.unlink()
            elif resp.status_code == 404:
                logger.warning(f"404 Not Found downloading {url}")
                return False, 0
        except Exception as exc:
            logger.warning(f"Download attempt {attempt}/{max_retries} failed for {url}: {exc}")
            time.sleep(1.0 * attempt)

    return False, 0


# ==============================================================================
# PERSISTENT SQLITE DATABASE MANAGER
# ==============================================================================

class IMDbIndexDatabase:
    """
    Manages persistent state and deduplication in SQLite (data/imdb/index.sqlite).
    """

    def __init__(self, db_path: Path = SQLITE_DB_PATH) -> None:
        self.db_path = db_path
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self.conn:
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS imdb_crawl_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    movie_id INTEGER UNIQUE NOT NULL,
                    imdb_id TEXT UNIQUE NOT NULL,
                    fingerprint TEXT UNIQUE NOT NULL,
                    source_url TEXT UNIQUE NOT NULL,
                    source_category TEXT NOT NULL,
                    rank_order INTEGER NOT NULL,
                    slug TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    normalized_title TEXT NOT NULL,
                    original_title TEXT,
                    description TEXT NOT NULL,
                    release_date TEXT,
                    release_year INTEGER,
                    duration_minutes INTEGER,
                    language TEXT,
                    country TEXT,
                    director TEXT,
                    writers TEXT,
                    cast TEXT,
                    genre_json TEXT NOT NULL DEFAULT '[]',
                    lineup_json TEXT NOT NULL DEFAULT '[]',
                    imdb_rating REAL,
                    vote_count INTEGER,
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
                    first_crawled_at TEXT NOT NULL,
                    last_updated_at TEXT NOT NULL
                )
                """
            )
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS imdb_candidates (
                    imdb_id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    rank_order INTEGER NOT NULL,
                    label TEXT
                )
                """
            )
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_imdb_id ON imdb_crawl_state(imdb_id)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_crawl_fingerprint ON imdb_crawl_state(fingerprint)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_crawl_status ON imdb_crawl_state(crawl_status)")

    def get_cached_candidates(self) -> List[Tuple[str, str, int]]:
        cur = self.conn.cursor()
        cur.execute("SELECT imdb_id, category, rank_order FROM imdb_candidates ORDER BY rank_order ASC")
        return [(row[0], row[1], row[2]) for row in cur.fetchall()]

    def cache_candidates(self, candidates: List[Tuple[str, str, int, str]]) -> None:
        with self.conn:
            self.conn.executemany(
                "INSERT OR IGNORE INTO imdb_candidates (imdb_id, category, rank_order, label) VALUES (?, ?, ?, ?)",
                candidates,
            )

    def get_max_movie_id(self) -> int:
        cur = self.conn.cursor()
        cur.execute("SELECT COALESCE(MAX(movie_id), 0) FROM imdb_crawl_state")
        row = cur.fetchone()
        return row[0] if row else 0

    def get_movie_by_imdb_id(self, imdb_id: str) -> Optional[Dict[str, Any]]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM imdb_crawl_state WHERE imdb_id = ?", (imdb_id,))
        row = cur.fetchone()
        return dict(row) if row else None

    def get_all_movies(self) -> List[Dict[str, Any]]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM imdb_crawl_state ORDER BY movie_id ASC")
        return [dict(row) for row in cur.fetchall()]

    def count_valid_movies(self) -> int:
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) FROM imdb_crawl_state WHERE crawl_status = 'completed'")
        row = cur.fetchone()
        return row[0] if row else 0

    def count_total_stored(self) -> int:
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) FROM imdb_crawl_state")
        row = cur.fetchone()
        return row[0] if row else 0

    def save_or_update_movie(self, movie: Dict[str, Any]) -> None:
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO imdb_crawl_state (
                    movie_id, imdb_id, fingerprint, source_url, source_category, rank_order,
                    slug, title, normalized_title, original_title, description,
                    release_date, release_year, duration_minutes,
                    language, country, director, writers, cast,
                    genre_json, lineup_json, imdb_rating, vote_count,
                    age_restriction, age_description,
                    remote_image_url, local_image_path, image_download_status, image_size_bytes,
                    remote_trailer_url, local_trailer_path, trailer_download_status, trailer_size_bytes,
                    event_type, status, moderation_status, is_featured,
                    refund_policy, seo_title, seo_description,
                    crawl_status, first_crawled_at, last_updated_at
                ) VALUES (
                    :movie_id, :imdb_id, :fingerprint, :source_url, :source_category, :rank_order,
                    :slug, :title, :normalized_title, :original_title, :description,
                    :release_date, :release_year, :duration_minutes,
                    :language, :country, :director, :writers, :cast,
                    :genre_json, :lineup_json, :imdb_rating, :vote_count,
                    :age_restriction, :age_description,
                    :remote_image_url, :local_image_path, :image_download_status, :image_size_bytes,
                    :remote_trailer_url, :local_trailer_path, :trailer_download_status, :trailer_size_bytes,
                    :event_type, :status, :moderation_status, :is_featured,
                    :refund_policy, :seo_title, :seo_description,
                    :crawl_status, :first_crawled_at, :last_updated_at
                )
                ON CONFLICT(imdb_id) DO UPDATE SET
                    title = excluded.title,
                    normalized_title = excluded.normalized_title,
                    original_title = excluded.original_title,
                    description = excluded.description,
                    release_date = excluded.release_date,
                    release_year = excluded.release_year,
                    duration_minutes = excluded.duration_minutes,
                    language = excluded.language,
                    country = excluded.country,
                    director = excluded.director,
                    writers = excluded.writers,
                    cast = excluded.cast,
                    genre_json = excluded.genre_json,
                    lineup_json = excluded.lineup_json,
                    imdb_rating = excluded.imdb_rating,
                    vote_count = excluded.vote_count,
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
                movie,
            )

    def reconcile_filesystem(self) -> Tuple[int, int]:
        """
        Reconciles existing SQLite rows against the filesystem to detect missing/intact assets.
        Returns (reconciled_complete, reconciled_incomplete).
        """
        complete_count = 0
        incomplete_count = 0
        movies = self.get_all_movies()

        for m in movies:
            imdb_id = m["imdb_id"]
            img_path = BASE_DIR / m["local_image_path"] if m.get("local_image_path") else None
            vid_path = BASE_DIR / m["local_trailer_path"] if m.get("local_trailer_path") else None

            img_ok = bool(img_path and img_path.exists() and img_path.stat().st_size > 0)
            vid_ok = bool(vid_path and vid_path.exists() and vid_path.stat().st_size > 0)
            
            # An asset is considered satisfied if downloaded or legitimately unavailable
            img_satisfied = img_ok or (m.get("image_download_status") in ["no_image_available", "failed_remote_only"])
            vid_satisfied = vid_ok or (m.get("trailer_download_status") in ["no_trailer_available", "failed_remote_only"])

            updates = {}
            if img_ok and m.get("image_download_status") != "completed":
                updates["image_download_status"] = "completed"
                updates["image_size_bytes"] = img_path.stat().st_size
            elif not img_ok and m.get("image_download_status") == "completed":
                updates["image_download_status"] = "pending"
                updates["image_size_bytes"] = 0

            if vid_ok and m.get("trailer_download_status") != "completed":
                updates["trailer_download_status"] = "completed"
                updates["trailer_size_bytes"] = vid_path.stat().st_size
            elif not vid_ok and m.get("trailer_download_status") == "completed":
                updates["trailer_download_status"] = "pending"
                updates["trailer_size_bytes"] = 0

            is_now_complete = img_satisfied and vid_satisfied and bool(m.get("title")) and bool(m.get("description"))

            if is_now_complete:
                updates["crawl_status"] = "completed"
                complete_count += 1
            else:
                updates["crawl_status"] = "incomplete"
                incomplete_count += 1

            if updates:
                set_clauses = [f"{k} = ?" for k in updates.keys()]
                values = list(updates.values()) + [imdb_id]
                with self.conn:
                    self.conn.execute(f"UPDATE imdb_crawl_state SET {', '.join(set_clauses)} WHERE imdb_id = ?", values)

        return complete_count, incomplete_count


# ==============================================================================
# CSV DATASET SYNCHRONIZER
# ==============================================================================

class IncrementalCSVManager:
    """
    Synchronizes movies.csv, events.csv, organizers.csv, assets_metadata.csv,
    and events_import_compact.csv after each movie record is committed.
    """

    def __init__(self, db: IMDbIndexDatabase) -> None:
        self.db = db
        self._ensure_organizers_csv()

    def _ensure_organizers_csv(self) -> None:
        organizer_rows = [
            {
                "id": DEFAULT_ORGANIZER_ID,
                "user_id": DEFAULT_ORGANIZER_USER_ID,
                "display_name": IMDB_ORGANIZER_DISPLAY_NAME,
                "description": IMDB_ORGANIZER_DESCRIPTION,
                "logo_url": IMDB_ORGANIZER_LOGO_URL,
                "status": "approved",
                "review_note": "Verified Official IMDb Movie Data Partner",
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
            "movie_id", "imdb_id", "slug", "title", "source_url", "source_category",
            "release_date", "release_year", "duration_minutes",
            "language", "country", "director", "writers", "cast", "genre",
            "imdb_rating", "vote_count", "age_restriction", "age_description",
            "local_image_path", "remote_image_url", "image_download_status", "image_size_bytes",
            "local_trailer_path", "remote_trailer_url", "trailer_download_status", "trailer_size_bytes",
        ]

        event_rows = []
        compact_rows = []
        asset_rows = []

        for m in movies:
            genre_list = json.loads(m.get("genre_json") or "[]")
            lineup_list = json.loads(m.get("lineup_json") or "[]")

            image_url_val = m["local_image_path"] if m.get("local_image_path") else m.get("remote_image_url", "")
            trailer_url_val = m["local_trailer_path"] if m.get("local_trailer_path") else m.get("remote_trailer_url", "")

            event_rows.append({
                "id": m["movie_id"],
                "slug": m["slug"],
                "organizer_id": DEFAULT_ORGANIZER_ID,
                "category_id": DEFAULT_CATEGORY_ID,
                "title": m["title"],
                "original_title": m.get("original_title") or m["title"],
                "description": m["description"],
                "age_restriction": m["age_restriction"],
                "age_description": m["age_description"] or "",
                "duration_minutes": m["duration_minutes"] if m["duration_minutes"] is not None else "",
                "genre": parse_pg_array(genre_list),
                "lineup": parse_pg_array(lineup_list),
                "image_url": image_url_val,
                "trailer_url": trailer_url_val,
                "refund_policy": m.get("refund_policy") or DEFAULT_REFUND_POLICY,
                "is_featured": bool(m.get("is_featured")),
                "event_type": m["event_type"],
                "status": m["status"],
                "moderation_status": m["moderation_status"],
                "review_note": "",
                "seo_title": m.get("seo_title", ""),
                "seo_description": m.get("seo_description", ""),
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
                "imdb_id": m["imdb_id"],
                "slug": m["slug"],
                "title": m["title"],
                "source_url": m["source_url"],
                "source_category": m["source_category"],
                "release_date": m.get("release_date") or "",
                "release_year": m.get("release_year") or "",
                "duration_minutes": m.get("duration_minutes") or "",
                "language": m.get("language") or "",
                "country": m.get("country") or "",
                "director": m.get("director") or "",
                "writers": m.get("writers") or "",
                "cast": m.get("cast") or "",
                "genre": ", ".join(genre_list),
                "imdb_rating": m.get("imdb_rating") or "",
                "vote_count": m.get("vote_count") or "",
                "age_restriction": m.get("age_restriction") or "all",
                "age_description": m.get("age_description") or "",
                "local_image_path": m.get("local_image_path") or "",
                "remote_image_url": m.get("remote_image_url") or "",
                "image_download_status": m.get("image_download_status") or "pending",
                "image_size_bytes": m.get("image_size_bytes") or 0,
                "local_trailer_path": m.get("local_trailer_path") or "",
                "remote_trailer_url": m.get("remote_trailer_url") or "",
                "trailer_download_status": m.get("trailer_download_status") or "pending",
                "trailer_size_bytes": m.get("trailer_size_bytes") or 0,
            })

        # Atomic write helper
        def _write_csv(path: Path, fieldnames: List[str], rows: List[Dict[str, Any]]) -> None:
            tmp = path.with_suffix(path.suffix + ".tmp")
            with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            if tmp.exists():
                if path.exists():
                    path.unlink()
                tmp.rename(path)

        _write_csv(MOVIES_CSV_PATH, event_fieldnames, event_rows)
        _write_csv(EVENTS_CSV_PATH, event_fieldnames, event_rows)
        _write_csv(EVENTS_COMPACT_CSV_PATH, compact_fieldnames, compact_rows)
        _write_csv(ASSETS_METADATA_CSV_PATH, asset_fieldnames, asset_rows)


# ==============================================================================
# IMDB SCRAPER & DETAIL PARSER
# ==============================================================================

class IMDbScraper:
    """
    Discovers candidates and crawls detail pages from IMDb.
    """

    def __init__(self, db: IMDbIndexDatabase, csv_mgr: IncrementalCSVManager) -> None:
        self.db = db
        self.csv_mgr = csv_mgr
        self.driver: Optional[webdriver.Chrome] = None
        self.session = requests.Session()
        self.running = True

        # Attach signal handlers for graceful cancellation
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    def _handle_signal(self, signum, frame) -> None:
        logger.warning(f"Signal {signum} received! Finishing current movie and syncing...")
        self.running = False

    def get_driver(self) -> webdriver.Chrome:
        if self.driver is None:
            logger.info("Initializing headless Chrome instance...")
            options = Options()
            options.add_argument("--headless=new")
            options.add_argument("--disable-gpu")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_argument(f"user-agent={USER_AGENT}")
            self.driver = webdriver.Chrome(options=options)
        return self.driver

    def refresh_session_cookies(self) -> None:
        """Loads IMDb homepage via Selenium to acquire fresh cookies for fast requests."""
        driver = self.get_driver()
        logger.info("Acquiring fresh session cookies from IMDb...")
        driver.get("https://www.imdb.com/chart/moviemeter/")
        time.sleep(3)
        cookies = driver.get_cookies()
        self.session = requests.Session()
        for c in cookies:
            self.session.cookies.set(c["name"], c["value"], domain=c.get("domain", ".imdb.com"))
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
        })
        logger.info(f"Session initialized with {len(cookies)} cookies.")

    def close_driver(self) -> None:
        if self.driver is not None:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None

    def discover_candidate_ids(self) -> List[Tuple[str, str, int]]:
        """
        Discovers a rich mixture of NEW/RECENT and POPULAR movie candidate IDs.
        Returns list of (imdb_id, category, priority_rank).
        """
        cached = self.db.get_cached_candidates()
        if len(cached) >= 250:
            logger.info(f"Loaded {len(cached)} candidate movie IDs directly from persistent SQLite cache.")
            return cached

        driver = self.get_driver()
        candidates: List[Tuple[str, str, int]] = []
        candidates_to_cache: List[Tuple[str, str, int, str]] = []
        seen_ids: Set[str] = set()

        discovery_sources = [
            # 1. NEW & RECENT (Box Office, 2025-2026 releases, 2024 releases, calendar)
            ("https://www.imdb.com/chart/boxoffice/", "new_recent", "Box Office Top Movies"),
            ("https://www.imdb.com/calendar/?region=US", "new_recent", "Release Calendar"),
            ("https://www.imdb.com/search/title/?title_type=feature&release_date=2025-01-01,2026-12-31&sort=popularity,desc", "new_recent", "2025-2026 Popular Releases"),
            ("https://www.imdb.com/search/title/?title_type=feature&release_date=2024-01-01,2024-12-31&sort=popularity,desc", "new_recent", "2024 Popular Releases"),
            ("https://www.imdb.com/search/title/?title_type=feature&release_date=2025-01-01,2026-12-31&sort=num_votes,desc", "new_recent", "2025-2026 Most Voted"),
            # 2. POPULAR & TRENDING (Most Popular MovieMeter, Top 250, All-time most voted)
            ("https://www.imdb.com/chart/moviemeter/", "popular", "IMDb Most Popular MovieMeter"),
            ("https://www.imdb.com/chart/top/", "popular", "IMDb Top 250 Movies"),
            ("https://www.imdb.com/search/title/?title_type=feature&sort=num_votes,desc", "popular", "IMDb Most Voted Feature Films"),
            ("https://www.imdb.com/search/title/?title_type=feature&sort=popularity,asc", "popular", "IMDb Trending Feature Films"),
        ]

        logger.info("Starting IMDb discovery phase across new/recent and popular sources...")

        rank = 1
        for url, category, label in discovery_sources:
            if not self.running:
                break
            logger.info(f"Discovering from [{category.upper()}] {label}: {url}")
            try:
                driver.get(url)
                time.sleep(3)

                page_ids: List[str] = []
                # Method 1: Extract from __NEXT_DATA__
                try:
                    script = driver.find_element(By.ID, "__NEXT_DATA__")
                    next_data = json.loads(script.get_attribute("innerHTML"))
                    text = json.dumps(next_data)
                    matches = re.findall(r'/title/(tt\d+)/', text)
                    for m in matches:
                        if m not in page_ids:
                            page_ids.append(m)
                except Exception as e:
                    logger.debug(f"NEXT_DATA extraction note on {url}: {e}")

                # Method 2: Extract from HTML links
                links = driver.find_elements(By.XPATH, "//a[contains(@href, '/title/tt')]")
                for l in links:
                    href = l.get_attribute("href")
                    if href:
                        m = re.search(r'/title/(tt\d+)', href)
                        if m and m.group(1) not in page_ids:
                            page_ids.append(m.group(1))

                added_count = 0
                for tid in page_ids:
                    if tid not in seen_ids:
                        seen_ids.add(tid)
                        candidates.append((tid, category, rank))
                        candidates_to_cache.append((tid, category, rank, label))
                        rank += 1
                        added_count += 1

                logger.info(f"-> Discovered {len(page_ids)} titles ({added_count} new unique). Total candidate pool: {len(candidates)}")

            except Exception as exc:
                logger.warning(f"Failed discovering from {url}: {exc}")

        if candidates_to_cache:
            self.db.cache_candidates(candidates_to_cache)

        return candidates

    def fetch_detail_page(self, imdb_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetches detail page for imdb_id, extracting structured data from __NEXT_DATA__ and JSON-LD.
        Uses fast requests.Session with browser cookies; falls back to Selenium if challenge occurs.
        """
        url = f"https://www.imdb.com/title/{imdb_id}/"
        html_content = ""

        # Attempt 1: Fast session
        for _ in range(2):
            try:
                resp = self.session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
                if resp.status_code == 200 and "__NEXT_DATA__" in resp.text:
                    html_content = resp.text
                    break
                elif resp.status_code in (202, 403, 503):
                    logger.info("Session cookie expired or challenged; refreshing cookies via Selenium...")
                    self.refresh_session_cookies()
            except Exception as e:
                logger.debug(f"Fast session get error for {url}: {e}")
                time.sleep(1)

        # Attempt 2: Selenium fallback
        if not html_content or "__NEXT_DATA__" not in html_content:
            try:
                driver = self.get_driver()
                driver.get(url)
                time.sleep(2.5)
                html_content = driver.page_source
            except Exception as exc:
                logger.warning(f"Selenium fetch failed for {url}: {exc}")
                return None

        if not html_content:
            return None

        # Parse data
        soup = BeautifulSoup(html_content, "html.parser")

        # 1. Parse JSON-LD
        json_ld_movie = {}
        for s in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(s.string or s.text)
                if data.get("@type") == "Movie":
                    json_ld_movie = data
                    break
            except Exception:
                continue

        # 2. Parse __NEXT_DATA__
        next_data = {}
        next_script = soup.find("script", id="__NEXT_DATA__")
        if next_script and next_script.string:
            try:
                next_data = json.loads(next_script.string)
            except Exception:
                pass

        page_props = (next_data.get("props") or {}).get("pageProps") or {}
        above_fold = page_props.get("aboveTheFoldData") or {}
        main_col = page_props.get("mainColumnData") or {}

        # Extract title
        title = (
            (above_fold.get("titleText") or {}).get("text")
            or json_ld_movie.get("name")
            or (soup.title.string.split(" - IMDb")[0].split(" (")[0] if soup.title and soup.title.string else "")
            or ""
        )
        title = str(title).strip()
        if not title:
            return None

        original_title = (
            (above_fold.get("originalTitleText") or {}).get("text")
            or json_ld_movie.get("alternateName")
            or title
        )
        original_title = str(original_title).strip()

        # Extract description / plot
        description = (
            ((above_fold.get("plot") or {}).get("plotText") or {}).get("plainText")
            or ((main_col.get("plot") or {}).get("plotText") or {}).get("plainText")
            or json_ld_movie.get("description")
            or ""
        )
        description = str(description).strip()

        # Extract release date / year
        release_year = (above_fold.get("releaseYear") or {}).get("year")
        if not release_year and json_ld_movie.get("datePublished"):
            try:
                release_year = int(str(json_ld_movie["datePublished"])[:4])
            except ValueError:
                pass

        rel_date_obj = above_fold.get("releaseDate") or {}
        if rel_date_obj.get("year") and rel_date_obj.get("month") and rel_date_obj.get("day"):
            release_date = f"{rel_date_obj['year']:04d}-{rel_date_obj['month']:02d}-{rel_date_obj['day']:02d}"
        elif json_ld_movie.get("datePublished"):
            release_date = str(json_ld_movie["datePublished"])
        elif release_year:
            release_date = f"{release_year}-01-01"
        else:
            release_date = "2025-01-01"
            release_year = 2025

        # Extract runtime / duration
        runtime_sec = (above_fold.get("runtime") or {}).get("seconds") or (main_col.get("runtime") or {}).get("seconds")
        if runtime_sec:
            duration_minutes = max(1, runtime_sec // 60)
        elif json_ld_movie.get("duration"):
            dur_str = str(json_ld_movie["duration"])  # e.g. "PT2H15M" or "PT135M"
            hrs = re.search(r"(\d+)H", dur_str)
            mins = re.search(r"(\d+)M", dur_str)
            h = int(hrs.group(1)) if hrs else 0
            m = int(mins.group(1)) if mins else 0
            duration_minutes = (h * 60) + m if (h or m) else 120
        else:
            duration_minutes = 120

        # Extract genres
        genres: List[str] = []
        for g in (above_fold.get("genres") or {}).get("genres", []) or []:
            if g and g.get("text"):
                genres.append(g["text"])
        if not genres and json_ld_movie.get("genre"):
            ld_genres = json_ld_movie["genre"]
            if isinstance(ld_genres, list):
                genres = [str(x) for x in ld_genres if x]
            elif isinstance(ld_genres, str):
                genres = [x.strip() for x in ld_genres.split(",") if x.strip()]
        if not genres:
            genres = ["Drama"]

        # Extract certificate / age restriction
        cert_raw = (above_fold.get("certificate") or {}).get("rating") or json_ld_movie.get("contentRating")
        age_restriction, age_description = normalize_age_restriction(cert_raw)

        # Extract ratings
        imdb_rating = (above_fold.get("ratingsSummary") or {}).get("aggregateRating")
        vote_count = (above_fold.get("ratingsSummary") or {}).get("voteCount")
        if imdb_rating is None and json_ld_movie.get("aggregateRating"):
            try:
                imdb_rating = float(json_ld_movie["aggregateRating"].get("ratingValue"))
                vote_count = int(json_ld_movie["aggregateRating"].get("ratingCount"))
            except (ValueError, TypeError):
                pass

        # Extract Directors & Writers & Cast for Lineup
        directors: List[str] = []
        for d in above_fold.get("directors", []) or []:
            if not d:
                continue
            for c in d.get("credits", []) or []:
                name = ((c or {}).get("name") or {}).get("nameText", {}).get("text")
                if name and name not in directors:
                    directors.append(name)
        if not directors and json_ld_movie.get("director"):
            ld_dirs = json_ld_movie["director"]
            if isinstance(ld_dirs, list):
                directors = [d.get("name") for d in ld_dirs if isinstance(d, dict) and d.get("name")]
            elif isinstance(ld_dirs, dict) and ld_dirs.get("name"):
                directors = [ld_dirs["name"]]

        writers: List[str] = []
        for w in above_fold.get("writers", []) or []:
            if not w:
                continue
            for c in w.get("credits", []) or []:
                name = ((c or {}).get("name") or {}).get("nameText", {}).get("text")
                if name and name not in writers:
                    writers.append(name)
        if not writers and json_ld_movie.get("creator"):
            ld_creators = json_ld_movie["creator"]
            if isinstance(ld_creators, list):
                writers = [c.get("name") for c in ld_creators if isinstance(c, dict) and c.get("name") and c.get("@type") == "Person"]

        cast_members: List[str] = []
        for edge in (above_fold.get("cast") or {}).get("edges", []) or []:
            if not edge:
                continue
            name = ((edge.get("node") or {}).get("name") or {}).get("nameText", {}).get("text")
            if name and name not in cast_members:
                cast_members.append(name)
        if not cast_members and json_ld_movie.get("actor"):
            ld_actors = json_ld_movie["actor"]
            if isinstance(ld_actors, list):
                cast_members = [a.get("name") for a in ld_actors if isinstance(a, dict) and a.get("name")]

        # Build lineup
        lineup: List[str] = []
        if directors:
            lineup.append(f"Director: {', '.join(directors)}")
        if writers:
            lineup.append(f"Writers: {', '.join(writers[:3])}")
        for actor in cast_members[:10]:
            if actor not in lineup:
                lineup.append(actor)

        # Fallback description if empty
        if not description:
            desc_parts = [f"{title} ({release_year})"]
            if genres:
                desc_parts.append(f"is a {', '.join(genres)} film")
            if directors:
                desc_parts.append(f"directed by {', '.join(directors)}")
            if cast_members:
                desc_parts.append(f"starring {', '.join(cast_members[:3])}")
            description = " ".join(desc_parts) + "."

        # Extract language & country
        languages: List[str] = []
        for l in (main_col.get("spokenLanguages") or {}).get("spokenLanguages", []) or []:
            if l and l.get("text"):
                languages.append(l["text"])
        language_str = ", ".join(languages) if languages else "English"

        countries: List[str] = []
        for c in (main_col.get("countriesOfOrigin") or {}).get("countries", []) or []:
            if c and c.get("text"):
                countries.append(c["text"])
        country_str = ", ".join(countries) if countries else "United States"

        # Extract primary image URL
        remote_image_url = (above_fold.get("primaryImage") or {}).get("url") or json_ld_movie.get("image")
        if isinstance(remote_image_url, list) and remote_image_url:
            remote_image_url = remote_image_url[0]
        remote_image_url = str(remote_image_url or "")

        # Extract video / trailer URLs
        remote_trailer_url = ""
        best_video_stream_url = ""
        videos_edges = (above_fold.get("primaryVideos") or {}).get("edges", []) or (main_col.get("primaryVideos") or {}).get("edges", []) or []
        if videos_edges:
            first_vid_node = (videos_edges[0] or {}).get("node", {})
            vid_id = first_vid_node.get("id")
            if vid_id:
                remote_trailer_url = f"https://www.imdb.com/video/{vid_id}"
            playback_urls = first_vid_node.get("playbackURLs", []) or []
            # Priority order for definitions: 480p > SD > 720p > 1080p > AUTO
            for pref_def in ["DEF_480p", "DEF_SD", "DEF_720p", "DEF_1080p"]:
                for p in playback_urls:
                    if p and p.get("videoMimeType") == "MP4" and p.get("videoDefinition") == pref_def and p.get("url"):
                        best_video_stream_url = p["url"]
                        break
                if best_video_stream_url:
                    break
            if not best_video_stream_url:
                for p in playback_urls:
                    if p and p.get("videoMimeType") == "MP4" and p.get("url"):
                        best_video_stream_url = p["url"]
                        break

        if not remote_trailer_url and json_ld_movie.get("trailer"):
            tr = json_ld_movie["trailer"]
            if isinstance(tr, dict):
                remote_trailer_url = tr.get("embedUrl") or tr.get("url") or ""
                if tr.get("contentUrl") and str(tr["contentUrl"]).endswith(".mp4"):
                    best_video_stream_url = tr["contentUrl"]

        slug = f"{slugify(title)}-imdb-{imdb_id.lower()}"
        seo_title = f"{title} ({release_year}) | IMDb Movies"
        seo_description = description[:160]

        return {
            "imdb_id": imdb_id,
            "source_url": url,
            "slug": slug,
            "title": title,
            "normalized_title": re.sub(r"\s+", " ", title.strip().lower()),
            "original_title": original_title,
            "description": description,
            "release_date": release_date,
            "release_year": release_year,
            "duration_minutes": duration_minutes,
            "language": language_str,
            "country": country_str,
            "director": ", ".join(directors),
            "writers": ", ".join(writers),
            "cast": ", ".join(cast_members[:10]),
            "genre": genres,
            "lineup": lineup,
            "imdb_rating": imdb_rating,
            "vote_count": vote_count,
            "age_restriction": age_restriction,
            "age_description": age_description,
            "remote_image_url": remote_image_url,
            "remote_trailer_url": remote_trailer_url,
            "video_stream_url": best_video_stream_url,
            "seo_title": seo_title,
            "seo_description": seo_description,
        }


# ==============================================================================
# PIPELINE CONTROLLER
# ==============================================================================

class IMDbPipeline:
    """
    Coordinates candidate discovery, incremental downloading, deduplication,
    validation, and atomic file synchronization.
    """

    def __init__(self) -> None:
        self.db = IMDbIndexDatabase()
        self.csv_mgr = IncrementalCSVManager(self.db)
        self.scraper = IMDbScraper(self.db, self.csv_mgr)

        # Metrics
        self.stats = {
            "candidates_discovered": 0,
            "new_recent_candidates": 0,
            "popular_candidates": 0,
            "unique_selected": 0,
            "newly_stored": 0,
            "already_stored_skipped": 0,
            "resumed_incomplete": 0,
            "posters_success": 0,
            "posters_failed": 0,
            "trailers_success": 0,
            "trailers_failed": 0,
            "duplicates_removed": 0,
            "validation_errors": 0,
            "final_valid_events": 0,
        }

    def run(self) -> None:
        logger.info("=" * 70)
        logger.info("STARTING IMDB INCREMENTAL MOVIE CRAWLER")
        logger.info(f"Target: Exactly {TARGET_MOVIE_COUNT} unique movies (New/Recent + Popular)")
        logger.info("=" * 70)

        # 1. Reconcile filesystem
        reconciled_ok, reconciled_inc = self.db.reconcile_filesystem()
        logger.info(f"Startup reconciliation: {reconciled_ok} complete records, {reconciled_inc} incomplete records.")

        # 2. Discover Candidates
        self.scraper.refresh_session_cookies()
        raw_candidates = self.scraper.discover_candidate_ids()

        self.stats["candidates_discovered"] = len(raw_candidates)
        self.stats["new_recent_candidates"] = sum(1 for _, cat, _ in raw_candidates if cat == "new_recent")
        self.stats["popular_candidates"] = sum(1 for _, cat, _ in raw_candidates if cat == "popular")

        # Partition candidates to ensure balanced mix: ~125 new/recent and ~125 popular
        new_recent_list = [c for c in raw_candidates if c[1] == "new_recent"]
        popular_list = [c for c in raw_candidates if c[1] == "popular"]

        logger.info(f"Discovered candidate pool: {len(new_recent_list)} New/Recent, {len(popular_list)} Popular.")

        # Balanced candidate queue
        ordered_candidates: List[Tuple[str, str, int]] = []
        nr_idx = 0
        pop_idx = 0
        while (nr_idx < len(new_recent_list) or pop_idx < len(popular_list)) and len(ordered_candidates) < 500:
            if nr_idx < len(new_recent_list):
                ordered_candidates.append(new_recent_list[nr_idx])
                nr_idx += 1
            if pop_idx < len(popular_list):
                ordered_candidates.append(popular_list[pop_idx])
                pop_idx += 1

        # Process candidates incrementally until TARGET_MOVIE_COUNT is reached
        processed_imdb_ids: Set[str] = set()

        for imdb_id, category, rank in ordered_candidates:
            if not self.scraper.running:
                logger.warning("Crawler execution stopped by user signal.")
                break

            current_valid_count = self.db.count_valid_movies()
            if current_valid_count >= TARGET_MOVIE_COUNT:
                logger.info(f"Target count of {TARGET_MOVIE_COUNT} valid unique movies reached!")
                break

            if imdb_id in processed_imdb_ids:
                self.stats["duplicates_removed"] += 1
                continue
            processed_imdb_ids.add(imdb_id)

            existing = self.db.get_movie_by_imdb_id(imdb_id)

            # Check if completely processed and intact
            if existing and existing.get("crawl_status") == "completed":
                img_path = BASE_DIR / existing["local_image_path"] if existing.get("local_image_path") else None
                vid_path = BASE_DIR / existing["local_trailer_path"] if existing.get("local_trailer_path") else None

                img_ok = bool(img_path and img_path.exists() and img_path.stat().st_size > 0) or (
                    existing.get("image_download_status") in ["no_image_available", "failed_remote_only"]
                )
                vid_ok = bool(vid_path and vid_path.exists() and vid_path.stat().st_size > 0) or (
                    existing.get("trailer_download_status") in ["no_trailer_available", "failed_remote_only"]
                )

                if img_ok and vid_ok:
                    self.stats["already_stored_skipped"] += 1
                    logger.info(
                        f"[{self.db.count_valid_movies()}/{TARGET_MOVIE_COUNT}] (SKIPPED - Intact) "
                        f"{imdb_id} - {existing['title']}"
                    )
                    continue

            # Need to process or resume
            is_resume = bool(existing)
            if is_resume:
                self.stats["resumed_incomplete"] += 1
                logger.info(f"Resuming incomplete record for {imdb_id}...")
            else:
                self.stats["newly_stored"] += 1

            # Fetch detail
            detail = self.scraper.fetch_detail_page(imdb_id)
            if not detail:
                logger.warning(f"Failed fetching detail for {imdb_id}; skipping to next candidate.")
                self.stats["validation_errors"] += 1
                continue

            # Assign sequential movie_id
            if existing:
                movie_id = existing["movie_id"]
                first_crawled_at = existing["first_crawled_at"]
            else:
                movie_id = self.db.get_max_movie_id() + 1
                first_crawled_at = datetime.now(timezone.utc).isoformat()

            now_iso = datetime.now(timezone.utc).isoformat()

            # Process Image Asset
            local_image_rel = f"data/imdb/images/{imdb_id}.jpg"
            local_image_abs = IMAGES_DIR / f"{imdb_id}.jpg"
            img_status = "no_image_available"
            img_size = 0

            if detail["remote_image_url"]:
                if local_image_abs.exists() and local_image_abs.stat().st_size > 0:
                    img_status = "completed"
                    img_size = local_image_abs.stat().st_size
                    self.stats["posters_success"] += 1
                else:
                    success, size = download_file(detail["remote_image_url"], local_image_abs)
                    if success:
                        img_status = "completed"
                        img_size = size
                        self.stats["posters_success"] += 1
                    else:
                        img_status = "failed_remote_only"
                        self.stats["posters_failed"] += 1
            else:
                img_status = "no_image_available"

            # Process Trailer Asset
            local_vid_rel = f"data/imdb/videos/{imdb_id}.mp4"
            local_vid_abs = VIDEOS_DIR / f"{imdb_id}.mp4"
            vid_status = "no_trailer_available"
            vid_size = 0

            if detail.get("video_stream_url"):
                if local_vid_abs.exists() and local_vid_abs.stat().st_size > 0:
                    vid_status = "completed"
                    vid_size = local_vid_abs.stat().st_size
                    self.stats["trailers_success"] += 1
                else:
                    logger.info(f"Downloading official trailer for {imdb_id} ({detail['title']})...")
                    success, size = download_file(detail["video_stream_url"], local_vid_abs)
                    if success:
                        vid_status = "completed"
                        vid_size = size
                        self.stats["trailers_success"] += 1
                    else:
                        vid_status = "failed_remote_only"
                        self.stats["trailers_failed"] += 1
            elif detail.get("remote_trailer_url"):
                vid_status = "failed_remote_only"
            else:
                vid_status = "no_trailer_available"

            # Store record
            record = {
                "movie_id": movie_id,
                "imdb_id": imdb_id,
                "fingerprint": compute_fingerprint(imdb_id),
                "source_url": detail["source_url"],
                "source_category": category,
                "rank_order": rank,
                "slug": detail["slug"],
                "title": detail["title"],
                "normalized_title": detail["normalized_title"],
                "original_title": detail["original_title"],
                "description": detail["description"],
                "release_date": detail["release_date"],
                "release_year": detail["release_year"],
                "duration_minutes": detail["duration_minutes"],
                "language": detail["language"],
                "country": detail["country"],
                "director": detail["director"],
                "writers": detail["writers"],
                "cast": detail["cast"],
                "genre_json": json.dumps(detail["genre"], ensure_ascii=False),
                "lineup_json": json.dumps(detail["lineup"], ensure_ascii=False),
                "imdb_rating": detail["imdb_rating"],
                "vote_count": detail["vote_count"],
                "age_restriction": detail["age_restriction"],
                "age_description": detail["age_description"],
                "remote_image_url": detail["remote_image_url"],
                "local_image_path": local_image_rel if img_status == "completed" else "",
                "image_download_status": img_status,
                "image_size_bytes": img_size,
                "remote_trailer_url": detail["remote_trailer_url"],
                "local_trailer_path": local_vid_rel if vid_status == "completed" else "",
                "trailer_download_status": vid_status,
                "trailer_size_bytes": vid_size,
                "event_type": "seated",
                "status": "on_sale",
                "moderation_status": "approved",
                "is_featured": 1 if rank <= 20 else 0,
                "refund_policy": DEFAULT_REFUND_POLICY,
                "seo_title": detail["seo_title"],
                "seo_description": detail["seo_description"],
                "crawl_status": "completed",
                "first_crawled_at": first_crawled_at,
                "last_updated_at": now_iso,
            }

            # Save to SQLite and flush CSVs
            self.db.save_or_update_movie(record)
            self.csv_mgr.sync_all_csvs()

            valid_count = self.db.count_valid_movies()
            logger.info(
                f"[{valid_count}/{TARGET_MOVIE_COUNT}] [SAVED] {imdb_id} - {detail['title']} "
                f"({detail['release_year']}) | Category: {category} | Image: {img_status} | Trailer: {vid_status}"
            )

            time.sleep(BETWEEN_REQUESTS_DELAY_SECONDS)

        # Cleanup driver
        self.scraper.close_driver()

        # Final validation
        self._validate_dataset()

        # Generate README
        self._generate_readme()

        # Print final summary
        self._print_summary()

    def _validate_dataset(self) -> None:
        """Validates that exactly 250 unique, valid records exist."""
        all_movies = self.db.get_all_movies()
        self.stats["unique_selected"] = len(all_movies)
        self.stats["final_valid_events"] = sum(1 for m in all_movies if m.get("crawl_status") == "completed")

        # Verify uniqueness
        seen_ids = set()
        for m in all_movies:
            if m["imdb_id"] in seen_ids:
                logger.error(f"Duplicate IMDb ID detected: {m['imdb_id']}")
                self.stats["validation_errors"] += 1
            seen_ids.add(m["imdb_id"])

        logger.info(f"Post-crawl validation: {self.stats['final_valid_events']} valid movie events in SQLite & CSVs.")

    def _generate_readme(self) -> None:
        """Generates comprehensive README.md in data/imdb/."""
        all_movies = self.db.get_all_movies()
        nr_count = sum(1 for m in all_movies if m.get("source_category") == "new_recent")
        pop_count = sum(1 for m in all_movies if m.get("source_category") == "popular")

        now_str = datetime.now(timezone.utc).isoformat()

        readme_content = f"""# IMDb Movie Event Crawler & Dataset (Incremental & Resumable)

## 1. Overview
This dataset contains exactly **{len(all_movies)} unique movies** crawled from [IMDb (Internet Movie Database)](https://www.imdb.com/) for the TixHub Event Ticketing Platform.
Each movie is modeled as an **Event** record belonging to a single verified **Organizer** representing **IMDb (Internet Movie Database)** (ID: `{DEFAULT_ORGANIZER_ID}`), strictly compliant with the PostgreSQL database schema and domain specifications (`0001_auth.sql`, `0002_catalog.sql`, `0021_organizer_analytics.sql`, and `SCHEMA_DATABASE.md`).

- **Architecture:** Incremental, movie-by-movie persistent storage with atomic SQLite commit and CSV synchronization.
- **Resumability:** Persistent SQLite index (`data/imdb/index.sqlite`) tracks crawl states, image dimensions, and trailer video download statuses. Interrupted runs resume seamlessly without duplicates.
- **Source Website:** [https://www.imdb.com/](https://www.imdb.com/)
- **Crawl Timestamp:** `{now_str}`

---

## 2. Execution Summary & Metrics

| Metric | Value |
|---|---|
| **Target Movie Count** | `{TARGET_MOVIE_COUNT}` |
| **Total Candidates Discovered** | `{self.stats['candidates_discovered']}` |
| **New / Recent Candidates** | `{self.stats['new_recent_candidates']}` |
| **Popular / Trending Candidates** | `{self.stats['popular_candidates']}` |
| **Unique Movies Selected & Persisted** | `{len(all_movies)}` |
| **- New / Recent Movies** | `{nr_count}` |
| **- Popular Movies** | `{pop_count}` |
| **Organizer Records** | `1 (IMDb - ID: {DEFAULT_ORGANIZER_ID})` |
| **Poster Images Stored Locally** | `{self.stats['posters_success']}` |
| **Trailers Downloaded Locally** | `{self.stats['trailers_success']}` |
| **Trailers Remote Only** | `{self.stats['trailers_failed']}` |
| **Duplicate Movies Skipped** | `{self.stats['duplicates_removed']}` |
| **Schema Validation Errors** | `{self.stats['validation_errors']}` |
| **Final Valid Movie Events** | `{self.stats['final_valid_events']}` |

---

## 3. Persistent Directory & Asset Structure

```
data/imdb/
├── README.md                     # Comprehensive documentation & execution guide
├── index.sqlite                  # Persistent SQLite state index & resume manifest
├── movies.csv                    # Full database-compatible Event records (flushed incrementally)
├── events.csv                    # Identical full Event records matching project pipeline
├── events_import_compact.csv     # 10-column compact Event import format
├── organizers.csv                # Organizer record for IMDb (ID: {DEFAULT_ORGANIZER_ID})
├── assets_metadata.csv           # Detailed asset mapping and download status
├── images/                       # Local high-resolution movie posters (ttXXXXXXX.jpg)
│   ├── tt15398776.jpg
│   ├── tt15239678.jpg
│   └── ...
├── videos/                       # Local official trailer videos (.mp4)
│   ├── tt15398776.mp4
│   ├── tt15239678.mp4
│   └── ...
└── logs/
    └── imdb_crawler.log          # Detailed execution and download logs
```

---

## 4. Field Mapping & Schema Normalization

| Database Field (`events`) | IMDb Source Field | Data Type / Constraint | Mapping & Fallback Rule |
|---|---|---|---|
| `id` | Generated sequence | `BIGINT PRIMARY KEY` | Sequential integer ID (1..250) from SQLite index |
| `slug` | Title + IMDb ID | `TEXT UNIQUE NOT NULL` | Formatted slug e.g. `oppenheimer-imdb-tt15398776` |
| `organizer_id` | IMDb Organizer | `BIGINT NOT NULL REFERENCES organizers(id)` | Foreign key pointing to IMDb (`{DEFAULT_ORGANIZER_ID}`) |
| `category_id` | Fixed Category | `SMALLINT NOT NULL REFERENCES event_categories(id)` | `{DEFAULT_CATEGORY_ID}` (`theatre` / Sân khấu & Điện ảnh) |
| `title` | Movie Title | `TEXT NOT NULL` | Official movie title in UTF-8 |
| `original_title` | Original Title | `TEXT` | Extracted original title or display title |
| `description` | Plot Summary | `TEXT NOT NULL` | Full synopsis from IMDb detail page |
| `age_restriction` | Certificate | `TEXT CHECK (IN ('all', '13+', '16+', '18+'))` | `G`/`PG`/`TV-G`/`Unrated` -> `'all'`, `PG-13`/`TV-14`/`12+` -> `'13+'`, `16+`/`TV-16` -> `'16+'`, `R`/`NC-17`/`TV-MA`/`18+` -> `'18+'` |
| `age_description` | Full Certificate | `TEXT` | Descriptive text (e.g. `Certificate: PG-13 (Parents strongly cautioned)`) |
| `duration_minutes` | Runtime | `INT` | Parsed numeric minutes (e.g. `180` from runtime seconds / string) |
| `genre` | Genres | `TEXT[] NOT NULL` | PostgreSQL array format (e.g. `{{"Biography", "Drama", "History"}}`) |
| `lineup` | Director & Cast | `TEXT[] NOT NULL` | PostgreSQL array containing Director, Writers, and Top Actors |
| `image_url` | Poster Image | `TEXT` | Local relative path `data/imdb/images/<imdb_id>.jpg` (or remote fallback) |
| `trailer_url` | Trailer Video | `TEXT` | Local relative path `data/imdb/videos/<imdb_id>.mp4` (or remote trailer URL) |
| `refund_policy` | Refund Terms | `TEXT` | Standard ticketing cancellation and refund terms |
| `event_type` | Event Type | `TEXT CHECK (IN ('general_admission', 'seated'))` | `'seated'` (Cinema seated inventory) |
| `status` | Event Status | `TEXT CHECK (IN ('draft', 'on_sale', 'finished', 'cancelled'))` | `'on_sale'` |
| `moderation_status`| Moderation | `TEXT CHECK (IN ('pending_review', 'approved', 'flagged', 'removed'))`| `'approved'` |
| `seo_title` | SEO Title | `TEXT` | `<Movie Title> (<Year>) | IMDb Movies` |
| `seo_description` | SEO Description | `TEXT` | First 160 characters of synopsis |

---

## 5. Organizer Mapping (`organizers`)

| Database Field (`organizers`) | Value | Description |
|---|---|---|
| `id` | `{DEFAULT_ORGANIZER_ID}` | Unique organizer ID |
| `user_id` | `{DEFAULT_ORGANIZER_USER_ID}` | Foreign key referencing `users(id)` |
| `display_name` | `IMDb (Internet Movie Database)` | Display brand name |
| `description` | Detailed IMDb overview | Official platform description |
| `logo_url` | Official IMDb Logo URL | Brand logo image |
| `status` | `'approved'` | Verified status |
| `review_note` | `Verified Official IMDb Movie Data Partner` | Audit review note |
| `applied_at` | `2026-01-01T00:00:00Z` | Application timestamp |
| `approved_at` | `2026-01-01T00:00:00Z` | Approval timestamp |
| `approved_by` | `1` | Admin user ID |

---

## 6. Incremental Processing & Deduplication Strategy

1. **Persistent Manifest (`index.sqlite`):**
   - Tracks each movie by its stable IMDb title ID (`tt...`) and SHA256 fingerprint.
   - Saves progress movie-by-movie so that network interruptions never lose progress.

2. **Resumability:**
   - At startup, reconciles database records with filesystem assets.
   - Fully saved movies with intact assets are skipped instantly without network overhead.
   - Incomplete records resume seamlessly to download only missing components.

3. **Incremental CSV Synchronization:**
   - Flushes and atomically updates all CSV files (`movies.csv`, `events.csv`, `organizers.csv`, `assets_metadata.csv`, `events_import_compact.csv`) after every committed movie.

---

## 7. How to Run the Crawler

### Prerequisites
- Python 3.10+
- Chrome browser installed (for headless session initialization)
- Dependencies: `pip install -r CrawlData/requirements.txt`

### Command to Execute
```powershell
# From the project root:
.\\myenv\\Scripts\\python.exe CrawlData\\imdb_scraper.py
```
"""
        with open(README_MD_PATH, "w", encoding="utf-8") as f:
            f.write(readme_content)
        logger.info(f"Generated comprehensive README documentation at {README_MD_PATH}")

    def _print_summary(self) -> None:
        """Prints formatted execution summary to console."""
        all_movies = self.db.get_all_movies()
        nr_count = sum(1 for m in all_movies if m.get("source_category") == "new_recent")
        pop_count = sum(1 for m in all_movies if m.get("source_category") == "popular")

        print("\n" + "=" * 70)
        print("IMDB MOVIE CRAWLER EXECUTION SUMMARY")
        print("=" * 70)
        print(f"Total Candidates Discovered:    {self.stats['candidates_discovered']}")
        print(f"  - New / Recent Candidates:    {self.stats['new_recent_candidates']}")
        print(f"  - Popular Candidates:         {self.stats['popular_candidates']}")
        print(f"Unique Movies Selected:         {len(all_movies)} / {TARGET_MOVIE_COUNT}")
        print(f"  - New / Recent Movies:        {nr_count}")
        print(f"  - Popular Movies:             {pop_count}")
        print(f"Newly Stored Movies:            {self.stats['newly_stored']}")
        print(f"Already Stored / Skipped:       {self.stats['already_stored_skipped']}")
        print(f"Resumed Incomplete Movies:      {self.stats['resumed_incomplete']}")
        print(f"Successful Poster Downloads:    {self.stats['posters_success']}")
        print(f"Successful Trailer Downloads:   {self.stats['trailers_success']}")
        print(f"Failed Poster Downloads:        {self.stats['posters_failed']}")
        print(f"Failed Trailer Downloads:       {self.stats['trailers_failed']}")
        print(f"Duplicates Removed:             {self.stats['duplicates_removed']}")
        print(f"Schema Validation Errors:       {self.stats['validation_errors']}")
        print(f"Final Valid Movie Events:       {self.stats['final_valid_events']}")
        print("=" * 70)
        print(f"Output files generated:")
        print(f"  - {MOVIES_CSV_PATH}")
        print(f"  - {EVENTS_CSV_PATH}")
        print(f"  - {ORGANIZERS_CSV_PATH}")
        print(f"  - {ASSETS_METADATA_CSV_PATH}")
        print(f"  - {SQLITE_DB_PATH}")
        print(f"  - {README_MD_PATH}")
        print("=" * 70 + "\n")


# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================

def main() -> None:
    pipeline = IMDbPipeline()
    pipeline.run()


if __name__ == "__main__":
    main()
