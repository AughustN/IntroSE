-- 0030 — A drawn shape gets a colour and a remembered geometry.
--
-- `layout_elements.points` (0012) already stores a vertex list, and the canvas already draws it closed,
-- so every outline in the system is a polygon underneath. Two things were missing to make that usable:
--
--  * COLOUR. A hall outline, a divider and a standing area were all drawn in the same theme ink, so a
--    chart with several zones read as one undifferentiated tangle. The colour has to live here rather
--    than only in the authoring document, because the buyer's map is built from `showtimes.layout_snapshot`,
--    which is copied from these rows — a colour kept only in the blob would never reach a buyer.
--
--  * GEOMETRY. A circle and a hand-drawn ring are the same 32 points once stored, so re-opening a chart
--    lost the fact that one of them was a circle and could be regenerated as one. Remembering the name
--    lets "make this an oval" stay a one-click change instead of a redraw.
--
-- Both are nullable and mean "as before" when absent, so every existing element keeps rendering exactly
-- as it does today.

ALTER TABLE layout_elements ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE layout_elements ADD COLUMN IF NOT EXISTS geometry TEXT;

-- The value ends up in an SVG `fill`, so it is constrained here as well as at the route: a colour is
-- six hex digits and nothing else, which forecloses `url(...)` and any other paint server.
DO $$ BEGIN
  ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_color_hex
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Named shapes only. `free` is the hand-drawn polygon and is stored as NULL rather than as a name, so
-- an element with no geometry is exactly "whatever points it has", which is what every existing row is.
DO $$ BEGIN
  ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_geometry_known
    CHECK (geometry IS NULL OR geometry IN ('rect', 'square', 'circle', 'oval', 'triangle', 'hexagon'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
