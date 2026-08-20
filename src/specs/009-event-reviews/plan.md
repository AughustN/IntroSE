# Implementation Plan: Event Reviews & Ratings

**Branch**: `009-event-reviews` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-event-reviews/spec.md`, UC-18 and UC-39 in `docs/Analysis_Design/Group02_UseCaseSpecification.md`, and two decisions taken on 2026-08-11: eligibility is a paid ticket rather than a check-in, and the organizer-profile half of UC-18 is deferred.

## Summary

Let an attendee who holds a paid, non-void ticket give an event one to five stars and optional text, whether or not its showtime has started. Show the average, the count and the reviews on the event-detail page to everyone, signed in or not. Let a reader report a review into the moderation queue that already exists and already accepts `target_type = 'review'`.

One new table, one new module following the repo/service/routes split every other module uses, a shared contract in `shared/reviews/types.ts`, and a section added to the existing event-detail screen. The aggregate is computed from live rows rather than stored, so an edit, a delete and a moderation removal cannot leave it stale.

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js 22, strict mode

**Primary Dependencies**: Express 4, PostgreSQL via `pg`, Zod, React 19, Vitest, Supertest, and the existing `requireAuth`, `requireAdmin`, `validate`, `withTransaction`, `insertAudit` helpers plus the catalog visibility predicate. No new dependency.

**Storage**: PostgreSQL. New migration `0020_event_reviews.sql` for `event_reviews`. Reuses `content_reports` (its `target_type` check already allows `'review'`) and `audit_logs`.

**Testing**: Vitest + Supertest against the Neon test branch, with the existing auth/catalog seed helpers.

**Target Platform**: Same-origin React SPA behind VPS/Nginx, stateless Express API

**Performance Goals**: Event detail carries the aggregate and the first page of reviews in the response it already makes — no extra round trip on open. Reviews paginate, so an event with two hundred reads like one with none.

**Constraints**: Eligibility enforced server-side on every write; one review per attendee per event guaranteed by the database, not by a check-then-insert; review text stored and returned as text and never as markup; aggregate derived from live rows; removal by moderation hides rather than erases; every admin removal audited.

**Scale/Scope**: One table, five endpoints, one new UI section, one admin queue extension. No new role, no notification, no organizer reply, no voting.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability Under Load**: PASS. Reviews touch no seat, hold, order or payment. The one concurrency question — two devices submitting a first review at once — is answered by a unique constraint rather than by application logic, so the database decides.

- **II. Security & Trust by Default**: PASS. Writing requires `requireAuth`; eligibility is re-derived from the caller's own paid tickets on every write, so the client cannot assert it. Authorship is checked server-side for edit and delete. Removal is admin-only and audited (SEC-09). All input is Zod-validated and all SQL parameterized. Review text is returned as data and rendered by React as text, which output-encodes by default (SEC-07) — the specification's rule is that no code path may opt out with `dangerouslySetInnerHTML`.

- **III. AI Is Assistive, Grounded, Non-Blocking**: N/A — no AI in this feature. Worth one note: the assistant's candidate projection is unchanged, so ratings do not leak into recommendations and nothing here can slow a chat answer.

- **IV. Verifiable Requirements & Test-First**: PASS. The denial paths are the feature's whole integrity story and each gets a test that asserts the refusal: no ticket, unpaid ticket, refunded ticket, void ticket, not signed in, someone else's review, duplicate rating under concurrency.

- **V. Simplicity & Free-Tier Discipline**: PASS. One table and one index. The aggregate is a `GROUP BY` over live rows rather than a denormalised counter with triggers to keep honest — at this scale the query is cheaper than the bug surface it avoids. Reporting reuses `content_reports` instead of a second reporting concept.

- **VI. Clean Codebase & FE/BE Integration**: PASS. Payloads live once in `shared/reviews/types.ts`, imported by both sides. The new module mirrors the `repo` / `service` / `routes` split used by admin, catalog, holds and ai.

**No violations. Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/009-event-reviews/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── reviews.openapi.yaml
└── checklists/requirements.md
```

### Source Code (repository root)

```text
server/src/
├── db/migrations/0020_event_reviews.sql   # event_reviews + indexes
└── modules/reviews/
    ├── reviews.repo.ts                     # eligibility, CRUD, aggregate, listing
    ├── reviews.service.ts                   # the rules: who may write, edit, delete
    └── reviews.routes.ts                    # REST surface, Zod schemas

server/src/modules/catalog/
└── catalog.repo.ts                          # event detail gains rating + count

server/src/modules/admin/
├── admin.repo.ts                            # reported reviews in the queue
└── admin.service.ts                         # removeReview, audited

shared/
├── reviews/types.ts                          # the one contract
└── catalog/types.ts                          # EventDetail gains rating + reviewCount

src/
├── components/reviews/
│   ├── ReviewSection.tsx                     # aggregate, list, "load more"
│   ├── ReviewForm.tsx                        # stars + text, create and edit
│   └── StarRating.tsx                        # the control and its read-only display
├── components/EventDetail.tsx                # hosts the section
└── services/reviewsClient.ts                 # typed calls

server/tests/reviews/
├── write.test.ts                             # eligibility, validation, uniqueness
├── read.test.ts                              # public listing, aggregate, paging
└── moderate.test.ts                          # report, admin removal, audit
```

**Structure Decision**: A module of its own rather than an extension of catalog. Reviews are written by attendees and moderated by admins, while catalog is a read-only public projection; folding them together would put the first write path into a module whose every other query is a public read. Catalog gains only the two aggregate columns on event detail.

## Phase 0: Research Findings

Research is complete in [research.md](./research.md). Resolved decisions:

1. Eligibility is derived per request from the caller's paid tickets; it is never stored on the review.
2. Uniqueness is a database constraint, not a read-then-write check.
3. The aggregate is computed from live rows, not maintained as a counter.
4. Moderation hides a review rather than deleting it; the author's own delete removes it.
5. Reports reuse `content_reports`, whose `target_type` already permits `'review'`.
6. Reviews outlive their authors' accounts.

## Phase 1: Design Details

### Database migration

Create `0020_event_reviews.sql`:

- `event_reviews(id BIGSERIAL PK, event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5), body TEXT, status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','removed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
- `user_id` is nullable with `ON DELETE SET NULL`: a deleted account must not take its reviews with it (FR-016), and `SET NULL` is what makes the row survive as an anonymous one.
- Partial unique index `(event_id, user_id) WHERE user_id IS NOT NULL` — one review per person per event, enforced by the database so concurrent first submissions cannot both win. Partial because several orphaned reviews may share a NULL author.
- Index `(event_id, created_at DESC) WHERE status = 'visible'` — the listing's exact order and filter.
- Full field rules in [data-model.md](./data-model.md).

### Repository

`server/src/modules/reviews/reviews.repo.ts`:

- `eligibility(userId, eventId)` — one query joining `tickets → orders → reservations → showtimes`, requiring `orders.payment_status = 'paid'`, `tickets.qr_status <> 'void'` and `showtimes.starts_at < now()`. Returns whether a paid ticket exists and whether the event has started, separately, so the refusal can say which rule failed.
- `findByAuthor(userId, eventId)`, `insert`, `update`, `deleteOwn(userId, reviewId)` — the author's id is part of the `WHERE`, never checked in application code first.
- `listForEvent(eventId, limit, before)` — visible reviews, newest first, keyset-paginated on `created_at`; joins `users` for name and avatar, tolerating NULL.
- `summary(eventId)` — `count` and `avg` over visible rows, returning `null` average for none.
- `setStatus(reviewId, status)` — moderation's hide, used by the admin service.

### Service

`server/src/modules/reviews/reviews.service.ts` holds the rules and nothing else:

- `submit(userId, eventId, rating, body)` — check eligibility, then upsert on the unique key so a second submission edits rather than collides; blank-only text is stored as null.
- `edit`, `remove` — scoped to the author.
- `forEvent(eventId, viewerId)` — the public listing plus, when a viewer is signed in, their own review and whether they may write one, so the UI needs one call rather than three.

### REST routes

New router mounted at `/api/events/:eventId/reviews` plus one review-scoped path:

- `GET /api/events/:eventId/reviews` — public, paginated.
- `POST /api/events/:eventId/reviews` — authed, create or update.
- `PATCH /api/reviews/:id` — authed, author only.
- `DELETE /api/reviews/:id` — authed, author only.
- `POST /api/reviews/:id/report` — authed, once per reader.
- `DELETE /api/admin/reviews/:id` — admin only, hides and audits.

Shapes in [reviews.openapi.yaml](./contracts/reviews.openapi.yaml).

### Catalog and admin integration

- `getEventDetail` gains `rating` (a number, or null when unrated) and `reviewCount`, so the detail screen renders the summary from the response it already fetches.
- The admin moderation queue joins reported reviews the same way it joins reported events; `removeReview` sets `status = 'removed'` and writes an audit row inside one transaction.

### Frontend

- `StarRating` — one component in two modes, interactive for the form and static for display, keyboard-operable as a radio group.
- `ReviewForm` — five stars and a textarea, pre-filled when the viewer already reviewed, refusing submission without a star value.
- `ReviewSection` — the average and count, the list, a "load more" control, the form or the reason it is not offered, and a report control per review.
- `EventDetail` hosts the section below the existing content.
- `reviewsClient` imports every type from `shared/reviews/types.ts`.

### Testing

- **Write**: eligibility refused for no ticket, unpaid order, refunded/void ticket, event not started, signed out. Rating outside 1–5 refused. Over-length body refused. Second submission edits rather than duplicates. Two concurrent first submissions leave exactly one row.
- **Read**: public without auth; newest first; keyset paging returns each review once; aggregate matches the mean of visible rows after an edit, a delete and a removal; an unrated event reports null rather than zero; a review whose author was deleted still lists.
- **Moderate**: report enters the queue; a second report by the same reader is refused; admin removal hides the review, excludes it from the aggregate and writes an audit row; a non-admin removal attempt is refused.
- Run `npm run typecheck`, `npm test -- --run`, `npm run lint`.

## Constitution Check (Post-Design)

- **Reliability**: PASS. No seat, order or money path is touched. Uniqueness is a constraint; the aggregate cannot drift because it is not stored.
- **Security**: PASS. Every write re-derives eligibility from the caller's own rows; authorship is part of the `WHERE`; removal is admin-only and audited; text is never markup.
- **Testability**: PASS. Each refusal has a named test, including the concurrent-duplicate case.
- **Simplicity**: PASS. One table, two indexes, no new dependency, no denormalised counter.
- **Integration contract**: PASS. `shared/reviews/types.ts` plus the OpenAPI document define every payload once.

## Complexity Tracking

No constitution violations. No complexity exceptions requested.
