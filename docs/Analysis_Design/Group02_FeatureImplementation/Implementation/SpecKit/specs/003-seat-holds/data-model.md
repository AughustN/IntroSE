# Data Model: Seat Holds & Reservations (003)

New tables in `server/src/db/migrations/0003_holds.sql`. Existing `showtime_seats` and
`ticket_tiers` (002) gain new *transitions*, not new columns (except the seat mirror already present).
Money is whole VND đồng (BIGINT). Authoritative schema: `docs/Analysis_Design/SCHEMA_DATABASE.md`
(`reservations`, `reservation_items`, "Seat Concurrency Requirement").

## Entities

### `reservations`

One in-progress checkout session for one showtime, owned by one attendee.

| Field | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `user_id` | BIGINT NOT NULL → users(id) | owner; login required (FR-001) |
| `showtime_id` | BIGINT NOT NULL → showtimes(id) | one showtime per reservation (FR-012) |
| `status` | TEXT NOT NULL CHECK (active/expired/converted/cancelled) | lifecycle |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | window origin (FR-006) |
| `expires_at` | TIMESTAMPTZ NOT NULL | source of truth for expiry; seats mirror it |
| `extended_once` | BOOLEAN NOT NULL DEFAULT false | one-time top-up grace guard (FR-010) |

- **Partial unique index** `uq_reservation_active ON reservations(user_id, showtime_id) WHERE
  status='active'` — at most one active reservation per (user, showtime) (R-4, FR-011).
- Index `idx_reservations_sweep ON reservations(status, expires_at)` — drives the sweep.
- Invariant: `expires_at ≤ created_at + HOLD_ABSOLUTE_MS` (14 min) — enforced in app on `extendOnce`.

### `reservation_items`

One line: a specific held seat (seated) **or** a tier quantity (GA).

| Field | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `reservation_id` | BIGINT NOT NULL → reservations(id) | |
| `ticket_tier_id` | BIGINT NOT NULL → ticket_tiers(id) | price class |
| `showtime_seat_id` | BIGINT NULL → showtime_seats(id) | set for seated, NULL for GA |
| `quantity` | INT NOT NULL DEFAULT 1 CHECK (quantity > 0) | GA quantity; 1 per seated seat |
| `unit_price_amount` | BIGINT NOT NULL | VND snapshot at hold time (STD-03) |

- `UNIQUE (reservation_id, showtime_seat_id)` — a seat appears once per reservation (idempotent
  re-hold; NULLs allowed for GA rows).
- Running total (FR-015) = `SUM(quantity * unit_price_amount)`.

### `showtime_seats` (existing, 002) — transitions only

- Status machine this feature drives: `available → held → available` (release/expiry) and leaves
  `held → sold` to feature 004.
- While `held`: `hold_owner_id` = the reservation's `user_id` (never NULL — no anonymous holds,
  FR-001); `hold_expires_at` mirrors the reservation's `expires_at`.
- `blocked` and `sold` are terminal to this feature (never held).

### `ticket_tiers` (existing, 002) — GA reserved count

- `reserved_quantity` is incremented on a GA hold and decremented on release/expiry (R-7).
- Invariant preserved: `sold_quantity + reserved_quantity ≤ COALESCE(total_quantity, …)` (never
  oversold, FR-019, SC-005).

## State machines

**Reservation**

```
(first hold) → active
active → converted   (feature 004, order commit)
active → cancelled   (attendee cancels, FR-014)
active → expired     (sweep past expires_at, FR-008)
```
`extended_once`: false → true once, only while `active`, only via `extendOnce` (FR-010).

**Seat (this feature's slice)**

```
available → held      (hold under FOR UPDATE, owner + expiry set)
held → available      (owner release, cancel, or sweep expiry)
held → sold           (feature 004 only — out of scope here)
```

## Key operations (locking)

| Op | Lock | Effect |
|---|---|---|
| Hold seated | `SELECT … FOR UPDATE` on each `showtime_seats` row | re-check available/expired/mine → `held`; upsert active reservation + item |
| Hold GA | `SELECT … FOR UPDATE` on `ticket_tiers` row | check remaining ≥ qty → `reserved_quantity += qty`; item |
| Release / deselect | lock the seat / tier row | owned+held → `available` / `reserved_quantity -= qty`; drop item |
| Cancel reservation | lock its rows | release all → mark `cancelled` |
| Sweep (per expired active) | one txn per reservation | release all its seats / restore GA → mark `expired`; broadcast |
| `extendOnce` | lock reservation row | refuse if `extended_once`; else bump `expires_at` (≤ ceiling), mirror to seats |

## Configuration (server/src/config.ts)

`HOLD_TTL_MS = 7*60_000` · `HOLD_GRACE_MS = 7*60_000` · `HOLD_ABSOLUTE_MS = 14*60_000` ·
`SEAT_CAP = 8` · `HOLD_SWEEP_INTERVAL_MS = 60_000`.
