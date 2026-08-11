# Data Model: Event Reviews & Ratings

One new table. Everything else is existing structure this feature reads or reuses.

## Review

New table: `event_reviews`, created by `0020_event_reviews.sql`.

| Field | Type | Rules |
|---|---|---|
| `id` | `BIGSERIAL` | Primary key. |
| `event_id` | `BIGINT` | Required. Foreign key to `events(id)`, `ON DELETE CASCADE` — a deleted event takes its reviews with it, since they describe nothing without it. |
| `user_id` | `BIGINT` nullable | Foreign key to `users(id)`, **`ON DELETE SET NULL`**. Nullable on purpose: a closed account must not remove its ratings, or an event's score would move with account churn and an organizer could lift a poor rating by persuading one reviewer to leave. |
| `rating` | `SMALLINT` | Required, `CHECK (rating BETWEEN 1 AND 5)`. Whole stars only. |
| `body` | `TEXT` nullable | Optional. Stored as the characters the author typed — never escaped on the way in, never markup on the way out. Null when the author wrote nothing or only whitespace. |
| `status` | `TEXT` | `'visible'` or `'removed'`, default `'visible'`. Moderation sets `'removed'`; the author's own withdrawal deletes the row instead. |
| `created_at` | `TIMESTAMPTZ` | Required, defaults to now. |
| `updated_at` | `TIMESTAMPTZ` | Required, defaults to now, moved on every edit. `updated_at > created_at` is what marks a review as edited — no separate flag to keep in step. |

**Indexes**

- `UNIQUE (event_id, user_id) WHERE user_id IS NOT NULL` — one review per person per event, promised by the database rather than by a check-then-insert that two simultaneous submissions both pass. Partial so that several author-less reviews of one event can coexist.
- `(event_id, created_at DESC) WHERE status = 'visible'` — the listing's exact filter and order, so paging is an index scan.

**Rules**

- A review is written only after eligibility is re-derived from the caller's own rows; nothing about eligibility is recorded here, so a later refund cannot leave a rating that outlives its purchase.
- Body length is capped by the service (2000 characters), not by the column: the limit is a product decision that should be changeable without a migration.

## Event Rating Summary

Not a table, and deliberately not a column on `events`.

| Field | Derivation |
|---|---|
| `rating` | `avg(rating)` over `event_reviews` where `event_id` matches and `status = 'visible'`. **Null** when there are none — an unrated event is not a zero-star event. |
| `reviewCount` | `count(*)` over the same rows. |

Computed at read time. A stored counter would need updating on insert, edit, delete and moderation removal — four paths, each able to drift silently — and SC-005 requires the displayed average to equal the mean of live reviews immediately after every one of them. Deriving it makes that true by construction.

## Review Report

Existing table: `content_reports`. No change.

| Field | Use here |
|---|---|
| `target_type` | `'review'`. The column's check constraint already reads `CHECK (target_type = ANY (ARRAY['event','review']))` — feature 004 anticipated this before reviews existed. |
| `target_id` | `event_reviews.id`. |
| `reporter_user_id` | The reader. One report per reader per review; a repeat is answered "already reported" rather than stored again. |
| `reason`, `status`, `resolved_by`, `resolved_at`, `resolution_note` | Unchanged, and the same moderation queue and resolution states admins already use for reported events. |

## Eligibility

Not stored anywhere. A query, run on every write:

```
tickets → orders (user_id = caller, payment_status = 'paid')
        → reservations → showtimes (event_id = target, starts_at < now())
   AND tickets.qr_status <> 'void'
```

Two conditions are reported separately — "you have no paid ticket" and "the event has not happened yet" — so a refusal can name the rule it failed instead of a generic denial the reader cannot act on.

## Event Detail

Existing projection, two fields added, so the detail screen renders the summary from the response it already fetches rather than making a second call on open.

| Field | Type | Rules |
|---|---|---|
| `rating` | `number \| null` | The average above. Null means unrated. |
| `reviewCount` | `number` | Zero when unrated. |
