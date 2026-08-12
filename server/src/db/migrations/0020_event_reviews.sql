-- 0020_event_reviews.sql -- Ratings and reviews for events (009, UC-18).
--
-- The event-detail design has shown "aggregated rating" since UC-09 was written; nothing has ever
-- produced one. This is the table that does.
--
-- Reporting is deliberately absent: `content_reports.target_type` already reads
-- CHECK (target_type = ANY (ARRAY['event','review'])) — feature 004 anticipated reviews before they
-- existed, so a reported review goes into the moderation queue that is already built.

BEGIN;

CREATE TABLE IF NOT EXISTS event_reviews (
  id         BIGSERIAL PRIMARY KEY,
  event_id   BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  /*
   * Nullable, and SET NULL rather than CASCADE, on purpose.
   *
   * An event's rating is a claim about the event. Cascading would let it move because somebody
   * closed an unrelated account — and would hand an organizer a way to lift a poor rating by
   * persuading one reviewer to delete their account. The review survives its author, attributed to
   * nobody.
   */
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  -- The characters the author typed, stored verbatim. Never escaped on the way in: escaping belongs
  -- at the render boundary, and doing it here double-escapes anything displayed twice and corrupts
  -- text that legitimately contains `<` or `&` (SEC-07 is about output encoding, not input mangling).
  body       TEXT,
  -- Moderation hides; the author's own withdrawal deletes the row. A hidden row is what keeps the
  -- report and the audit entry pointing at something an admin can still read.
  status     TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- `updated_at > created_at` is what marks a review as edited. A separate boolean would be a second
  -- thing to keep in step with the first.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/*
 * One review per person per event, promised by the database.
 *
 * "Look for an existing review, then insert if there is none" is two statements with a gap, and two
 * devices submitting a first review at the same instant both find nothing and both insert. Partial
 * because `user_id` is nullable: several author-less reviews of one event must be able to coexist.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_reviews_one_per_author
  ON event_reviews (event_id, user_id)
  WHERE user_id IS NOT NULL;

-- The listing's exact filter and order, so paging is an index scan rather than a sort.
CREATE INDEX IF NOT EXISTS idx_event_reviews_listing
  ON event_reviews (event_id, created_at DESC)
  WHERE status = 'visible';

COMMIT;
