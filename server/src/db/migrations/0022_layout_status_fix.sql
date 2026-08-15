BEGIN;

-- Repair the `venue_layouts.status` CHECK, and make the draft/published distinction mean something.
--
-- 0007_seatmap.sql:17 declared CHECK (status IN ('draft', 'published')) and no later migration ever
-- altered it — but every writer in the codebase writes 'ready' (layouts.service.publish,
-- catalog.write.defaultLayoutId, seed-dev). On a database built fresh from 0007 the publish endpoint
-- therefore fails with 23514. It has not bitten anyone because 0007 uses CREATE TABLE IF NOT EXISTS
-- and the existing databases were created by an earlier definition with a looser constraint — the
-- same history 0008_seatmap_reconcile.sql documents.
--
-- The fix aligns the DATABASE to the shipped TypeScript union (`LayoutStatus = 'draft' | 'ready' |
-- 'archived'`) rather than renaming 'ready' to 'published' across the contract: the union is already
-- in `shared/`, already crossing the wire, and already what every consumer reads.
ALTER TABLE venue_layouts DROP CONSTRAINT IF EXISTS venue_layouts_status_check;
ALTER TABLE venue_layouts ADD CONSTRAINT venue_layouts_status_check
  CHECK (status IN ('draft', 'ready', 'archived'));

-- Any row written under the old vocabulary becomes the value the code actually uses.
UPDATE venue_layouts SET status = 'ready' WHERE status = 'published';

COMMIT;
