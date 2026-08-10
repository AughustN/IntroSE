-- 0010 — widen `layout_elements.kind` to the union of both vocabularies.
--
-- The pre-existing CHECK allowed (stage, aisle, door, label, area); feature 005 requires `bar`
-- (FR-016) and does not use `area`. Widening to the union is additive: nothing that was valid becomes
-- invalid, so no existing row or writer is affected, and both vocabularies keep working.
ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_kind_check;
ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_kind_check
  CHECK (kind IN ('stage', 'aisle', 'door', 'bar', 'label', 'area'));
