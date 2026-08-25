# Phase 0 Research: Event Catalog & Discovery

Resolves the implementation choices behind the spec. Spec decisions (D-A…D-F) are fixed; this pins the
technical *how*. Each entry: **Decision → Rationale → Alternatives rejected**.

## R-1 — The live public-visibility predicate (D-B/D-E)

**Decision**: One reusable SQL fragment gates every public read:
```sql
FROM events e
JOIN organizers o ON o.id = e.organizer_id
WHERE e.status = 'on_sale'
  AND e.moderation_status = 'approved'
  AND o.status = 'approved'
```
Kept in `catalog/visibility.ts` and composed into every public query (list, detail, showtimes,
seat-map). It is **never** cached onto the event; recomputed each request.

**Rationale**: three independent conditions (organizer publish, admin approval, organizer not
suspended) must all hold, and each can change without touching the event row — exactly like feature
001's per-request suspension read (FR-021). A single fragment guarantees no public endpoint forgets a
clause (SC-004: nothing leaks even by id/slug guess).

**Alternatives rejected**: a stored `is_public` boolean (drifts the moment an organizer is suspended or
an admin acts — the bug D-A/D-E exist to prevent); a database view (fine, but a shared fragment keeps
the join explicit and lets each endpoint add its own filters without view-nesting).

## R-2 — Sold-out & availability derivation (D-A)

**Decision**: Availability is computed, never stored. Per showtime:
- **Seated**: available seats = `count(showtime_seats WHERE status='available')`; sold out when 0.
- **General admission**: remaining per tier = `total_quantity - sold_quantity - reserved_quantity`;
  sold out when every tier's remaining ≤ 0.
An **event** is sold out when every upcoming showtime is sold out. The list query returns an
availability summary (has-availability / sold-out) and starting price via aggregates joined per event.

**Rationale**: the seat/tier counts are the truth; `showtimes.status='sold_out'` in the schema is a
convenience the holds/orders feature may maintain, but the catalog must not depend on it being fresh.
Sold-out events are still shown, labelled, sorted last (FR-004).

**Alternatives rejected**: reading `showtimes.status` alone (can drift before holds/orders maintain it);
a stored event-level sold-out flag (D-A forbids).

## R-3 — Search & relevance (FR-003)

**Decision**: Postgres `ILIKE '%q%'` across `title`, `lineup` (array → `array_to_string`), and
`description`, ranked with a `CASE` (title match = 3, lineup = 2, description-only = 1), ties broken by
soonest upcoming showtime. Filters (category, city via venue, price via min tier, date via showtime,
availability, status) combine as `AND`.

**Rationale**: dozens-to-hundreds of events at this scale → `ILIKE` + a ranking `CASE` is the simplest
correct thing (Principle V). Full-text (`to_tsvector` + GIN) is the noted upgrade once the catalog grows
or Vietnamese stemming matters.

**Alternatives rejected**: `pgvector` semantic search (over-engineering; reserved for AI features);
full-text now (added complexity — GIN index, tsquery parsing — for no MVP benefit).

## R-4 — Stable unique slugs (FR-031)

**Decision**: On event **create**, generate a slug from the title — lowercase, Vietnamese diacritics
folded to ASCII, non-alphanumerics → hyphens — then ensure uniqueness by appending `-2`, `-3`, … on
collision (checked against the `events_slug UNIQUE` constraint, retried on conflict). The slug is
written once and **never regenerated** when the title is later edited.

**Rationale**: FR-031 requires the link to survive title edits; generating only at creation keeps it
stable. The DB UNIQUE is the real guarantee; the suffix loop is for a friendly first choice.

**Alternatives rejected**: regenerating on title change (breaks shared links / SEO); a random-only slug
(unfriendly, no keyword value); no uniqueness handling (violates FR-031 uniqueness under identical
titles).

## R-5 — Moderation state machine (D-C)

**Decision**: Two orthogonal columns on `events`: `status` (draft → on_sale → finished/cancelled) and
`moderation_status` (pending_review → approved; approved → flagged/removed; → removed on reject).
Transitions:
- Organizer **publish**: `status: draft→on_sale`, `moderation_status: →pending_review`. Not public.
- Admin **approve**: `moderation_status: pending_review→approved`. Public (if on_sale + organizer ok).
- Admin **reject**: `moderation_status: pending_review→removed` with a `review`/reason note.
- Admin **flag** / **remove** (post-approval): `approved→flagged` / `→removed`.
- Organizer **unpublish**: `status: on_sale→draft` (pulls it).
- **Material edit** of an approved event (title/description/pricing/showtimes): `approved→pending_review`
  (re-review; edge case).
Every admin moderation action writes an `audit_logs` row (SEC-09, reuse 001's table).

**Rationale**: the two columns model two independent authorities (organizer lifecycle vs admin
moderation); the visibility predicate (R-1) reads both. Re-review-on-edit closes the approve-shell-then-
edit bypass.

**Alternatives rejected**: a single combined status column (conflates two authorities, can't express
"on sale but awaiting review"); a `rejected` value (the schema's CHECK has none — reuse `removed` + a
review note).

## R-6 — Venue ownership (D-F, schema addition)

**Decision**: Add `created_by BIGINT NOT NULL REFERENCES users(id)` to `venues` (the reference schema
has no owner). Organizer venue queries are scoped to `created_by = <caller>`; only the owner or an admin
may edit/delete; an event may reference only a venue its organizer owns. Enforced by a `requireOwner`
check, server-side.

**Rationale**: closes the cross-organizer venue-edit hole (D-F); a physical place duplicated across
organizers is the accepted cost.

**Alternatives rejected**: admin-curated global venues (a second admin bottleneck); no owner column
(anyone edits anyone's venue).

## R-7 — Seat-map generation (US5, seated showtimes)

**Decision**: For a seated showtime, `seatmap.generate` inserts one `showtime_seats` row per physical
seat of the venue, `status='available'`, with `ticket_tier_id` assigned **per section**: the organizer
maps each of the venue's `sections` to one ticket tier (e.g. section "Khu VIP" → tier VIP), and every
seat inherits its section's tier. Uses `INSERT … SELECT` joining `seats → sections → (section→tier map)`
in one transaction. Regeneration is refused if any `showtime_seats` row for the showtime is not
`available` (would clobber a live map); deleting a seat that is part of a live map is refused (FR-024).
GA showtimes get no seat map — capacity lives on `ticket_tiers.total_quantity`.

**Tier assignment = per-section** (decided): simplest mapping that fits the existing `sections` structure
and real venue layouts (price zones are sections). Rejected: per-seat/per-row assignment (flexible but a
heavy organizer UI for the MVP); a single default tier (too coarse for a real priced seat map). A future
per-seat override can layer on top without changing the generation model.

**Rationale**: one bookable seat per physical seat (FR-022) is exactly what the holds feature will lock;
generating it as a set operation is atomic and fast.

**Alternatives rejected**: lazy per-click seat creation (races with holds; the map must pre-exist);
allowing regeneration over a live map (destroys inventory).

## R-8 — Ownership & organizer-identity mapping (D-D)

**Decision**: `events.organizer_id` references a specific approved `organizers` row. On create, the
server resolves the caller's **approved organizer row** (`organizers WHERE user_id=$me AND
status='approved'`) and stamps its id. `requireOwner` for an event checks
`event.organizer_id → organizers.user_id === req.auth.userId` (admin bypasses). Venue ownership checks
`venues.created_by === req.auth.userId`.

**Rationale**: feature 001 derives organizer capability from the approved row; the event binds to that
row so a later suspension of the organizer (its `status`) flips visibility via R-1 automatically.

**Alternatives rejected**: binding events to `user_id` directly (loses the organizer-application link
that D-E's suspension gating rides on); trusting a client-supplied organizer id (violates D-D).

## R-9 — Pagination

**Decision**: Offset/limit on the public list, default page size 20, capped (e.g. 50), returning a total
count for the UI. Stable ordering: availability first, then relevance/soonest-showtime, then id.

**Rationale**: simplest correct paging at this scale; a stable secondary sort keeps pages consistent.

**Alternatives rejected**: keyset/cursor paging (unneeded at catalog scale; revisit if lists grow huge).

## R-10 — Categories seeding

**Decision**: `event_categories` is seeded with a fixed set (music, workshop, theatre, community, …) in
`0002_catalog.sql`. Organizers pick a category by code; there is no organizer-facing category CRUD.
Category management is a future admin concern.

**Rationale**: matches the spec assumption; keeps the MVP surface small (Principle V).

**Alternatives rejected**: organizer-created categories (uncontrolled taxonomy, moderation burden).

## R-11 — SEO metadata & JSON-LD (FR-032)

**Decision**: The event-detail endpoint returns the fields needed for SEO (title, description, image,
start date, location, offers, availability). The FE renders `<title>`/meta and a JSON-LD `Event` block
from that payload; the slug is the canonical URL. Whether pre-rendered or hydrated is deferred (the data
is API-available either way).

**Rationale**: satisfies FR-032 without committing to SSR now; the SPA can hydrate the metadata and the
slug is stable (R-4).

**Alternatives rejected**: full SSR framework migration (out of scope, large); no structured data
(fails FR-032).

## R-12 — Retiring the frontend mock (SC-011)

**Decision**: A `catalogClient` (fetch, reusing `authClient`'s in-memory token for authenticated
organizer/admin calls) replaces `src/data.ts` for the browse and detail flows. The `MovieEvent` mock
type is superseded by `shared/catalog` types; remaining mock references are removed from those screens.

**Rationale**: SC-011 requires the real catalog to back the browse/detail flows; sharing the typed
contract (Principle VI) prevents FE/BE drift.

**Alternatives rejected**: keeping `data.ts` as a fallback (two sources of truth, drift).
