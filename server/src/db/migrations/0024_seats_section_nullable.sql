BEGIN;

-- Reconcile `seats.section_id` back to nullable, in the spirit of 0008_seatmap_reconcile.sql.
--
-- `0002_catalog.sql:55` declares it `BIGINT REFERENCES sections(id)` with no NOT NULL, and
-- `0007_seatmap.sql:119-121` states the intent outright: "section_id stays nullable, so a sectionless
-- seat is representable in draft and caught by validation, not by the constraint." The whole
-- `seat_without_section` validation rule exists because of that.
--
-- Some databases nevertheless carry a NOT NULL on the column — the same drift 0008 documents, where a
-- table predating the migration was created by hand and `CREATE TABLE IF NOT EXISTS` then skipped the
-- corrected definition. On such a database, placing a table or a standing area outside any section
-- fails with a raw 500 instead of the draft-then-validate flow the feature is built around.
--
-- Idempotent: dropping a NOT NULL that is not there is a no-op, not an error.
ALTER TABLE seats ALTER COLUMN section_id DROP NOT NULL;

COMMIT;
