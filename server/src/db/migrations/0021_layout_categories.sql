BEGIN;

-- Feature 005 amendment — CATEGORIES: the chart's price classes, separated from the event's prices.
--
-- Until now `sections` did double duty. A section is a SPATIAL grouping ("Khu A", "Ban công"), but it
-- was also the thing an organizer mapped to a ticket tier when generating a showtime's seats — and
-- that mapping was passed as a request argument and then thrown away. Every showtime of the same
-- chart re-picked it by hand, and nothing recorded that "the front rows are VIP" was a property of
-- the CHART rather than of one night's sale.
--
-- A category is that missing thing: a named, coloured class an object belongs to, owned by the
-- layout. Price stays where it belongs — on `ticket_tiers`, per showtime — and a tier now names the
-- category it prices. One chart therefore backs many showtimes at many prices without being redrawn,
-- which is the whole reason the layout layer exists (FR-005).
--
-- Additive only. Every ADD COLUMN uses IF NOT EXISTS: the migration runner treats 42P07/42710/42P16
-- as "already applied" but NOT 42701 (duplicate column), so a plain ADD COLUMN would fail a re-run.

CREATE TABLE IF NOT EXISTS layout_categories (
  id BIGSERIAL PRIMARY KEY,
  layout_id BIGINT NOT NULL REFERENCES venue_layouts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- NOT NULL, unlike `sections.color`. A category exists to be recognised by colour, so a colourless
  -- one is meaningless rather than merely unpublishable — the constraint says so instead of a
  -- validation rule saying it later.
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_layout_categories_layout ON layout_categories(layout_id);

ALTER TABLE layout_categories DROP CONSTRAINT IF EXISTS layout_categories_layout_name_key;
ALTER TABLE layout_categories ADD CONSTRAINT layout_categories_layout_name_key UNIQUE (layout_id, name);

-- Objects gain their category. Nullable, and deliberately ON DELETE SET NULL: deleting a category
-- ORPHANS its objects, exactly as deleting a section orphans its seats (layoutOps.removeSection).
-- Destroying seats because a price class was renamed away would be the worst possible reading.
ALTER TABLE seats ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES layout_categories(id) ON DELETE SET NULL;
ALTER TABLE layout_tables ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES layout_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_seats_category ON seats(category_id);

-- The event side of the join: a tier PRICES a category. Nullable because a general-admission
-- showtime has tiers and no chart at all, and because a seated showtime generated before today has
-- tiers whose category cannot always be recovered (see the backfill below).
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES layout_categories(id) ON DELETE SET NULL;

-- Snapshotted onto the bookable row, for the same reason `section_name` already is (0007:145-152):
-- a showtime owns its map, so renaming or deleting a chart category must never reach back and
-- relabel a ticket somebody has already paid for.
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS category_name TEXT;

-- ---------- BACKFILL ----------
-- The goal is that nothing observably changes on the day this ships. Before today the section WAS
-- the price class, so every existing section becomes a category of the same name and colour, and
-- every seat joins the category matching its section. A chart drawn yesterday keeps working, and its
-- organizer sees the classes they already had rather than an empty panel.
INSERT INTO layout_categories (layout_id, name, color)
SELECT sec.layout_id,
       sec.name,
       -- Sections predating 0012's backfill can still be colourless; fall back to the same palette
       -- 0012 used, positioned the same way, so the two never disagree about a chart's colours.
       COALESCE(sec.color, (ARRAY['#4C9A6B', '#3E7CB1', '#C9762F', '#9B4D8E', '#B3453C'])[
         ((row_number() OVER (PARTITION BY sec.layout_id ORDER BY sec.id) - 1) % 5)::int + 1
       ])
  FROM sections sec
 WHERE sec.layout_id IS NOT NULL
ON CONFLICT (layout_id, name) DO NOTHING;

UPDATE seats s
   SET category_id = c.id
  FROM sections sec
  JOIN layout_categories c ON c.layout_id = sec.layout_id AND c.name = sec.name
 WHERE s.section_id = sec.id AND s.category_id IS NULL;

UPDATE layout_tables t
   SET category_id = c.id
  FROM sections sec
  JOIN layout_categories c ON c.layout_id = sec.layout_id AND c.name = sec.name
 WHERE t.section_id = sec.id AND t.category_id IS NULL;

-- Recover the section→tier mapping that generation used to discard, by reading it back off the
-- inventory it produced. A tier that priced exactly one category gets that category; a tier spanning
-- several is left NULL rather than guessed, because guessing here would silently reprice seats.
WITH tier_category AS (
  SELECT ss.ticket_tier_id, min(s.category_id) AS category_id
    FROM showtime_seats ss
    JOIN seats s ON s.id = ss.seat_id
   WHERE s.category_id IS NOT NULL
   GROUP BY ss.ticket_tier_id
  HAVING count(DISTINCT s.category_id) = 1
)
UPDATE ticket_tiers tt
   SET category_id = tc.category_id
  FROM tier_category tc
 WHERE tt.id = tc.ticket_tier_id AND tt.category_id IS NULL;

-- Backfill the snapshot on maps that already exist, so an organizer opening an old showtime sees the
-- same classes as its chart. Reads the LAYOUT's category because that is what the map was generated
-- from; from here on it is frozen and the layout can diverge freely.
UPDATE showtime_seats ss
   SET category_name = c.name
  FROM seats s
  JOIN layout_categories c ON c.id = s.category_id
 WHERE ss.seat_id = s.id AND ss.category_name IS NULL;

COMMIT;
