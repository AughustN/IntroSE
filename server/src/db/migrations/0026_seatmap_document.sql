BEGIN;

-- The authoring DOCUMENT: one JSONB blob per layout holding design INTENT.
--
-- What the normalized rows cannot express, and an organizer needs in order to re-edit rather than
-- redraw: a block's `rowsCount × seatsPerRow`, its seat and row spacing, an arc's radius and angle,
-- the row/seat label schemes, a GA zone's headcount. Today all of that is baked into seat coordinates
-- the moment it is drawn, so changing "10 seats per row" to 11 means deleting the row and drawing it
-- again.
--
-- The blob is NOT the sellable truth. `sections`, `layout_categories`, `seats`, `layout_elements` and
-- `layout_tables` stay authoritative, and the document is projected ONE WAY into them on every save
-- (shared/catalog/seatmap-project.ts). That split is not a compromise, it is the requirement: a paid
-- ticket reaches a chart through `showtime_seats.seat_id -> seats.id` and a price through
-- `ticket_tiers.category_id -> layout_categories.id`. Seats that existed only inside a blob would
-- have nothing for either foreign key to point at, and the per-seat sold/held rules in apply.ts
-- (FR-028) would have nothing left to enforce against. So no inventory path ever reads this column.
--
-- Nullable on purpose. Every layout drawn before today has none — including the "Sơ đồ mặc định" rows
-- 0007_seatmap.sql backfilled onto real venues. `getLayout` synthesises a document from the rows for
-- those (`adoptLayout`), so no reader has to cope with a missing one and no existing chart has to be
-- migrated. That is also why this is one nullable column and not a NOT NULL default: a default would
-- claim every old layout has an authoring document, which is exactly the lie adoption avoids.
--
-- ADD COLUMN IF NOT EXISTS is mandatory: the runner treats 42P07 / 42710 / 42P16 as "already applied"
-- but NOT 42701 (duplicate column), so a plain ADD COLUMN would fail a re-run rather than skip it.
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS document JSONB;

-- The one thing worth constraining in the storage layer. A JSON array, string or number here would
-- crash every reader on its first property access; field-level validation belongs at the route, in a
-- zod schema, where a refusal can name the offending field.
DO $$ BEGIN
  ALTER TABLE venue_layouts ADD CONSTRAINT venue_layouts_document_object
    CHECK (document IS NULL OR jsonb_typeof(document) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Deliberately absent:
--   * No index. The column is only ever read whole, by layout id, which is already the primary key.
--   * No `document_schema` column. `(document->>'schemaVersion')::int` serves any future migrator's
--     WHERE clause, and one column beats two (Principle V).
--   * No id-counter column. Stable identity comes from storing the real `seats.id` inside the
--     document; negative values mean "minted in the editor, never persisted", the convention
--     `resolveRef` in layouts.repo.ts already implements.

COMMIT;
