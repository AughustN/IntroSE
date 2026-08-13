# Phase 0 Research: Waitlist for Sold-Out Tickets

No `NEEDS CLARIFICATION` remained in the Technical Context — the stack is fixed by the constitution and every table this feature needs already exists. What follows is the set of decisions that had a real alternative.

## 1. Where the availability test belongs

**Decision**: `POST /api/waitlists` judges availability at the scope being joined, by calling the existing `availableForWaitlist(db, showtimeId, tierId)` from `notifications.service.ts`. Export it and delete the inline showtime-wide `EXISTS` query in the route.

**Rationale**: Two functions currently answer "is there stock here" and they disagree. The notifier's version branches on tier; the route's version does not, which is why a sold-out tier refuses a join whenever a sibling tier still sells (spec FR-002, UC-09 A2). One function, used by both the gate and the notifier, cannot drift — and it is already the version the release path trusts.

**Alternatives considered**: Fix the route's query in place — rejected, it recreates the same duplication one bug later. Move both into a new `waitlist.service.ts` — rejected as churn for four endpoints (Principle V); the release notifier that would have to move with it is squarely a notifications concern.

## 2. Position: derived or stored

**Decision**: Derived on read — `count(open entries in this queue with joined_at < mine) + 1`.

**Rationale**: A stored position is a denormalisation that has to be rewritten every time somebody leaves, expires, or converts, and every one of those rewrites is a chance for two rows to claim place 3. `joined_at` is already indexed for exactly this queue (`idx_waitlists_open` on `(showtime_id, ticket_tier_id, joined_at)`), the cap is ten rows, and spec A4 ("later entries move up a position") becomes free rather than a job.

**Alternatives considered**: A `position` column maintained on write — rejected: more state, no faster at ten rows. A window function over the whole queue returned to the client — rejected: sends other people's queue contents to a browser that only needs one number.

## 3. Which statuses count as "in the queue"

**Decision**: `waiting` **and** `notified` are open. Both are counted against the cap of 10, both are ordered by `joined_at` for position and for notification, both are what a leave removes.

**Rationale**: UC-17 A5 is explicit that `notified` is not terminal — a waiter who loses the race keeps their priority. Treating `notified` as gone would let an eleventh person in the moment five are notified, and would silently promote latecomers past someone who has waited longest. The existing partial index and the notifier already use exactly this pair, so this decision is a codification, not a change.

## 4. How entries close

**Decision**: Two writes, both attached to something that already happens.

- `converted` — inside `checkout()` (`wallet.service.ts`), in the same transaction that issues the tickets: close the buyer's open entries for that showtime whose tier matches one of the purchased tiers, plus their any-tier entry for that showtime.
- `expired` — a single `UPDATE … WHERE status IN ('waiting','notified') AND showtime.starts_at <= now()` run from the notification worker's existing 15-minute tick.

**Rationale**: Neither deserves its own scheduler (Principle V). Converting inside the checkout transaction means a purchase and its queue exit commit or roll back together — no window where a buyer holds a ticket and a place in line for it. Expiry is not time-critical: an entry that closes up to fifteen minutes late is invisible, because `notifyWaitlistForShowtime()` already filters on `s.starts_at > now()` and so will never notify a stale entry in the meantime.

**Alternatives considered**: A `pg_cron`/external scheduler — rejected, new infrastructure for one `UPDATE`. Lazy expiry computed at read time only — rejected: the status column would permanently lie to anyone reading the table directly, and the spec names the transition.

## 5. Delivering the notification to a human

**Decision**: A `/notifications` screen listing the existing `GET /api/notifications`, with unread state marked by `POST /api/notifications/:id/read` (and a read-all). The unread count is computed on the client from the same list and shown in the header menu.

**Rationale**: The outbox and its email leg already work; what is missing is only the in-app reader (spec FR-012). Deriving the count from the list the app already fetches avoids a second endpoint, a socket channel, and a polling loop — the count is refreshed whenever the list is, which for a 50-row query is cheap.

**Alternatives considered**: A dedicated `GET /api/notifications/unread-count` — rejected as a second source of truth for one integer. Pushing over the existing seat-map socket — rejected: that channel is scoped to a showtime a buyer is watching, and reliability of a *notification* must not depend on a live socket.

## 6. What the frontend offers, per event type

**Decision**: General admission joins **per tier** (each sold-out tier row carries its own control, `ticketTierId` set). A seated showtime joins **any-tier** (`ticketTierId: null`) from the primary CTA, and only when the whole showtime is sold out.

**Rationale**: A GA tier is the unit a buyer chooses, and UC-09 A2 requires exactly that granularity. For seated events the buyer picks a seat on the next screen, not a tier on this one, so the page has no honest per-tier control to offer — and a seated showtime with no free seat has, by definition, no tier with stock, which is precisely the condition the spec sets for an any-tier entry (FR-002).

**Alternatives considered**: Per-tier joins on seated events too — rejected: it would require loading the seat map's tier breakdown on a page that does not otherwise need it, to let a buyer wait for a tier they never chose.

## 7. Refusing a join that should be a purchase

**Decision**: Keep the existing `409 tickets_available` and have the frontend treat it as an instruction: refresh the tier and point the buyer at the purchase control.

**Rationale**: This is UC-17 A3 and the race is real — stock can return between the page painting and the button being pressed. The server is the only honest judge (Principle I: the database decides, not the seat map UI), so the client must handle being told "no, buy it".

**Alternatives considered**: Hiding the control optimistically on stale client state — rejected, it hides the race instead of handling it.
