-- ============================================================================
-- Migration 0021 — Organizer Business Analytics (feature 011-organizer-business-analytics)
-- ============================================================================

BEGIN;

-- 1. Ensure category TEXT column exists on events for category breakdown fallback
ALTER TABLE events ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Âm nhạc';

-- 2. Add composite index for organizer analytics query performance
CREATE INDEX IF NOT EXISTS idx_events_org_analytics ON events(organizer_id, status, created_at);

-- 3. Check-in records table (P3 optional extension for door scanner attendance tracking)
CREATE TABLE IF NOT EXISTS checkin_records (
  id                 BIGSERIAL PRIMARY KEY,
  ticket_id          BIGINT NOT NULL,
  event_id           BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scanned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_by_user_id BIGINT NOT NULL REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'DUPLICATE', 'INVALID'))
);

CREATE INDEX IF NOT EXISTS idx_checkin_records_event_scanned ON checkin_records(event_id, scanned_at);

COMMIT;
