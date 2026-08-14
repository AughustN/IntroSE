-- 0029 — Letting more than one person work on an organizer's charts.
--
-- Until now every refusal in the seatmap module reduced to one comparison: is the caller the user in
-- `venues.created_by`? That is correct and it is why the module has no authorization bugs, but it makes
-- an organizer a single person. A venue with a dedicated seat-map designer, or an assistant who may
-- look but not publish, cannot be expressed at all.
--
-- The grant is per OWNER rather than per venue or per chart, because that is the shape the existing
-- check already has: `assertOwn` compares user ids, so "who may act as this owner, and how far" slots
-- in beside it without rewriting the boundary that currently works.
--
-- Roles are ordered, not a set of flags — every level contains the one below:
--
--   viewer    read a chart, its history and its validation
--   designer  + draw: save, rename, create, clone, save as template, restore, tables, floor plans
--   manager   + decide: publish, archive, delete, and act on a showtime's live inventory
--
-- The owner is not a row here. They are the owner, and no grant can be revoked out from under them.
--
-- Nothing changes for anyone today: with no rows in this table every check resolves exactly as it did
-- before. Access is only ever ADDED by inserting a grant, never removed, so this migration cannot
-- widen what an existing account can reach.

CREATE TABLE IF NOT EXISTS chart_collaborators (
  owner_user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('viewer', 'designer', 'manager')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, member_user_id),
  -- Granting yourself access to your own charts is meaningless, and a self-row would imply the owner's
  -- rights come from a grant that could then be deleted.
  CHECK (owner_user_id <> member_user_id)
);

-- The lookup every guarded request makes: "what may this member do for this owner?"
CREATE INDEX IF NOT EXISTS chart_collaborators_member_idx
  ON chart_collaborators(member_user_id, owner_user_id);
