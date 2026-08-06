# Implementation Plan: Organizer Event Studio

**Branch**: `006-organizer-studio` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-organizer-studio/spec.md`

## Summary

Finish the organizer's authoring surface. Ticket tiers stop being write-once — they gain add, rename,
reprice, capacity, archive, restore, and delete, each gated on live inventory read under the same
`FOR UPDATE` lock feature 003 takes, so a capacity change and a hold can never both win. Showtimes
become editable (time, venue, deletion) under the same guards. Every organizer write funnels through
**one** function that decides whether the event goes back to `pending_review` and writes the audit
row, because UC-24 A6 is a security control and a control that each handler has to remember to call
is a control that will eventually be forgotten. The AI listing assistant is added as prose-only: the
suggested **price is computed in SQL** from comparable published events and never asked of the model,
which is the cheapest way to make FR-033's grounding rule structurally true rather than a prompt
instruction. The assistant answers `200 {available:false}` on timeout, error, or quota so the client's
fallback is an ordinary response and not an error path. `OrganizerPanel.tsx` becomes a four-level
console with real URLs. Out of scope: seat geometry (005), orders/tickets/revenue (007), admin
moderation actions (002).

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 22, React 19 — same stack as 001–005.

**Primary Dependencies**: Express (REST), `pg` (row locks for the capacity floor), Zod (SEC-07 input
validation), **`@google/genai` — already installed**, unused until now. No new dependency is added;
`react-router-dom` v7 (already present) carries the console's new URLs.

**Storage**: PostgreSQL (Neon). One migration, `server/src/db/migrations/0011_studio.sql`:
`ticket_tiers` gains `archived_at TIMESTAMPTZ NULL` plus a partial index on the active tiers of a
showtime; `audit_logs` gains an index on `(target_type, target_id)` because FR-020's "was this event
ever approved" is derived from it and FR-026 now writes to it on every material edit.

**Testing**: Vitest + supertest, mirroring `server/tests/catalog/` and `server/tests/seatmap/`. New
`server/tests/studio/` covers the tier lifecycle, the capacity floor under concurrency, the showtime
guards, the material-edit table test, event deletion, cross-organizer refusals, and the assistant's
rate limit, cache, and three fallback modes. The Gemini call sits behind an interface with a fake, in
the shape `modules/auth/mailer.ts` already uses — the suite makes no network call.

**Target Platform**: Single VPS (Nginx, same-origin) + Neon; browsers 360–1920 px.

**Project Type**: Web application (monorepo: `server/` backend, `src/` React SPA, `shared/` contract).

**Performance Goals**: organizer console reads < 500 ms p95 (PERF-02 class); assistant call < 5 s
target with an **8 s hard timeout** → fallback (PERF-05); no effect on feature 003's < 1 s seat-update
bound, since this feature only reads hold state.

**Constraints**: the database is the source of truth for sold and reserved (Principle I); every
endpoint scoped server-side to the owning organizer (SEC-04); AI never on a critical path and never
returning a blocking error (Principle III); whole-VND integers only (STD-03); no fifth external
integration — Gemini is one of the four already permitted.

**Scale/Scope**: ≤ 4 active tiers per showtime, unbounded archived tiers; ~15 new endpoints; assistant
10 req/hour/user (SEC-08) with a 24 h suggestion cache (SCAL-02) and a process-wide daily quota guard
(SCAL-03).

## Constitution Check

*GATE: must pass before Phase 0; re-checked after Phase 1.*

| Principle | Gate | Status |
|---|---|---|
| I — Reliability Under Load | DB is source of truth; no oversell; explicit lifecycle; claims proven by tests | **PASS** — the capacity floor is read under `SELECT … FOR UPDATE` on the same tier row 003 locks, so a capacity change and a GA hold serialize (FR-004); the existing `CHECK (sold + reserved <= total)` stays as the last line of defence; no seat status is written by this feature |
| II — Security & Trust | RBAC on every endpoint; server-authoritative identity; strict schema validation | **PASS** — every route resolves ownership through event → organizer → user and *refuses* (FR-035, FR-036); UC-24 A6 is implemented as a security control with a single choke point (R-2); FR-020 blocks deleting an event an admin took down |
| III — AI assistive, grounded, non-blocking | never on a critical path; degrades; grounded in platform data; editable output | **PASS** — the price comes from SQL, not the model (R-6); failures return `200 {available:false}`, not an error; every suggestion is per-field acceptable/rejectable; the assistant is refused entirely on an approved, on-sale event (FR-027) |
| IV — Verifiable / test-first | refusal tests, not just happy paths; ≥ 60% on critical logic; strict TS; green CI | **PASS** — SC-002..SC-015 are refusal-shaped; `server/src/modules/studio/**` gets a 60% vitest threshold alongside auth/holds/seatmap; the material-edit rule is pinned by a table test (SC-009) that fails when a new editable field skips it |
| V — Simplicity & Free-Tier | simplest thing that meets the requirement; no infra ahead of need | **PASS** — a nullable `archived_at` instead of a tier status enum; in-process rate limiter and cache reusing the `holds.throttle.ts` shape rather than Redis; no new dependency; the assistant's price is a SQL aggregate, not an embedding lookup |
| VI — Clean Codebase & FE/BE contract | one shared typed contract; no re-declared payloads; consumers move together | **PASS** — tier management types are added once to `shared/catalog/types.ts`; `Tier.remaining` semantics are unchanged, and the archived-tier exclusion is documented as a read-contract change with every consumer named (`contracts/catalog-read-impact.md`) |

**Integration cap**: untouched. Gemini is integration #2 of the four permitted (VNPay, Gemini, Google
OAuth, Resend); this is its first use, not a new one.

**Governance touch**: none requiring an amendment. Four documents are contradicted or extended by this
design and are already tracked as follow-ups in `spec.md` (UC-24 A6, UC-26 A3, UC-23, the schema's
Organizer API section and `ticket_tiers`, and the `CONTEXT.md` glossary).

**Result: PASS. No unjustified violations; Complexity Tracking left empty.**

### Post-design re-check (after Phase 1)

Re-evaluated against `research.md`, `data-model.md`, and `contracts/`. Still **PASS**, with three
points the design sharpened rather than loosened:

- **Principle III got structurally stronger, not just documented.** R-6 moves the price suggestion out
  of the model entirely. A prompt instruction saying "do not invent prices" is a hope; computing the
  number in SQL and letting the model write only prose makes the grounding rule unbreakable by any
  prompt-injection or hallucination path. The one thing the assistant could have gotten factually
  wrong is now the one thing it never touches.
- **Principle II gained a choke point.** R-2 replaces "every handler remembers to re-moderate" with a
  single `applyOrganizerEdit` that no write path can bypass, plus its deliberately-named counterpart
  `applyInventoryEdit` for the two exempt cases. The exemption becomes something a reviewer sees at
  the call site rather than an omission they have to notice.
- **Principle I extended to a path this feature did not create.** R-4 found that archiving a tier does
  not actually stop new purchases unless feature 003's GA hold path also refuses an archived tier.
  That guard is in scope here and is listed as a cross-feature touch, because FR-006's promise of
  "unpurchasable" is otherwise only true of the catalog read.

One consequence worth flagging to reviewers: **FR-020's "never approved" is derived from `audit_logs`,
not from a column** (R-1). That keeps a single source of truth for moderation history, but it means the
audit table is now load-bearing for a refusal, not just a record — hence the new index and an explicit
test that a deleted approval history cannot be faked.

## Project Structure

### Documentation (this feature)

```text
specs/006-organizer-studio/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (studio REST, the AI contract, the catalog read impact)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/src/
├── db/migrations/0011_studio.sql        # ticket_tiers.archived_at + partial index; audit_logs target index
├── config.ts                            # + AI_RATE_LIMIT/WINDOW_MS, AI_TIMEOUT_MS, AI_CACHE_TTL_MS,
│                                        #   AI_DAILY_QUOTA, AI_CACHE_MAX_ENTRIES, MAX_TIERS_PER_SHOWTIME
├── modules/studio/
│   ├── tiers.service.ts                 # add / rename / reprice / capacity / archive / restore / delete
│   ├── tiers.repo.ts                    # locked reads, per-tier sold+reserved for both event types
│   ├── showtimes.service.ts             # reschedule / relocate / delete, each inventory-gated
│   ├── events.service.ts                # widened event edit + FR-020 deletion
│   ├── moderation-guard.ts              # applyOrganizerEdit / applyInventoryEdit — the ONE choke point
│   ├── studio.routes.ts                 # /api/organizer/… tier, showtime, event write endpoints
│   └── ai/
│       ├── listing.service.ts           # orchestration: limit → cache → quota → model → normalize
│       ├── listing.model.ts             # GeminiListingModel + FakeListingModel (test seam)
│       ├── comparables.repo.ts          # SQL price suggestion from comparable published events
│       └── ai.throttle.ts               # per-user 10/h bucket + process-wide daily quota guard
├── modules/catalog/
│   ├── catalog.repo.ts                  # tier reads exclude archived_at IS NOT NULL
│   ├── visibility.ts                    # SHOWTIME_HAS_AVAILABILITY ignores archived tiers
│   └── organizer.routes.ts              # PATCH /events/:id delegates to modules/studio
└── modules/holds/holds.repo.ts          # GA hold refuses an archived tier (cross-feature guard, R-4)

src/ (web)
├── components/organizer/
│   ├── OrganizerConsole.tsx             # shell: the four levels + shared loading/empty/error states
│   ├── EventList.tsx                    # level 1
│   ├── EventEditor.tsx                  # level 2 — widened fields + the re-review confirmation
│   ├── ShowtimeList.tsx                 # level 3 — reschedule, relocate, delete
│   ├── TierPanel.tsx                    # level 4 — sold/held/remaining per tier; archive/restore
│   ├── AiListingPanel.tsx               # per-field accept/edit/reject; silent fallback
│   └── states.tsx                       # Loading / Empty / ErrorRetry — first-class, reused (FR-040)
├── components/OrganizerPanel.tsx        # ← becomes the console entry, delegating to the above
├── routes.ts                            # + /organizer/events/:id and /organizer/showtimes/:id
└── services/catalogClient.ts            # + studioApi, aiApi

shared/
├── catalog/types.ts                     # + ManagedTier, TierMutation results, ListingSuggestion
└── catalog/material-edit.ts             # isMaterialEdit() — ONE definition of the exemption rule,
                                         #   imported by moderation-guard.ts AND EventEditor.tsx (R-9)
```

**Structure Decision**: Web-app monorepo, unchanged from 001–005. A new backend module
`modules/studio/` mirrors `modules/seatmap/` and `modules/holds/`, which keeps `organizer.routes.ts`
from growing into a 600-line catch-all and gives vitest a coverage-threshold path of its own. The one
structural choice that carries weight is `moderation-guard.ts`: it exists as a separate file, not as a
helper inside each service, precisely so that "did this write path re-moderate?" is answerable by
grepping for two function names rather than by reading every handler.

## Complexity Tracking

> No constitution violations — section intentionally empty.
