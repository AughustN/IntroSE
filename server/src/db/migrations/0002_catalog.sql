-- ============================================================================
-- Migration 0002 — Event Catalog & Discovery (feature 002-event-catalog)
--
-- Run after 0001_auth.sql (references users, organizers). Creates the 8 catalog
-- tables from SCHEMA_DATABASE.md, plus venues.created_by (D-F) and seeds
-- event_categories. Money is whole VND đồng (BIGINT, D1).
--   psql "$DATABASE_URL" -f server/src/db/migrations/0002_catalog.sql
-- ============================================================================

BEGIN;

-- ---------- EVENT CATEGORIES (seeded, R-10) ----------
CREATE TABLE event_categories (
  id       SMALLSERIAL PRIMARY KEY,
  code     TEXT UNIQUE NOT NULL,
  label_vi TEXT NOT NULL,
  label_en TEXT
);
INSERT INTO event_categories (code, label_vi, label_en) VALUES
  ('music',      'Âm nhạc',        'Music'),
  ('workshop',   'Workshop',       'Workshop'),
  ('theatre',    'Sân khấu',       'Theatre'),
  ('community',  'Cộng đồng',      'Community'),
  ('sports',     'Thể thao',       'Sports'),
  ('exhibition', 'Triển lãm',      'Exhibition');

-- ---------- VENUES (+ created_by owner, D-F) ----------
CREATE TABLE venues (
  id           BIGSERIAL PRIMARY KEY,
  created_by   BIGINT NOT NULL REFERENCES users(id),   -- owner (D-F)
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  raw_address  TEXT NOT NULL,
  address_line TEXT,
  map_url      TEXT,
  guide        TEXT,
  normalized_name TEXT GENERATED ALWAYS AS (lower(regexp_replace(name, '\s+', ' ', 'g'))) STORED,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_venues_created_by ON venues(created_by);

-- ---------- SECTIONS (unit of tier pricing, R-7) ----------
CREATE TABLE sections (
  id          BIGSERIAL PRIMARY KEY,
  venue_id    BIGINT NOT NULL REFERENCES venues(id),
  name        TEXT NOT NULL,
  description TEXT,
  UNIQUE (venue_id, name)
);

-- ---------- SEATS ----------
CREATE TABLE seats (
  id          BIGSERIAL PRIMARY KEY,
  venue_id    BIGINT NOT NULL REFERENCES venues(id),
  section_id  BIGINT REFERENCES sections(id),
  row_label   TEXT NOT NULL,
  seat_number INT NOT NULL,
  seat_type   TEXT NOT NULL DEFAULT 'single' CHECK (seat_type IN ('single', 'double', 'standing')),
  UNIQUE (venue_id, row_label, seat_number)
);

-- ---------- EVENTS ----------
CREATE TABLE events (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,                    -- stable, set once (FR-031)
  organizer_id  BIGINT NOT NULL REFERENCES organizers(id),
  category_id   SMALLINT NOT NULL REFERENCES event_categories(id),
  title         TEXT NOT NULL,
  original_title TEXT,
  description   TEXT NOT NULL,
  age_restriction TEXT NOT NULL DEFAULT 'all' CHECK (age_restriction IN ('all', '13+', '16+', '18+')),
  age_description TEXT,
  duration_minutes INT,
  genre         TEXT[] NOT NULL DEFAULT '{}',
  lineup        TEXT[] NOT NULL DEFAULT '{}',
  image_url     TEXT,
  trailer_url   TEXT,
  refund_policy TEXT,
  is_featured   BOOLEAN NOT NULL DEFAULT false,
  event_type    TEXT NOT NULL DEFAULT 'general_admission'
    CHECK (event_type IN ('general_admission', 'seated')),
  status        TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'on_sale', 'finished', 'cancelled')),
  moderation_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (moderation_status IN ('pending_review', 'approved', 'flagged', 'removed')),
  review_note   TEXT,                                    -- admin reject/flag/remove reason
  seo_title     TEXT,
  seo_description TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_category   ON events(category_id);
CREATE INDEX idx_events_status     ON events(status);
CREATE INDEX idx_events_organizer  ON events(organizer_id);
CREATE INDEX idx_events_moderation ON events(moderation_status);

-- ---------- SHOWTIMES ----------
CREATE TABLE showtimes (
  id        BIGSERIAL PRIMARY KEY,
  event_id  BIGINT NOT NULL REFERENCES events(id),
  venue_id  BIGINT NOT NULL REFERENCES venues(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ,
  status    TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'on_sale', 'sold_out', 'finished', 'cancelled'))
);
CREATE INDEX idx_showtimes_event     ON showtimes(event_id);
CREATE INDEX idx_showtimes_starts_at ON showtimes(starts_at);

-- ---------- TICKET TIERS (whole VND đồng, D1) ----------
CREATE TABLE ticket_tiers (
  id             BIGSERIAL PRIMARY KEY,
  showtime_id    BIGINT NOT NULL REFERENCES showtimes(id),
  label          TEXT NOT NULL,
  price_amount   BIGINT NOT NULL,                        -- integer VND đồng
  description    TEXT,
  badge          TEXT,
  total_quantity INT,                                    -- GA capacity; NULL for seated
  sold_quantity  INT NOT NULL DEFAULT 0,
  reserved_quantity INT NOT NULL DEFAULT 0,
  CHECK (sold_quantity + reserved_quantity <= COALESCE(total_quantity, sold_quantity + reserved_quantity))
);
CREATE INDEX idx_ticket_tiers_showtime ON ticket_tiers(showtime_id);

-- ---------- SHOWTIME SEATS (seated; read-only in this feature) ----------
CREATE TABLE showtime_seats (
  id             BIGSERIAL PRIMARY KEY,
  showtime_id    BIGINT NOT NULL REFERENCES showtimes(id),
  seat_id        BIGINT NOT NULL REFERENCES seats(id),
  ticket_tier_id BIGINT NOT NULL REFERENCES ticket_tiers(id),
  status         TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'held', 'sold', 'blocked')),
  hold_owner_id   BIGINT REFERENCES users(id),
  hold_expires_at TIMESTAMPTZ,
  UNIQUE (showtime_id, seat_id)
);
CREATE INDEX idx_showtime_seats_showtime   ON showtime_seats(showtime_id, status);
CREATE INDEX idx_showtime_seats_hold_expiry ON showtime_seats(hold_expires_at) WHERE status = 'held';

-- ---------- AUDIT LOGS (admin actions; first used by moderation, SEC-09) ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT NOT NULL REFERENCES users(id),
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     BIGINT,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at);

COMMIT;
