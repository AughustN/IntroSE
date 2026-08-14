-- 0031 — An element can say which section it belongs to.
--
-- A shape drawn around a stand IS that stand: you draw the outline of Khu A, name it, and put the seat
-- blocks inside it. The editor has always let a shape be assigned to a section — the control is the same
-- one every block has — but there was nowhere to put the answer. `layout_elements` carried a
-- `category_id` (0027, for capacity zones) and no `section_id`, so the assignment survived only inside
-- `venue_layouts.document`.
--
-- That blob is deliberately dropped whenever geometry changes outside it — placing a table or reshaping
-- a standing area nulls it, and the next read re-adopts the document from these rows. So the first table
-- placed anywhere in the chart silently detached every shape from its section, with no error and nothing
-- in the UI to suggest it had happened.
--
-- Not restricted by kind, unlike `capacity` and `category_id`: a boundary can outline a section, a door
-- can lead into one, a bar can serve one. Restricting it would be inventing a rule the feature does not
-- have.

ALTER TABLE layout_elements ADD COLUMN IF NOT EXISTS section_id BIGINT;

-- ON DELETE SET NULL, not CASCADE: deleting a section must not delete the outline drawn around it. The
-- shape survives unassigned, which is a state the editor already renders and the validator ignores —
-- an element is decoration, so it is never what makes a chart unpublishable.
DO $$ BEGIN
  ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_section_fk
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Read on every chart open, alongside the layout_id filter the query already uses.
CREATE INDEX IF NOT EXISTS layout_elements_section_idx ON layout_elements (section_id);
