# Phase 1 Data Model: Waitlist for Sold-Out Tickets

**No migration.** Every table and index this feature needs shipped in `server/src/db/migrations/0015_notifications.sql`. What follows records what the columns mean once all of UC-17 is implemented, since half of them have never been written to.

## `waitlists`

One attendee waiting on one showtime, optionally narrowed to one ticket tier.

| Column | Type | Meaning |
|---|---|---|
| `id` | BIGSERIAL PK | Entry identity. What `DELETE /api/waitlists/:id` names. |
| `user_id` | BIGINT → `users(id)` | The waiter. The only ownership check that matters. |
| `showtime_id` | BIGINT → `showtimes(id)` | The queue's showtime. |
| `ticket_tier_id` | BIGINT → `ticket_tiers(id)`, NULL | The tier queued for; `NULL` means "any tier of this showtime". |
| `status` | TEXT | `waiting` \| `notified` \| `expired` \| `converted`. |
| `joined_at` | TIMESTAMPTZ | Queue order and priority. Never rewritten — not by a notification, not by a re-notification. |
| `notified_at` | TIMESTAMPTZ NULL | *Most recent* notification, not a one-shot burn. |

### Constraints already in the schema

- `UNIQUE (user_id, showtime_id, ticket_tier_id)` — one entry per person per tier queue.
- `waitlists_user_any_tier_once` — partial unique index on `(user_id, showtime_id) WHERE ticket_tier_id IS NULL`, because Postgres treats NULLs as distinct and the plain UNIQUE above would let a person hold ten any-tier entries.
- `idx_waitlists_open` on `(showtime_id, ticket_tier_id, joined_at) WHERE status IN ('waiting','notified')` — serves the cap count, the position count, and the notifier's ordering.

### State transitions

```text
                 join
                  │
                  ▼
             ┌─────────┐   inventory frees    ┌──────────┐
             │ waiting │ ───────────────────► │ notified │
             └─────────┘                      └──────────┘
                  │  │                          │   │  ▲
      leave (row  │  │  showtime starts         │   │  └── inventory frees again
       deleted) ◄─┘  ▼                          │   │      (joined_at unchanged)
                ┌─────────┐                     │   ▼
                │ expired │ ◄───────────────────┘  ┌───────────┐
                └─────────┘   showtime starts      │ converted │
                                                   └───────────┘
                                                    buyer checks out
```

**Open** = `waiting` ∪ `notified`. Open entries are what the cap counts, what position counts, what the notifier reads, and what a leave deletes. `expired` and `converted` are terminal and invisible to all four.

`notified` is **not** terminal (UC-17 A5): a waiter who loses the race is notified again at the next release and keeps their original `joined_at`, so they keep their place.

### Derived values (never stored)

- **Position** — `count(open entries in this queue with joined_at < mine) + 1`. Recomputed on read; a departure moves everyone behind up automatically. See `research.md` §2.
- **Queue depth** — `count(open entries)`. Compared against the cap of **10** on join.
- **Sold out** — not a waitlist column at all: `availableForWaitlist(db, showtimeId, tierId)` answers it from `ticket_tiers` (`sold + reserved < total_quantity`) or `showtime_seats` (`status = 'available'`) depending on the tier's kind. A tier with `total_quantity IS NULL` and no seats is never sold out.

### Validation rules

| Rule | Where enforced | Failure |
|---|---|---|
| Showtime exists, is upcoming, not cancelled | Join, inside the transaction, `SELECT … FOR UPDATE` | `404 showtime_not_found` |
| Tier belongs to that showtime | Join | `400 validation_failed` |
| The joined scope has no stock | Join, via `availableForWaitlist` | `409 tickets_available` |
| Open entries in this queue < 10 | Join, counted under the same row lock | `409 waitlist_full` |
| One entry per (user, showtime, tier) | Join returns the existing entry; DB unique index is the backstop | `200` with `existing: true` |
| The entry belongs to the caller | Leave, as `WHERE id = $1 AND user_id = $2` | `404 waitlist_entry_not_found` |
| Session required | `notificationRouter.use(requireAuth)` | `401` |

## `notifications` (existing, unchanged)

Relevant to this feature only through the `waitlist_open` type and the read flag.

| Column | Meaning here |
|---|---|
| `type` | `waitlist_open` — one of the existing union members. |
| `dedupe_key` | `waitlist_open:{entryId}:{timestamp}` — deliberately unique per release, because re-notification is required (A5). |
| `payload` | `{ eventTitle, showtimeId }`, plus the event slug so the in-app row can link to the event page. |
| `read_at` | Written by `POST /api/notifications/:id/read`; `NULL` is unread. The unread count is `count(read_at IS NULL)` over the fetched page. |
| `event_id` | Set on `waitlist_open` so the reader can resolve the destination without trusting the payload. |

## Shared contract types

Declared once, imported by both sides (constitution VI). Mirrors `contracts/waitlist.openapi.yaml`.

```text
shared/waitlist/types.ts
  WaitlistStatus      = 'waiting' | 'notified' | 'expired' | 'converted'
  WaitlistEntry       { id, showtimeId, ticketTierId, status, position, joinedAt, notifiedAt }
  WaitlistJoinInput   { showtimeId, ticketTierId? }
  WaitlistJoinResult  { entry: WaitlistEntry, existing: boolean }

shared/notifications/types.ts
  NotificationType    = 'order_confirmed' | 'ticket_resend' | 'reminder_7d' | 'reminder_1d'
                      | 'event_changed' | 'event_cancelled' | 'waitlist_open' | 'announcement'
  NotificationItem    { id, type, title, body, payload, eventSlug?, readAt, createdAt }
```

`NotificationType` is moved from its private declaration in `notifications.service.ts` into the shared module and imported back, so the server and the client cannot disagree about what kinds exist.
