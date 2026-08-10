-- 0008_seatmap_reconcile.sql — reconcile `venue_layouts` with feature 005.
--
-- Why this exists: 0007 creates `venue_layouts` with `CREATE TABLE IF NOT EXISTS`. On a database where
-- a table of that name already existed (an earlier parallel implementation of the same feature), the
-- CREATE was skipped in full — so the table survived without the columns 0007's code expects, and
-- every layout read failed with `column "version" does not exist`.
--
-- The two shapes turned out to be the same design under different names. This migration keeps the
-- existing `background_*` naming, which other code may already read, and adds only what is genuinely
-- missing. 0007 was amended to match, so a fresh database and this one end up identical.
--
-- IF NOT EXISTS throughout, so this is a no-op on a database that 0007 built from scratch.

ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- The layout's own coordinate space. Feature 005 treats it as a constant (0–10000 on each axis), but
-- the pre-existing table carries width/height per layout; default them so both agree.
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS width INT NOT NULL DEFAULT 10000;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS height INT NOT NULL DEFAULT 10000;

-- Background (the floor plan). A BACKGROUND LAYER ONLY: it never creates a seat and never determines
-- a seat's status (FR-020). `background_public` is the buyer-visibility toggle (FR-026), and it
-- governs display, not reachability — the file is unguessable, not access-controlled (FR-026a).
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS background_url TEXT;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS background_scale NUMERIC(6,3) NOT NULL DEFAULT 1;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS background_offset_x INT NOT NULL DEFAULT 0;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS background_offset_y INT NOT NULL DEFAULT 0;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS background_opacity NUMERIC(3,2) NOT NULL DEFAULT 0.5;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS background_public BOOLEAN NOT NULL DEFAULT false;

-- `sections.description` is read by the layout document; add it where it is missing.
ALTER TABLE sections ADD COLUMN IF NOT EXISTS description TEXT;
