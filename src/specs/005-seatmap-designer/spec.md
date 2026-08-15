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

### Amendment — Session 2026-08-06 (hall-scheme parity)

> **This scope was added after feature 005 shipped.** Everything above — layouts, sections, coordinate
> seats, arc/align/distribute/rotate, marquee select, grid snap, undo/redo, templates and clone,
> floor-plan upload with opacity and buyer visibility, optimistic locking, validate/publish,
> apply-to-showtime with sold/held refusals, per-seat block and per-seat tier assignment, and buyer
> zoom/pan — is **shipped and not re-opened**. The requirements below (FR-047 onward) close the gap
> between this designer and a commercial hall-scheme builder, benchmarked against
> `regtoevent.com/en/hallscheme`. Original numbering, wording, and clarifications are unchanged.

- Q: Where do a boundary polygon's points live — on the element row, or in a separate shape table? → A:
  **On the element, as an ordered list of points.** The element model is rectangle-only today
  (`x, y, width, height`), and a polygon needs N vertices. A separate `shape_points` table would make
  every layout read a second join and every save a delete-and-reinsert, for geometry that is never
  queried by point — it is only ever read whole, drawn, and written whole, exactly like the layout
  snapshot already is. The points ride on the element as an ordered JSON array, and the rectangle fields
  stay as the shape's bounding box so existing readers that ignore points still position it sensibly.
- Q: A section can now scale its seats. Does the overlap rule use the nominal diameter or the scaled
  one? → A: **The scaled one — overlap uses the *effective* size of the two seats compared.** Keeping
  the test on the nominal diameter would let a 2× section draw seats visibly on top of each other while
  validation called the layout clean, and a picture that contradicts the publish gate is worse than no
  picture. The default multiplier is **1.0**, which reproduces today's behaviour exactly, so no existing
  layout changes its publishability the day this ships; only a layout that opts into a larger multiplier
  can newly fail, and it fails for something the organizer can see.
- Q: Do tables introduce a new kind of inventory? → A: **No. A table is a drawing object; its seats are
  ordinary seats.** Each seat generated around a table belongs to a section, carries a tier, and is held
  and sold through feature 003 and 004 completely unchanged. The table row exists so the editor can move,
  rotate, relabel, and re-count a group as one object — it is never sold, never appears in inventory, and
  deleting it is governed by the seats it holds, not by itself.
- Q: On the buyer's map, when a seat's section colour and its price-tier colour disagree, which wins? →
  A: **Section colour is an editor-only tool; the buyer map colours by tier.** The two audiences want
  different things — an organizer drawing needs to see which block is which, a buyer choosing a seat
  wants to know the price — and a map whose fill means two things at once means nothing. Seat **shape**
  and **size** from the section still carry through to buyers, so sections stay distinguishable by form
  while colour is reserved entirely for price. This is also what makes the tier legend honest and the two
  renderers trivially identical (FR-069).

- Q: Where does a price tier's colour come from — organizer-chosen or auto-assigned? → A:
  **Auto-assigned from a fixed palette, ordered by price** (cheapest to most expensive). A chosen colour
  would mean adding a field to the ticket tier, which feature **006** owns, and widening its forms —
  cross-feature work that would have to land in the same change for no requirement that asks for it.
  Ordering the palette by price also makes the visual order consistent across every event on the
  platform, so a buyer learns it once. The legend names every tier and its price regardless, so nothing
  depends on a colour being memorable. An organizer override remains **additive** if it is ever asked
  for, and would invalidate nothing decided here.
- Q: The editor grew canvas fit/zoom controls and element deletion while this amendment was being built,
  neither of which any requirement asked for. Fold them in or take them out? → A: **Folded in, as FR-084
  and FR-085.** Both turned out to be preconditions for the amendment's own scope rather than extras: a
  hall of tables, a boundary polygon, and 200 standing positions cannot be placed accurately at a fixed
  scale, and a palette that can *add* a facility icon but not remove one is a trap. Neither touches
  inventory — zoom is a view control that changes no stored value, and an element is by definition never
  sellable — so folding them in adds no refusal path and no risk to a live map (SC-029). The alternative,
  deleting working code that the new palette needs, would have made the feature worse to satisfy a
  numbering technicality.

- Q: When a layout is applied to a showtime, are tables, boundary shapes and facility icons copied into
  that showtime too? → A: **Yes — they are snapshotted with the seats, exactly as the geometry already
  is.** The snapshot rule already exists precisely so a later layout edit cannot reshape a show that is
  selling, and decoration sits in the same picture as the seats: reading it live would let an organizer
  tidying the venue outline silently change the map under a live show, which is the failure the rule was
  written to prevent. Extending the existing rule keeps **one** rule rather than two contradictory ones,
  and keeps the previewed re-apply as the single way any layout edit reaches a live showtime. It also
  means a buyer looking at "Bàn 5 - Ghế 3" can actually see the table it names.

- Q: When a table is placed, how do its seats get a section? → A: **The table carries a section and its
  seats inherit it.** A gala hall really is organised as "Khu VIP quanh sân khấu" versus "Khu thường phía
  sau" — that is a section — and tables are placed in groups inside those areas, so asking per seat would
  be ten answers to one question. Holding it on the table also makes moving a table between sections one
  operation that re-parents all its seats, and makes the uniqueness of "Bàn 5" checkable **at placement**
  rather than at save, where a collision is far more annoying to unpick.

- Q: Are "fan zones" — an area bought by headcount rather than by seat — in scope? → A: **No. A showtime
  stays seated **or** general admission, never both; a fan zone is expressed as a section of
  pre-generated `standing` positions inside a drawn area.** Mixing the two on one showtime would reopen
  feature 003's reservation invariant ("either seated or GA, never mixed", 003 FR-012) and feature 004's
  conversion against it — the two places where money and double-selling live — which is a feature with
  its own concurrency work, not a line item in a seat-map amendment. The substitute costs nothing new:
  the original spec already permits seats of type `standing`, each an ordinary individually-held seat, so
  a fan zone of 200 is 200 standing positions the buyer picks from. The honest difference is that a buyer
  chooses a **spot** rather than a **headcount**; that is accepted in exchange for changing nothing about
  how a seat is claimed.

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

---

### User Story 9 - Lay out a gala dinner with tables (Priority: P1)

An organizer running a year-end party, a wedding, or an awards dinner places round tables across the
hall, sets how many guests each seats, and the seats appear already arranged around each table. They
drag a table to make room for the dance floor and its ten seats travel with it. They change one table
from eight covers to ten and the seats redistribute evenly. Guests then buy a specific chair at a
specific table.

**Why this priority**: This is the largest single gap against a commercial builder, and it is the
layout Vietnamese gala dinners, weddings, and year-end parties actually use — the product cannot
express it at all today. Everything else in this amendment improves a map an organizer can already
draw; this one makes a whole category of event drawable for the first time.

**Independent Test**: Place three round tables of 10 and one rectangular table of 12, drag one table
across the hall, change another's count from 8 to 10, and confirm the seats follow and redistribute —
then generate a showtime's map and confirm a buyer can select "Bàn 3 - Ghế 7" and nothing else changed
about how it is held.

**Acceptance Scenarios**:

1. **Given** an empty area of the canvas, **When** the organizer places a round table for 10, **Then**
   one table object appears with 10 seats spaced evenly around its perimeter, each belonging to a section
   and labelled so it reads as a table seat.
2. **Given** a rectangular table, **When** the organizer sets how many seats sit on each side, **Then**
   the seats distribute along those sides in that arrangement.
3. **Given** a table with seats, **When** the organizer drags or rotates the table, **Then** every one of
   its seats moves and rotates with it, keeping its place at the table.
4. **Given** a table of 8 with nothing sold, **When** the organizer changes it to 10, **Then** the seats
   redistribute evenly and the two new seats are labelled in sequence.
5. **Given** a table whose seats include one **sold** or **held** seat, **When** the organizer changes the
   count or deletes the table, **Then** it is refused for that seat with the existing reason vocabulary,
   and the table and all its seats are left exactly as they were.
6. **Given** a table selected on the canvas, **When** the organizer clicks it, **Then** one object is
   selected — not a loose scatter of seats — and one undo reverses whatever they do to it.
7. **Given** a generated showtime map containing table seats, **When** a buyer holds and buys one,
   **Then** it behaves identically to any other seat: nothing about holding, releasing, or selling
   changes.

---

### User Story 10 - Buyers can read the price off the map (Priority: P1)

A buyer opening a seat map sees at a glance which seats cost what: each price tier has its own colour
and a legend naming the tier and its price. Seats already taken still read as taken and stay
unclickable, so the buyer never has to choose between knowing the price and knowing what is available.

**Why this priority**: The map currently colours by status only (Còn trống / Đang giữ / Đã bán), so a
buyer on a multi-tier event has to click a seat to learn what it costs. That is the single most common
thing a buyer wants from a seat map, and it is buyer-facing value on the critical purchase path.

**Independent Test**: Open a showtime with three tiers at 360, 768, and 1920 px on both the event-page
preview and the selection screen; confirm the tier colours and the legend are identical on both, that
the legend names each tier and its price in đồng, and that sold and held seats remain visibly
unavailable and cannot be selected.

**Acceptance Scenarios**:

1. **Given** a showtime with several tiers, **When** a buyer opens the map, **Then** each seat is
   coloured by its tier and a legend names every tier with its colour and its price in whole đồng.
2. **Given** a seat that is sold or held, **When** the buyer looks at it, **Then** it still reads as
   unavailable and cannot be selected, regardless of its tier colour.
3. **Given** the same showtime, **When** the buyer compares the event-page preview with the seat-selection
   screen, **Then** the colours, the legend, and the seat shapes are the same on both — one visual
   language, not two.
4. **Given** any of the supported widths, **When** the buyer zooms and pans, **Then** the legend stays
   readable and the map stays usable.

---

### User Story 11 - Draw the shape of the hall (Priority: P2)

An organizer outlines the room itself — an L-shaped ballroom, a room with a cut corner — and draws
straight dividers to separate the dance floor from the dining area, so the map reads as *that* room
rather than as seats floating on a blank field.

**Why this priority**: Orientation. Buyers judge "where am I sitting" from the room's shape, and today
the only way to suggest it is an uploaded floor plan, which many organizers do not have. It improves a
map that is already drawable, so it follows the tables work.

**Independent Test**: Draw a five-point boundary and two dividers, save, reopen, and confirm the shape
persists; then generate a showtime map and confirm the bookable seat count is completely unchanged.

**Acceptance Scenarios**:

1. **Given** the canvas, **When** the organizer draws a boundary of several points, **Then** it is stored
   with the layout and drawn behind the seats in both the editor and the buyer's map.
2. **Given** a boundary or a divider, **When** the organizer moves or reshapes it, **Then** no seat moves
   and no seat changes status.
3. **Given** a layout with a boundary, **When** its showtime map is generated, **Then** the number of
   bookable seats is exactly the number of seats — boundaries and dividers are never inventory.
4. **Given** a boundary that does not enclose every seat, **When** the organizer tries to publish,
   **Then** validation reports it and names the seats left outside.

---

### User Story 12 - Show buyers where the facilities are (Priority: P2)

An organizer marks the exits, the toilets, the food and drink counters, the smoking area, first aid,
the lift or stairs, and wheelchair access, so a buyer choosing a seat can see what is near it.

**Why this priority**: It is a small, self-contained addition to a vocabulary that already exists
(stage, aisle, door, bar, label), and it answers real buyer questions — "is there a toilet near this
block?", "can I get a wheelchair to this row?" — without touching inventory at all.

**Independent Test**: Place one of each facility icon with Vietnamese labels, save, and confirm all of
them render in the editor and in the buyer's map, and that layouts saved before this change still load.

**Acceptance Scenarios**:

1. **Given** the palette, **When** the organizer places a facility icon, **Then** it is drawn distinctly
   from seats in both the editor and the buyer's map and is never selectable as inventory.
2. **Given** a facility icon, **When** the organizer gives it a Vietnamese label, **Then** the label is
   shown intact and is never interpreted as markup.
3. **Given** layouts created before this amendment, **When** they are opened, **Then** every existing
   element still loads and displays exactly as before.

---

### User Story 13 - Tell the sections apart at a glance (Priority: P2)

An organizer gives each section its own colour, and picks whether its seats are drawn as circles or
squares and how large, so a VIP block reads differently from the back stalls at a glance while they
draw. The colour is a working aid for the organizer; buyers see the same shapes and sizes but are
coloured by price instead.

**Why this priority**: Every seat is currently an identical circle, so a map with five sections is a
uniform field of dots and the organizer cannot verify visually that they tiered the right block. It
also gives the buyer-side tier colouring (US10) a coherent visual system to sit in.

**Independent Test**: Give three sections distinct colours, shapes, and sizes; confirm the editor and
both buyer renderers show them; then place two seats of a scaled-up section close together and confirm
validation reports the overlap it now visibly has.

**Acceptance Scenarios**:

1. **Given** a section, **When** the organizer sets its colour, seat shape, and size, **Then** its seats
   are drawn that way in the **editor**; the shape and size also reach both buyer renderers, while the
   buyer's fill colour comes from the seat's price tier, not from the section.
2. **Given** a section whose seats are scaled larger, **When** two of them are placed closer than their
   drawn size, **Then** validation reports them as overlapping — what is drawn and what is checked agree.
3. **Given** a layout created before this amendment, **When** it is opened, **Then** its seats look
   exactly as they did, because the default size is unchanged.
4. **Given** a section with no colour chosen, **When** the organizer tries to publish, **Then** validation
   reports it.

---

### User Story 14 - One palette for the new objects (Priority: P3)

The organizer picks tables, shapes, and facility icons from one palette on the canvas, the same way
they already place a stage or an aisle, and undo reverses any of it in one step.

**Why this priority**: Pure ergonomics over capabilities delivered by US9–US13. The objects are usable
without a dedicated palette; the palette makes them findable.

**Independent Test**: Place one table, one boundary, and one icon from the palette, then press undo
three times and confirm each object disappears in one step, in reverse order.

**Acceptance Scenarios**:

1. **Given** the canvas, **When** the organizer opens the palette, **Then** tables, shapes, and facility
   icons are offered alongside the existing elements.
2. **Given** any new object operation — placing, moving, resizing, re-counting, deleting — **When** the
   organizer undoes, **Then** exactly one step reverses the whole operation.


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

*Added by the 2026-08-06 amendment:*

- **A table dragged so its seats land on another table's seats**: allowed while drafting, reported by
  validation, blocking at publish — the same permissive-draft / strict-publish rule seats already follow.
- **A table's seat count reduced below the number already sold at it**: refused, naming the sold seats;
  the count never silently drops a seat someone bought.
- **A table rotated when one of its seats is held**: refused, because rotating moves that seat. The
  organizer waits for the hold to lapse, exactly as with any other move of a held seat.
- **A table deleted whose seats are all `available`**: deleted together with its seats, one undo step.
- **Two tables given the same name in one section**: refused at placement, naming the existing table. The
  same name in a *different* section is fine — "Bàn 5" in Khu VIP and "Bàn 5" in Khu thường are distinct
  seats, which is exactly what per-section uniqueness allows.
- **A table moved to another section while one of its seats is sold**: refused, because re-parenting
  changes that seat's identity; the existing sold/held vocabulary reports it.
- **A round table of 2**: allowed — two seats opposite each other. A table of 1 or 0 is refused; that is
  a loose seat, not a table.
- **A boundary polygon drawn with two points**: refused as a polygon; a two-point shape is a divider,
  which is its own object.
- **A boundary polygon that crosses itself**: allowed and drawn as-is. Enclosure is tested by whether the
  seats fall inside it, and a self-crossing outline that still contains every seat is the organizer's
  aesthetic choice, not an error.
- **A layout's boundary redrawn while one of its showtimes is selling**: the selling showtime is
  untouched — it holds its own snapshot. The change reaches it only when the organizer re-applies, under
  the existing preview and the existing inventory rules.
- **A facility icon placed outside the boundary**: allowed — a smoking area or an exit is often outside
  the room proper.
- **A section coloured the same as another section**: allowed but reported as a warning at publish, since
  two identical colours defeat the purpose without being wrong. It never reaches buyers either way —
  section colour is editor-only.
- **A tier with no colour assigned on the buyer map**: falls back to a neutral colour and is still named
  in the legend with its price; the map never renders a seat the buyer cannot price.
- **More tiers than distinct colours in the palette**: colours repeat, and the legend remains the
  authority — the legend, not the colour, is what names the price.
- **Two tiers priced identically**: they sort adjacently and may receive adjacent palette colours; the
  legend still names both, so a buyer is never asked to tell them apart by colour alone.
- **A tier's price changed by feature 006 after the map is drawn**: the colour order is derived at read
  time, so the map re-colours itself on the next read; no stored colour goes stale.
- **A buyer using colour alone cannot distinguish two tiers**: colour is never the only signal; the
  legend names every tier and its price, and a seat's tier is available to assistive technology.

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

*The requirements below were added by the 2026-08-06 amendment and are additive: FR-001–FR-046 above are
unchanged and none of the behaviour they describe is re-opened.*

**Tables (the gala-dinner layout)**

- **FR-047**: System MUST support a **table** as a first-class layout object carrying a shape (**round**
  or **rectangular**), a position, a size, a rotation, an optional label, and a seat count.
- **FR-048**: Placing a table MUST generate its seats **already distributed around its perimeter** —
  evenly around the circumference for a round table, and along the sides for a rectangular one with a
  **per-side count** the organizer can set.
- **FR-049**: A table's seats MUST be **ordinary seats**: they belong to a section, carry a ticket tier,
  and are held and sold through features 003 and 004 **entirely unchanged**. A table itself MUST NEVER be
  sellable and MUST NEVER appear in inventory. A **table carries a section** and its seats MUST inherit
  it; changing the table's section MUST re-parent every one of its seats in one operation, subject to the
  same sold/held refusals as any other change (FR-051).
- **FR-050**: Moving or rotating a table MUST carry its seats with it, preserving each seat's place at the
  table; changing its seat count MUST redistribute its seats.
- **FR-051**: Any table operation that would move, relabel, or remove a seat that is **sold** or **held**
  MUST be refused using the existing `seat_sold` / `seat_held` reason vocabulary, and MUST be refused
  **whole** — the table and every one of its seats MUST be left exactly as they were (FR-029's rule,
  applied to tables).
- **FR-052**: Deleting a table MUST delete its seats with it when they are all free, and MUST be refused
  when any of them is sold or held, naming those seats.
- **FR-053**: Table seats MUST be labelled so they read naturally in Vietnamese — **"Bàn 5 - Ghế 3"** —
  while satisfying the existing per-section uniqueness rule (FR-003): the table's name acts as the seat's
  row label and its position at the table as the seat number, so `(section, row label, number)` stays
  unique without a new constraint. Because a table carries its section (FR-049), a table name that would
  collide with an existing table in the **same section** MUST be refused **at placement**, naming the
  clash, rather than failing on save.
- **FR-054**: A table MUST hold at least **2** seats and at most **20**, and a layout MUST be capped at
  **100** tables; a table of 0 or 1 MUST be refused as a loose seat rather than a table.
- **FR-055**: Table seats MUST count toward the existing **2,000 seats per layout** ceiling; tables add no
  separate inventory budget.
- **FR-056**: Selecting a table on the canvas MUST select **one object**, not its seats individually, and
  each table operation MUST be **one undo step**.

**Venue boundary and dividing lines**

- **FR-057**: System MUST support a **boundary polygon** describing the hall outline and a straight-line
  **divider** for separating spaces. Both are **decorative geometry only**: never sellable, never in
  inventory, never clickable on the buyer's map.
- **FR-058**: A shape's points MUST be stored **on the element itself** as an ordered list, with the
  existing rectangle fields retained as its bounding box, so a reader that does not understand points
  still positions the shape sensibly. A separate shape-point table MUST NOT be introduced: this geometry
  is only ever read whole and written whole.
- **FR-059**: A boundary polygon MUST hold at least **3** and at most **64** points; a divider MUST hold
  exactly **2**. Shapes MUST count toward the existing **200 elements per layout** ceiling.
- **FR-060**: Boundaries and dividers MUST be drawn behind the seats in the editor and in **both** buyer
  renderers, and MUST NOT intercept pointer or keyboard interaction intended for a seat.

**Facility icons**

- **FR-061**: The non-sellable element vocabulary MUST be extended with **exit, restroom, food and drink,
  smoking area, first aid, lift/stairs, and wheelchair access**, in addition to the existing stage, aisle,
  door, bar, and label.
- **FR-062**: Each facility icon MUST accept an **optional Vietnamese label**, length-bounded and
  output-encoded wherever displayed, and MUST render in the editor and in both buyer renderers.
- **FR-063**: Widening the element vocabulary MUST be **additive**: every element stored before this
  change MUST continue to load and display unchanged.

**Per-section visual style**

- **FR-064**: A **section** MUST carry a **colour**, a **seat shape** (circle or square), and a **seat
  size multiplier**. The **colour is an editor-only** aid and MUST NOT be used to fill seats on the buyer
  map, where colour is reserved for price tier (FR-067); the **shape and size MUST** be carried through
  to both buyer renderers, so sections stay distinguishable to buyers by form rather than by fill.
- **FR-065**: The multiplier MUST scale the existing nominal seat diameter, defaulting to **1.0** so that
  a layout created before this amendment renders and validates exactly as it did, and MUST be bounded to
  **0.5–2.0**; a value outside that range MUST be refused. The overlap test (FR-030a) MUST use the
  **effective** size of the two seats being compared, so that what is drawn and what is validated always
  agree.
- **FR-066**: A section without a colour MUST be reported by validation and MUST block publishing.

**Buyer-side price reading**

- **FR-067**: The buyer map MUST colour seats **by ticket tier** and MUST show a **legend** naming every
  tier, its colour, and its price in **whole Vietnamese đồng**. Tier colours MUST be **assigned
  automatically from a fixed palette ordered by price**, cheapest to most expensive, so the visual order
  is consistent across events; the organizer MUST NOT be required to choose one, and this amendment MUST
  NOT add a colour field to the ticket tier, which feature 006 owns.
- **FR-068**: Seat **status MUST remain legible** alongside tier colour: a sold or held seat MUST stay
  visibly unavailable and MUST remain unclickable and unselectable.
- **FR-069**: Both buyer renderers MUST express **one visual language** — identical colours, legend, seat
  shapes, and status treatment — driven by one shared definition rather than two implementations.
- **FR-070**: Tier colouring and the legend MUST work within the existing **zoom and pan** and MUST meet
  the existing **360–1920 px** bar.
- **FR-071**: Colour MUST NOT be the only carrier of price: the legend names every tier and price, and a
  seat's tier MUST be available to assistive technology alongside its identity, status, and price.

**Validation of the new objects (one gate, not a second)**

- **FR-072**: Validation MUST report a **table whose seats overlap another object**, naming the seats.
- **FR-073**: Validation MUST report a **boundary polygon that does not enclose every seat**, naming the
  seats left outside.
- **FR-074**: Validation MUST report a **facility icon with no position**.
- **FR-075**: Every new check MUST run inside the **existing validate/publish gate** (FR-030) and be
  reported in the same single pass; a second validation path MUST NOT be introduced.

**Carrying the new objects onto a showtime**

- **FR-081**: Generating or re-applying a showtime's seat map MUST **snapshot the tables, boundary
  shapes, dividers, and facility icons** into that showtime alongside its seats and their geometry, so a
  later edit to the source layout MUST NOT change what buyers see on a showtime that is already selling.
- **FR-082**: The buyer map MUST draw a showtime's snapshotted tables, so a seat labelled "Bàn 5 - Ghế 3"
  is shown at the table it names. Tables, shapes, and icons MUST remain non-interactive on the buyer map.
- **FR-083**: A layout edit MUST reach a live showtime's decoration only through the **existing previewed
  re-apply** (FR-027a); no second update path may be introduced for the new objects.

**Standing areas (the fan-zone substitute)**

- **FR-080**: A **standing area** MUST be expressible as a section whose seats are of type `standing`,
  positioned inside a drawn shape, and MUST be sold **seat by seat** through the unchanged 003/004 path.
  A showtime MUST remain either seated or general admission; this amendment MUST NOT introduce a
  showtime that is both, and MUST NOT introduce any inventory sold by quantity against a drawn area.

**Editor ergonomics and contract**

- **FR-076**: The editor MUST offer **one palette** from which tables, shapes, and facility icons are
  placed, alongside the existing elements.
- **FR-077**: The existing **undo/redo history** MUST cover every new operation, at one step per
  operation, within the existing depth.
- **FR-078**: Every new object MUST be carried by the **single-sourced layout contract**, imported by the
  server, the editor, and **both** buyer renderers in the same change; no consumer may keep its own idea
  of the payload.
- **FR-079**: Every endpoint touching tables, shapes, icons, or section style MUST remain scoped **on the
  server** to the owning organizer, and MUST refuse another organizer's layout.
- **FR-084**: The **editor canvas** MUST support zoom and a fit-to-content control. This is separate from
  FR-039, which governs the *buyer* map: a hall of tables, a boundary polygon and 200 standing positions
  cannot be placed accurately at a fixed scale, so the drawing surface needs its own framing. It is a
  view control only — zooming MUST NOT move a seat, change a coordinate, or produce an undo step.
- **FR-085**: Organizers MUST be able to **delete a decorative element** — an aisle, a shape, a facility
  icon — from the canvas, as one undo step. FR-009 grants delete for *seats*; elements are never
  inventory, so removing one can refuse nothing and take nothing from anyone. Deleting a **table** is
  governed by FR-053 instead, because a table owns seats.

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

*Added by the 2026-08-06 amendment:*

- **Table**: a drawing object grouping seats around a shape — round or rectangular, with position, size,
  rotation, a name, a section, and a seat count (with a per-side count when rectangular). Its seats
  inherit its section, and its name is what their labels read from. It is never
  sellable and never appears in inventory; it exists so the editor can move, rotate, rename, and re-count
  a group of seats as one thing. The seats it generates are ordinary seats in every other respect.
- **Layout Shape**: a boundary polygon or a straight divider, described by an ordered list of points with
  the rectangle fields kept as its bounding box. Decorative geometry with no status and no price.
- **Facility Icon**: a non-sellable element marking exit, restroom, food and drink, smoking area, first
  aid, lift/stairs, or wheelchair access, with an optional Vietnamese label.
- **Section Style**: the colour, seat shape, and seat size multiplier a section carries. The **colour is
  editor-only** — it gives a sector an identity while drawing; the **shape and size** reach buyers too.
  The multiplier scales the existing nominal diameter and defaults to 1.0.
- **Tier Legend**: the buyer-facing mapping from ticket tier to colour and price in whole đồng. Colours
  are derived, not stored — assigned from a fixed palette ordered by price — so no ticket-tier data
  changes. The legend is the authority for what a seat costs; colour is the shorthand, never the only
  signal.

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

*Added by the 2026-08-06 amendment:*

- **SC-015**: An organizer can lay out a 20-table gala dinner — placing tables, setting covers, and
  arranging them around a dance floor — without positioning a single seat by hand, and every seat reads as
  "Bàn N - Ghế M".
- **SC-016**: Moving or rotating a table carries **100%** of its seats, and changing its count
  redistributes them evenly — verified by comparing every seat's position relative to its table before and
  after.
- **SC-017**: Every table refusal has an asserting test: changing the count, moving, rotating, or deleting
  a table holding a **sold** seat and a **held** seat each refuse with the existing reason vocabulary and
  leave the table and its seats byte-identical.
- **SC-018**: Boundaries, dividers, and facility icons never become inventory: a layout containing them
  generates a bookable-seat count exactly equal to its seat count, unchanged from before the amendment.
- **SC-019**: Every layout, element, and seat saved before this amendment loads and renders unchanged
  after it — verified by opening pre-amendment layouts and comparing what is drawn.
- **SC-020**: A seat scaled up by its section's multiplier is reported as overlapping when it visibly
  overlaps — what the organizer sees and what the publish gate enforces agree at any multiplier.
- **SC-021**: A buyer can tell what a seat costs **without clicking it**, on both renderers, at 360, 768,
  and 1920 px — verified by a legend naming each tier and its price in whole đồng and by the two renderers
  producing the same colours, shapes, and legend.
- **SC-022**: A sold or held seat remains visibly unavailable and cannot be selected on either renderer,
  whatever its tier colour — verified by an asserting test per status.
- **SC-023**: Each new validation failure — overlapping table seats, a boundary that leaves a seat
  outside, an icon with no position, a section with no colour — blocks publishing **independently**, and
  all of them are reported in one pass by the existing gate.
- **SC-024**: Undo reverses every new operation in exactly one step, in reverse order, within the existing
  history depth.
- **SC-028**: Two tables may share a name across different sections but never within one, and a colliding
  name is refused at placement — verified by an asserting test per case.
- **SC-027**: Editing a layout's tables, boundary, or icons changes nothing on a showtime that has
  already generated its map — verified by comparing the showtime's buyer payload before and after the
  layout edit — and the change appears only after an explicit re-apply.
- **SC-026**: A fan-zone-style standing area of 200 positions can be drawn and sold, and no showtime in
  the system is ever both seated and general admission — verified by an asserting test that a mixed
  showtime cannot be created and that feature 003's reservation invariant holds unchanged.
- **SC-025**: Feature 003's and 004's behaviour is unchanged by this amendment: their existing test suites
  pass **unmodified**, and a table seat is held, released, and sold exactly as any other seat.
- **SC-029**: The editor's own zoom and fit controls change no stored value — verified by comparing every
  seat, element, and table coordinate before and after zooming and fitting — and deleting a decorative
  element removes exactly that element, leaving the seat count unchanged.

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

*Added by the 2026-08-06 amendment:*

- **A table is a drawing object, not an inventory model.** Its seats are ordinary seats on the unchanged
  003/004 path. Nothing about holding, releasing, or selling a seat changes because it sits at a table.
- **Shape points ride on the element row** as an ordered list, with the rectangle fields kept as the
  bounding box (see the amendment clarification). No new shape-point table is introduced.
- **The section seat-size multiplier defaults to 1.0**, which reproduces today's rendering and today's
  overlap outcomes exactly; only a layout that opts into a different multiplier can change either.
- **New ceilings**: **2 to 20 seats per table**, **100 tables per layout**, **3 to 64 points per boundary
  polygon**, **exactly 2 per divider**. Table seats count toward the existing 2,000-seat ceiling and
  shapes toward the existing 200-element ceiling, so the amendment adds no new budget — only new limits
  on the shapes of the things inside the old ones. These are settings with these defaults.
- **The next migration is 0012**, and it MUST use `ADD COLUMN IF NOT EXISTS`: the migration runner's
  already-applied error codes cover duplicate tables, objects, and indexes, but **not** a duplicate
  column (42701), so a re-run would otherwise fail rather than skip.
- **Vietnamese** remains the user-facing language and **VND integers** the only money.

### Explicitly out of scope for this amendment

- **Mixed seated + general-admission showtimes ("fan zones" sold by headcount).** Decided 2026-08-06:
  out of scope. It would reopen feature 003's reservation invariant and feature 004's conversion, so it
  is its own feature with its own concurrency and checkout work. The in-scope substitute is FR-080's
  standing area.
- **Multi-level and tiered charts** (balcony, stadium decks, mezzanines). One plane per layout stays the
  rule (Principle V). Levels would change the buyer map, the apply diff, and the hold broadcast at the
  same time, which is a feature, not a line item.
- **Embeddable widgets, iframes, and public share links.** That is a chart-builder *vendor's* model, where
  the map must live on someone else's site. TixHub **is** the marketplace: the map belongs on the event
  page, and adding an embed surface would add a public, unauthenticated rendering path with its own
  caching and abuse questions for no requirement here.
- **Any change to how a seat is held or sold.** Feature 003's `showtime_seats` path and feature 004's
  checkout stay untouched. This amendment changes **where a seat is drawn and how it looks**, never how it
  is claimed — which is why 003's and 004's suites must pass unmodified (SC-025).

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

*Added by the 2026-08-06 amendment:*

- The **layout contract stays single-sourced in `shared/catalog/seatmap.ts`** and gains tables, shapes
  with their point lists, the widened element vocabulary, and section style. Under Principle VI this is
  one change that updates the shared definition, the server, the editor, and **both** buyer renderers
  together.
- The **buyer seat-map read** gains what the map needs to price itself: each seat's tier, and the tier
  legend (name, colour, price in whole đồng). This is a change to an existing public read and needs its
  own test — a buyer must be able to price a seat without a second request.
- The **live seat-update payload** from feature 003 is **unchanged again**: geometry, tables, shapes, and
  section style are static per layout and belong to the map read, never to a per-hold broadcast. The
  optional tier label and price added by FR-035 remain the only additive change to it.
- The element `kind` vocabulary is **widened additively**, exactly as migration 0010 widened it once
  before, so no stored element becomes invalid.

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

*Added by the 2026-08-06 amendment:*

- **`SCHEMA_DATABASE.md`** — `sections` gains colour, seat shape, and seat size multiplier; a table object
  is added; `layout_elements` gains its point list and the widened `kind` vocabulary. Record that the
  points ride on the element rather than in a shape-point table, and why.
- **`CONTEXT.md` glossary** — add **Table** and **Layout Shape** beside Layout, and note that a table is a
  drawing object whose seats are ordinary seats.
- **UC-21** — the designer flow gains tables, hall boundary, facility icons, and per-section style; the
  buyer-facing steps gain price-by-colour with a legend.
- **Feature 002's spec and contract** — the buyer seat-map read shape changes again (tier + legend);
  amend it there rather than leaving two conflicting descriptions.
