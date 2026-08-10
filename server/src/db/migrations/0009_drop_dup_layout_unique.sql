-- 0009 — drop the redundant unique constraint 0008 added.
--
-- The pre-existing table already carried `venue_layouts_venue_id_name_key UNIQUE (venue_id, name)`,
-- so 0008's own `venue_layouts_venue_name_key` was a duplicate of the same rule under a second name.
-- One constraint, one error path.
ALTER TABLE venue_layouts DROP CONSTRAINT IF EXISTS venue_layouts_venue_name_key;
