# Phase 1 Data Model: Event Catalog & Discovery

Scope: the 8 catalog tables this feature **creates** (migration `0002_catalog.sql`). Authoritative
reference is `docs/Analysis_Design/SCHEMA_DATABASE.md`; this restates the catalog subset and records the
**one addition** it lacks (`venues.created_by`, D-F) plus the catalog-specific rules the grill settled
(D-A…D-F). None of these tables exist yet — only the auth tables from `0001_auth.sql`.

## Tables

### `event_categories` (seeded, R-10)

`id SMALLSERIAL PK`, `code TEXT UNIQUE NOT NULL`, `label_vi TEXT NOT NULL`, `label_en TEXT`. Seeded with
a fixed set (music, workshop, theatre, community, …). Not organizer-editable.

### `venues` — **+ `created_by` (NEW, D-F)**

| Field | Type | Rule |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `created_by` | BIGINT NOT NULL → users(id) | **owner** — only this user (or an admin) edits/deletes; only their events use it (D-F, R-6) |
| `name` / `city` / `raw_address` | TEXT NOT NULL | |
| `address_line` / `map_url` / `guide` | TEXT | location guidance |
| `normalized_name` | generated | `lower(regexp_replace(name,'\s+',' '))` |
| `created_at` | TIMESTAMPTZ | |

`UNIQUE(normalized_name, city)` is **dropped** in favour of the per-owner model (two organizers may
enter the same physical place). Index `idx_venues_created_by`.

### `sections`, `seats` (physical layout)

`sections(id, venue_id→venues, name, description, UNIQUE(venue_id,name))` — a **section is the unit of
tier pricing**: when generating a seated seat map, the organizer maps each section to one ticket tier and
every seat in it inherits that tier (R-7, per-section decision).
`seats(id, venue_id→venues, section_id→sections, row_label, seat_number, seat_type CHECK in
single/double/standing, UNIQUE(venue_id,row_label,seat_number))` — a seat is unique within its venue
(FR-021). A seat that is part of a live seat map cannot be deleted (FR-024).

### `events`

| Field | Type | Rule |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `slug` | TEXT UNIQUE NOT NULL | stable, set once at create, never regenerated on title edit (FR-031, R-4) |
| `organizer_id` | BIGINT NOT NULL → organizers(id) | the caller's **approved** organizer row (R-8) |
| `category_id` | SMALLINT NOT NULL → event_categories | |
| `title`/`description` | TEXT NOT NULL | |
| `age_restriction` | TEXT CHECK in all/13+/16+/18+ | |
| `genre` / `lineup` | TEXT[] | searchable (R-3) |
| `image_url`/`trailer_url`/`refund_policy` | TEXT | URLs (assumption) |
| `event_type` | TEXT CHECK in general_admission/seated | |
| `status` | TEXT CHECK in draft/on_sale/finished/cancelled DEFAULT draft | organizer lifecycle |
| `moderation_status` | TEXT CHECK in pending_review/approved/flagged/removed DEFAULT pending_review | admin gate |
| `review_note` | TEXT | admin's reject/flag/remove reason (shown to organizer) |
| `seo_title`/`seo_description` | TEXT | FR-032 |
| `created_at`/`updated_at` | TIMESTAMPTZ | |

Indexes: `events_slug UNIQUE`, `idx_events_category`, `idx_events_status`, `idx_events_organizer`,
`idx_events_moderation`.

**State machines (R-5)** — two orthogonal columns:
- `status`: `draft →(publish)→ on_sale →(unpublish)→ draft`; `→ finished` (derived: all showtimes past);
  `→ cancelled` (downstream feature).
- `moderation_status`: `pending_review →(admin approve)→ approved`; `pending_review →(admin reject)→
  removed`; `approved →(flag)→ flagged`; `approved/flagged →(remove)→ removed`; `approved →(material
  edit)→ pending_review` (re-review).

### `showtimes`

`id, event_id→events, venue_id→venues, starts_at TIMESTAMPTZ NOT NULL, ends_at, status CHECK in
scheduled/on_sale/sold_out/finished/cancelled`. Indexes `idx_showtimes_event`,
`idx_showtimes_starts_at`. A **past** `starts_at` is excluded from public availability (derived, R-2).

### `ticket_tiers`

`id, showtime_id→showtimes, label, price_amount BIGINT NOT NULL (whole VND đồng, FR-019/D1), description,
badge, total_quantity INT (GA capacity; NULL for seated), sold_quantity INT DEFAULT 0, reserved_quantity
INT DEFAULT 0, CHECK(sold+reserved ≤ COALESCE(total, sold+reserved))`. Index `idx_ticket_tiers_showtime`.
Prices are integers only — a fractional value is refused at the boundary (SC-009).

### `showtime_seats` (seated; **read-only in this feature**)

`id, showtime_id→showtimes, seat_id→seats, ticket_tier_id→ticket_tiers, status CHECK in
available/held/sold/blocked DEFAULT available, hold_owner_id→users, hold_expires_at, UNIQUE(showtime_id,
seat_id)`. Indexes `idx_showtime_seats_showtime(showtime_id,status)`,
`idx_showtime_seats_hold_expiry WHERE status='held'`. **This feature only generates (US5/R-7) and reads
these rows; the transitions available→held→sold belong to the holds/orders features.**

## Derived, never stored (D-A)

- **Public visibility** of an event = `status='on_sale' ∧ moderation_status='approved' ∧ owning
  organizer's `organizers.status='approved'`, computed per request (R-1). Not a column.
- **Sold-out** of a showtime = no available seat (seated) or every tier remaining ≤ 0 (GA); of an event =
  all upcoming showtimes sold out (R-2). Not a column.
- **City** of an event = its showtime venues' cities (an event may span cities). Not a column.
- **Starting price** = min tier `price_amount` across the event's showtimes. Not a column.
- **Finished** = all showtimes' `starts_at` in the past. Not a stored transition.

## Cross-entity invariants (assert in tests)

- **No leak (SC-004)**: no draft / `pending_review` / `flagged` / `removed` event, and no event whose
  organizer is suspended, appears in any public list, detail, showtime, or seat-map response — even by
  direct id/slug.
- **Ownership (SC-007, D-D)**: an organizer can read/modify only their own events and venues; a cross-
  organizer request is refused server-side.
- **Sold-out agrees with inventory (SC-005)**: selling out every showtime flips the event to sold-out
  with **no** event-level write.
- **Slug stable & unique (SC-010, FR-031)**: a title edit leaves the slug unchanged; identical titles get
  distinct slugs.
- **VND integer (SC-009, D1)**: every `*_amount` is a whole đồng; a fractional value is refused.
- **One bookable seat per physical seat (FR-022)**: `UNIQUE(showtime_id, seat_id)` on `showtime_seats`.
- **Suspension hides events (FR-033/D-E)**: suspending an organizer removes all their events from public
  reads on the next request, via the live predicate — no per-event write.
