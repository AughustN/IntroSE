-- 0038 — Whether a film is showing now or is still to come.
--
-- Depends on 0002_catalog.sql (events).
--
-- The cinema band on the landing page splits into two, "Đang chiếu" and "Sắp chiếu", and the reader
-- switches between them in place. That split needs a fact, and the catalogue did not hold one.
--
-- It could have been derived — soonest showtime still in the future means "upcoming" — and that was
-- the obvious first answer. It is wrong for the case the two words exist to describe: a film opens on
-- Friday and sells tickets from Monday, so for four days it is in cinemas' listings as "sắp chiếu"
-- while every one of its showtimes is in the future; the morning after its first screening nothing
-- about it changed except a clock, and a derived rule would have moved it on its own. Worse in the
-- other direction: a long run keeps selling for weeks, so "has a past showtime" quietly makes every
-- film "đang chiếu" forever, including the ones a cinema has already pulled.
--
-- So it is what the organizer says it is, and it stays that way until they say otherwise.
--
-- `now_showing` is the default because it describes every film already in the catalogue: they are on
-- sale with showtimes running, which is precisely what the phrase means. Nothing is rewritten.
--
-- Only films carry it. Nothing constrains that at the schema level — a CHECK against the category
-- would have to reach into `event_categories` on every write — but the column is read only by the
-- cinema band, and the organizer control only appears on an event in the `movie` category.
BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS release_phase TEXT NOT NULL DEFAULT 'now_showing'
  CHECK (release_phase IN ('now_showing', 'upcoming'));

-- The band is the only reader, and it always asks for one phase at a time within one category.
CREATE INDEX IF NOT EXISTS idx_events_release_phase
  ON events (release_phase)
  WHERE status = 'on_sale';

COMMIT;
