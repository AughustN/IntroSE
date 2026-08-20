# Quickstart: Event Reviews & Ratings

Validation guide. Payload shapes are in [contracts/reviews.openapi.yaml](./contracts/reviews.openapi.yaml); field rules in [data-model.md](./data-model.md).

## Prerequisites

- PostgreSQL reachable through `DATABASE_URL`; `TEST_DATABASE_URL` pointing at a Neon branch nobody else uses (the suite truncates thirty tables before every test).
- Dependencies installed; `npm run db:migrate` applied.
- **An account holding a paid, non-void ticket to the event, whether or not its showtime has started.** This is the whole eligibility rule, and without one there is nothing to test. On the current development data eligible (account, event) pairs can be listed with `SELECT o.user_id, s.event_id FROM tickets t JOIN orders o ON o.id = t.order_id JOIN reservations r ON r.id = o.reservation_id JOIN showtimes s ON s.id = r.showtime_id WHERE o.payment_status = 'paid' AND t.qr_status <> 'void'`.
- An admin account, and a second ordinary account with no ticket to that event.

## Apply schema

```powershell
npm run db:migrate
```

Expected: `0020_event_reviews.sql` creates `event_reviews` with a partial unique index on `(event_id, user_id)` and a listing index on `(event_id, created_at DESC) WHERE status = 'visible'`. No existing table changes.

## Run the automated suite

```powershell
npm run typecheck
npm test -- --run
npm run lint
```

Expected: zero type errors, zero lint errors, `server/tests/reviews/` passing, review-module statement coverage at or above 60%.

## Scenario 1 — Write a review

Sign in as the eligible account with a paid, non-void ticket, open the event, and submit four stars with a sentence.

Expected: the review appears immediately at the top of the list with the account's name and avatar; the summary above shows `4.0` and a count one higher than before.

## Scenario 2 — Stars are required

Open the form, type text, submit without choosing a star.

Expected: submission is refused with a stated reason and nothing is stored.

## Scenario 3 — Text is text, not markup

Submit a review whose body is `<script>alert(1)</script> **bold**`.

Expected: the page shows those characters literally — no dialog, no bold. Fetch the same review from the API and confirm the body comes back byte-identical to what was typed: escaping belongs at the render boundary, not in storage.

## Scenario 4 — One review per person

With the same account, open the event again.

Expected: the form is pre-filled with the existing review and offers to update it; there is no way to add a second. Change the rating to two stars and save — the list still holds one review from this account, now showing two stars and marked as edited, and the summary has moved.

## Scenario 5 — Only ticket holders

Sign in as the account with no ticket to that event.

Expected: no form, and a line explaining that a ticket to the event is needed. Then call the API directly:

```powershell
curl -X POST http://localhost:4000/api/events/<id>/reviews -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{\"rating\":5}'
```

Expected: `403` with code `no_ticket`. Repeat against an event before its showtime with an account that *does* hold a paid, non-void ticket: the review is accepted, because timing is not an eligibility condition. Repeat with no token at all: `401`.

## Scenario 6 — Reading needs no account

Sign out and open the same event.

Expected: the average, the count and every review are visible. The form is replaced by an invitation to sign in.

## Scenario 7 — Paging

On an event with more than ten reviews, scroll to the end of the list and use "load more".

Expected: older reviews append, none repeats, and the order stays newest-first throughout.

## Scenario 8 — Withdraw your own

Delete your review.

Expected: it disappears; the summary recalculates without it. If it was the only one, the event shows as unrated rather than zero stars.

## Scenario 9 — Report and moderate

As a second signed-in account, report a review with a reason. Report it again.

Expected: the first is acknowledged; the second answers "already reported" and creates no duplicate.

Sign in as an admin, find the report in the moderation queue, and remove the review.

Expected: the review disappears from the event and stops counting toward the average; the row is still present with `status = 'removed'`; an `audit_logs` entry records the removal and its actor.

## Scenario 10 — Somebody else's review

As an ordinary account, call `PATCH /api/reviews/<someone-else's-id>` and `DELETE` on the same id.

Expected: `404` both times — not `403`, so probing ids reveals nothing about which reviews exist.

## Cleanup

```sql
DELETE FROM content_reports WHERE target_type = 'review';
DELETE FROM event_reviews WHERE event_id = <id>;
```
