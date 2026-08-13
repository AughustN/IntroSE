-- 0021_review_threads.sql -- Many comments per person, and replies under them (009 revisited).
--
-- 0020 built one review per person per event: a rating with optional prose, upserted so a second
-- submission edited the first. That is the right shape for a score and the wrong shape for a comment
-- section, which is what the event page actually grew into. A buyer who comes back with a second
-- thought had their first one silently overwritten, and nobody could answer anybody.
--
-- The score survives intact. A person still rates an event exactly once — the partial unique index
-- below is what promises it — and everything they write afterwards, top level or reply, is text with
-- no stars in it. So the average is still one vote per attendee no matter how much they talk.

BEGIN;

/*
 * A reply's parent. NULL for a top-level comment, which is what the wall lists.
 *
 * CASCADE, unlike the author key beside it: a reply is a remark *about* its parent and reads as
 * nonsense without it, whereas a review outlives its author because it is a claim about the event.
 * Deleting a comment therefore takes its thread with it.
 */
ALTER TABLE event_reviews
  ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES event_reviews(id) ON DELETE CASCADE;

-- Only the first comment carries stars; every later one, and every reply, is prose.
ALTER TABLE event_reviews ALTER COLUMN rating DROP NOT NULL;

DO $$
BEGIN
  -- A row has to say something: stars, text, or both. Otherwise it is an empty line on the wall.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_reviews_says_something') THEN
    ALTER TABLE event_reviews
      ADD CONSTRAINT event_reviews_says_something
      CHECK (rating IS NOT NULL OR body IS NOT NULL);
  END IF;

  -- A reply is text under somebody else's comment. Stars belong to the event, not to a remark about
  -- a remark, so a rated reply is refused by the database rather than by whoever remembers to check.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_reviews_replies_have_no_stars') THEN
    ALTER TABLE event_reviews
      ADD CONSTRAINT event_reviews_replies_have_no_stars
      CHECK (parent_id IS NULL OR rating IS NULL);
  END IF;
END $$;

/*
 * One *rating* per person per event, still promised by the database.
 *
 * Replaces 0020's index, which was one *row* per person per event. The predicate is what carries the
 * new rule: a second rated row cannot be inserted, so "have they rated this already?" can never be a
 * read followed by a write with a gap in the middle, while unrated comments and replies are free to
 * pile up beside it.
 */
DROP INDEX IF EXISTS idx_event_reviews_one_per_author;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_reviews_one_rating_per_author
  ON event_reviews (event_id, user_id)
  WHERE user_id IS NOT NULL AND rating IS NOT NULL;

-- The wall's exact filter and order: top-level comments only, newest first.
CREATE INDEX IF NOT EXISTS idx_event_reviews_toplevel
  ON event_reviews (event_id, created_at DESC)
  WHERE status = 'visible' AND parent_id IS NULL;

-- Reading one comment's thread, oldest first — a conversation is read in the order it happened.
CREATE INDEX IF NOT EXISTS idx_event_reviews_replies
  ON event_reviews (parent_id, created_at)
  WHERE status = 'visible' AND parent_id IS NOT NULL;

COMMIT;
