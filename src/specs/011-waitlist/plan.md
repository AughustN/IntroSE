# Implementation Plan: Waitlist for Sold-Out Tickets

**Branch**: `011-waitlist` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-waitlist/spec.md`

## Summary

Finish UC-17. The queue itself already exists on the server — table, join endpoint, and the release-notifier wired to the two events that free inventory — so this feature is mostly **the four things missing around it**: a correct scope test on join, the three flows nobody wrote (position, leave, close), a way for an attendee to actually join from the event page, and a place to read the notification that results.

Technical approach, in one line each:

1. **Scope fix** — `POST /api/waitlists` stops asking "does this *showtime* have stock" and asks "does *this scope* have stock", reusing `availableForWaitlist()`, which already answers per tier and is already what the notifier trusts.
2. **Position** — derived, never stored: count open entries of the queue with an earlier `joined_at`, plus one. Nothing to keep in step when somebody leaves.
3. **Leave** — `DELETE /api/waitlists/:id` with a server-side owner check; positions behind it move up on their own because they are derived.
4. **Close** — `converted` written inside the existing checkout transaction; `expired` swept by the notification worker tick that already runs every 15 minutes.
5. **Frontend** — a `waitlistClient`, a per-tier join/leave control on `EventDetail` for general admission, the same control on the primary CTA for a sold-out seated showtime, and a `/notifications` screen plus an unread count in the header menu.

No migration, no new table, no new scheduler, no new dependency.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 ESM server, React 19 + Vite frontend

**Primary Dependencies**: Express 4, `pg` (raw parameterized SQL, no ORM), Zod validation, React 19, Tailwind 4, lucide-react. Reused, not added: the `notifications` outbox and its worker, Resend for the email leg.

**Storage**: PostgreSQL (Neon). Tables `waitlists`, `notifications`, `notification_logs` all exist from migration `0015_notifications.sql`. **This feature adds no migration.**

**Testing**: Vitest (`npm test`), server integration tests under `server/tests/` against a live test database, as the other features do.

**Target Platform**: Same-origin web app behind Nginx on the team VPS; browser is desktop + mobile (PLAT-01 breakpoints).

**Project Type**: Web application — one repository, `server/` and `src/` sharing `shared/` contract types.

**Performance Goals**: Join/leave/position round trips are ordinary CRUD (<200 ms p95). The release notifier stays off the critical path: cancellation and hold-expiry return without waiting on delivery, as they do today.

**Constraints**: Free-tier discipline — DB pool ≤ 20 unchanged, no new background process, no polling loop tighter than the existing 15-minute worker tick. In-app unread count is fetched with the notification list, not by a dedicated endpoint or a socket.

**Scale/Scope**: 10 entries per queue, ≤5 notified per tier per release. Roughly 2 server files touched, 2 new shared type modules, 1 new frontend screen, 1 new frontend service, 2 edited frontend components, ~6 test files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Reliability Under Load** | The cap and the duplicate rule must hold under concurrent joins; the queue's order must be stable. | **PASS** — join stays inside `withTransaction` and keeps the existing `SELECT … FOR UPDATE` on the showtime row, which serializes concurrent joins on one queue. Order is `joined_at`, never a stored position, so nothing can drift. Notification is fire-and-forget after commit, so a waiting list never delays a cancellation. |
| **II. Security & Trust** | Every endpoint authenticated; ownership enforced server-side; input schema-validated; SQL parameterized. | **PASS** — `notificationRouter.use(requireAuth)` already covers the whole router. `DELETE` filters on `user_id = $auth` in the statement itself rather than reading then checking, so a forged id returns 404 and touches nothing. Zod schemas on every body/param. No new personal data is stored. |
| **III. AI Assistive** | — | **N/A** — no AI on this path. |
| **IV. Verifiable & Test-First** | Invariants pinned by tests before merge; denial paths tested. | **PASS** — tests are written before the code they pin (see quickstart): cap-at-10, concurrent join at the cap, duplicate join, per-tier scope refusal, join-while-available refusal, ownership refusal on delete, notify-top-5-by-join-time, re-notify keeps priority. |
| **V. Simplicity & Free Tier** | No infrastructure ahead of need. | **PASS** — no migration, no new table, no scheduler, no socket channel, no new dependency. Expiry rides the worker tick that already fires; unread count is derived from the list the page already fetches. |
| **VI. Clean Codebase & FE/BE Contract** | One shared type per payload, imported by both sides; no re-declared shapes. | **PASS** — `shared/waitlist/types.ts` and `shared/notifications/types.ts` are the single declaration, mirrored by `contracts/waitlist.openapi.yaml`. The frontend imports them; the routes type their responses against them. |

**Post-Phase-1 re-check**: still PASS. The design added no table, no endpoint outside the existing router, and no state the server does not already own. The one judgement call — deriving position instead of storing it — moves *away* from complexity, and `data-model.md` records why.

## Project Structure

### Documentation (this feature)

```text
specs/011-waitlist/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── waitlist.openapi.yaml
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
shared/
├── waitlist/types.ts                     # NEW — entry, join input, block reasons
└── notifications/types.ts                # NEW — notification item + type union

server/src/modules/
├── notifications/
│   ├── notifications.routes.ts           # EDIT — scope fix, position, GET mine, DELETE, read-marking
│   └── notifications.service.ts          # EDIT — export availableForWaitlist, expiry sweep, converted helper
└── payments/
    └── wallet.service.ts                 # EDIT — mark converted inside the checkout transaction

server/tests/notifications/
├── waitlist-join.test.ts                 # NEW — cap, duplicate, scope, availability refusal
├── waitlist-leave.test.ts                # NEW — ownership, position recompute
├── waitlist-notify.test.ts               # NEW — top-5 per tier, joined_at order, re-notify
└── waitlist-lifecycle.test.ts            # NEW — expired on start, converted on purchase

src/
├── services/
│   ├── waitlistClient.ts                 # NEW
│   └── notificationsClient.ts            # NEW
├── components/
│   ├── EventDetail.tsx                   # EDIT — join/leave control per sold-out tier + sold-out CTA
│   ├── Header.tsx                         # EDIT — "Thông báo" destination + unread count
│   └── NotificationsPage.tsx             # NEW — the in-app list
├── routes.ts                             # EDIT — `notifications` screen + `/notifications`
└── App.tsx                               # EDIT — mount the screen, load notifications, wire handlers
```

**Structure Decision**: The repository's existing split is kept exactly. Waitlist is a *notifications* concern on the server — the table shipped in the notifications migration and the release notifier already lives in `notifications.service.ts` — so no new module is created for four endpoints. On the frontend the feature is two thin service clients plus one screen, matching how wallet and reviews are organised.

## Complexity Tracking

> No constitution violations. Table intentionally empty.
