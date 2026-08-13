# Quickstart: Waitlist for Sold-Out Tickets

Validation guide. Payload shapes are in [contracts/waitlist.openapi.yaml](./contracts/waitlist.openapi.yaml); field rules and the state machine in [data-model.md](./data-model.md).

## Prerequisites

- PostgreSQL reachable through `DATABASE_URL`; `TEST_DATABASE_URL` pointing at a Neon branch nobody else uses (the suite truncates before every test).
- Dependencies installed. **No migration is needed** — `waitlists` and `notifications` shipped in `0015_notifications.sql`. Confirm with `SELECT count(*) FROM waitlists;` before starting; if that errors, run `npm run db:migrate`.
- **A showtime with one sold-out general-admission tier and one tier that still sells.** This is the case the current server gets wrong, so nothing about FR-002 can be validated without it. Build it by setting a tier's `total_quantity` equal to its `sold_quantity`, leaving a sibling tier alone.
- **A seated showtime with no available seat** (`SELECT count(*) FROM showtime_seats WHERE showtime_id = $1 AND status = 'available'` returns 0), for the any-tier path.
- **A paid, cancellable ticket** on a waited-on showtime (starts more than 24h out), to trigger a release without waiting for a hold to expire.
- Three signed-in accounts minimum: one waiter, one second waiter, one to attempt somebody else's entry. Twelve accounts if you want to exercise the cap by hand rather than through the test suite.

## Run the automated suite first

The invariants are pinned by tests, and those tests are written before the code they pin (constitution IV).

```powershell
npm run typecheck
npm test -- --run
npm run lint
```

Expected: zero type errors, zero lint errors, and `server/tests/notifications/waitlist-*.test.ts` passing —

| File | Pins |
|---|---|
| `waitlist-join.test.ts` | cap of 10; concurrent join at the cap admits exactly one; duplicate join returns the existing entry with `existing: true`; **a sold-out tier is joinable while a sibling tier still sells**; a tier with stock is refused `tickets_available`; started/cancelled showtime refused |
| `waitlist-leave.test.ts` | owner may delete; another account gets 404 and the row survives; positions behind a departure decrease by one |
| `waitlist-notify.test.ts` | at most 5 per tier per release; selection is by `joined_at` regardless of `waiting` vs `notified`; a re-notified entry keeps its original position |
| `waitlist-lifecycle.test.ts` | entries close `expired` once the showtime has started; a purchase closes the buyer's matching entries `converted` in the same transaction |

## Scenario 1 — Join a sold-out tier while its sibling still sells

Sign in, open the event with the mixed showtime.

Expected: the sold-out tier's stepper is replaced by a waitlist control and says why; the sibling tier still sells normally. Press the control, read the confirmation — it must state that **no ticket is reserved** — and accept.

Expected after: the row shows your position (`#1` on an empty queue) and offers a way to leave. `GET /api/waitlists?showtimeId=…` returns one entry with that position.

This is the case that fails on the current server with `409 tickets_available`.

## Scenario 2 — Any-tier join on a sold-out seated showtime

Open the seated showtime with no free seat.

Expected: the primary CTA reads as a waitlist action rather than a disabled "Hết vé"; joining records an entry with `ticketTierId: null`. Attempt the same join on a seated showtime that still has one free seat: refused, and the interface points you at buying.

## Scenario 3 — Duplicate and cap

With the same account, press join again (reload first).

Expected: no second entry; your existing position is shown; the API answers `200` with `existing: true`.

Fill the queue to ten entries (the suite does this faster than you can), then join with an eleventh account.

Expected: refused with `waitlist_full` and a sentence explaining the cap of ten — not a generic error.

## Scenario 4 — A release notifies the queue

With two accounts queued on the same tier, cancel the paid ticket for that showtime (`/bookings` → the ticket → cancel), or let a hold expire.

Expected within one worker tick: both accounts have a `waitlist_open` notification; their entries read `notified` with `notified_at` set; **neither has anything reserved**. With more than five waiters, exactly the five earliest by `joined_at` are notified.

## Scenario 5 — Read the notification in the app

Sign in as a notified waiter.

Expected: the header shows an unread count; opening "Thông báo" lists the notification newest-first, unread visibly distinct; opening it marks it read (the count drops) and lands on the event it concerns. An account with no notifications sees a plain empty state, not an empty frame.

## Scenario 6 — Lose the race, keep your place

From two notified accounts, let the first buy the freed ticket and the second do nothing. Free inventory again.

Expected: the second account is notified again, and its position is unchanged — `joined_at` was never rewritten. The first account's entry is now `converted` and no longer counts against the cap or appears in `GET /api/waitlists`.

## Scenario 7 — Leave, and the queue closes up

With three accounts queued at positions 1–3, have #1 leave.

Expected: their entry is gone from `GET /api/waitlists`; #2 and #3 now read positions 1 and 2; a later release sends nothing to the account that left. Then attempt `DELETE /api/waitlists/{id}` against another account's entry: `404`, and that entry still exists.

## Scenario 8 — Expiry

Point a queued showtime's `starts_at` into the past and wait for a worker tick (or call the sweep directly in a test).

Expected: the entries read `expired`, they vanish from `GET /api/waitlists`, and no notification is produced for that showtime afterwards.

## Manual API check

```powershell
curl -X POST http://localhost:3000/api/waitlists -H "Content-Type: application/json" -b "tix_access=<token>" -d '{"showtimeId": 1, "ticketTierId": 2}'
curl http://localhost:3000/api/waitlists?showtimeId=1 -b "tix_access=<token>"
curl -X DELETE http://localhost:3000/api/waitlists/1 -b "tix_access=<token>"
curl http://localhost:3000/api/notifications -b "tix_access=<token>"
```

Expected: shapes match `contracts/waitlist.openapi.yaml` exactly. Every one of the four without a session cookie returns `401` — the interface hiding a control is not access control (constitution II).
