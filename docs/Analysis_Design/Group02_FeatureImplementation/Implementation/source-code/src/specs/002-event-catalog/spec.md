# Feature Specification: Event Catalog & Discovery

**Feature Branch**: `002-event-catalog`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Event catalog & discovery for TixHub — the public-facing catalog that
everything downstream (seat holds, orders, tickets) attaches to, plus the organizer/admin CRUD that
populates it. Entities from SCHEMA_DATABASE.md: event_categories, venues, sections, seats, events,
showtimes, ticket_tiers, showtime_seats (read-only seat map here). Public browse/search/filter, event
detail, showtimes, seat-map view. Organizer/admin CRUD, moderation. Replaces the frontend mock
`src/data.ts`. VND integers. SEO slugs. Out of scope: seat holding, checkout, wallet, tickets, reviews."

## Clarifications

### Session 2026-07-23

- Q: When an approved organizer publishes an event, is it visible to buyers immediately, or only after
  an admin approves it? → A: **Pre-publish moderation** — publishing submits the event for review
  (`moderation_status='pending_review'`) and it stays **invisible to buyers** until an admin
  **approves** it. Only an event that is both `on_sale` **and** `approved` appears in the public
  catalog. Admins can later `flag`/`remove` an approved event to pull it. (See FR-029/FR-030, D-B/D-C.)
- Q: Should a sold-out event be hidden from the catalog or shown with a label? → A: **Shown, labelled
  "Hết vé"**, sorted after events with availability; the availability filter can hide them. (US1-5,
  FR-004.)
- Q: Does public visibility also depend on the owning organizer's status? → A: **Yes** — a suspended
  organizer's events are hidden from buyers on the next request; predicate is `on_sale ∧ approved ∧
  organizer.approved`, evaluated live. (FR-029/FR-033, D-E.)
- Q: Who owns venues — shared or per organizer? → A: **Per organizer** (creator-owned, editable by
  owner/admin, used only in the owner's events); needs a `created_by` column on `venues`. (FR-020, D-F.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover events by browsing and searching (Priority: P1)

A visitor who is not signed in opens TixHub, browses the events on offer, and narrows them down by
keyword, category, city, date, price range, and availability to find something they want to attend.

**Why this priority**: Discovery is the entrance to the whole product. Nothing downstream — holding a
seat, buying a ticket — happens unless a visitor can first find an event. This is the smallest slice
that delivers standalone value (a browsable catalog) and it is what replaces the frontend's mock data.

**Independent Test**: Load the catalog as a guest, apply each filter (keyword, category, city, date,
price, availability) and confirm the returned events match the filter; confirm a draft or unpublished
event never appears.

**Acceptance Scenarios**:

1. **Given** a set of events, **When** a guest opens the catalog, **Then** they see event cards (title,
   image, category, earliest showtime, starting price, city) for **only** events that are on sale
   **and admin-approved** — never drafts, events still awaiting review, flagged, removed, or cancelled
   events.
2. **Given** events across several categories and cities, **When** a guest filters by category and by
   city, **Then** only events matching **both** are shown.
3. **Given** events with a range of ticket prices, **When** a guest filters by a minimum and maximum
   price, **Then** only events whose lowest ticket price falls in that range are shown.
4. **Given** a keyword, **When** a guest searches, **Then** events whose title, lineup, or description
   match the keyword are returned, ordered by relevance.
5. **Given** an event whose every upcoming showtime is sold out, **When** the catalog is shown, **Then**
   the event is **still shown, marked "Hết vé" (sold out)** and sorted after events that still have
   availability; the sold-out flag is derived from its showtimes, not stored on the event. The
   availability filter can narrow the list to events with tickets left.
6. **Given** a filter that matches nothing, **When** the guest applies it, **Then** an empty result is
   returned with a clear "no events found" outcome, not an error.

---

### User Story 2 - View an event's detail page (Priority: P1)

A visitor opens a single event to see its full description, ticket tiers and prices, venue and location
guidance, refund policy, its showtimes, and related events.

**Why this priority**: The detail page is where a visitor decides to attend. It is required before any
purchase journey and is independently valuable as the shareable, SEO-indexable page for an event.

**Independent Test**: Open an event by its stable link, confirm every detail (tiers, prices in VND,
venue guide, refund policy, showtimes) is present and correct, and confirm the same link keeps working
over time.

**Acceptance Scenarios**:

1. **Given** a published event, **When** a guest opens its page by its stable slug, **Then** they see
   the title, description, category, age restriction, lineup, images, ticket tiers with prices in
   Vietnamese đồng, the venue guide, and the refund policy.
2. **Given** an event with several showtimes, **When** the page is opened, **Then** all upcoming
   showtimes are listed with their date, time, venue, and an availability summary.
3. **Given** an event, **When** the page is opened, **Then** a short list of related events (same
   category or city) is offered.
4. **Given** a slug that belongs to no published event, **When** it is opened, **Then** a clear
   "event not found" outcome is returned, not a server error.
5. **Given** a price shown anywhere on the page, **When** it is displayed, **Then** it is a whole
   Vietnamese đồng amount with no fractional part.

---

### User Story 3 - Inspect showtimes and the seat map (Priority: P1)

A visitor drills into a specific showtime to see its inventory: for a seated event, the seat map with
each seat's availability and price tier; for a general-admission event, the remaining quantity per
tier. Viewing is open to guests; **selecting or holding a seat requires signing in and is a later
feature.**

**Why this priority**: Seeing availability is the last step before deciding to buy, and the seat-map
data model created here is exactly what the downstream seat-holding feature will lock on. It is
independently testable as a read-only availability view.

**Independent Test**: Open a seated showtime's seat map as a guest and confirm each seat shows its tier
and one of available / held / sold / blocked; open a general-admission showtime and confirm remaining
quantity per tier. Confirm no hold or purchase can be made from this feature.

**Acceptance Scenarios**:

1. **Given** a seated showtime, **When** a guest opens its seat map, **Then** each seat shows its row,
   number, price tier, and current status (available, held, sold, or blocked).
2. **Given** a general-admission showtime, **When** a guest opens it, **Then** each ticket tier shows
   its price and remaining quantity (capacity minus sold minus reserved).
3. **Given** a guest viewing a seat map, **When** they attempt to select or hold a seat, **Then** they
   are prompted to sign in and no hold is created (holding belongs to the later feature).
4. **Given** a showtime that has already started or was cancelled, **When** it is requested, **Then**
   it is not offered for selection and is clearly marked as unavailable.

---

### User Story 4 - Organizer creates and publishes an event (Priority: P2)

An approved organizer creates an event with its details, adds showtimes and ticket tiers, and publishes
it so the public can find it. They can edit and unpublish their own events, and only their own.

**Why this priority**: Without organizers populating the catalog there is nothing to discover, but the
public-facing read side (US1–US3) can be demonstrated against seed data first, so creation is a
separable second slice.

**Independent Test**: As an approved organizer, create an event with showtimes and tiers, publish it,
and confirm it appears in the public catalog; confirm a different organizer cannot edit it; confirm a
non-approved account cannot create one at all.

**Acceptance Scenarios**:

1. **Given** an approved organizer, **When** they create an event with a title, category, description,
   and at least one showtime and ticket tier, **Then** the event is saved as a draft owned by them and
   is **not** yet public.
2. **Given** an organizer's draft event, **When** they publish it, **Then** it is submitted for admin
   review and is **not yet visible to buyers**; it appears in the public catalog only after an admin
   approves it (pre-publish moderation, see Clarifications).
3. **Given** an account that is **not** an approved organizer, **When** it attempts to create or publish
   an event, **Then** the action is refused.
4. **Given** an event owned by organizer A, **When** organizer B attempts to edit or unpublish it,
   **Then** the action is refused; an organizer may only manage their own events.
5. **Given** a published event, **When** its owner unpublishes it, **Then** it disappears from the
   public catalog but is retained as a draft.
6. **Given** an event, **When** a ticket-tier price is entered, **Then** it is accepted only as a whole
   Vietnamese đồng amount; a fractional value is refused.

---

### User Story 5 - Organizer manages venues, sections, and seat maps (Priority: P2)

An organizer defines the physical venues, their sections and seats, and — for a seated showtime —
generates the bookable seat map that assigns each seat to a price tier.

**Why this priority**: Seated events cannot exist without a seat map, and the map is the substrate the
holds feature locks. General-admission events need only a venue and capacity, so this can follow US4.

**Independent Test**: Create a venue with sections and seats, attach it to a seated showtime, generate
the showtime seat map with tier assignments, and confirm every physical seat has exactly one bookable
seat entry for that showtime.

**Acceptance Scenarios**:

1. **Given** an organizer, **When** they create a venue with a name, city, and address, **Then** it is
   saved and reusable across events.
2. **Given** a venue, **When** the organizer adds sections and seats (row, number, seat type), **Then**
   each seat is unique within the venue by row and number.
3. **Given** a seated showtime and its venue's seats, **When** the organizer generates the seat map with
   tier assignments, **Then** exactly one bookable seat exists per physical seat for that showtime, each
   starting as available and carrying its tier's price.
4. **Given** a general-admission showtime, **When** it is set up, **Then** capacity is defined per
   ticket tier as a quantity, with no per-seat map.
5. **Given** a venue already referenced by a published showtime, **When** the organizer tries to delete
   a seat that is part of a live seat map, **Then** the deletion is refused to protect inventory
   integrity.

---

### User Story 6 - Admin reviews and moderates the catalog (Priority: P2)

An admin works a review queue of events organizers have submitted: **approving** the good ones (which
makes them visible to buyers) or **rejecting** the rest; and can later **flag** or **remove** an
already-approved event. Every decision is recorded.

**Why this priority**: Under pre-publish moderation (see Clarifications), **admin approval is the gate**
that makes any organizer-created event visible — so the approve action is on the critical path for the
organizer→buyer flow, not a late slice. The public read side (US1–US3) can still be demoed against
pre-approved seed data, which is why this sits at P2 alongside the write side (US4/US5).

**Independent Test**: Submit an event for review as an organizer, approve it as an admin, and confirm it
now appears in the public catalog; reject a second one and confirm it never appears; flag/remove an
approved one and confirm it disappears on the next request while staying visible to its organizer.

**Acceptance Scenarios**:

1. **Given** an event awaiting review (`pending_review`), **When** an admin approves it, **Then** it
   becomes visible in the public catalog (provided it is on sale).
2. **Given** an event awaiting review, **When** an admin rejects it (with a reason), **Then** it is
   never made public and the organizer sees the rejection and its reason.
3. **Given** an approved, on-sale event, **When** an admin flags or removes it, **Then** it is pulled
   from the public catalog on the very next request.
4. **Given** a rejected or removed event, **When** its organizer views their own events, **Then** they
   still see it with its moderation state and reason.
5. **Given** an account that is not an admin, **When** it attempts any moderation action, **Then** it is
   refused.
6. **Given** any moderation action, **When** it is taken, **Then** an immutable audit record of who did
   what and when is written.

---

### User Story 7 - Public event pages are shareable and indexable (Priority: P3)

An event's page carries a stable link and the metadata that lets it be shared on social media and found
by search engines.

**Why this priority**: SEO widens the discovery funnel but is not required for the catalog to function,
so it is a polish-level slice.

**Independent Test**: Open an event page, confirm it has a stable slug, a server-renderable title and
description, an open-graph image, and structured event data; confirm the slug does not change when the
event's title is edited.

**Acceptance Scenarios**:

1. **Given** an event, **When** its page is served, **Then** it exposes a title, description, a preview
   image, and structured event data (date, location, offers, availability) suitable for search engines
   and social sharing.
2. **Given** an event whose title is later edited, **When** the edit is saved, **Then** its slug — and
   therefore its link — stays the same.
3. **Given** two events with the same title, **When** both are created, **Then** each gets a distinct
   stable slug.

---

### Edge Cases

- **Sold-out is derived, not stored**: an event is "sold out" only because every one of its upcoming
  showtimes is sold out; it is never a field on the event that can drift from the truth.
- **Event with no showtimes**: shown to its organizer as an incomplete draft; never publishable and
  never public until it has at least one upcoming showtime with a tier.
- **Past showtimes**: a showtime whose start time has passed is excluded from availability and from the
  public "upcoming" listing, but the event remains viewable for history.
- **Seated vs general-admission**: a seated event's availability comes from its seat map; a
  general-admission event's from tier quantities. The two are never mixed on one showtime.
- **Price filtering**: the min/max price filter compares against an event's **lowest** ticket price
  across its tiers, so an event appears if any tier falls in range.
- **City filtering**: an event's city comes from its showtime venue(s); an event in multiple cities
  matches any of them.
- **Slug collision**: two events with identical titles receive distinct slugs; slugs are unique.
- **Unapproved never leaks**: a draft, an event awaiting review (`pending_review`), a flagged, or a
  removed event must never appear in any public list, detail, showtime, or seat-map response, even if
  its id or slug is guessed — only `on_sale` + `approved` is public.
- **Edit after approval re-enters review**: a material edit (title, description, pricing, showtimes) to
  an already-approved event returns it to `pending_review` and pulls it from the public catalog until an
  admin re-approves — otherwise moderation could be bypassed by approving an empty shell then editing.
- **Suspended organizer hides their events**: when an organizer is suspended, every event they own
  disappears from the public catalog on the next request, even ones that are on sale and approved;
  lifting the suspension restores them. Visibility is computed from the organizer's current status, so
  no per-event write is needed.
- **Cross-organizer access**: an organizer requesting another organizer's draft or management endpoint
  is refused; ownership is checked on the server, never assumed from the client.
- **Cross-organizer venue**: an organizer cannot edit, delete, or attach one of *their* events to a
  venue another organizer owns; each organizer manages and uses only their own venues (duplication of a
  physical place across organizers is accepted).
- **Currency**: every price is a whole Vietnamese đồng integer; no fractional or multi-currency values
  exist anywhere in the catalog.

## Requirements *(mandatory)*

### Functional Requirements

**Discovery & search (public)**

- **FR-001**: System MUST let anyone (no sign-in) browse a paginated list of publicly-visible events as
  cards showing at least title, image, category, earliest upcoming showtime, starting price, and city.
- **FR-002**: System MUST let the list be filtered by keyword, category, city, date, minimum price,
  maximum price, and availability, and MUST combine active filters conjunctively.
- **FR-003**: System MUST match a keyword against an event's title, lineup, and description and MUST
  return results ordered by relevance: a title match ranks above a lineup match, which ranks above a
  description-only match; ties are broken by the soonest upcoming showtime.
- **FR-004**: System MUST derive an event's sold-out state from its showtimes (all upcoming showtimes
  sold out) and MUST NOT store it as a mutable field on the event. Sold-out events MUST still appear in
  the catalog with a sold-out label, sorted after events that have availability, unless the availability
  filter excludes them.
- **FR-005**: System MUST return an empty, non-error result when no event matches a query.

**Event detail (public)**

- **FR-006**: System MUST serve an event's full detail by its stable slug: description, category, age
  restriction, lineup, images, ticket tiers with VND prices, venue guide, refund policy.
- **FR-007**: System MUST list an event's upcoming showtimes with date, time, venue, and an availability
  summary.
- **FR-008**: System MUST offer a short list of related events (same category or city) on the detail
  page.
- **FR-009**: System MUST return a clear "not found" outcome for a slug that maps to no publicly-visible
  event, without leaking the existence of drafts or removed events.

**Showtimes & seat map (public, read-only)**

- **FR-010**: System MUST return a showtime's seat map for a seated showtime, showing each seat's row,
  number, price tier, and status (available, held, sold, blocked).
- **FR-011**: System MUST return remaining quantity per ticket tier for a general-admission showtime
  (capacity minus sold minus reserved).
- **FR-012**: System MUST allow guests to **view** a seat map but MUST require sign-in for any
  selection/hold — and this feature MUST NOT create holds (holding is a downstream feature).
- **FR-013**: System MUST exclude started, finished, or cancelled showtimes from availability and mark
  them unavailable.

**Organizer event management**

- **FR-014**: System MUST allow only an **approved organizer** (capability from feature 001) to create
  events, and each event MUST be owned by the organizer that created it.
- **FR-015**: System MUST let an organizer add, edit, and remove showtimes and ticket tiers on their own
  events.
- **FR-016**: System MUST create a new event as a **draft** that is not publicly visible until published.
- **FR-017**: System MUST let an organizer publish and unpublish their own events; publishing requires at
  least one upcoming showtime with at least one ticket tier.
- **FR-018**: System MUST refuse any create/edit/publish/delete action on an event by anyone other than
  its owning organizer (or an admin), enforced on the server.
- **FR-019**: System MUST store and accept every monetary amount as a whole Vietnamese đồng integer and
  MUST refuse fractional values.

**Venue & seat-map management**

- **FR-020**: System MUST let an organizer create venues (name, city, address, guidance) and their
  sections and seats (row, number, seat type). Each venue is **owned by the organizer that created it**;
  only that organizer (or an admin) may edit or delete it, and it may be used only in that organizer's
  own events. (This requires a creator/owner reference on the venue — a schema addition, see
  Dependencies.)
- **FR-021**: System MUST guarantee each seat is unique within a venue by row and number.
- **FR-022**: System MUST let an organizer generate a seated showtime's seat map so that exactly one
  bookable seat exists per physical seat, each starting available and carrying its tier's price.
- **FR-023**: System MUST let a general-admission showtime define capacity per ticket tier as a quantity,
  with no per-seat map.
- **FR-024**: System MUST refuse deletion of a seat or venue element that is part of a live seat map, to
  protect inventory integrity.

**Admin moderation**

- **FR-025**: System MUST let only an admin (a) **approve** an event awaiting review — the gate that
  makes it eligible for public visibility — or **reject** it with a reason, and (b) **flag** or
  **remove** an already-approved event; a flag/remove MUST pull it from the public catalog on the very
  next request, and an approval MUST make it publicly visible (if on sale) on the very next request.
- **FR-026**: System MUST keep a removed/flagged event visible to its owning organizer and to admins,
  with its moderation state and reason.
- **FR-027**: System MUST refuse moderation actions from non-admin accounts.
- **FR-028**: System MUST write an immutable audit record for each moderation action (who, what, when).

**Visibility & SEO**

- **FR-029**: System MUST expose an event publicly only when **all** hold: it is on sale, it is
  admin-approved (`moderation_status='approved'`), **and its owning organizer is currently an approved
  organizer (not suspended)**. It MUST never expose drafts, events awaiting review (`pending_review`),
  flagged, removed, or events whose organizer is suspended, in any public list, detail, showtime, or
  seat-map response.
- **FR-033**: Suspending an organizer (feature 001) MUST hide **all** of that organizer's events from
  the public catalog on the very next request, and lifting the suspension MUST restore them — decided
  from the organizer's current status per request, not by editing each event (mirrors feature 001's
  immediate-suspension rule, FR-021).
- **FR-030**: On publish, the System MUST submit the event for admin review (`pending_review`) and keep
  it **invisible to buyers**; the event becomes public only after an admin approves it (pre-publish
  moderation, see Clarifications, D-C).
- **FR-031**: System MUST give each event a stable slug that does not change when its title is edited,
  and that is unique across events.
- **FR-032**: System MUST expose, for each public event page, a server-renderable title and description,
  a preview image, and structured event data (date, location, offers, availability) for search engines
  and social sharing.

### Key Entities

- **Event**: a happening a visitor can attend — general-admission or seated. Holds a stable slug,
  title, description, category, age restriction, genre/lineup lists, images, refund policy, an
  organizer-facing lifecycle status (draft / on sale / finished / cancelled), an admin moderation state
  (pending / approved / flagged / removed), and SEO fields. Owned by exactly one organizer. Public only
  when on sale and not flagged/removed.
- **Category**: a classification (e.g. music, workshop, theatre) an event belongs to and can be filtered
  by.
- **Venue**: a physical place with a name, city, address, and location guidance, **owned by the
  organizer that created it** and reusable across that organizer's own events. Holds sections and seats.
  Editable only by its owner or an admin.
- **Section / Seat**: the physical layout of a venue — a seat has a row, number, and type and is unique
  within its venue. Not tied to any one showtime.
- **Showtime**: a dated instance of an event at a venue, with a start time and an inventory status. An
  event may have several.
- **Ticket Tier**: a price class within a showtime (label, whole-đồng price, and — for general
  admission — a capacity with sold/reserved counts).
- **Showtime Seat**: for a seated showtime, one bookable instance of a physical seat, carrying a tier and
  a status (available / held / sold / blocked). Read-only in this feature; the holds feature transitions
  it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A visitor can find a specific event using search and filters in under 30 seconds and no
  more than 4 interactions.
- **SC-002**: 95% of catalog searches return results within 1 second under ordinary load.
- **SC-003**: An event detail page presents complete information (tiers, prices, venue, showtimes, refund
  policy) with zero missing mandatory fields for a published event.
- **SC-004**: No draft, unpublished, flagged, or removed event ever appears in any public list, detail,
  showtime, or seat-map response — verified by an automated test that guesses ids/slugs directly.
- **SC-005**: An event's sold-out state always agrees with its showtimes — verified by a test that sells
  out every showtime and confirms the event flips to sold out without any event-level write.
- **SC-006**: An organizer can create, add showtimes/tiers to, and publish an event in under 5 minutes;
  it stays invisible to buyers until an admin approves it, and appears in the public catalog on the
  request after approval.
- **SC-007**: An organizer cannot read or modify another organizer's draft or management data —
  verified by an automated cross-organizer access test that asserts refusal.
- **SC-008**: An admin removal pulls an event from the public catalog on the next request (within 1
  request), verified by an immediate re-fetch.
- **SC-009**: Every price displayed or stored is a whole Vietnamese đồng integer — verified by a test
  that rejects any fractional amount at the boundary.
- **SC-010**: An event's slug is stable across title edits — verified by editing a title and confirming
  the link is unchanged.
- **SC-011**: The frontend's mock `src/data.ts` is fully replaced by the real catalog for the browse and
  detail flows — no screen in those flows reads mock data.

## Assumptions

- **Organizer capability and admin flag come from feature 001** (Account & Authentication): an
  "approved organizer" is an account with an approved organizer application; "admin" is the account
  flag. This feature consumes those, it does not redefine them.
- **Pre-publish moderation** (Clarifications / D-C): an organizer's event is invisible to buyers until
  an admin approves it. Admin approval is therefore **in scope** and on the critical path; the review
  queue must be worked for organizer events to reach buyers.
- **Images and trailers are supplied as URLs**, consistent with the rest of the product; file/image
  upload beyond the avatar case is out of scope here.
- **Vietnamese is the user-facing language** and **VND integer** the only currency (constitution / D1).
- **Physical venues only** — no online/streaming events (schema note).
- **Server-renderable metadata** means the data needed for SEO is available from the API; whether the
  page is pre-rendered or hydrated is an implementation choice for planning.
- **Categories are a fixed, seeded set** (e.g. music, workshop, theatre, community). Organizers pick a
  category when creating an event; adding or editing the category list is an admin concern and is out of
  scope for organizers in this feature.
- **Event cancellation is downstream, not here.** Setting an event to `cancelled` and its money/refund
  consequences belong to the later cancellation/refund feature. This catalog only *reads* lifecycle
  state: `cancelled` and `finished` events are simply excluded from the public on-sale listing (they are
  not `on_sale`). **`finished` is derived** — an event whose every showtime has passed is treated as
  finished and viewable by slug for history, without a stored transition.
- **Pagination**: the public catalog list is paginated with a sensible default page size (≈ 20 per
  page); the exact size and cursor/offset scheme is a planning detail.

## Dependencies

- **Feature 001 (Account & Authentication)** — DONE. Provides the identity, the approved-organizer
  capability (derived per request), and the admin flag this feature authorizes against. Its
  `audit_logs` table is where moderation actions are recorded.
- **Reference schema**: `docs/Analysis_Design/SCHEMA_DATABASE.md` is authoritative for the
  `event_categories`, `venues`, `sections`, `seats`, `events`, `showtimes`, `ticket_tiers`, and
  `showtime_seats` tables and the public API contract shape (decisions D1–D3 apply). **Schema addition
  needed** (not yet in the reference): a `created_by` owner column on `venues` (D-F) — the planning
  phase owns the migration, as `password_resets` was added for feature 001.
- **Downstream consumers** (out of scope here, but this feature is their foundation): **seat holds /
  reservations** lock `showtime_seats`; **checkout / orders**, **tickets**, **wallet**, and **reviews**
  all attach to the events, showtimes, tiers, and seats defined here.

## Decisions Taken

- **D-A — Sold-out and availability are derived from showtimes, never stored on the event.** A stored
  flag inevitably drifts from the seat/tier truth; the catalog computes availability from showtimes and
  their inventory each time it is read.
- **D-B — Public visibility requires BOTH `status='on_sale'` AND `moderation_status='approved'`.** A
  published-but-unreviewed event (`pending_review`) is not visible to buyers; `flagged` and `removed`
  are not visible either. `approved` is the single positive gate.
- **D-C — Pre-publish moderation.** An organizer's published event is invisible to buyers until an admin
  **approves** it. Chosen over reactive moderation for marketplace trust (Constitution Principle II):
  no unreviewed content ever reaches a buyer. **Accepted cost:** admin approval is on the critical path
  — the catalog depends on admins keeping the review queue moving, so the approve action is P2 (US6),
  not a late slice, and the review queue's latency becomes an operational concern.
- **D-D — Ownership is server-enforced.** Every organizer management action is scoped to the owning
  organizer on the server; the client never asserts which event/organizer it is acting for (mirrors
  feature 001 FR-023 and constitution's server-authoritative identity rule).
- **D-E — Public visibility also gates on the owning organizer's live status.** An event is public only
  if its organizer is currently an approved organizer; suspending the organizer hides all their events
  at once (FR-033), computed per request. This closes the gap where a suspended organizer's events would
  otherwise keep selling. Consequence: the public visibility predicate is `event.on_sale ∧
  event.approved ∧ organizer.approved`, evaluated live — never cached onto the event.
- **D-F — Venues are owned per organizer, not shared.** Each venue belongs to its creating organizer;
  only its owner (or an admin) edits/deletes it, and only its owner's events use it. Chosen over an
  admin-curated global venue catalog to avoid cross-organizer edit conflicts and a second admin
  bottleneck; the accepted cost is that one physical place may be entered by several organizers.
  Requires a `created_by` owner column on `venues` (schema addition — the reference schema has none).
