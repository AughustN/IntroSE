-- 0027 — Capacity zones: a standing area sold by COUNT, not by generated seat rows.
--
-- Until now a "khu đứng" was expanded into one `seats` row per spectator (`standing.standingPositions`).
-- A 5,000-capacity floor therefore produced 5,000 `seats`, 5,000 `showtime_seats` and 5,000 interactive
-- SVG nodes — to sell an undifferentiated standing ticket that nobody picks a position for.
--
-- The platform already had the right mechanism for this and was not using it: `ticket_tiers` carries
-- `total_quantity / sold_quantity / reserved_quantity` under a CHECK that prevents oversell, and the
-- hold path locks the tier `FOR UPDATE`. A capacity zone is therefore not a new kind of inventory — it
-- is an `area` element that names a price class, and at generation its capacity becomes that tier's
-- quantity. One row instead of five thousand, and the concurrency guarantees are the existing ones.
--
-- `category_id` is what was missing: an element could carry a capacity but had no way to say which
-- price class the capacity belongs to, so there was nothing to join it to a tier by. Seats have had
-- this since 0021; this gives areas the same handle.
--
-- ON DELETE SET NULL matches `seats.category_id` (0021): deleting a price class must never delete the
-- thing that referenced it. A zone that loses its category becomes unpublishable — `validateLayout`
-- reports `zone_without_category` — rather than silently disappearing from the chart.
--
-- Nothing here is destructive and nothing is back-filled: existing generated standing seats keep
-- working exactly as they do today. This migration only makes the cheaper model expressible.

ALTER TABLE layout_elements
  ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES layout_categories(id) ON DELETE SET NULL;

-- Only an `area` may carry capacity or a price class. A stage with a capacity would be a stage that
-- sells tickets, which is the one thing `layout_elements` exists to make impossible (FR-017).
DO $$ BEGIN
  ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_capacity_area_only
    CHECK (kind = 'area' OR (capacity IS NULL AND category_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Capacity is a count of people; zero or negative is not a zone, it is a drawing.
DO $$ BEGIN
  ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_capacity_positive
    CHECK (capacity IS NULL OR capacity > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The join generation walks: "every zone of this layout, by price class".
CREATE INDEX IF NOT EXISTS layout_elements_category_idx
  ON layout_elements(layout_id, category_id) WHERE category_id IS NOT NULL;
