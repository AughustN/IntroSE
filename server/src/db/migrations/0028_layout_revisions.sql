-- 0028 — Version history for a chart, and the audit trail for what was done to it.
--
-- Two gaps this closes, both of them "the organizer cannot get back to where they were":
--
--  * Nothing recorded what a chart looked like before the last change. Draft recovery (localStorage)
--    protects UNSAVED work; this protects work that was saved and then made worse. The snapshot on a
--    showtime protects the SALE, not the chart.
--  * Nothing in the seatmap module wrote to `audit_logs` at all, so "who archived this and when" had
--    no answer.
--
-- A revision is taken at PUBLISH, not at every save. Publish is the moment the organizer declares a
-- chart finished, which makes it the checkpoint worth returning to; snapshotting every keystroke-level
-- save would bury the useful revisions among hundreds of intermediate ones and grow without bound.
--
-- Only the document is stored, not the projected rows. The document is the authoring intent, and
-- restoring it re-projects through the ordinary save path — which means a restore is subject to every
-- guard a normal save has, including the refusal to drop a seat somebody has bought.

CREATE TABLE IF NOT EXISTS layout_revisions (
  id          BIGSERIAL PRIMARY KEY,
  layout_id   BIGINT NOT NULL REFERENCES venue_layouts(id) ON DELETE CASCADE,
  -- The `venue_layouts.version` this document WAS, so a revision can be named to the organizer in the
  -- same terms the editor shows and a stale restore can be told apart from a fresh one.
  version     INT NOT NULL,
  document    JSONB NOT NULL,
  -- Denormalised for the list: showing history should not cost a projection per row.
  seat_count  INT NOT NULL DEFAULT 0,
  -- Nullable because a chart outlives the account that drew it; ON DELETE SET NULL keeps the history
  -- rather than deleting the evidence along with the user.
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(document) = 'object'),
  -- One revision per published version. Publishing twice without an edit in between should not add a
  -- second identical row.
  UNIQUE (layout_id, version)
);

-- The list query: newest first, for one chart.
CREATE INDEX IF NOT EXISTS layout_revisions_layout_idx
  ON layout_revisions(layout_id, created_at DESC);
