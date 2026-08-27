# Quickstart: Organizer Event Studio

How to run and validate feature 006 end to end. Design details live in [plan.md](./plan.md),
[research.md](./research.md), [data-model.md](./data-model.md), and
[contracts/](./contracts/studio.openapi.yaml).

## Prerequisites

- Node 22, and the repo's usual `.env` (see `.env.example`). `DATABASE_URL` and `TEST_DATABASE_URL`
  must point at **different** Neon branches — the suite truncates every table between cases and
  `config.ts` deliberately refuses to fall back.
- `GEMINI_API_KEY` is **optional**. Without it the assistant selects `FakeListingModel` and the rest
  of the feature is unaffected — which is itself the point of Principle III and worth verifying at
  least once.

```bash
npm install
npm run db:migrate        # applies 0011_studio.sql
npm run seed              # dev data: an approved organizer, events, showtimes, tiers
npm run dev:server        # :4000
npm run dev:web           # :3000
```

## Automated validation

```bash
npm test                                  # whole suite
npx vitest run server/tests/studio        # this feature
npm run test:coverage                     # enforces the 60% floor on modules/studio/**
npm run typecheck && npm run lint         # strict TS + ESLint/Prettier (MAIN-01/02)
```

New suite layout under `server/tests/studio/`:

| File | Covers |
|---|---|
| `tiers-lifecycle.test.ts` | add, rename, reprice, the fifth-tier refusal, delete vs archive, restore, the restore limit (SC-001, SC-003, SC-004) |
| `tiers-capacity.test.ts` | the floor, including the concurrent hold race (SC-002) and the seated-capacity refusal (SC-005) |
| `showtimes-guards.test.ts` | reschedule into the past, started/finished, delete with sales, relocate with holds, mapped-seated relocate (SC-006) |
| `event-delete.test.ts` | each FR-020 condition asserted separately (SC-007) |
| `re-moderation.test.ts` | the per-endpoint table test (SC-009), inventory-only exemption, the untouched-inventory assertion (SC-010), the audit row (SC-018) |
| `ownership.test.ts` | a second organizer refused on every endpoint (SC-011) |
| `ai-listing.test.ts` | rate limit, cache hit, and the three degradation branches (SC-012, SC-013, SC-014) |

Additions to two existing suites, per
[catalog-read-impact.md](./contracts/catalog-read-impact.md): archived-tier exclusion in
`server/tests/catalog/`, and the archived-tier hold refusal in `server/tests/holds/`.

## Manual validation — the three that matter

### 1. The moderation gate actually closes (US3, SC-008)

The single most important thing to see with your own eyes, because it is a security fix.

1. Sign in as an organizer, create an event, add a showtime with a tier, publish it.
2. As an admin, approve it at `/moderation`.
3. As a guest, confirm it appears on `/` and on its public page.
4. Back as the organizer, change the **title**.
5. Reload the public catalog as a guest → **the event is gone**, on the very next request.
6. As the admin, the review queue shows it again with a reason saying it was returned because it was
   edited. Approve it → it is public again.
7. Repeat step 4 with a **general-admission capacity change** instead → the event stays public. That
   is the one exemption, and seeing it stay is how you know the rule is a rule and not a blanket.

### 2. A capacity change cannot outrun a hold (US1, SC-002)

1. On a GA showtime with a tier of capacity 100, hold 3 tickets as an attendee in one browser.
2. As the organizer, set that tier's capacity to 2 → refused, with a message naming what is sold and
   what is held.
3. Set it to 3 → accepted. The floor is inclusive; remaining is now 0.
4. Let the hold expire (default 7 min, or lower `HOLD_TTL_MS`) and set it to 1 → now accepted.

The automated version of this races the two operations; the manual version is for confirming the
*message* is one an organizer can act on.

### 3. The assistant degrades without saying so (US5, SC-013)

1. Stop the server, unset `GEMINI_API_KEY`, restart.
2. In the console, open a draft and ask for suggestions → the panel quietly offers plain manual entry.
   There is no error banner, no red state, and every other control still works.
3. Set `AI_TIMEOUT_MS=1` and try again with a key configured → same outcome, different cause.
4. Fire 11 requests within an hour → the 11th says "try again later" and the form keeps working. This
   is the one degradation the user is meant to notice.

## Configuration knobs

All in `server/src/config.ts` with defaults; none is hard-coded (UC-36).

| Setting | Default | Purpose |
|---|---|---|
| `MAX_TIERS_PER_SHOWTIME` | 20 | maximum **active** tiers per showtime; creation, add and restore share it, and organizer forms read the effective value from the API |
| `AI_RATE_LIMIT` / `AI_RATE_WINDOW_MS` | 10 / 1 h | SEC-08 |
| `AI_TIMEOUT_MS` | 8000 | PERF-05 hard timeout → fallback |
| `AI_CACHE_TTL_MS` | 24 h | SCAL-02 |
| `AI_CACHE_MAX_ENTRIES` | 500 | bounded so a user-keyed cache cannot leak memory (PERF-07) |
| `AI_DAILY_QUOTA` | 200 | SCAL-03 platform-wide guard |

## Rollback

`0011_studio.sql` is additive: one nullable column and two indexes. Reverting the application code
leaves archived tiers looking active again — acceptable, because an archived tier is a valid tier with
a price and a label, so nothing is corrupt. The audit rows written by FR-026 are inert to older code,
which reads `audit_logs` only for admin actions.

The one thing that must **not** be rolled back independently is the hold-path guard
(`catalog-read-impact.md` #3) while the archive UI is live: without it an organizer can archive a tier
that buyers can still hold.
