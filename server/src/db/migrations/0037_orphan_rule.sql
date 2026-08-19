-- 0037 — How hard a chart refuses to strand a lone seat.
--
-- Depends on 0007_seatmap.sql (venue_layouts).
--
-- "Best available" picks a run of adjacent seats nearest the focal point. Until now it would happily
-- take the middle of a three-seat gap and leave a single seat marooned between two sold ones — the
-- seat nobody then buys, which is revenue lost rather than merely untidy.
--
-- Whether that is worth preventing is a VENUE's call, not the platform's, so it is a property of the
-- chart rather than a constant in the picker:
--
--   balanced (default) — a buyer may not strand a single seat mid-row, but a one-seat gap beside an
--                        aisle or at the end of a row is fine. Somebody sitting alone on the end is
--                        ordinary, and forbidding it costs more sales than it saves.
--   strict             — no single empty seat anywhere. Fills the house harder, and refuses
--                        arrangements plenty of buyers would consider reasonable.
--
-- It lives on `venue_layouts` beside `background_*` because those are the other chart-level settings,
-- and because `refreshSnapshot` builds the buyer's copy of the map from THESE columns — the authoring
-- document (`venue_layouts.document`) is never read on that path, so a setting kept only in the blob
-- would never reach a buyer.
--
-- Additive and defaulted: every existing chart keeps behaving the way the picker already behaves once
-- the balanced rule ships, and no row is rewritten.
BEGIN;

ALTER TABLE venue_layouts
  ADD COLUMN IF NOT EXISTS orphan_rule TEXT NOT NULL DEFAULT 'balanced'
  CHECK (orphan_rule IN ('balanced', 'strict'));

COMMIT;
