-- Migration 0034 — Let an event advertise again after its campaign ends.
--
-- 0033 forbade a second campaign per event with a partial unique index on `status = 'active'`. That
-- is the wrong rule for the lifecycle 0033 chose: a campaign that has simply run out KEEPS
-- `status = 'active'` and falls out of the placement feed by `ends_at`, precisely so that expiry
-- needs no sweeper. The index therefore did not forbid "two campaigns at once", it forbade "ever
-- advertising this event twice" — an organizer whose 7-day package expired could never buy another.
--
-- What was actually meant is that two campaigns may not OVERLAP. That is an exclusion constraint,
-- which unlike a partial unique index can compare the time ranges themselves, and unlike a `now()`
-- predicate stays immutable and therefore indexable.
BEGIN;

-- `gist` cannot index a plain BIGINT for equality without this.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX IF EXISTS uq_ad_purchases_live_per_event;

ALTER TABLE ad_purchases
  DROP CONSTRAINT IF EXISTS ad_purchases_no_overlap;

ALTER TABLE ad_purchases
  ADD CONSTRAINT ad_purchases_no_overlap
  EXCLUDE USING gist (
    event_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'active');

COMMIT;
