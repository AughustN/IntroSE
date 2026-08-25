-- Migration 0039 — An event is bound to ONE venue.
--
-- Depends on 0002_catalog.sql (events, venues, showtimes).
--
-- The organizer-facing rule changed: a venue is collected when the event is CREATED (feature
-- "tạo sự kiện" page two), and showtimes are never asked which venue they belong to — the event
-- already answered. This column is that answer, server-side:
--
--   * `addShowtimeWithTiers` refuses a venueId that differs from the pinned one, and PINS it on the
--     event's first showtime when still NULL (which covers every draft created before this column,
--     and keeps legacy rows working without a data migration guessing for them).
--   * `updateShowtime` no longer accepts a venueId at all — relocating was the one edit that could
--     contradict the pin, so the capability goes rather than gaining a second refusal message.
--
-- Backfill takes each event's venue only where ALL of its showtimes agree; ambiguous multi-venue
-- histories stay NULL and will pin on their next showtime creation.
BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_id BIGINT REFERENCES venues(id);

UPDATE events e
   SET venue_id = s.venue_id
  FROM (
    SELECT event_id, MIN(venue_id) AS venue_id
      FROM showtimes
     GROUP BY event_id
    HAVING COUNT(DISTINCT venue_id) = 1
  ) s
 WHERE s.event_id = e.id
   AND e.venue_id IS NULL;

COMMIT;
