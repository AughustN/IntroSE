-- One venue row per real place, and a constraint that keeps it that way.
--
-- `createVenue` was an unconditional INSERT and the create-event wizard calls it with three free-text
-- fields, so every event held at the same address minted another row. The application half is fixed
-- (lookup-or-create); this is the half that cleans up what it already made and stops a concurrent
-- pair of requests slipping through the lookup.
--
-- "The same place" is defined here exactly as `SAME_TEXT` in catalog.write.ts and `dedupedVenues` in
-- the web client define it: trim, collapse internal whitespace, lowercase — scoped to the OWNER,
-- because a venue carries an edit permission and two organizers naming the same hall are two rows.
--
-- Ordering matters: the merge has to run before the index, or the index cannot be built.

DO $$
DECLARE
  loser  RECORD;
  keeper BIGINT;
BEGIN
  FOR loser IN
    WITH keyed AS (
      SELECT id, created_by,
             lower(regexp_replace(btrim(name),        '\s+', ' ', 'g')) AS n,
             lower(regexp_replace(btrim(city),        '\s+', ' ', 'g')) AS c,
             lower(regexp_replace(btrim(raw_address), '\s+', ' ', 'g')) AS a,
             -- The three tables that actually reference venues. `sections.venue_id` and
             -- `seats.venue_id` existed in 0002 but moved to `layout_id` in 0007, so they travel
             -- with their layout and are not listed.
             (EXISTS (SELECT 1 FROM events        e WHERE e.venue_id = venues.id)
           OR EXISTS (SELECT 1 FROM showtimes     s WHERE s.venue_id = venues.id)
           OR EXISTS (SELECT 1 FROM venue_layouts l WHERE l.venue_id = venues.id)) AS used
        FROM venues
    ),
    survivor AS (
      -- The lowest id something already points at; failing that, the lowest id. Both halves matter:
      -- "lowest id is the original" is the client's rule, and "never collapse away a row in use" is
      -- the one that stopped an organizer being offered an id nothing was built on.
      SELECT created_by, n, c, a, COALESCE(min(id) FILTER (WHERE used), min(id)) AS keep_id
        FROM keyed GROUP BY created_by, n, c, a
    )
    SELECT k.id AS from_id, s.keep_id AS to_id
      FROM keyed k
      JOIN survivor s
        ON s.created_by = k.created_by AND s.n = k.n AND s.c = k.c AND s.a = k.a
     WHERE k.id <> s.keep_id
     ORDER BY k.id
  LOOP
    keeper := loser.to_id;

    -- `venue_layouts` is UNIQUE (venue_id, name) (0007), so a chart moving to the survivor can
    -- collide with one already there. Suffix with the layout's own id rather than refusing: the id
    -- is unique by construction, and losing the merge over a name clash would leave the duplicate
    -- standing for a cosmetic reason.
    UPDATE venue_layouts l
       SET name = left(l.name, 180) || ' (#' || l.id || ')'
     WHERE l.venue_id = loser.from_id
       AND EXISTS (SELECT 1 FROM venue_layouts t
                    WHERE t.venue_id = keeper AND t.name = l.name);

    UPDATE venue_layouts SET venue_id = keeper WHERE venue_id = loser.from_id;
    UPDATE showtimes     SET venue_id = keeper WHERE venue_id = loser.from_id;
    UPDATE events        SET venue_id = keeper WHERE venue_id = loser.from_id;

    DELETE FROM venues WHERE id = loser.from_id;
  END LOOP;
END $$;

-- The half `createVenue`'s lookup cannot provide on its own: two simultaneous creates of the same
-- place both find nothing and both insert. With this the second one conflicts instead, and the
-- application turns that conflict back into the existing row.
--
-- Functional index: `btrim`, `regexp_replace` and `lower` are all IMMUTABLE, which is what makes the
-- expression indexable at all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_venues_owner_place
  ON venues (created_by,
             lower(regexp_replace(btrim(name),        '\s+', ' ', 'g')),
             lower(regexp_replace(btrim(city),        '\s+', ' ', 'g')),
             lower(regexp_replace(btrim(raw_address), '\s+', ' ', 'g')));
