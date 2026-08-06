# Phase 1 Data Model: Organizer Event Studio

Migration `server/src/db/migrations/0011_studio.sql`. This feature adds **one column and two indexes**
— almost all of its work is rules over data that already exists.

## Schema changes

### `ticket_tiers` — gains an archive marker

```sql
ALTER TABLE ticket_tiers ADD COLUMN archived_at TIMESTAMPTZ;

-- "Active" is the hot predicate: the 4-tier check, every buyer read, and every organizer read
-- filter on it (R-4).
CREATE INDEX idx_ticket_tiers_active ON ticket_tiers(showtime_id) WHERE archived_at IS NULL;
```

| Column | Meaning |
|---|---|
| `archived_at` | `NULL` = active: purchasable, counts toward the four-tier limit. Non-null = archived: unpurchasable, hidden from buyers, still resolvable by existing orders and tickets, does **not** count toward the limit (FR-006). |

No other column changes. `total_quantity`, `sold_quantity`, and `reserved_quantity` keep their existing
meanings and their existing `CHECK (sold_quantity + reserved_quantity <= COALESCE(total_quantity, …))`,
which stays as the last line of defence behind the FR-004 refusal (R-3).

### `audit_logs` — gains a lookup index

```sql
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
```

No shape change. Two new access patterns justify the index (R-1, R-2): FR-020 asks "was this event
ever approved?" on every delete attempt, and FR-026 now writes a row on every material edit, where
before only admin moderation wrote here.

## Entities

### Ticket tier (managed) — `ticket_tiers`

The existing row, now with a lifecycle.

**States**

```text
                 add (≤ 4 active)
        ∅ ─────────────────────────▶ active
        ▲                            │  │
        │  restore (≤ 4 active)      │  │  archive  (allowed always; required once sold)
        └──────────── archived ◀─────┘  │
                                        ▼
                                     deleted   (only: 0 sold, 0 held, 0 seats, not the last active)
```

**Invariants**

| # | Invariant | Enforced by |
|---|---|---|
| T1 | ≤ 4 tiers with `archived_at IS NULL` per showtime | count under the partial index, checked on add **and** on restore (FR-002, FR-006) |
| T2 | `price_amount` is a non-negative integer of đồng | Zod `z.number().int().nonnegative()` + `BIGINT` column (FR-003, STD-03) |
| T3 | `total_quantity >= sold + reserved` | read under `FOR UPDATE`, plus the existing table CHECK (FR-004, R-3) |
| T4 | `total_quantity` is `NULL` for a tier of a seated showtime | manual capacity refused before the write (FR-005) |
| T5 | a tier with `sold > 0` is never deleted | delete path branches to archive (FR-006) |
| T6 | a tier with `reserved > 0` is never deleted | refusal; archive offered instead (FR-008) |
| T7 | a tier referenced by any bookable `showtime_seats` row is never deleted | refusal pointing at feature 005 (FR-007) |
| T8 | a showtime of an on-sale event always has ≥ 1 active tier | delete/archive refuse the last active one (FR-007) |
| T9 | an archived tier cannot be newly held or newly sold | guard in the GA hold path; excluded from catalog reads (R-4) |

**Derived per tier** (not stored — computed by `tiers.repo.ts`, R-5):

| Field | General admission | Seated |
|---|---|---|
| `capacity` | `total_quantity` | `null` — derived from the seat map, feature 005 |
| `sold` | `sold_quantity` | count of its `showtime_seats` with `status='sold'` |
| `held` | `reserved_quantity` | count of its `showtime_seats` with `status='held'` |
| `remaining` | `capacity − sold − held` | count of its `showtime_seats` with `status='available'` |

### Showtime (editable) — `showtimes`

No schema change. This feature makes three existing columns writable and gates each one.

| Operation | Column | Permitted when |
|---|---|---|
| reschedule | `starts_at` | new time is in the future **and** the showtime has not started and is not `finished`/`cancelled` (FR-012, FR-013) |
| relocate | `venue_id` | 0 sold **and** 0 held **and** no `showtime_seats` rows **and** the target venue is owned by the caller (FR-016, FR-017) |
| delete | — | 0 sold **and** 0 held **and** not started (FR-014, FR-015) |

Deleting a showtime cascades to its tiers and, when it has no bookable seats, nothing else references
it. The 0-sold and 0-held preconditions are what make that cascade safe: a showtime with inventory is
refused before any delete is attempted.

### Event (moderated) — `events`

No schema change. Two behaviours are added over the existing `moderation_status`.

**Moderation transition on edit** (FR-021, the only transition this feature writes):

| Current `moderation_status` | After an organizer edit |
|---|---|
| `approved` | → `pending_review`, `review_note` set to the edited-for-review reason |
| `pending_review` | unchanged — already queued |
| `flagged` | unchanged — admin owns it |
| `removed` | unchanged — admin owns it |

`events.status` (`draft`/`on_sale`/…) is **never** written by this transition (FR-024). Public
visibility is unchanged: `visibility.ts` already computes it live from on-sale + approved + organizer
approved, so pulling the event from the catalog is a consequence of the moderation state, not a second
write.

**Deletion** (FR-020) — permitted only when all four hold:

1. `moderation_status NOT IN ('flagged','removed')`
2. no `event_approved` row in `audit_logs` for this event (R-1)
3. no showtime of the event has a sold ticket or a live hold
4. the caller owns the event

### Edit audit record — `audit_logs`

Existing table, new writer. One row per material edit.

| Column | Value |
|---|---|
| `actor_user_id` | the organizer who made the edit — not an admin, which is new for this table |
| `action` | `event_edited_pending_review` when the edit returned the event to review; `event_inventory_edited` for the FR-021 exemption |
| `target_type` / `target_id` | `'event'` / the event id |
| `detail` | `{ "fields": ["title","tier.price"] }` — **names only, never values** (the spec's clarification) |

Immutable by construction: nothing in the codebase updates or deletes `audit_logs` rows, and no
organizer-facing route reads or writes them except through `writeAudit`.

### Listing suggestion / assistant usage — not persisted

Neither is a table (R-8). The suggestion exists only in the response and in the organizer's form until
they accept it; the per-user hourly count, the 24 h cache, and the daily quota counter live in process
memory. Nothing about an AI call survives a restart, which is correct: a lost cache costs one upstream
call and a reset counter is bounded by the same daily quota guard.

## Cross-feature touches

| File | Change | Why |
|---|---|---|
| `catalog.repo.ts` | tier reads add `AND archived_at IS NULL` | an archived tier must not be offered (FR-006) |
| `visibility.ts` | `SHOWTIME_HAS_AVAILABILITY` adds the same predicate | an archived tier must not keep a showtime looking available |
| `catalog.write.ts` `eventShowtimesManage` | returns archived tiers, flagged | the organizer must see what they archived (FR-009) |
| `holds.repo.ts` | GA hold refuses a tier with `archived_at IS NOT NULL` | otherwise "unpurchasable" is only a display claim (R-4) |

Existing reservations and orders that already reference an archived tier are untouched and continue to
resolve its label and price — that is the whole point of archiving rather than deleting.
