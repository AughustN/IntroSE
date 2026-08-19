-- Migration 0036 — Cinema chains ("cụm rạp") as a first-class entity.
--
-- Depends on 0002_catalog.sql (venues).
--
-- Until now a chain existed only as prose. `seed-cinemas.ts` wrote it into `venues.guide` as the
-- string "Hệ thống CGV", which reads fine on a venue page and is useless for everything else: the
-- catalogue cannot filter "phim đang chiếu ở Lotte", the landing page cannot group cinemas by their
-- operator, and an admin cannot attach a logo to a chain without editing 15 venue rows. A chain is a
-- thing buyers actually navigate by, so it gets a table.
--
-- The relationship is venue → chain, nullable, because most venues have no chain at all. 465 of the
-- venues already in this schema are concert halls, stadiums and auditoriums; they are not operated by
-- anybody in this table and must not be forced to name one. `chain_id IS NULL` is the normal state
-- for a venue, not a gap to be backfilled.
--
-- ON DELETE SET NULL rather than CASCADE for the same reason: a venue is a physical place that
-- outlives its operator. Retiring the chain row must orphan the cinemas, never delete them along
-- with every showtime ever sold there.
BEGIN;

-- ---------- THE CHAINS ----------
-- Small, admin-owned, effectively static — the eight operators are seeded at the bottom of this file.
-- `code` is the stable slug the API and FE key off; `name` is display copy an admin may reword
-- without breaking a saved filter or a bookmarked URL.
CREATE TABLE IF NOT EXISTS cinema_chains (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  -- Cloudinary URL, set later through the media pipeline (feature 012). Null until an admin uploads
  -- one; the FE falls back to the name.
  logo_url      TEXT,
  description   TEXT,
  -- Retires a chain without deleting it, matching `ad_packages.is_active` (0033): a retired chain
  -- still has to render on the venues that belong to it.
  is_active     BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cinema_chains_active ON cinema_chains(is_active, display_order, id);

-- ---------- THE LINK ----------
-- Additive, and IF NOT EXISTS on the column: the migration runner treats 42P07/42710/42P16 as
-- "already applied" but NOT 42701 (duplicate column), so a plain ADD COLUMN would break a re-run.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS chain_id BIGINT REFERENCES cinema_chains(id) ON DELETE SET NULL;

-- Partial index: the query this serves is always "venues of chain X" or "venues in city Y of chain
-- X", never "venues with no chain" — and the null rows are the overwhelming majority, so indexing
-- them would double the index to answer a question nobody asks.
CREATE INDEX IF NOT EXISTS idx_venues_chain ON venues(chain_id, city) WHERE chain_id IS NOT NULL;

-- ---------- SEED ----------
-- The eight operators `seed-cinemas.ts` schedules against, in rough order of estate size. Seeded
-- here rather than in the seed script so the reference data exists in every environment — including
-- test databases that never run the cinema seed.
INSERT INTO cinema_chains (code, name, display_order) VALUES
  ('cgv',           'CGV',           1),
  ('lotte-cinema',  'Lotte Cinema',  2),
  ('galaxy',        'Galaxy',        3),
  ('beta',          'Beta',          4),
  ('bhd-star',      'BHD Star',      5),
  ('cinestar',      'Cinestar',      6),
  ('mega-gs',       'Mega GS',       7),
  ('starlight',     'Starlight',     8)
ON CONFLICT (code) DO NOTHING;

COMMIT;
