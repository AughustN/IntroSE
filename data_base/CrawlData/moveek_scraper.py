"""
Incremental and Resumable Moveek Vietnam Movie Event Scraper & Asset Pipeline.

Crawls all currently showing and upcoming movies from https://moveek.com/,
downloads high-resolution poster images and trailer videos to dedicated local folders
(data/moveek/images, data/moveek/videos), persists progress movie-by-movie into a local
SQLite state database (data/moveek/index.sqlite), and incrementally writes directly
importable CSV files and asset metadata conforming strictly to the TixHub database schema.
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
DATA_DIR = BASE_DIR / "data" / "moveek"
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
LOG_FILE_PATH = LOGS_DIR / "moveek_crawler.log"

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

MOVEEK_BASE_URL = "https://moveek.com"
MOVEEK_NOW_SHOWING_URL = "https://moveek.com/phim-dang-chieu/"
MOVEEK_COMING_SOON_URL = "https://moveek.com/phim-sap-chieu/"
MOVEEK_HOMEPAGE_URL = "https://moveek.com/"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 (TixHub-Moveek-Crawler/1.0)"
)

# Database schema constants for MOVEEK Organizer
DEFAULT_ORGANIZER_ID = 600
DEFAULT_ORGANIZER_USER_ID = 600
MOVEEK_ORGANIZER_DISPLAY_NAME = "Moveek Cinema Platform"
MOVEEK_ORGANIZER_DESCRIPTION = (
    "Moveek là nền tảng tổng hợp thông tin điện ảnh, lịch chiếu phim, giá vé và review phim "
    "toàn diện hàng đầu tại Việt Nam, kết nối khán giả với tất cả các cụm rạp trên toàn quốc."
)
MOVEEK_ORGANIZER_LOGO_URL = "https://cdn.moveek.com/img/logo.png"

# Category ID 3 represents 'theatre' ('Sân khấu', 'Theatre & Art') in the catalog
DEFAULT_CATEGORY_ID = 3

DEFAULT_REFUND_POLICY = (
    "Theo quy định hoàn vé của hệ thống rạp đối tác qua Moveek: Vé đã thanh toán thành công "
    "không thể hoàn tiền hoặc đổi sang suất chiếu khác ngoại trừ trường hợp có thông báo hủy suất chiếu từ rạp."
)

ALLOWED_AGE_RESTRICTIONS = {"all", "13+", "16+", "18+"}
ALLOWED_EVENT_TYPES = {"general_admission", "seated"}
ALLOWED_EVENT_STATUSES = {"draft", "on_sale", "finished", "cancelled"}
ALLOWED_MODERATION_STATUSES = {"pending_review", "approved", "flagged", "removed"}

PAGE_LOAD_WAIT_SECONDS = 3
BETWEEN_REQUESTS_DELAY_SECONDS = 1.0
REQUEST_TIMEOUT_SECONDS = 30

GENRE_TRANSLATION_MAP = {
    "action": "Hành Động",
    "adventure": "Phiêu Lưu",
    "animation": "Hoạt Hình",
    "anime": "Anime",
    "comedy": "Hài",
    "crime": "Tội Phạm",
    "documentary": "Tài Liệu",
    "drama": "Tâm Lý",
    "family": "Gia Đình",
    "fantasy": "Giả Tưởng",
    "history": "Lịch Sử",
    "horror": "Kinh Dị",
    "music": "Âm Nhạc",
    "mystery": "Bí Ẩn",
    "romance": "Tình Cảm",
    "science fiction": "Khoa Học Viễn Tưởng",
    "sci-fi": "Khoa Học Viễn Tưởng",
    "thriller": "Giật Gân",
    "war": "Chiến Tranh",
    "western": "Miền Tây",
}


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


def normalize_genres(raw_genres: str | list[str]) -> list[str]:
    """Translates and formats genre string/list into normalized Vietnamese terms."""
    if isinstance(raw_genres, str):
        items = [g.strip() for g in re.split(r"[,/]+", raw_genres) if g.strip()]
    else:
        items = [str(g).strip() for g in raw_genres if str(g).strip()]

    normalized: list[str] = []
    for it in items:
        lower = it.lower()
        translated = GENRE_TRANSLATION_MAP.get(lower, it)
        if translated not in normalized:
            normalized.append(translated)

    return normalized if normalized else ["Điện Ảnh", "Chiếu Rạp"]


def normalize_age_restriction(rated_str: str) -> tuple[str, str]:
    """
    Normalizes age rating string into schema enum ('all', '13+', '16+', '18+') and description.
    """
    raw = (rated_str or "").strip()
    upper = raw.upper()

    if "18" in upper or "T18" in upper or "C18" in upper or "R" in upper:
        code = "18+"
        desc = "T18 - Phim được phổ biến đến người xem từ đủ 18 tuổi trở lên (18+)"
    elif "16" in upper or "T16" in upper or "C16" in upper:
        code = "16+"
        desc = "T16 - Phim được phổ biến đến người xem từ đủ 16 tuổi trở lên (16+)"
    elif "13" in upper or "T13" in upper or "C13" in upper or "PG-13" in upper:
        code = "13+"
        desc = "T13 - Phim được phổ biến đến người xem từ đủ 13 tuổi trở lên (13+)"
    else:
        code = "all"
        desc = "P - Phim được phép phổ biến rộng rãi đến mọi lứa tuổi"

    return code, raw if raw else desc


def parse_duration_iso(duration_str: str) -> int | None:
    """
    Parses ISO 8601 duration string like 'PT109M' or 'PT1H49M' into integer minutes.
    """
    if not duration_str:
        return None
    
    # Check PT#M pattern
    m_match = re.search(r"PT(\d+)M", duration_str)
    if m_match:
        try:
            return int(m_match.group(1))
        except ValueError:
            pass

    # Check PT#H#M pattern
    hm_match = re.search(r"PT(?:(\d+)H)?(?:(\d+)M)?", duration_str)
    if hm_match and (hm_match.group(1) or hm_match.group(2)):
        hours = int(hm_match.group(1) or 0)
        minutes = int(hm_match.group(2) or 0)
        total = hours * 60 + minutes
        return total if total > 0 else None

    # Fallback to plain digits
    digits = re.search(r"(\d+)", duration_str)
    if digits:
        try:
            val = int(digits.group(1))
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

    if "nhật" in audio_part or "japanese" in audio_part or "nhật bản" in combined or "anime" in combined:
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
    if "anh" in audio_part or "mỹ" in audio_part or "english" in audio_part or "hollywood" in combined or "marvel" in combined:
        return "Mỹ"
    if "pháp" in audio_part or "french" in audio_part or "cherbourg" in combined:
        return "Pháp"
    return "Quốc tế"


# ==============================================================================
# BROWSER DRIVER MANAGER (Self-Healing)
# ==============================================================================

class BrowserManager:
    """Manages Chrome WebDriver lifecycle with automatic reconnection and HTTP session."""

    def __init__(self) -> None:
        self.driver: webdriver.Chrome | None = None
        self.http_session = requests.Session()
        self.http_session.headers.update({"User-Agent": USER_AGENT})

    def get_driver(self) -> webdriver.Chrome:
        """Gets active driver or creates a fresh one."""
        if self.driver is not None:
            try:
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
        if self.driver is not None:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None

    def fetch_page_source(self, url: str, max_retries: int = 3) -> str:
        for attempt in range(1, max_retries + 1):
            try:
                driver = self.get_driver()
                driver.get(url)
                time.sleep(PAGE_LOAD_WAIT_SECONDS)

                try:
                    for cookie in driver.get_cookies():
                        self.http_session.cookies.set(
                            cookie["name"], cookie["value"], domain=cookie.get("domain", "")
                        )
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

class MoveekIndexDatabase:
    """
    Manages persistent SQLite storage for Moveek movies, incremental progress,
    resume capability, and reliable deduplication.
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
                CREATE TABLE IF NOT EXISTS moveek_crawl_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    movie_id INTEGER UNIQUE NOT NULL,
                    moveek_id TEXT,
                    fingerprint TEXT UNIQUE NOT NULL,
                    source_url TEXT UNIQUE NOT NULL,
                    slug TEXT UNIQUE NOT NULL,
                    source_slug TEXT NOT NULL,
                    section TEXT NOT NULL DEFAULT 'now_showing',
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
                    remote_backdrop_url TEXT,
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
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_fingerprint ON moveek_crawl_state(fingerprint)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_slug ON moveek_crawl_state(slug)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_source_url ON moveek_crawl_state(source_url)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_section ON moveek_crawl_state(section)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_status ON moveek_crawl_state(crawl_status)")

    def get_max_movie_id(self) -> int:
        cursor = self.conn.cursor()
        cursor.execute("SELECT COALESCE(MAX(movie_id), 0) FROM moveek_crawl_state")
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def find_by_url(self, source_url: str) -> dict[str, Any] | None:
        norm_url = source_url.split("?")[0].split("#")[0].rstrip("/")
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM moveek_crawl_state WHERE source_url = ?", (norm_url,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def find_by_fingerprint(self, fingerprint: str) -> dict[str, Any] | None:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM moveek_crawl_state WHERE fingerprint = ?", (fingerprint,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def upsert_movie_state(self, movie: dict[str, Any]) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO moveek_crawl_state (
                    movie_id, moveek_id, fingerprint, source_url, slug, source_slug,
                    section, title, normalized_title, original_title, description,
                    director, cast, genre_json, lineup_json,
                    release_date, duration_minutes, duration_raw,
                    language, country, age_restriction, age_description,
                    remote_image_url, local_image_path, image_download_status, image_size_bytes,
                    remote_backdrop_url, remote_trailer_url, local_trailer_path,
                    trailer_download_status, trailer_size_bytes,
                    event_type, status, moderation_status, is_featured,
                    refund_policy, seo_title, seo_description,
                    crawl_status, first_crawled_at, last_updated_at
                ) VALUES (
                    :movie_id, :moveek_id, :fingerprint, :source_url, :slug, :source_slug,
                    :section, :title, :normalized_title, :original_title, :description,
                    :director, :cast, :genre_json, :lineup_json,
                    :release_date, :duration_minutes, :duration_raw,
                    :language, :country, :age_restriction, :age_description,
                    :remote_image_url, :local_image_path, :image_download_status, :image_size_bytes,
                    :remote_backdrop_url, :remote_trailer_url, :local_trailer_path,
                    :trailer_download_status, :trailer_size_bytes,
                    :event_type, :status, :moderation_status, :is_featured,
                    :refund_policy, :seo_title, :seo_description,
                    :crawl_status, :first_crawled_at, :last_updated_at
                )
                ON CONFLICT(source_url) DO UPDATE SET
                    section = excluded.section,
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
                    remote_backdrop_url = excluded.remote_backdrop_url,
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
                    "moveek_id": movie.get("moveek_id", ""),
                    "fingerprint": movie["fingerprint"],
                    "source_url": movie["source_url"],
                    "slug": movie["slug"],
                    "source_slug": movie["source_slug"],
                    "section": movie.get("section", "now_showing"),
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
                    "remote_backdrop_url": movie.get("remote_backdrop_url", ""),
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
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM moveek_crawl_state ORDER BY movie_id ASC")
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
# INCREMENTAL CSV SYNCHRONIZER
# ==============================================================================

class MoveekCSVManager:
    """Manages incremental and atomic persistence of CSV datasets on disk after each movie."""

    def __init__(self, db: MoveekIndexDatabase) -> None:
        self.db = db
        self._ensure_organizers_csv()

    def _ensure_organizers_csv(self) -> None:
        organizer_rows = [
            {
                "id": DEFAULT_ORGANIZER_ID,
                "user_id": DEFAULT_ORGANIZER_USER_ID,
                "display_name": MOVEEK_ORGANIZER_DISPLAY_NAME,
                "description": MOVEEK_ORGANIZER_DESCRIPTION,
                "logo_url": MOVEEK_ORGANIZER_LOGO_URL,
                "status": "approved",
                "review_note": "Verified Official Moveek Partner",
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
            "movie_id", "slug", "title", "original_title", "section", "source_url",
            "release_date", "duration_minutes", "language", "country", "director", "cast",
            "genre", "age_restriction", "age_description", "local_image_path",
            "remote_image_url", "image_download_status", "image_size_bytes",
            "remote_backdrop_url", "local_trailer_path", "remote_trailer_url",
            "trailer_download_status", "trailer_size_bytes",
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
                "original_title": m["original_title"],
                "section": m["section"],
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
                "remote_backdrop_url": m["remote_backdrop_url"],
                "local_trailer_path": m["local_trailer_path"],
                "remote_trailer_url": m["remote_trailer_url"],
                "trailer_download_status": m["trailer_download_status"],
                "trailer_size_bytes": m["trailer_size_bytes"],
            })

        # Write atomically
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
# MOVEEK CRAWLER PIPELINE
# ==============================================================================

class ResumableMoveekCrawler:
    def __init__(self) -> None:
        self.db = MoveekIndexDatabase()
        self.csv_manager = MoveekCSVManager(self.db)
        self.browser = BrowserManager()
        self.start_timestamp = datetime.now(timezone.utc).isoformat()
        self.running = True

        self.stats = {
            "total_discovered": 0,
            "now_showing_count": 0,
            "upcoming_count": 0,
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
        logging.info("Reconciling Moveek startup state from SQLite and storage directories...")
        existing_movies = self.db.get_all_movies()
        reconciled_count = 0

        for m in existing_movies:
            needs_update = False
            img_path = BASE_DIR / m["local_image_path"] if m["local_image_path"] else None
            vid_path = BASE_DIR / m["local_trailer_path"] if m["local_trailer_path"] else None

            if img_path and img_path.exists() and img_path.stat().st_size > 0:
                if m["image_size_bytes"] != img_path.stat().st_size or m["image_download_status"] != "completed":
                    m["image_size_bytes"] = img_path.stat().st_size
                    m["image_download_status"] = "completed"
                    needs_update = True
            elif m["local_image_path"]:
                logging.warning("Image file missing on disk for [%s]: %s; resetting status.", m["slug"], m["local_image_path"])
                m["local_image_path"] = ""
                m["image_size_bytes"] = 0
                m["image_download_status"] = "pending"
                needs_update = True

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
        logging.info("Moveek startup reconciliation complete. Found %d existing records (%d reconciled).", len(existing_movies), reconciled_count)

    def discover_all_moveek_urls(self) -> list[tuple[str, str]]:
        """
        Discovers all currently showing and upcoming movie URLs across Moveek.
        Returns list of tuples: (source_url, section) where section is 'now_showing' or 'upcoming'.
        """
        logging.info("Starting exhaustive movie discovery across Moveek...")
        target_sections = [
            (MOVEEK_NOW_SHOWING_URL, "now_showing"),
            (f"{MOVEEK_NOW_SHOWING_URL}tat-ca/", "now_showing"),
            (MOVEEK_COMING_SOON_URL, "upcoming"),
            (f"{MOVEEK_COMING_SOON_URL}tat-ca/", "upcoming"),
            (MOVEEK_HOMEPAGE_URL, "now_showing"),
            (f"{MOVEEK_BASE_URL}/phim-chieu-rap/", "now_showing"),
            (f"{MOVEEK_BASE_URL}/trailer/", "upcoming"),
            (f"{MOVEEK_BASE_URL}/trailers/", "upcoming"),
            (f"{MOVEEK_BASE_URL}/lich-chieu/", "now_showing"),
        ]

        discovered_dict: dict[str, tuple[str, str]] = {}
        visited_pages: set[str] = set()

        for page_url, default_section in target_sections:
            if not self.running:
                break
            if page_url in visited_pages:
                continue
            visited_pages.add(page_url)

            logging.info("Scanning Moveek page: %s", page_url)
            try:
                html = self.browser.fetch_page_source(page_url)
                soup = BeautifulSoup(html, "html.parser")

                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if "/phim/" not in href:
                        continue
                    if any(href.endswith(x) for x in ["/phim/", "/phim-dang-chieu/", "/phim-sap-chieu/", "/tat-ca/"]):
                        continue

                    if not href.startswith("http"):
                        href = MOVEEK_BASE_URL + href
                    href = href.split("?")[0].split("#")[0].rstrip("/") + "/"

                    slug = href.rstrip("/").rsplit("/", 1)[-1]
                    if not slug or len(slug) < 2:
                        continue

                    sec = "upcoming" if ("sap-chieu" in page_url or "trailer" in page_url) else default_section

                    if slug not in discovered_dict:
                        discovered_dict[slug] = (href, sec)
                        logging.info("  [Discovered %s] %s -> %s", sec, slug, href)
                    elif discovered_dict[slug][1] == "now_showing" and sec == "upcoming":
                        # Preserve now_showing if active
                        pass

            except Exception as exc:
                logging.error("Error discovering on %s: %s", page_url, exc)

        now_showing_cnt = sum(1 for _, sec in discovered_dict.values() if sec == "now_showing")
        upcoming_cnt = sum(1 for _, sec in discovered_dict.values() if sec == "upcoming")
        self.stats["total_discovered"] = len(discovered_dict)
        self.stats["now_showing_count"] = now_showing_cnt
        self.stats["upcoming_count"] = upcoming_cnt

        logging.info("Discovery complete: %d Total Movies (%d Now Showing, %d Upcoming)", len(discovered_dict), now_showing_cnt, upcoming_cnt)
        return [discovered_dict[k] for k in sorted(discovered_dict.keys())]

    def parse_moveek_movie(self, url: str, section: str) -> dict[str, Any] | None:
        """Parses full structured movie details from a Moveek movie detail page."""
        try:
            html = self.browser.fetch_page_source(url)
            soup = BeautifulSoup(html, "html.parser")

            # Extract JSON-LD schema
            movie_json: dict[str, Any] = {}
            for s in soup.find_all("script", type="application/ld+json"):
                try:
                    data = json.loads(s.string)
                    if data.get("@type") == "Movie":
                        movie_json = data
                        break
                except Exception:
                    pass

            # Title
            title = ""
            if movie_json.get("name"):
                title = str(movie_json["name"]).strip()
            if not title:
                h1 = soup.select_one("h1")
                if h1:
                    title = h1.get_text(strip=True)

            if not title:
                logging.warning("No title found on Moveek URL %s", url)
                return None

            slug_raw = url.rstrip("/").rsplit("/", 1)[-1]
            slug = f"{slug_raw}-moveek"

            # Moveek numeric ID from @id e.g. https://moveek.com/movie/17419/
            moveek_id = ""
            raw_id = movie_json.get("@id", "")
            id_match = re.search(r"/movie/(\d+)", raw_id)
            if id_match:
                moveek_id = id_match.group(1)
            else:
                data_id_el = soup.select_one("[data-id], [data-movie-id]")
                if data_id_el:
                    moveek_id = data_id_el.get("data-id") or data_id_el.get("data-movie-id") or ""

            # Original Title & Subtitle
            original_title = ""
            subtitle_el = soup.select_one(".col-12.col-sm-10 p.text-muted, p.text-muted.text-truncate")
            if subtitle_el:
                subtitle_text = subtitle_el.get_text(strip=True)
                if " - " in subtitle_text:
                    original_title = subtitle_text.split(" - ")[0].strip()
                elif subtitle_text:
                    original_title = subtitle_text.strip()

            if not original_title or original_title.lower() == title.lower():
                original_title = slug_raw.replace("-", " ").title()

            # Description
            description = ""
            if movie_json.get("description"):
                description = str(movie_json["description"]).strip()
            if not description or len(description) < 20:
                p_desc = soup.select_one(".col-12.col-lg-7 p.text-justify, p.text-justify")
                if p_desc:
                    description = p_desc.get_text(strip=True)
            if not description:
                description = f"Thông tin chi tiết, lịch chiếu và đánh giá bộ phim {title} trên hệ thống Moveek."

            # Duration
            duration_minutes = parse_duration_iso(movie_json.get("duration", ""))
            duration_raw = movie_json.get("duration", "")
            if not duration_minutes:
                for li in soup.select("li, span, p"):
                    t = li.get_text(strip=True)
                    if "thời lượng" in t.lower() or "phút" in t.lower():
                        duration_minutes = parse_duration_iso(t)
                        if duration_minutes:
                            duration_raw = t
                            break

            # Release Date
            release_date = movie_json.get("datePublished", "")
            if release_date:
                # Format to YYYY-MM-DD
                release_date = release_date.split("T")[0]
            if not release_date:
                for li in soup.select("li, span, p"):
                    t = li.get_text(strip=True)
                    if "khởi chiếu" in t.lower():
                        d_match = re.search(r"(\d{1,2}[/-]\d{1,2}[/-]\d{4})", t)
                        if d_match:
                            release_date = d_match.group(1)
                            break

            # Genres
            genres = normalize_genres(movie_json.get("genre", []))

            # Age Rating
            raw_rating = movie_json.get("contentRating", "")
            age_restriction, age_description = normalize_age_restriction(raw_rating)

            # Director & Cast / Lineup
            directors_list: list[str] = []
            if movie_json.get("director"):
                dirs = movie_json["director"]
                if isinstance(dirs, list):
                    for d in dirs:
                        if isinstance(d, dict) and d.get("name"):
                            directors_list.append(str(d["name"]).strip())
                        elif isinstance(d, str):
                            directors_list.append(d.strip())
                elif isinstance(dirs, dict) and dirs.get("name"):
                    directors_list.append(str(dirs["name"]).strip())

            cast_list: list[str] = []
            if movie_json.get("actor"):
                actors = movie_json["actor"]
                if isinstance(actors, list):
                    for a in actors:
                        if isinstance(a, dict) and a.get("name"):
                            cast_list.append(str(a["name"]).strip())
                        elif isinstance(a, str):
                            cast_list.append(a.strip())

            lineup_items: list[str] = []
            if directors_list:
                lineup_items.append(f"Đạo diễn: {', '.join(directors_list)}")
            lineup_items.extend(cast_list)

            # Poster Image URL
            remote_image_url = ""
            if movie_json.get("image"):
                img_val = movie_json["image"]
                if isinstance(img_val, dict) and img_val.get("url"):
                    remote_image_url = str(img_val["url"]).strip()
                elif isinstance(img_val, str):
                    remote_image_url = img_val.strip()

            if not remote_image_url:
                img_el = soup.select_one("img[data-srcset*='tall'], img[data-src*='cache/tall'], img[src*='cache/tall'], .col-2 img, .card-poster img")
                if img_el:
                    remote_image_url = (img_el.get("data-src") or img_el.get("src") or "").strip()

            # Upgrade image to tall resolution if cache URL is square or card
            if remote_image_url and "/cache/square/" in remote_image_url:
                remote_image_url = remote_image_url.replace("/cache/square/", "/cache/tall/")
            elif remote_image_url and "/cache/card/" in remote_image_url:
                remote_image_url = remote_image_url.replace("/cache/card/", "/cache/tall/")

            # Backdrop Image URL
            remote_backdrop_url = ""
            backdrop_div = soup.select_one(".backdrop, [style*='background-image']")
            if backdrop_div:
                style_str = backdrop_div.get("style", "")
                m_bg = re.search(r"url\(['\"]?([^'\")]+)['\"]?\)", style_str)
                if m_bg:
                    remote_backdrop_url = m_bg.group(1).strip()

            # Trailer URL
            remote_trailer_url = ""
            trailer_btn = soup.select_one("[data-video-url], a[data-video-url], button[data-video-url]")
            if trailer_btn and trailer_btn.get("data-video-url"):
                v_id = trailer_btn.get("data-video-url").strip()
                remote_trailer_url = f"https://www.youtube.com/watch?v={v_id}"
            else:
                yt_match = re.search(r"(?:youtube\.com/(?:watch\?v=|embed/)|youtu\.be/|data-video-url=[\"'])([a-zA-Z0-9_-]{11})", html)
                if yt_match:
                    remote_trailer_url = f"https://www.youtube.com/watch?v={yt_match.group(1)}"

            # Language & Country
            language = "Tiếng Việt"
            country = infer_country("", title, description)

            norm_title = normalize_title(title)
            fingerprint = compute_fingerprint(norm_title, str(release_date), url)

            return {
                "fingerprint": fingerprint,
                "moveek_id": moveek_id,
                "slug": slug,
                "source_slug": slug_raw,
                "source_url": url,
                "section": section,
                "title": title,
                "normalized_title": norm_title,
                "original_title": original_title,
                "description": description,
                "director": ", ".join(directors_list),
                "cast": ", ".join(cast_list),
                "lineup": lineup_items,
                "genre": genres,
                "release_date": str(release_date),
                "duration_minutes": duration_minutes,
                "duration_raw": duration_raw,
                "language": language,
                "country": country,
                "age_restriction": age_restriction,
                "age_description": age_description,
                "remote_image_url": remote_image_url,
                "remote_backdrop_url": remote_backdrop_url,
                "remote_trailer_url": remote_trailer_url,
                "event_type": "seated",
                "status": "on_sale",
                "moderation_status": "approved",
                "is_featured": False,
                "refund_policy": DEFAULT_REFUND_POLICY,
                "seo_title": f"{title} | Moveek Cinema",
                "seo_description": description[:160],
            }

        except Exception as exc:
            logging.error("Error parsing Moveek movie detail for %s: %s", url, exc)
            return None

    def download_image_immediately(self, movie: dict[str, Any]) -> tuple[str, str, int]:
        """Downloads poster image immediately to data/moveek/images."""
        url = movie.get("remote_image_url", "")
        slug = movie["source_slug"]
        if not url:
            return "", "missing_source_url", 0

        parsed = urlparse(url)
        ext = Path(parsed.path).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
            ext = ".webp"

        filename = f"{slug}_poster{ext}"
        file_path = IMAGES_DIR / filename
        rel_path = f"data/moveek/images/{filename}"

        if file_path.exists() and file_path.stat().st_size > 0:
            return rel_path, "completed", file_path.stat().st_size

        try:
            r = self.browser.http_session.get(url, timeout=20)
            if r.status_code == 200 and len(r.content) > 0:
                with open(file_path, "wb") as f:
                    f.write(r.content)
                size = len(r.content)
                logging.info("  Saved Moveek image: %s (%d bytes)", rel_path, size)
                return rel_path, "completed", size
        except Exception as e:
            logging.warning("HTTP session download failed for %s: %s; trying browser XHR", url, e)

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
        """Downloads trailer video using yt-dlp immediately to data/moveek/videos."""
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
        rel_path = f"data/moveek/videos/{target_name}.mp4"

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

            logging.info("  Downloading Moveek trailer via yt-dlp: %s", watch_url)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([watch_url])

            if expected_mp4.exists() and expected_mp4.stat().st_size > 0:
                size = expected_mp4.stat().st_size
                logging.info("  Saved Moveek trailer: %s (%d bytes)", rel_path, size)
                return rel_path, "completed", size

            candidates = list(VIDEOS_DIR.glob(f"{target_name}.*"))
            if candidates and candidates[0].stat().st_size > 0:
                cand = candidates[0]
                found_rel = f"data/moveek/videos/{cand.name}"
                return found_rel, "completed", cand.stat().st_size

            return "", "failed_remote_only", 0

        except Exception as exc:
            logging.warning("  Could not download trailer for [%s]: %s. Recorded remote URL.", slug, exc)
            return "", "failed_remote_only", 0

    def process_single_movie(self, url: str, section: str) -> None:
        """Processes an individual Moveek movie URL with immediate persistent storage."""
        logging.info(">>> Processing Moveek URL [%s]: %s", section, url)

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
                logging.info("  [RESUME] Incomplete assets for existing Moveek movie: [%s]", existing["slug"])
                is_resume = True

        movie = self.parse_moveek_movie(url, section)
        if not movie:
            logging.warning("  Failed to extract valid Moveek movie metadata from %s", url)
            self.stats["validation_errors"] += 1
            return

        existing_fp = self.db.find_by_fingerprint(movie["fingerprint"])
        if existing_fp and existing_fp["source_url"] != movie["source_url"]:
            logging.info("  [DEDUPLICATE] Movie already exists under different Moveek URL: '%s'", movie["title"])
            self.stats["duplicates_skipped"] += 1
            return

        if existing:
            movie["movie_id"] = existing["movie_id"]
            movie["first_crawled_at"] = existing["first_crawled_at"]
        else:
            movie["movie_id"] = self.db.get_max_movie_id() + 1
            movie["first_crawled_at"] = datetime.now(timezone.utc).isoformat()

        # Download image immediately
        img_path, img_status, img_size = self.download_image_immediately(movie)
        movie["local_image_path"] = img_path
        movie["image_download_status"] = img_status
        movie["image_size_bytes"] = img_size
        if img_status == "completed":
            self.stats["successful_images"] += 1
        else:
            self.stats["failed_downloads"] += 1

        # Download trailer immediately
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
        start_time = time.time()
        logging.info("=========================================================")
        logging.info("STARTING RESUMABLE MOVEEK MOVIE PIPELINE")
        logging.info("Timestamp: %s", self.start_timestamp)
        logging.info("SQLite Index: %s", SQLITE_DB_PATH)
        logging.info("=========================================================")

        candidates = self.discover_all_moveek_urls()
        logging.info("Found %d total candidate URLs from Moveek.", len(candidates))

        for idx, (url, section) in enumerate(candidates, 1):
            if not self.running:
                logging.info("Interruption requested. Stopping loop gracefully.")
                break
            logging.info("Processing Moveek movie [%d/%d]", idx, len(candidates))
            self.process_single_movie(url, section)

        self.generate_readme()

        elapsed = time.time() - start_time
        total_in_db = len(self.db.get_all_movies())

        logging.info("=========================================================")
        logging.info("RESUMABLE MOVEEK MOVIE PIPELINE SUMMARY")
        logging.info("=========================================================")
        logging.info("Elapsed Time:                  %.2f seconds", elapsed)
        logging.info("Total Discovered Movies:       %d", self.stats["total_discovered"])
        logging.info("Currently Showing Movies:      %d", self.stats["now_showing_count"])
        logging.info("Upcoming Movies:               %d", self.stats["upcoming_count"])
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
        readme_path = DATA_DIR / "README.md"
        total_in_db = len(self.db.get_all_movies())
        content = f"""# Moveek Movie Event Crawler & Dataset (Incremental & Resumable)

## 1. Overview
This dataset contains movie events crawled from [Moveek Vietnam](https://moveek.com/) for the TixHub Event Ticketing Platform. Each movie is modeled as an **Event** record belonging to a single verified **Organizer** representing **Moveek Cinema Platform**, strictly compliant with the PostgreSQL database schema and domain specifications (`0001_auth.sql`, `0002_catalog.sql`, and `SCHEMA_DATABASE.md`).

- **Architecture:** Incremental, movie-by-movie persistent storage with atomic SQLite commit & CSV synchronization.
- **Resumability:** Persistent SQLite index (`data/moveek/index.sqlite`) tracks crawl states, image sizes, and trailer download statuses. Interrupted runs resume seamlessly without duplicates.
- **Source Website:** [https://moveek.com](https://moveek.com)
- **Last Crawl Timestamp:** `{datetime.now(timezone.utc).isoformat()}`

---

## 2. Execution Summary & Metrics

| Metric | Value |
|---|---|
| **Total URLs Discovered** | `{self.stats['total_discovered']}` |
| **Currently Showing Movies** | `{self.stats['now_showing_count']}` |
| **Upcoming Movies** | `{self.stats['upcoming_count']}` |
| **Total Persisted Records** | `{total_in_db}` |
| **Already Stored / Skipped** | `{self.stats['already_stored_skipped']}` |
| **Newly Stored Records** | `{self.stats['newly_stored']}` |
| **Resumed / Incomplete Records** | `{self.stats['resumed_incomplete']}` |
| **Organizer Records** | `1 (Moveek Cinema Platform)` |
| **Poster Images Successfully Stored** | `{self.stats['successful_images']}` |
| **Trailer Videos Downloaded Locally** | `{self.stats['successful_trailers']}` |
| **Trailers Recorded Remote Only** | `{self.stats['failed_downloads']}` |
| **Duplicate Movies Skipped** | `{self.stats['duplicates_skipped']}` |
| **Validation Errors** | `{self.stats['validation_errors']}` |

---

## 3. Persistent Directory & Asset Structure

```
data/moveek/
├── README.md                     # Comprehensive documentation & execution guide
├── index.sqlite                  # Persistent SQLite state index & resume manifest
├── events.csv                    # Full database-compatible Event records (flushed incrementally)
├── events_import_compact.csv     # 10-column compact Event import format
├── organizers.csv                # Organizer record for Moveek
├── assets_metadata.csv           # Detailed asset mapping and download status
├── images/                       # Local official high-resolution movie posters (.webp / .jpg)
│   ├── conan-movie-29-fallen-angel-of-the-highway_poster.webp
│   ├── ngay-tan-cua-pho-oak_poster.webp
│   └── ...
├── videos/                       # Local official trailer videos (.mp4)
│   ├── conan-movie-29-fallen-angel-of-the-highway_trailer.mp4
│   ├── ngay-tan-cua-pho-oak_trailer.mp4
│   └── ...
└── logs/
    └── moveek_crawler.log        # Detailed execution and download logs
```

---

## 4. Field Mapping & Schema Normalization

### 4.1 Event Field Mapping (`events.csv`)
| Database Field (`events`) | Moveek Source Field | Data Type / Constraint | Mapping & Fallback Rule |
|---|---|---|---|
| `id` | Generated sequence | `BIGINT` | Stable sequential integer ID from SQLite index |
| `slug` | Moveek URL slug | `TEXT UNIQUE NOT NULL` | Extracted from URL (e.g. `conan-movie-29-fallen-angel-of-the-highway-moveek`) |
| `organizer_id` | Moveek Organizer | `BIGINT NOT NULL REFERENCES organizers(id)` | Foreign key pointing to Moveek (`600`) |
| `category_id` | Fixed Category | `SMALLINT NOT NULL REFERENCES event_categories(id)` | `3` (`theatre` / Sân khấu & Điện ảnh) |
| `title` | Movie name | `TEXT NOT NULL` | Official Vietnamese display title from JSON-LD / `h1` in UTF-8 |
| `original_title` | Subtitle / Original | `TEXT` | Extracted from subtitle `<p class="text-muted">` before `-` delimiter |
| `description` | Synopsis | `TEXT NOT NULL` | Full synopsis from JSON-LD `description` or paragraph |
| `age_restriction` | `contentRating` | `TEXT CHECK (IN ('all', '13+', '16+', '18+'))` | `P`/`K` -> `'all'`, `T13`/`PG-13` -> `'13+'`, `T16` -> `'16+'`, `T18`/`R` -> `'18+'` |
| `age_description` | Rated text | `TEXT` | Full descriptive classification text |
| `duration_minutes` | `duration` | `INT` | Parsed numeric minutes from ISO 8601 `PT109M` |
| `genre` | `genre` | `TEXT[] NOT NULL` | Normalized PostgreSQL array (e.g. `{"Hành Động", "Bí Ẩn", "Hoạt Hình"}`) |
| `lineup` | `director`, `actor` | `TEXT[] NOT NULL` | PostgreSQL array containing director and cast members |
| `image_url` | Poster Image | `TEXT` | Relative local path `data/moveek/images/<slug>_poster.webp` |
| `trailer_url` | Trailer Video | `TEXT` | Relative local path `data/moveek/videos/<slug>_trailer.mp4` or official remote URL |
| `refund_policy` | Policy terms | `TEXT` | Standard Moveek ticket cancellation and refund terms |
| `event_type` | Loại sự kiện | `TEXT CHECK (IN ('general_admission', 'seated'))` | `'seated'` (Cinema seated inventory) |
| `status` | Trạng thái | `TEXT CHECK (IN ('draft', 'on_sale', 'finished', 'cancelled'))` | `'on_sale'` |
| `moderation_status`| Duyệt sự kiện | `TEXT CHECK (IN ('pending_review', 'approved', 'flagged', 'removed'))`| `'approved'` |
| `seo_title` | SEO Title | `TEXT` | `<Movie Title> | Moveek Cinema` |
| `seo_description` | SEO Description | `TEXT` | First 160 characters of synopsis |

### 4.2 Organizer Field Mapping (`organizers.csv`)
| Database Field (`organizers`) | Value | Description |
|---|---|---|
| `id` | `600` | Unique integer ID |
| `user_id` | `600` | Account user reference |
| `display_name` | `Moveek Cinema Platform` | Display name for Moveek organizer |
| `description` | Official description | Comprehensive platform overview |
| `logo_url` | `https://cdn.moveek.com/img/logo.png` | Official Moveek logo |
| `status` | `approved` | Verified Partner status |
| `review_note` | `Verified Official Moveek Partner` | Audit verification note |
| `applied_at` | `2026-01-01T00:00:00Z` | Timestamp |
| `approved_at` | `2026-01-01T00:00:00Z` | Timestamp |
| `approved_by` | `1` | Admin user ID |
| `created_at` | `2026-01-01T00:00:00Z` | Timestamp |

---

## 5. Incremental Processing & Deduplication Strategy

1. **Persistent Manifest (`index.sqlite`):**
   - Stores each movie record immediately upon extraction.
   - Computes deterministic SHA256 fingerprint: `SHA256(normalized_title + release_date + source_url)`.
   - Prevents duplicate crawling across repeated runs or intersecting Moveek listings.

2. **Resume Capability:**
   - On restart, reconciles database states with filesystem files.
   - Fully saved movies with intact assets are skipped instantly without network overhead.
   - Incomplete records (e.g. interrupted trailer download) resume seamlessly.

3. **Incremental CSV Sync:**
   - Flushes and syncs CSV files (`events.csv`, `organizers.csv`, `assets_metadata.csv`, `events_import_compact.csv`) after each movie record is committed.
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
.\\myenv\\Scripts\\python.exe CrawlData\\moveek_scraper.py
```
"""
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(content)
        logging.info("Wrote updated Moveek README: %s", readme_path)


# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================

def main() -> None:
    crawler = ResumableMoveekCrawler()
    try:
        crawler.run()
    finally:
        crawler.close()


if __name__ == "__main__":
    main()
