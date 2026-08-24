-- Floors, so a balcony can be a second level instead of a curved row drawn behind the stalls.
--
-- Closes item 6 of the NOTES in `shared/catalog/seatmap-starters.ts` — the last of the six, and the
-- only one that changes the buyer's renderer. "Ban công" in the theatre starter sits on the same
-- plane as the stalls today, because the model has nowhere to say otherwise.
--
-- WHY A FLOOR HANGS OFF A SECTION, not off a seat.
--
-- A seat's floor is never independently chosen: a section is a named part of a room ("Khu A",
-- "Ban công"), and a part of a room cannot straddle two levels. `seat_without_section` already
-- refuses to publish a seat with no section, so every publishable seat reaches a floor this way, and
-- decoration reaches one too — `layout_elements.section_id` exists for exactly that.
--
-- The payoff is on the buyer's side. `showtime_seats` carries no section column; the buyer learns a
-- seat's section through the snapshot's `sectionStyles`, keyed by NAME. Hanging the floor off the
-- section lets it ride that same key, so the buyer's map gains floors with NO new column on
-- `showtime_seats` and no change to the seat-generation path. Putting the floor on the seat would
-- have meant a column on `seats`, a matching one on `showtime_seats`, and a migration of both for
-- every showtime already selling.
--
-- FIRST-CLASS ROWS, NOT A LABEL ON THE SECTION.
--
-- The cheap alternative is `sections.floor_name TEXT` with floors derived as the distinct set. That
-- is precisely what rows were before 0032, and it failed there for the reasons it would fail here: a
-- floor with no sections yet cannot exist (so it cannot be created and then filled), a rename has to
-- rewrite every section that carries it, and display order has nowhere to live except repeated on
-- each row where two sections can disagree about it.
--
-- NULLABLE, and null is the behaviour every existing chart already has. A single-level venue never
-- has to say it is single-level: null means "the only floor", the editor shows no picker, the buyer
-- sees no strip, and best-available ranks across everything exactly as it does today. Same contract
-- as `focal_x`/`focal_y` in 0043 — the column gives an organizer a way to state something, it does
-- not impose an answer on charts that never needed the question.

CREATE TABLE IF NOT EXISTS layout_floors (
  id            BIGSERIAL PRIMARY KEY,
  layout_id     BIGINT NOT NULL REFERENCES venue_layouts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- Ground first. The buyer's strip reads bottom-up like a lift panel, which is the renderer's
  -- concern; stored order is plain ascending so the editor's list and the picker agree.
  display_order INT NOT NULL DEFAULT 0,
  CONSTRAINT layout_floors_name_len CHECK (char_length(name) BETWEEN 1 AND 40),
  -- Two floors of one chart may not share a name: the name is what the buyer picks by, and what the
  -- snapshot carries. Scoped to the layout, so two venues may both have a "Tầng 2".
  UNIQUE (layout_id, name)
);

CREATE INDEX IF NOT EXISTS idx_layout_floors_layout
  ON layout_floors(layout_id, display_order);

ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS floor_id BIGINT REFERENCES layout_floors(id) ON DELETE SET NULL;

-- ON DELETE SET NULL, not CASCADE: deleting a floor must never delete the seats standing on it.
-- A floor removed leaves its sections on the implicit single floor, which is a chart an organizer can
-- see and fix. Cascading would silently destroy inventory, including seats already sold.

CREATE INDEX IF NOT EXISTS idx_sections_floor ON sections(floor_id) WHERE floor_id IS NOT NULL;
