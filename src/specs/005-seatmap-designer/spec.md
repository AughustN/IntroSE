# Feature Specification: Seat Map Designer

**Feature Branch**: `005-seatmap-designer`

**Created**: 2026-08-05

**Status**: Draft

**Input**: User description: "Seat map designer for TixHub (feature 005) — a real seat-map authoring
tool so each event reflects the actual shape of its venue instead of the uniform rectangular grid the
product renders today. Extends UC-21, closing A2 and A4. Depends on 001, 002, 003; independent of
checkout (004). Introduces a layout layer between venue and showtime; coordinates are the source of
truth; an uploaded floor plan is a background layer only. In scope: canvas drawing (place, drag,
multi-select, align, distribute, rotate, arc a row, delete), non-sellable elements, floor-plan upload
(magic-byte typed, SVG refused, re-encoded, uuid filename, nosniff — ADR-0004), background alignment,
inventory-checked map editing replacing the blanket 409, per-seat block/unblock, marquee tier
assignment, pre-publish validation, templates and cloning, and mandatory buyer-side parity in both
renderers with zoom/pan at 360–1920 px. Fixes the venue-wide seat uniqueness constraint. Out of scope:
ticket-tier CRUD and pricing (006); orders, tickets, refunds, check-in, revenue (007); admin
moderation (002); the hold algorithm itself (003)."

## Clarifications

### Session 2026-08-05

- Q: When an organizer edits a layout that several showtimes have already generated their bookable seats
  from, does the edit reach those showtimes automatically, or must each showtime opt in? → A: **Snapshot
  at generation, plus an explicit per-showtime re-apply.** Generating a showtime's seat map **copies**
  the layout into that showtime; from then on the showtime owns its map. A later layout edit changes only
  what *future* generations produce, until the organizer deliberately re-applies the layout to a chosen
  showtime — and that re-apply first shows what it would change, then runs the FR-028 inventory rules.
  A live reference was rejected: one tidy-up of a venue layout would silently reshape a show already on
  sale, and its refusals would come from a showtime the organizer was not thinking about.

- Q: Is an uploaded floor plan reachable by anyone holding its URL, or only by people the server checks?
  → A: **Public but unguessable — a static file under a random name, exactly as ADR-0004 serves
  avatars.** The buyer-visibility toggle (FR-026) governs whether the app *shows* the plan, not whether
  the file can be fetched. Chosen for consistency with a pattern already shipped and reviewed, and
  because routing every image fetch through the app costs an auth check per load and holds image bytes
  in a process already bounded at ~450 MB (PERF-07). The residual exposure is bounded and accepted: the
  name is unguessable, a floor plan is not personal data, and a URL only exists for someone the
  organizer already showed it to.

- Q: What exactly counts as two seats "overlapping", given a seat is stored as a point with a rotation?
  → A: **Centres closer than one seat width.** Every seat has the same fixed nominal diameter in layout
  units; two seats overlap when the distance between their centres is less than that diameter. One
  number, exact in integer coordinates, trivially testable, and it works unchanged for a straight row, a
  curved tier, and a round table without any per-seat geometry. **Rotation is cosmetic** — it turns how
  the seat is drawn, never its footprint. This also pins the coordinate space, which the spec had left
  unstated: **0–10,000 integer units on each axis, nominal seat diameter 100 units** (so ~100 seats fit
  edge-to-edge across a full-width layout, comfortably above the 2,000-seat ceiling).

- Q: Should floor-plan uploads and layout saves be rate-limited per organizer? → A: **Uploads yes, layout
  saves no.** The expensive operation is the image decode and re-encode, in a process bounded at ~450 MB
  (PERF-07) on the same VPS that serves the live seat map; so uploads carry a per-organizer rate limit
  *and* a cap on how many images are processed at once. A layout save is a bounded write already capped
  at 2,000 seats, and throttling it would fight the save-and-iterate rhythm the editor is built around.
  This mirrors feature 003's FR-017: bound the abusable path, leave normal work alone.

- Q: Must a buyer who cannot use a mouse still be able to pick a specific seat once the map is a
  free-form canvas? → A: **Yes — every seat stays individually focusable and labelled.** Tab order runs
  section → row → number; each seat announces its identity, status, and price; zoom and pan are reachable
  from the keyboard. Today's grid of buttons has this by accident, and drawing seats at arbitrary
  coordinates would silently destroy it — nothing in PLAT-01 or the test suite would notice. This is the
  cheap version: the renderer draws real focusable elements rather than a bitmap canvas. No separate
  non-visual seat list is built, and no formal WCAG conformance level is claimed here.

### Session 2026-08-05 (decided in-spec; confirm or overturn in `/speckit-clarify`)

- Q: Does a layout belong to the venue or to the event? → A: **To the venue.** One venue owns many
  named layouts ("Nhạc hội đứng", "Kịch có ghế ngồi", "Workshop chữ U"); a showtime *picks* one and only
  then generates its bookable `showtime_seats`. Owning layouts at the event level would force a venue to
  be duplicated per event and would break venue reuse (UC-20 step 5), which the whole feature exists to
  avoid. Layouts are still organizer-scoped, because venues are (schema D-F, UC-21 A5).
- Q: Free coordinates or snap-to-grid? → A: **Free coordinates, with snap-to-grid on by default and a
  one-click toggle off.** The stored value is always a free coordinate — snapping is an input aid, never
  a storage constraint. This keeps a curved tier and a round table expressible (free) while making the
  common case, a straight row, effortless (snap). A grid-only model cannot express the arc tool, which
  is in scope.
- Q: Do buyers see the uploaded floor plan? → A: **Only if the organizer turns it on; default off.** The
  plan is a tracing aid first. An organizer who has aligned it well may publish it as a background for
  buyers, but it is never required, never affects seat status, and never carries clickable geometry
  (Principle I: the database decides, not the picture).
- Q: May one showtime mix seated and standing? → A: **A showtime stays either seated or general
  admission, exactly as today — but a *seated* layout may contain seats of type `standing`.** Each such
  seat is still one row in `showtime_seats`, individually held and sold, so feature 003's invariant
  ("a reservation is either seated or GA, never mixed", FR-012) is untouched. A true standing *area*
  sold by quantity remains a GA tier with no geometry; it may be drawn as a non-sellable zone element
  for orientation only. This is the simplest option that adds no new inventory model (Principle V).
- Q: What are the ceilings? → A: **2,000 seats and 200 non-sellable elements per layout; 20 layouts per
  venue; 5 MB and 4,000 px on the long edge for a floor-plan upload; 50 undo steps.** 2,000 seats covers
  the largest venue realistically in scope for this build and keeps both the editor canvas and the
  buyer map inside PLAT-01/PERF-02. 5 MB is ADR-0004's avatar cap raised for the extra detail a floor
  plan carries; the file is re-encoded, so the *stored* size is far smaller.
- Q: Do sections stay venue-scoped or move to the layout? → A: **They move to the layout.** Seats belong
  to a layout, and seat uniqueness becomes per-section; if sections stayed venue-wide, two layouts of one
  venue could not both have a "Khu A", and cloning a layout would not be self-contained. Section names
  are unique within a layout.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Draw a layout that matches the real venue (Priority: P1)

An organizer opens the designer for one of their venues, seeds a layout with the fast Section / Row /
Count generator, then refines it by hand on a canvas: dragging seats where they actually are, selecting
a row and curving it along an arc, aligning and distributing a block, rotating seats to face the stage,
and deleting the ones that do not exist. They can undo mistakes and save the work as a draft to finish
later.

**Why this priority**: This is the feature. Without an authoring surface that stores geometry, nothing
downstream — the buyer map, the floor plan, validation, blocking — has anything to render or check.
Every other story reads or refines what this one produces.

**Independent Test**: As an organizer, create a layout for your own venue, generate 3 rows of 10 seats,
drag one seat to a new position, curve one row along an arc, delete two seats, undo the deletion, and
save as draft. Reopen the layout and confirm every seat is exactly where you left it. Requires only
feature 002's venue and section data.

**Acceptance Scenarios**:

1. **Given** an organizer viewing one of their own venues, **When** they create a named layout, **Then**
   an empty draft layout exists for that venue with its own coordinate space, and the venue's other
   layouts are unaffected.
2. **Given** an empty draft layout, **When** the organizer runs the Section / Row / Count generator,
   **Then** seats are created in that section with positions laid out on a regular grid, ready to be
   moved — the generator seeds geometry, it does not replace the canvas.
3. **Given** a layout with seats, **When** the organizer drags a seat, **Then** its stored position
   changes and nothing else about the seat (label, section, type) changes.
4. **Given** several seats selected with a marquee, **When** the organizer aligns, distributes, or
   rotates them, **Then** every selected seat's position (and rotation) updates together in one step
   that a single undo reverses.
5. **Given** a selected row of seats, **When** the organizer curves them along an arc, **Then** the seats
   are repositioned along that arc in their existing order, keeping their labels and numbering.
6. **Given** an organizer who has made several edits, **When** they undo repeatedly and then redo,
   **Then** the canvas returns exactly through the states they passed, up to the undo depth.
7. **Given** unsaved canvas work, **When** the organizer saves a draft and later reopens it, **Then**
   the layout is exactly what they saved — position, rotation, labels, sections, and elements.
8. **Given** a layout at the seat ceiling, **When** the organizer adds another seat, **Then** the
   addition is refused with a clear reason and the existing layout is untouched.
9. **Given** an organizer opening the designer for a venue they do not own, **When** the request is
   made, **Then** it is refused — not shown as an empty canvas.

---

### User Story 2 - Buyers see the real shape of the room (Priority: P1)

An attendee opening a seated showtime sees the map the organizer actually drew — the stage where it is,
the aisles, the curve of the balcony — instead of an identical grid of rows. They can zoom and pan
around it, on a 360 px phone as well as a 1920 px desktop.

**Why this priority**: Ships with US1 and is not optional. A layout stored but not rendered is invisible
to every buyer, and the product keeps showing the uniform grid — the exact problem this feature exists
to fix. It is also the contract-integrity half of the change (Principle VI): the seat-map read payload
gains geometry, so the API and both renderers move together or not at all.

**Independent Test**: Publish a showtime bound to a non-rectangular layout, open the event detail page
and the seat-selection screen as an attendee, and confirm both draw seats at their authored positions
with the stage and aisles visible; zoom and pan; repeat at 360, 768, and 1920 px with no horizontal
page scroll.

**Acceptance Scenarios**:

1. **Given** a showtime bound to an authored layout, **When** an attendee opens the read-only preview map
   on the event page, **Then** seats are drawn at their authored positions and rotations, not grouped
   into flex rows by label.
2. **Given** the same showtime, **When** the attendee opens the interactive seat-selection screen,
   **Then** it renders from the same coordinates and the same payload as the preview — the two never
   disagree about where a seat is.
3. **Given** a large map on a small screen, **When** the attendee zooms and pans, **Then** they can reach
   every seat, and at 360 / 768 / 1920 px there is no horizontal page scroll and every control stays
   reachable.
4. **Given** an attendee using only a keyboard, **When** they tab through the map, **Then** they reach
   every seat in section → row → number order, hear its identity, status, and price, can select one with
   the keyboard alone, and can zoom and pan without a pointer.
5. **Given** a rendered map, **When** the attendee selects a seat, **Then** holding behaves exactly as
   feature 003 already defines it — geometry changes where a seat is drawn, never whether or how it can
   be held.
6. **Given** a general-admission showtime, **When** the attendee opens it, **Then** there is no seat map
   and tier remaining is shown as today — this feature adds nothing to the GA path.
7. **Given** a showtime whose layout has a buyer-visible floor plan, **When** the map renders, **Then**
   the plan is drawn behind the seats at its saved scale, offset, and opacity, and no part of it is
   clickable or capable of changing a seat's shown status.

---

### User Story 3 - Correct a live map without breaking inventory (Priority: P1)

An organizer notices a mistake in a map that is already on sale — a seat in the wrong place, a row that
should not exist — and fixes it, either directly on that showtime's map or by correcting the source
layout and re-applying it to that one showtime. The system allows every change that is safe and refuses,
with a specific reason, exactly those that would take a seat away from someone who already holds or
bought it.

**Why this priority**: Today a map can be generated once and never corrected (`409 seat_map_exists`),
which is the blocker organizers hit first and the reason UC-21 A2 and A4 were left open. Ship this with
US1 or the authoring tool is write-once and no better than what exists.

**Independent Test**: Generate a seat map for a showtime, sell one seat, have a second user hold another,
leave a third available. Then move all three, retier all three, and delete all three, asserting: the
available seat accepts every change; the sold seat accepts only the position change; the held seat is
refused with a reason naming the live hold.

**Acceptance Scenarios**:

1. **Given** a showtime that already has a generated seat map, **When** the organizer edits that map,
   **Then** the edit is evaluated seat by seat and applied — it is never refused wholesale just because
   a map exists.
2. **Given** an organizer who has changed the source layout, **When** they re-apply it to one chosen
   showtime, **Then** they first see exactly what would change, and nothing runs until they confirm;
   other showtimes generated from the same layout are unaffected.
3. **Given** a seat that is `available` (or `blocked`), **When** the organizer moves, relabels, retiers,
   reassigns, or deletes it, **Then** the change succeeds.
4. **Given** a seat that is `sold`, **When** the organizer changes only its position or rotation,
   **Then** the change succeeds — the buyer's ticket still points at the same seat.
5. **Given** a seat that is `sold`, **When** the organizer tries to delete it, change its label or
   section, or move it to a different ticket tier, **Then** the change is refused with a reason naming
   the sale, and no part of the submitted edit is silently dropped.
6. **Given** a seat under a live hold from feature 003, **When** the organizer tries to change it in any
   way, **Then** the change is refused with a reason naming the active hold and telling the organizer it
   can be retried once the hold lapses; the buyer's hold is never cancelled to make room for the edit.
7. **Given** an edit that touches both a permitted and a refused seat, **When** it is submitted, **Then**
   the whole edit is rejected and the map is left exactly as it was — no partial application.
8. **Given** a refused edit, **When** the organizer reads the response, **Then** it names which seats
   were refused and why, so they can adjust rather than guess.

---

### User Story 4 - Trace an uploaded floor plan (Priority: P2)

An organizer who has a floor-plan image from the venue uploads it, scales and nudges it until it lines
up with the canvas, and places seats on top of it — then decides whether buyers see it too.

**Why this priority**: Tracing is what makes an irregular real venue quick to author rather than an hour
of dragging. It is a large convenience over US1, not a precondition for it: an organizer can draw a
correct map from scratch without ever uploading anything.

**Independent Test**: Upload a JPEG floor plan, set its scale, offset, and opacity so a doorway lines up,
place seats over it, save, reopen and confirm the alignment persisted. Then attempt to upload an SVG and
a `.png`-named text file and confirm both are refused.

**Acceptance Scenarios**:

1. **Given** an organizer editing their layout, **When** they upload a JPEG, PNG, or WebP floor plan
   within the size limit, **Then** it is accepted, stored, and shown behind the canvas.
2. **Given** an uploaded plan, **When** the organizer changes its scale, offset, or opacity, **Then**
   the background moves under the seats and the seats themselves do not move.
3. **Given** an organizer uploading an SVG, **When** the upload is submitted, **Then** it is refused
   regardless of what the file is named or what content type is declared.
4. **Given** a file whose real content is not a JPEG/PNG/WebP (e.g. an executable renamed `plan.png`, or
   a declared `image/png` that is not one), **When** it is uploaded, **Then** it is refused — the
   decision is made from the file's own bytes, never its name or declared type.
5. **Given** an accepted upload, **When** it is stored and later served, **Then** it carries none of its
   original metadata, is stored under a name unrelated to the uploaded filename, and is served in a way
   that forbids the browser from re-interpreting its type.
6. **Given** a layout with a plan, **When** the organizer replaces or removes it, **Then** the previous
   image is no longer reachable and the seats are unchanged.
7. **Given** a plan and a set of seats, **When** the plan is removed, **Then** every seat keeps its exact
   position — the picture never owned the geometry.
8. **Given** a floor plan, **When** the organizer toggles buyer visibility on and off, **Then** the
   buyer-facing map shows or hides it accordingly and seat status is identical either way.

---

### User Story 5 - Mark the parts of the room that are not for sale (Priority: P2)

An organizer adds the stage, aisles, doors, the bar, and free-text labels to the layout, so the map reads
like the room. None of these can ever be bought.

**Why this priority**: Orientation is most of what makes a map legible to a buyer — a grid of seats with
no stage does not tell anyone where the front is. It layers cleanly on top of US1 and blocks nothing.

**Independent Test**: Add a stage, two aisles, a door, and a text label to a layout, save, generate the
showtime's seat map, and confirm the ticket inventory count is exactly the seat count — the five elements
appear on the buyer map and in no tier, no capacity figure, and no seat list.

**Acceptance Scenarios**:

1. **Given** a layout, **When** the organizer adds a stage, aisle, door, bar, or text label, **Then** it
   is placed with its own position, size, and rotation and is visually distinct from a seat.
2. **Given** a layout containing non-sellable elements, **When** the showtime's bookable seats are
   generated, **Then** the number generated equals the number of seats and no element produces one.
3. **Given** a non-sellable element, **When** anyone attempts to hold, block, price, or assign a tier to
   it, **Then** there is nothing to act on — elements are not addressable as inventory.
4. **Given** a text label containing markup or script-like characters, **When** it is shown on the
   organizer canvas or the buyer map, **Then** it is displayed as literal text and never interpreted.
5. **Given** a layout at the element ceiling, **When** another element is added, **Then** it is refused
   with a clear reason.

---

### User Story 6 - Catch a broken map before it goes on sale (Priority: P2)

Before publishing, the organizer runs validation and sees a specific list of what is wrong — seats on top
of each other, two seats with the same label, a seat in no section, a section with no ticket tier, a map
with no capacity — and cannot publish until each is fixed.

**Why this priority**: A map that is wrong at publish time becomes wrong tickets and refund work, and
those cost far more than a validation pass. It is P2 rather than P1 only because an organizer can be
careful without it; the system should not rely on that.

**Independent Test**: Build a layout with one overlapping pair, one duplicate label, and one sectionless
seat; attempt to publish; confirm publishing is blocked and all three are reported by identity, not as a
single generic error. Fix them and confirm publishing proceeds.

**Acceptance Scenarios**:

1. **Given** a layout with two seats occupying the same space, **When** validation runs, **Then** the
   overlapping pair is reported and publishing is blocked.
2. **Given** two seats in one section with the same row label and number, **When** validation runs,
   **Then** the duplicate is reported and publishing is blocked.
3. **Given** a seat that belongs to no section, **When** validation runs, **Then** it is reported and
   publishing is blocked.
4. **Given** a section containing seats but assigned no ticket tier for the showtime, **When** validation
   runs, **Then** it is reported and publishing is blocked.
5. **Given** a layout with zero seats, **When** the organizer tries to bind it to a seated showtime and
   publish, **Then** it is blocked for zero capacity.
6. **Given** a layout with several distinct problems, **When** validation runs, **Then** every problem is
   reported in one pass with the seats or sections it concerns — not one error at a time.
7. **Given** a layout that passes every check, **When** validation runs, **Then** it reports clean and
   publishing is permitted.

---

### User Story 7 - Fine-grained inventory control on the map (Priority: P3)

An organizer working on a live showtime's map picks a seat that broke, a seat the sound desk occupies, or
a seat they are comping, and blocks it; and marquee-selects a wedge of the balcony to put it all on one
ticket tier in a single action.

**Why this priority**: Both are today only reachable — if at all — through section-wide operations, so
the MVP works without them. They are what turns the map from a picture into the organizer's actual
control surface, which is why they belong in this feature rather than a later one.

**Independent Test**: On a live showtime map, block one available seat and confirm buyers can no longer
select it and it is excluded from remaining capacity; unblock it and confirm it returns. Marquee-select
12 seats spanning two sections and assign them a tier; confirm all 12 carry the new tier and price.

**Acceptance Scenarios**:

1. **Given** an `available` seat on a live map, **When** the organizer blocks it, **Then** it becomes
   unselectable for buyers, is excluded from available capacity, and viewers see the change live.
2. **Given** a `blocked` seat, **When** the organizer unblocks it, **Then** it returns to `available` and
   viewers see the change live.
3. **Given** a `held` or `sold` seat, **When** the organizer tries to block it, **Then** it is refused
   with a reason — blocking never takes a seat from someone who has it.
4. **Given** a marquee selection of seats, **When** the organizer assigns a ticket tier, **Then** every
   selected seat that is not `sold` takes that tier and its price, regardless of section.
5. **Given** a marquee selection containing a `sold` seat, **When** a tier is assigned, **Then** the
   action is refused and identifies the sold seat, rather than silently repricing a ticket someone owns.
6. **Given** an existing per-section tier assignment, **When** the organizer uses it, **Then** it still
   works — marquee assignment is an addition, not a replacement.

---

### User Story 8 - Reuse a layout instead of redrawing it (Priority: P3)

An organizer saves a finished layout as a template, and starts the next venue or showtime from a copy of
one they already have, rather than from an empty canvas.

**Why this priority**: Pure time saving for a repeat organizer. Everything works without it, and it is
meaningful only once an organizer has several layouts, so it is last.

**Independent Test**: Save a layout as a template; create a new layout in a different venue you own by
cloning it; confirm every seat, element, section, and the background alignment came across, and that
editing the clone leaves the original untouched.

**Acceptance Scenarios**:

1. **Given** a valid layout, **When** the organizer saves it as a template, **Then** it is available to
   start new layouts from.
2. **Given** a template or an existing layout, **When** the organizer clones it into another of their
   venues, **Then** the new layout has the same seats, sections, elements, and background alignment, as
   an independent draft.
3. **Given** a clone, **When** the organizer edits it, **Then** the source layout is unchanged, and vice
   versa — a clone is a copy, never a live link.
4. **Given** a layout belonging to another organizer, **When** an organizer tries to clone it, **Then**
   it is refused — layouts follow venue ownership.
5. **Given** a cloned layout, **When** it is bound to a showtime, **Then** its seats generate bookable
   seats exactly as an authored layout does; a clone carries no sales, holds, or blocks from its source.

---

### Edge Cases

- **A layout bound to a live showtime is deleted**: refused. A layout with any generated seat map on a
  showtime that is not `finished` or `cancelled` cannot be deleted; the organizer archives it instead.
- **Two seats at exactly the same coordinates**: allowed while drafting (dragging naturally passes
  through overlap), reported by validation, and blocking at publish. Draft is permissive, publish is not.
- **A seat dragged outside the layout's coordinate space**: clamped to the space's bounds on save; a
  layout never stores an out-of-range position.
- **Concurrent edits by two organizer sessions on one layout**: the second save is refused as stale and
  the organizer reloads — layout saves do not silently overwrite each other.
- **The showtime's seat map is generated while the layout is still a draft**: refused. Only a layout that
  passes validation may be bound to a showtime and generate bookable seats.
- **A layout edited after a showtime already generated from it**: the showtime's map is untouched — it
  is a snapshot. The edit reaches that showtime only when the organizer re-applies the layout to it, and
  then under the US3 inventory rules. Showtimes that are `finished` or `cancelled` are never re-appliable.
- **Re-apply that would delete a sold seat**: refused whole, like any other edit (FR-029); the preview
  shows the conflict before anything runs, so the organizer is never surprised by the refusal.
- **Re-apply of a layout that has drifted far from the showtime's map**: still one confirmation on one
  preview — there is no partial or seat-by-seat re-apply.
- **A seat's hold expires between the refusal and a retry**: the retried edit now succeeds — the check is
  made against live inventory at the moment of the edit, not a cached snapshot.
- **Undo across a save**: undo history is per editing session and does not reach back past a save into
  another session's work; reopening a layout starts a fresh history.
- **Upload of a valid image that decodes to enormous dimensions** (decompression bomb): refused on
  dimension as well as byte size, before any re-encode.
- **Upload succeeds but the layout save later fails**: the orphaned image is not referenced by any layout
  and is cleaned up; it is never served.
- **Organizer uploads repeatedly in quick succession**: throttled with a clear "try again shortly"
  message rather than silently queued or dropped; no partly-processed image is ever attached to a layout.
- **Floor plan removed while buyers are viewing**: the next render simply has no background; no seat
  changes status and no viewer is disconnected.
- **Someone shares a floor-plan URL from a layout whose buyer visibility is off**: the image still opens
  — the file is unguessable, not access-controlled (FR-026a). This is a known and accepted bound, and the
  organizer is told so at upload time rather than discovering it.
- **Arc applied to a single seat or to a selection with no order**: treated as a no-op rather than an
  error; the arc tool needs at least two ordered seats.
- **Rotating a seat by a value outside 0–359**: normalised into range rather than refused.
- **Two seats exactly one diameter apart**: touching, not overlapping — the rule is *less than* one
  diameter, so a tight but legitimate theatre row stays publishable.
- **A round table of seats facing inward**: every seat rotated differently but no two centres within a
  diameter — publishes cleanly, because rotation never enters the overlap test.
- **A section emptied of all its seats**: allowed in draft; validation reports it only if the showtime
  assigns it a tier or a buyer-facing label depends on it.
- **Existing venues that already have seats under the old model**: each is migrated into one auto-created
  default layout, so no existing showtime's map breaks; positions are seeded from the current row/number
  grid, which is exactly what buyers see today.
- **A GA showtime pointed at a layout**: refused — layouts bind only to seated showtimes.
- **Text label in Vietnamese with diacritics, or an emoji**: stored and displayed intact; label length is
  bounded and content is escaped, never interpreted.

## Requirements *(mandatory)*

### Functional Requirements

**Layouts (the new layer)**

- **FR-001**: System MUST let an organizer create, rename, list, and delete named **seat layouts**
  belonging to one of **their own** venues; a venue MAY own several layouts and a layout name MUST be
  unique within its venue.
- **FR-002**: Seats MUST belong to a **layout**, not directly to a venue; **sections** MUST likewise
  belong to a layout, with section names unique within the layout.
- **FR-003**: A seat's row label and number MUST be unique **within its section**, replacing today's
  venue-wide uniqueness, so two sections in one venue may both contain "row A seat 1".
- **FR-004**: A layout MUST have a status of **draft** or **published**; only a layout that passes
  validation (FR-030) may become published.
- **FR-005**: A **seated showtime** MUST select exactly one published layout, and generating its bookable
  seats MUST **snapshot** that layout — copying its seats, sections, elements, and background settings
  into the showtime's own map and producing exactly one bookable seat per layout seat. From that moment
  the showtime owns its map: later edits to the source layout MUST NOT reach it except through the
  explicit re-apply of FR-027a. A general-admission showtime MUST NOT be bound to a layout.
- **FR-006**: System MUST refuse to delete a layout that any showtime which is not `finished` or
  `cancelled` has generated a seat map from, so the source of a live map stays inspectable and
  re-appliable.
- **FR-007**: System MUST cap a venue at **20** layouts and a layout at **2,000** seats, refusing
  additions past either bound with a clear reason.

**Geometry & drawing**

- **FR-008**: Every seat MUST carry a **position and rotation** in its layout's own coordinate space, and
  that geometry MUST be the single source of truth for how the seat is drawn everywhere. The coordinate
  space MUST be **0–10,000 integer units on each axis**, and every seat MUST share one **nominal
  diameter of 100 units**. Rotation MUST be cosmetic: it changes how a seat is drawn, never its footprint
  or its overlap behaviour.
- **FR-009**: Organizers MUST be able to **place**, **drag**, **multi-select** (including by marquee),
  **align**, **distribute**, **rotate**, **arc along a curve**, and **delete** seats on a canvas.
- **FR-010**: The existing **Section / Row / Count** generator MUST be kept as the fast first step,
  seeding seats with positions that are then editable by hand; it MUST NOT be the only way to create
  seats and MUST NOT overwrite existing seats without the organizer saying so.
- **FR-011**: The canvas MUST offer **snap-to-grid on by default with a toggle to disable it**; snapping
  MUST affect only input, never the stored coordinate model.
- **FR-012**: System MUST provide **undo and redo** across at least **50** steps within an editing
  session; a multi-seat operation MUST undo as one step.
- **FR-013**: Organizers MUST be able to **save a layout as a draft** and resume it later with the canvas
  in exactly the state it was saved.
- **FR-014**: A seat position outside the layout's coordinate space MUST be clamped into range on save;
  a stored position MUST always be in range. A rotation MUST be normalised into 0–359 degrees.
- **FR-015**: Concurrent saves to one layout MUST NOT silently overwrite each other; a save against a
  stale version MUST be refused and the organizer told to reload.

**Non-sellable elements**

- **FR-016**: Organizers MUST be able to place **stage**, **aisle**, **door**, **bar**, and **free text
  label** elements, each with its own position, size, and rotation.
- **FR-017**: Non-sellable elements MUST be stored **separately from seats** and MUST NEVER enter ticket
  inventory: they cannot be held, sold, blocked, priced, counted in capacity, or assigned a tier.
- **FR-018**: Element text MUST be length-bounded and **output-encoded** wherever it is displayed
  (organizer canvas and buyer map), never rendered as markup (SEC-07).
- **FR-019**: System MUST cap a layout at **200** non-sellable elements.

**Floor-plan background**

- **FR-020**: Organizers MUST be able to upload one floor-plan image per layout as a **background layer
  only**. It MUST NEVER create, move, name, or delete a seat, and MUST NEVER determine or influence a
  seat's status (Principle I).
- **FR-021**: Uploads MUST accept only raster **JPEG, PNG, and WebP**, decided by the file's **own
  bytes** — never its declared content type or its extension — and MUST **refuse SVG outright**.
- **FR-022**: Accepted uploads MUST be **re-encoded** so that original metadata and any embedded payload
  are discarded, MUST be stored under a **random identifier unrelated to the uploaded filename**, and
  MUST be served in a way that forbids content-type sniffing.
- **FR-023**: Uploads MUST be bounded at **5 MB** and **4,000 px on the long edge**; an image exceeding
  either MUST be refused before re-encoding.
- **FR-023a**: Floor-plan uploads MUST be **rate-limited per organizer** and the number of images being
  decoded or re-encoded at once MUST be **capped**, so that image processing cannot push the server past
  its memory ceiling (PERF-07) while it is also serving the live seat map. Layout saves are NOT rate
  limited: they are bounded writes and throttling them would obstruct normal editing.
- **FR-024**: Organizers MUST be able to set the background's **scale, offset, and opacity**, and these
  MUST be persisted with the layout and applied identically wherever the plan is drawn.
- **FR-025**: Replacing or removing a floor plan MUST make the previous image unreachable and MUST leave
  every seat's geometry unchanged.
- **FR-026**: Whether **buyers** see the floor plan MUST be an organizer-controlled setting, **default
  off**; when on, the plan is drawn behind the seats and is never interactive. This setting governs
  **display**, not file reachability (FR-026a).
- **FR-026a**: A stored floor plan MUST be served as a static file under its unguessable random name,
  with no per-request access check — the same treatment ADR-0004 gives avatars. Turning buyer visibility
  off MUST remove the plan from the buyer map but MUST NOT be presented to the organizer as making the
  file unreachable; the upload surface MUST say plainly that anyone given the link can open the image.

**Map lifecycle & inventory safety**

- **FR-027**: System MUST allow editing a showtime's **already-generated** seat map, replacing today's
  blanket refusal; the edit MUST be evaluated **per affected seat** against that showtime's live
  inventory. Editing the **source layout** MUST always be permitted and MUST never be gated on any
  showtime's inventory, because the layout no longer drives a generated map (FR-005).
- **FR-027a**: Organizers MUST be able to **re-apply** a layout to one chosen showtime that already has a
  generated map. Re-apply MUST first present **what it would change** (seats added, moved, relabelled,
  retiered, removed) and MUST run only on confirmation, under the same per-seat rules as FR-028. Re-apply
  MUST target one showtime at a time — a layout edit MUST NEVER reach a generated map implicitly.
- **FR-028**: Per-seat rules — a seat that is `available` or `blocked` MAY be freely moved, relabelled,
  re-sectioned, retiered, or deleted; a seat that is **`sold`** MAY have only its **position and
  rotation** changed and MUST NOT be deleted, relabelled, re-sectioned, or moved to a different ticket
  tier; a seat under a **live hold** from feature 003 MUST be refused **any** change, with a reason
  naming the hold. A held seat MUST NEVER be released to permit an organizer's edit.
- **FR-029**: An edit containing any refused seat MUST be rejected **whole** — the map MUST NOT be left
  partially applied — and the refusal MUST identify which seats were refused and why.

**Validation**

- **FR-030**: Before a layout may be published or bound to a showtime, system MUST report, in one pass,
  each of: **overlapping seats**, **duplicate labels within a section**, **seats belonging to no
  section**, **a section with seats but no ticket tier**, and **zero capacity** — and MUST **block
  publishing** while any is present.
- **FR-030a**: Two seats **overlap** when the distance between their centres is **less than one nominal
  seat diameter** (FR-008). This is the whole rule: it applies identically to straight rows, curved
  tiers, and round tables, and rotation never affects it.
- **FR-031**: Validation MUST identify the specific seats or sections at fault, not report a single
  generic failure — for an overlap, the **pair** of seats involved.
- **FR-032**: A **draft** layout MAY hold states validation rejects (e.g. transient overlap while
  dragging); the gate is at publish, not at every keystroke.

**Inventory controls on the map**

- **FR-033**: Organizers MUST be able to **block and unblock an individual seat** directly on a live
  showtime's map; blocking MUST exclude the seat from available capacity and MUST be refused on a `held`
  or `sold` seat.
- **FR-034**: Organizers MUST be able to assign a **ticket tier to a marquee selection of seats** across
  sections, in addition to the existing per-section assignment; a selection containing a `sold` seat MUST
  be refused rather than silently repricing an owned ticket.
- **FR-035**: A block, unblock, or tier change on a live map MUST reach viewers of that showtime through
  the existing live seat channel, within the same bound feature 003 already meets. A block or unblock is
  carried as the seat's new **status**; a tier change is carried as the seat's new **tier label and
  price** on that same per-seat entry. No new socket event is introduced, and no geometry is ever
  broadcast (FR-041).

**Reuse**

- **FR-036**: Organizers MUST be able to save a layout as a **template** and to **clone** a layout or
  template into another venue they own; a clone MUST be an independent copy of the seats, sections,
  elements, and background alignment, carrying no sales, holds, or blocks.
- **FR-037**: Cloning a layout the organizer does not own MUST be refused.

**Buyer-side rendering (mandatory parity)**

- **FR-038**: Both buyer-facing seat renderers — the read-only preview on the event page and the
  interactive seat-selection screen — MUST draw seats from the layout's **coordinates and rotations**,
  and MUST NOT group seats into rows by label. Neither may keep the uniform-grid rendering.
- **FR-039**: The buyer map MUST support **zoom and pan**, and MUST meet PLAT-01 at **360, 768, and
  1920 px** with no horizontal page scroll and every interactive element reachable.
- **FR-039a**: Every seat on the buyer map MUST remain **individually focusable and selectable from the
  keyboard**, in a tab order of section → row → number, and MUST expose its identity, status, and price
  to assistive technology (e.g. "Khu A, hàng B, ghế 12, còn trống, 250.000đ"). Zoom and pan MUST also be
  keyboard-reachable. Moving to coordinate-based drawing MUST NOT reduce the non-visual reach the
  current grid provides.
- **FR-040**: The buyer map MUST draw the non-sellable elements, and the floor plan when the organizer
  has made it buyer-visible, behind the seats. Non-sellable elements MUST NOT enter the seat tab order.
- **FR-041**: Adding geometry MUST NOT change how a seat is held, released, or sold; feature 003's hold
  path, `showtime_seats`, and its live-update payload MUST remain **layout-independent** — the live
  payload MUST NEVER carry geometry, which is static per map and belongs to the map read. It MAY carry a
  seat's ticket tier and price, because an organizer can change those on a live map (FR-035). That
  addition is optional and additive: every existing feature 003 consumer and test MUST be unaffected by
  it.

**Access, contract & integrity**

- **FR-042**: Every layout, seat, element, upload, and validation endpoint MUST be scoped **on the
  server** to the owning organizer; acting on another organizer's venue, layout, seat, or upload MUST be
  a **refusal**, not a filtered-out result (SEC-04).
- **FR-043**: Every input MUST be validated against a strict schema before use, and all organizer- and
  buyer-visible text (section names, row labels, element labels) MUST be output-encoded (SEC-07).
- **FR-044**: The seat-map **read contract is shared by the API and both renderers**; the contract, the
  API, and both renderers MUST be updated in the same change, with no side re-declaring the payload
  (Principle VI).
- **FR-045**: Seat-map reads MUST stay within the platform's standard read/write response bound
  (PERF-02) at a full 2,000-seat layout.
- **FR-046**: All prices surfaced alongside seats MUST remain whole Vietnamese đồng integers, and the
  user-facing language MUST be Vietnamese.

### Key Entities *(include if feature involves data)*

- **Seat Layout**: a named arrangement of one venue — its coordinate space, its status (draft or
  published), its background settings, and whether it is offered as a template. A venue owns several; a
  seated showtime selects one. This is the new layer that lets one venue host a standing concert, a
  seated play, and a U-shaped workshop without being duplicated.
- **Section** (moved): a named area *within a layout* ("Khu A", "Balcony", "VIP Front") grouping seats
  for pricing and labelling. Names are unique within the layout.
- **Seat** (extended): a physical seat in a layout — its section, row label, number, and type, plus its
  **position and rotation** in the layout's coordinate space. Unique by row label and number within its
  section. Position is what every renderer reads.
- **Layout Element**: a non-sellable part of the room — stage, aisle, door, bar, or free text label —
  with position, size, rotation, and (for a label) text. Stored apart from seats precisely so it can
  never become inventory.
- **Floor Plan Background**: an uploaded raster image attached to a layout, with its scale, offset,
  opacity, and buyer visibility. A tracing and orientation aid only; it holds no seat and no status.
- **Layout Template**: a layout marked reusable, from which a new independent layout can be cloned into
  another venue the organizer owns.
- **Showtime Seat Map**: a showtime's **own copy** of a layout, taken when its bookable seats were
  generated. It holds the geometry buyers see for that showtime and is edited per showtime from then on;
  the source layout reaches it again only through an explicit, previewed re-apply.
- **Showtime Seat** (unchanged in shape): the bookable instance feature 002 generates and feature 003
  holds. This feature changes only *which layout snapshot* it is generated from and adds the organizer's
  block/unblock and marquee tier controls over it — never its status machine.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An organizer can author a non-rectangular layout — including at least one curved row, one
  stage, and one aisle — and save it, without writing any coordinates by hand.
- **SC-002**: A buyer opening a showtime bound to that layout sees the authored shape on both the event
  page preview and the seat-selection screen, and can reach every seat by zoom and pan at 360, 768, and
  1920 px with no horizontal page scroll.
- **SC-003**: A seat map that has already been generated can be corrected: every attempted change to an
  `available` seat succeeds, only the position change to a `sold` seat succeeds, and every change to a
  held seat is refused with a reason — verified by an automated test covering all three states.
- **SC-004**: No organizer edit ever removes, moves to another tier, or reprices a seat someone already
  holds or owns — verified by a test that attempts each and asserts the refusal.
- **SC-005**: A refused edit leaves the map identical to its pre-edit state — verified by comparing the
  map before and after a partially-invalid edit.
- **SC-005a**: Editing a layout that two showtimes have generated from changes neither showtime's map;
  re-applying it to one changes that one only, and only after a preview the organizer confirmed —
  verified by a two-showtime test asserting the untouched map.
- **SC-005b**: Repeated floor-plan uploads from one organizer are throttled, and concurrent uploads never
  drive the server past its memory ceiling while the live seat map keeps meeting its update bound —
  verified by a burst-upload test run against an active seat map.
- **SC-006**: Every upload category is handled correctly — a valid JPEG/PNG/WebP accepted, an SVG
  refused, a mislabelled non-image refused, an oversized file refused, and an accepted file stored
  stripped of its metadata under an unrelated name — verified by an automated test per case.
- **SC-007**: Removing a floor plan leaves 100% of seat positions unchanged, and a buyer's seat status is
  identical with the plan visible and hidden — verified by comparison.
- **SC-008**: Publishing is blocked for each of the five validation failures independently, and a single
  validation pass reports all present failures at once with the offending seats or sections named.
- **SC-009**: A layout containing non-sellable elements generates a bookable-seat count exactly equal to
  its seat count — no element ever becomes inventory.
- **SC-010**: A 2,000-seat layout loads and renders for a buyer within the platform's standard read
  bound (PERF-02: under half a second at the 95th percentile, under the 25-VU normal load profile) and
  stays interactive for zoom and pan.
- **SC-010a**: Every seat on the buyer map is reachable and selectable with the keyboard alone, in
  section → row → number order, with its identity, status, and price exposed to assistive technology —
  verified on a non-rectangular layout, so the capability survives the move off the grid.
- **SC-011**: A layout, seat, upload, or clone request against another organizer's venue is refused in
  100% of cases — verified by a cross-organizer test per endpoint, asserting the refusal rather than an
  empty result.
- **SC-012**: Feature 003's hold behaviour is unchanged by this feature: its existing hold, release,
  expiry, and live-update tests pass without modification, and the live seat payload contains no
  geometry.
- **SC-013**: An organizer can clone an existing layout into another of their venues and edit the clone
  with zero change to the source.
- **SC-014**: The seat-map read payload has exactly one shared definition, consumed by the API and both
  renderers — verified by the type-check passing with no independently re-declared seat-map shape.

## Assumptions

- **Features 001, 002, and 003 are the substrate.** Organizer identity and ownership come from 001;
  venues, sections, seats, showtimes, ticket tiers, and `showtime_seats` come from 002; holds and the
  live seat channel come from 003. This feature adds the layout layer and geometry above them and
  changes none of their state machines.
- **Existing data migrates into a default layout.** Every venue that already has seats gets one
  auto-created default layout holding them, with positions seeded from the current row/number grid —
  which is exactly what buyers see today, so nothing visibly regresses on the day this ships and no
  existing showtime's generated map breaks.
- **Coordinates are stored in the layout's own normalised space** (0–10,000 integer units per axis), not
  in pixels or metres, so the same layout renders correctly on a 360 px phone and a 1920 px desktop and
  over a floor plan of any size. Integer units keep the overlap test (FR-030a) exact rather than
  floating-point approximate. Distances on a map are for drawing, not for real-world measurement — this
  is a layout editor, not a CAD program (Principle V).
- **Every seat is the same size.** One nominal diameter for all seats keeps overlap, snapping, and hit
  testing to one rule. Per-seat sizing (a wider `double` seat drawn to scale) is deliberately not built:
  the `seat_type` already labels it, and variable footprints would make overlap a per-pair geometry
  problem for no requirement that asks for it.
- **The floor-plan upload is disk plus a static route, mirroring ADR-0004** (avatar upload on the VPS
  disk), not a new external service. The constitution's four-integration cap (VNPay, Gemini, Google
  OAuth, Resend) is untouched. It mirrors ADR-0004's serving model too: unguessable name, no per-request
  access check (FR-026a).
- **Ceilings**: 2,000 seats and 200 elements per layout, 20 layouts per venue, 5 MB and 4,000 px per
  upload, 50 undo steps. These are settings with these defaults, not hard-coded constants, and they are
  chosen to keep the editor and the buyer map inside PLAT-01 and PERF-02 rather than to describe a
  physical limit.
- **A showtime remains seated or general admission, never both.** A seated layout may contain seats of
  type `standing`, each still an individually bookable seat; a quantity-sold standing area remains a GA
  tier with no geometry. Feature 003's "seated or GA, never mixed" reservation invariant is preserved
  exactly.
- **Ticket-tier creation and pricing stay in feature 006.** This feature only *assigns* an existing tier
  to seats; it never creates, prices, or deletes one.
- **Vietnamese** is the user-facing language and **VND integers** the only money, consistent with the
  rest of the product.
- **The organizer canvas is a new surface**; the buyer side reuses the two existing renderers rather than
  adding a third, so there is one rendering behaviour for buyers, expressed twice against one shared
  contract.
- **The buyer map is drawn as real focusable elements, not a bitmap canvas**, which is what makes
  FR-039a affordable. Keyboard reach on the *organizer* canvas is out of scope: authoring is a
  pointer-driven task and no requirement asks for it. No formal WCAG conformance level is claimed by this
  feature.

## Contract Impact

- The **seat-map read contract** (`shared/catalog/types.ts` — `SeatMap`, `SeatMapSeat`) gains geometry:
  seat position and rotation, the layout's coordinate space, the non-sellable elements, and the
  floor-plan background when buyer-visible. Under Principle VI this is one change that updates the shared
  type, the API, and **both** renderers together; neither renderer may keep its own idea of the payload.
- The **live seat-update payload** from feature 003 (`shared/holds/types.ts` — `SeatUpdate`) MUST NEVER
  carry geometry. Geometry is static per layout and belongs to the map read, not to a per-hold broadcast;
  verifying this stays layout-independent is an explicit acceptance item (FR-041, SC-012). The payload
  takes **one additive change**: an optional tier label and price on the seated entry, set only when an
  organizer retiers a live seat (FR-035). Because both fields are optional and only an organizer action
  sets them, a feature 003 client that ignores them behaves exactly as it does today — which is why
  `server/tests/holds/**` must still pass unmodified.
- The organizer seat-map generation endpoint's blanket `409 seat_map_exists` is **replaced** by the
  per-seat inventory evaluation of FR-027–FR-029. Consumers relying on that refusal must move to the new
  outcome shape.

## Dependencies

- **Feature 001 (Account & Authentication)** — DONE. Provides the organizer identity that ownership
  scoping (SEC-04) resolves against, and the ADR-0004 upload pattern this feature mirrors.
- **Feature 002 (Event Catalog & Discovery)** — DONE. Provides venues, sections, seats, showtimes, ticket
  tiers, `showtime_seats`, the generation endpoint this feature replaces, and both buyer renderers this
  feature rewrites.
- **Feature 003 (Seat Holds & Reservations)** — DONE. Provides the live hold state that FR-028 checks
  against and the seat channel FR-035 broadcasts on. Its hold algorithm, `showtime_seats` shape, and hold
  path are **unchanged** by this feature.
- **Feature 004 (Wallet & Checkout)** — INDEPENDENT. Not touched; a `sold` seat is only ever read here.
- **Feature 006 (Ticket tiers & pricing)** — DOWNSTREAM. Owns tier CRUD and pricing rules; this feature
  only assigns existing tiers to seats.
- **Reference documents**: `docs/Analysis_Design/Group02_UseCaseSpecification.md` UC-21 (with UC-20 step
  5 and UC-23 step 2) is authoritative for the designer flow and its alternative flows A1–A5;
  `docs/Analysis_Design/SCHEMA_DATABASE.md` (venues, sections, seats, showtime_seats) is authoritative
  for the current schema this feature extends; `docs/adr/0004-avatar-upload-vps-disk.md` is authoritative
  for upload handling; `CONTEXT.md` (Venue / Seat / Showtime seat) for vocabulary;
  `src/.specify/memory/constitution.md` v2.0.0 (Principles I, V, VI) and Vision §6 (SEC-04, SEC-07,
  PLAT-01, PERF-02) for the non-functional bar.

## Follow-ups (docs to amend when this feature lands)

- **UC-21** — step 2 (seats defined per venue, unique within the venue) and A2/A4 (edits with sold seats
  restricted, deletion refused) are superseded by the layout layer and the per-seat rules of
  FR-027–FR-029. Rewrite steps 1–4 around layouts and record that A2 and A4 are now closed.
- **`SCHEMA_DATABASE.md`** — `seats` moves from `venue_id` to a layout, gains position and rotation, and
  its `UNIQUE (venue_id, row_label, seat_number)` becomes per-section; `sections` moves to the layout;
  new tables for layouts, elements, and the floor-plan background; `showtimes` gains its layout binding
  **plus its own snapshot** of the layout's geometry, since a generated map is a copy and not a live
  reference (FR-005).
- **`CONTEXT.md` glossary** — add **Layout** between Venue and Seat, and amend "Seats … unique within the
  venue" to unique within their section.
- **Feature 002's spec and contract** — the seat-map read shape and the `409 seat_map_exists` behaviour
  it documents are changed here; amend rather than leave two conflicting descriptions.
