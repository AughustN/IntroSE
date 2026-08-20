---

description: "Task list for 008-ai-chatbot"
---

# Tasks: AI Attendee Chatbot

**Input**: Design documents from `/specs/008-ai-chatbot/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/ai-chatbot.openapi.yaml](./contracts/ai-chatbot.openapi.yaml), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution Principle IV requires denial paths to be tested for security-sensitive behaviour including AI rate limits, and SC-011 sets a 60% coverage bar. The AI module has zero tests today while every other server module has a suite.

**Organization**: Grouped by user story. Priority order from spec.md is P1 (US1, US2, US4) then P2 (US3, US5).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Paths are relative to the repository root `E:\IntroSE`

## Path Conventions

This is a web application in one repository:

- Backend: `server/src/`, tests in `server/tests/`
- Frontend: `src/` (components, services)
- Shared contracts: `shared/`
- Migrations: `server/src/db/migrations/`

---

## Phase 1: Setup

**Purpose**: Test scaffolding and environment hygiene. No behaviour change.

- [X] T001 Create `server/tests/ai/` and add a fake `AIProvider` test double at `server/tests/helpers/fakeAiProvider.ts` exposing `chat` and `generateEventListing` with per-test scripted results, a call counter, and a mode that fails the test if invoked
- [X] T002 [P] Confirm `.env.example` carries only `OPENAI_API_KEY=`, `OPENAI_BASE_URL`, `OPENAI_MODEL` placeholders and that `.env` is git-ignored; the real key is pasted by a team member and never passes through a commit, a log, or an assistant
- [X] T003 Provision a dedicated Neon **test** branch and set `TEST_DATABASE_URL` in `.env` to it, then run `npm run db:migrate` against that branch. `server/src/config.ts` resolves the suite's database from `TEST_DATABASE_URL` with no fallback to `DATABASE_URL`, so the run fails outright until this exists — which is the intended behaviour, not a bug to work around
- [X] T004 Never point `TEST_DATABASE_URL` at the shared development branch. `server/tests/helpers/setup.ts` runs `TRUNCATE … RESTART IDENTITY CASCADE` over thirty tables before **every** test; aimed at the shared branch it destroys the whole team's data on the first run. If a demo branch exists, also set `DEMO_DATABASE_URL` so `assertNotDemoBranch()` stops being a no-op — it currently returns early because the value is blank
- [X] T005 [P] Confirm `vitest.config.ts` globs pick up `server/tests/ai/**` by running `npm test -- --run server/tests/ai` and seeing the empty-suite result rather than a path error

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, shared contract, configuration, and the seams every story below needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Add `ai_usage_windows` to the `TRUNCATE` list in `server/tests/helpers/setup.ts`. Every other AI table carries a foreign key to `users(id)` and is therefore swept by the existing `TRUNCATE users … CASCADE`; `ai_usage_windows` is keyed by window and references nothing, so without this it survives between cases — the ceiling test would leave the counter at its limit and every later test would silently take the fallback path
- [X] T007 Create migration `server/src/db/migrations/0017_ai_chat.sql`: create `ai_usage_windows(window_started_at TIMESTAMPTZ PRIMARY KEY, request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`, delete `ai_response_cache` rows where `kind = 'recommendation'`, then replace that column's check constraint with `kind IN ('chat', 'listing')`
- [X] T008 [P] Create `shared/ai/types.ts` exporting `ConversationTurn`, `CandidateEvent`, `Recommendation`, `ChatRequest`, `ChatResponse`, `ListingInput`, `ListingSuggestion`, `ListingResponse`, matching `contracts/ai-chatbot.openapi.yaml` field for field
- [X] T009 [P] In `server/src/config.ts` change `AI_REQUEST_TIMEOUT_MS` from `60_000` to `8_000`, read an optional `AI_REQUEST_TIMEOUT_MS` environment override, and add defaults `ai_platform_request_ceiling: 2000` and `ai_platform_window_hours: 24` to the settings defaults block
- [X] T010 In `server/src/modules/admin/settings.service.ts` add validation for `ai_platform_request_ceiling` (integer ≥ 0) and `ai_platform_window_hours` (integer 1–720) alongside the existing `ai_features_enabled` case
- [X] T011 In `server/src/modules/admin/admin.routes.ts` add both keys to the settings Zod schema, and add their fields to the Cấu hình tab in `src/components/AdminPanel.tsx`
- [X] T012 Create `server/src/modules/ai/ai.repo.ts` and move `candidates`, `categoryContext`, `cacheGet`, `cachePut`, `visibleEventId`, `toggleBookmark`, `listBookmarks`, and `recordEventView` out of `server/src/modules/ai/ai.service.ts` unchanged in behaviour, so the service reads as a decision flow
- [X] T013 In `server/src/modules/ai/providers/ai.provider.ts` delete the locally declared types, import them from `shared/ai/types.ts`, and add `chat(context): Promise<{ reply: string; declined: boolean; recommendations: Array<{ eventId: number; reason: string }> }>` to the `AIProvider` interface
- [X] T014 Replace the module-level singleton `const provider = new OpenAIProvider()` in `server/src/modules/ai/ai.service.ts` with an injectable provider (module-scoped default plus an exported `setAIProvider` used only by tests), so every test below can substitute the double from T001

**Checkpoint**: Schema applied, one shared contract in place, provider injectable, 8-second budget live.

---

## Phase 3: User Story 1 - Ask the assistant for events in natural language (Priority: P1) 🎯 MVP

**Goal**: A signed-in attendee asks one question in Vietnamese and receives a prose reply plus real, on-sale events that open in the SPA.

**Independent Test**: Sign in, ask one question, verify the reply and that every event shown exists in the catalog, is on sale, and opens its detail page without a document reload.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [X] T015 [P] [US1] Contract test in `server/tests/ai/chat.test.ts`: `POST /api/ai/chat` returns `source`, `reply`, `declined`, and `recommendations` matching `contracts/ai-chatbot.openapi.yaml`, with every event field equal to its database row
- [X] T016 [P] [US1] Grounding test in `server/tests/ai/chat.test.ts`: a provider double returning an `eventId` absent from the candidate set yields zero recommendations and a fallback, never a phantom event
- [X] T017 [P] [US1] Visibility test in `server/tests/ai/chat.test.ts`: draft, past, and sold-out events never appear in the candidate set, in an AI answer, or in a fallback
- [X] T018 [P] [US1] Authorisation test in `server/tests/ai/chat.test.ts`: an unauthenticated `POST /api/ai/chat` returns 401 and leaves `ai_request_limits`, `ai_usage_windows`, and `ai_response_cache` unchanged

### Implementation for User Story 1

- [X] T019 [US1] Implement `chat()` in `server/src/modules/ai/providers/openai.provider.ts`: reuse `complete()` with `response_format: json_object` and the `AbortSignal.timeout` budget, and Zod-parse `{ reply, declined, recommendations[] }` with `.strict()`, keeping the existing `event_id`/`eventId` tolerance
- [X] T020 [US1] Write the system prompt in `server/src/modules/ai/providers/openai.provider.ts`: rank only supplied candidates, every `eventId` must be an exact id from `candidates`, never invent an event, price, date, or id, write concise Vietnamese
- [X] T021 [US1] Implement `chat(userId, { message, history })` in `server/src/modules/ai/ai.service.ts` following plan steps 1–9: candidates, settings, context, cache read, allowance, provider call, filter returned ids against the candidate map, cap at six, attach the database record for each, cache, return `source: "ai"`
- [X] T022 [US1] In `server/src/modules/ai/ai.routes.ts` add `POST /chat` with a strict Zod body schema and delete `POST /recommendations` together with `recommendEvents`
- [X] T023 [US1] In `src/services/aiClient.ts` add `chat(message, history)`, delete `recommendations()`, delete the locally re-declared `RecommendedEvent` and `ListingSuggestion` interfaces, and import every type from `shared/ai/types.ts`
- [X] T024 [US1] Create `src/components/AIChatPanel.tsx` rendering the exchange as a transcript with recommended events as cards beneath the reply that produced them, a loading state that disables submit while the rest of the page stays interactive, `aria-live="polite"` on the reply region, and a sign-in invitation instead of `return null` when signed out
- [X] T025 [US1] In `src/App.tsx` replace the `AIRecommendationPanel` import and its mount point with `AIChatPanel`, pass the existing event-open handler so a recommendation navigates in-application, and delete `src/components/AIRecommendationPanel.tsx`
- [X] T026 [US1] Bring `src/components/AIChatPanel.tsx` onto the design system: `text-eyebrow` and up only, `font-meta` / `font-display`, `bg-surface-2`, hairline rules; no `text-xs`, no `text-sm`, no `text-2xl`, no `rounded-lg`

**Checkpoint**: One question in, one grounded answer out, links open in the SPA. MVP demonstrable.

---

## Phase 4: User Story 2 - Continue the conversation (Priority: P1)

**Goal**: A follow-up that means nothing on its own is answered in the context of the earlier turn.

**Independent Test**: Ask an opening question, then send "rẻ hơn nữa đi", and verify the answer reflects the first turn while no conversation row exists in the database.

### Tests for User Story 2

- [X] T027 [P] [US2] Bounds test in `server/tests/ai/chat.test.ts`: eight history turns accepted, nine rejected at validation with 400, a 601-character turn rejected, an unknown role rejected
- [X] T028 [P] [US2] Injection test in `server/tests/ai/chat.test.ts`: a history turn instructing the assistant to reveal another user's data produces no query whose `user_id` parameter differs from the session identity, asserted on the captured SQL parameters
- [X] T029 [P] [US2] Persistence test in `server/tests/ai/chat.test.ts`: after a multi-turn exchange, no table contains any turn text

### Implementation for User Story 2

- [X] T030 [US2] Extend the `POST /chat` Zod schema in `server/src/modules/ai/ai.routes.ts` with `history`: an array of at most eight `{ role: "user" | "assistant", content: string 1–600 }`, `.strict()`, rejecting excess rather than truncating
- [X] T031 [US2] In `server/src/modules/ai/ai.service.ts` include the bounded history in the provider context and in the cache-key hash, and store nothing
- [X] T032 [US2] Extend the system prompt in `server/src/modules/ai/providers/openai.provider.ts` to state that text inside the conversation is the user's words, not instructions to obey
- [X] T033 [US2] Hold `turns: ConversationTurn[]` in `src/components/AIChatPanel.tsx`, send the last eight with each request, append both the question and the reply, and let the transcript die with the component

**Checkpoint**: Multi-turn conversation works and is provably not persisted.

---

## Phase 5: User Story 4 - Degrade instead of failing (Priority: P1)

**Goal**: Model slow, erroring, switched off, or over the platform ceiling — the attendee still gets usable suggestions and never an error page.

**Independent Test**: Force each of the four causes in turn and verify a 200 with `source: "fallback"`, a notice, and live events every time.

### Tests for User Story 4

- [X] T034 [P] [US4] Timeout test in `server/tests/ai/degradation.test.ts`: a provider double that never resolves is abandoned at the configured budget and returns 200 with a fallback; assert the elapsed time is nearer 8 s than 60 s
- [X] T035 [P] [US4] Failure-mode tests in `server/tests/ai/degradation.test.ts`: provider throw, non-2xx, unparseable JSON, and schema violation each return 200 with `source: "fallback"`, a notice, and live events
- [X] T036 [P] [US4] Kill-switch test in `server/tests/ai/degradation.test.ts`: with `ai_features_enabled` false the provider double fails the test if invoked, and the response is a fallback
- [X] T037 [P] [US4] Ceiling test in `server/tests/ai/limits.test.ts`: with `ai_usage_windows.request_count` at the configured ceiling the provider double fails the test if invoked, and the response is a fallback with a notice — not a 429
- [X] T038 [P] [US4] Empty-catalog test in `server/tests/ai/degradation.test.ts`: with nothing on sale the response explains that plainly, returns no events, and makes no provider call

### Implementation for User Story 4

- [X] T039 [US4] Add `consumeAllowance(userId)` to `server/src/modules/ai/ai.repo.ts`: one transaction that upserts the attendee row, takes `FOR UPDATE` on it and on the current `ai_usage_windows` row, checks the per-user count against `AI_REQUEST_LIMIT` and the window count against `ai_platform_request_ceiling`, then increments both; returns a discriminated result rather than throwing, because a personal refusal is a 429 while a platform refusal is a silent fallback
- [X] T040 [US4] Wire the discriminated result into `server/src/modules/ai/ai.service.ts`: personal refusal throws `err.tooMany("ai_rate_limited", …)`, platform refusal returns the non-AI fallback with a notice and no external call
- [X] T041 [US4] Wrap the provider call in `server/src/modules/ai/ai.service.ts` so timeout, non-2xx, unparseable output, schema violation, and zero surviving recommendations all return 200 with the non-AI fallback and a notice, logging the reason server-side and never surfacing it verbatim
- [X] T042 [US4] Apply the same ordering and the same failure handling to `generateEventListing()` in `server/src/modules/ai/ai.service.ts`, so UC-22 inherits the ceiling, the budget, and the fallback contract
- [X] T043 [US4] Render `message` as a quiet notice in `src/components/AIChatPanel.tsx` whenever `source` is not `"ai"`, and show the fallback events normally rather than as an error state

**Checkpoint**: Every degradation path returns something usable. The assistant can no longer block anyone.

---

## Phase 6: User Story 3 - Stay inside the TixHub domain (Priority: P2)

**Goal**: Off-domain questions are declined in one sentence and return no events.

**Independent Test**: Ask three unrelated questions and verify each is declined without an attempt to answer.

### Tests for User Story 3

- [X] T044 [P] [US3] Decline test in `server/tests/ai/chat.test.ts`: `declined: true` returns an empty `recommendations` array, is reported as `source: "ai"` rather than a fallback, and is not counted as a failure
- [X] T045 [P] [US3] In-domain test in `server/tests/ai/chat.test.ts`: a question about platform behaviour such as how seat holds expire is answered rather than declined

### Implementation for User Story 3

- [X] T046 [US3] Extend the system prompt in `server/src/modules/ai/providers/openai.provider.ts`: answer only about TixHub events, tickets, and platform behaviour; otherwise set `declined` and return no recommendations, declining in one Vietnamese sentence
- [X] T047 [US3] In `server/src/modules/ai/ai.service.ts` treat `declined: true` as a successful answer — skip the candidate-id filtering, return the reply with no events, and still cache the result
- [X] T048 [US3] Render a declined reply in `src/components/AIChatPanel.tsx` as ordinary assistant prose with no empty results area

**Checkpoint**: The domain boundary is a tested contract, not a hope about the prompt.

---

## Phase 7: User Story 5 - Respect the per-user allowance honestly (Priority: P2)

**Goal**: A repeated question is served from cache and costs no part of the hourly allowance.

**Independent Test**: Ask the same question twice inside the cache lifetime and verify `request_count` is unchanged by the second ask.

### Tests for User Story 5

- [X] T049 [P] [US5] Cache test in `server/tests/ai/limits.test.ts`: an identical question twice inside the TTL calls the provider once, returns `source: "cache"` the second time, and leaves `ai_request_limits.request_count` at one
- [X] T050 [P] [US5] Allowance test in `server/tests/ai/limits.test.ts`: ten distinct model-backed requests succeed, the eleventh returns 429 with code `ai_rate_limited`, and the count resets at the hour boundary
- [X] T051 [P] [US5] Concurrency test in `server/tests/ai/limits.test.ts`: two simultaneous requests from one attendee increment `request_count` by exactly two, never by one
- [X] T052 [P] [US5] Listing-parity test in `server/tests/ai/limits.test.ts`: a cached organizer listing suggestion likewise consumes no allowance

### Implementation for User Story 5

- [X] T053 [US5] Enforce the order in `chat()` in `server/src/modules/ai/ai.service.ts`: feature switch, candidates, cache read, **then** `consumeAllowance`, then the provider call — the allowance is spent only immediately before a call that will actually be made
- [X] T054 [US5] Apply the same reordering to `generateEventListing()` in `server/src/modules/ai/ai.service.ts`, which today decrements before it reads its cache
- [X] T055 [US5] Verify the cache key in `server/src/modules/ai/ai.service.ts` hashes the bounded history, the three category lists, and the candidate set, so a cached answer can never outlive the availability it was grounded in

**Checkpoint**: The counter now means what its name says.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T056 [P] Grep the repository for `recommendations`, `AIRecommendationPanel`, and `RecommendedEvent` and confirm no reference to the removed endpoint or deleted component survives in `src/`, `server/src/`, or `shared/`
- [X] T057 [P] Confirm no AI code path logs the API key, a request body, or conversation text; the provider error message must continue to report only origin and pathname
- [X] T058 Run `npm run typecheck`, `npm run lint`, and `npm test -- --run`; all three must pass with zero errors
- [X] T059 Confirm AI module statement coverage is at or above 60% per SC-011 via the coverage report
- [ ] T060 Walk all ten scenarios in [quickstart.md](./quickstart.md), including the live smoke test once the key is in `.env`
- [X] T061 [P] Remove `html2canvas` from `package.json` if nothing imports it, and drop `AI_REQUEST_LIMIT`-adjacent dead constants left by the refactor

---

## Phase 9: Governance (Merge-Blocking)

**Purpose**: The technology substitution gate recorded in [plan.md](./plan.md). Code may land on the branch without these; merge to `main` may not.

- [X] T062 Update `src/.specify/memory/constitution.md` through the approved provider-neutral amendment: AI uses the shared `AIProvider` abstraction, provider details are recorded in ADR-0005, and the four-integration cap remains unchanged.
- [ ] T063 Write `docs/adr/0005-ai-provider-openai.md` recording the decision, the alternatives from [research.md](./research.md), and the fact that `AIProvider` keeps a future vendor change to one class

---

## Phase 10: Deferred — Documentation Alignment

**Purpose**: Reconcile remaining AI governance and architecture documentation with the provider-neutral `AIProvider` contract.

**⚠️ DEFERRED BY DECISION**: Do this only after every phase above is complete and the amendment in T062 has carried. Doing it earlier would put the documents ahead of the governance decision that authorises them, and would churn files that may need different wording depending on how T062 lands.

- [X] T064 Update UC-10 and UC-22 in `docs/Analysis_Design/Group02_UseCaseSpecification.md`: use the configured provider behind `AIProvider`, remove vendor-specific actor/include wording, and reconcile UC-10 with the shipped bounded conversation, cache-first allowance, grounding, and fallback behavior.
- [ ] T065 [P] Update the AI element and its label in `docs/Analysis_Design/C4_Deployment.md`
- [ ] T066 [P] Update the AI references in `docs/Requirements/Group02_VisionDocument/VisionDocument.md`
- [ ] T067 [P] Update the AI references in `docs/Management/Group02_ProjectPlan/Group02_ProjectPlan.md`
- [ ] T068 [P] Update the AI references in `docs/Management/Group02_Proposal/Group02_ProjectProposal.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — blocks every user story
- **US1 (Phase 3)**: Depends on Foundational. Builds the endpoint every later story modifies
- **US2, US4, US3, US5 (Phases 4–7)**: Depend on Foundational **and on US1**, because each is a layer on the endpoint US1 creates
- **Polish (Phase 8)**: Depends on all desired stories
- **Governance (Phase 9)**: Independent of code; may run in parallel with any phase, but must complete before merge to `main`
- **Deferred docs (Phase 10)**: Depends on Phase 9 landing, by explicit decision

### User Story Dependencies — read this before parallelising

The template's usual promise of independent stories is only partly true here, and pretending otherwise would cause merge conflicts:

- **US1** is the vehicle. Nothing else is testable without it
- **US2, US3, US4, US5** are each independently *testable* against their own acceptance scenarios, but they are **not independently deployable before US1**, and four of them edit `server/src/modules/ai/ai.service.ts`
- Therefore Phases 4–7 are **sequential**, not parallel, unless one developer owns `ai.service.ts` across all of them
- Phases 4–7 may be reordered freely among themselves; the priority order above (P1 US2, P1 US4, P2 US3, P2 US5) is the recommended one

### Within Each User Story

- Tests are written first and must fail before implementation
- Repository before service, service before route, route before client, client before component

### Parallel Opportunities

- T002 and T005 in Setup. T003 and T004 are sequential and gate the whole suite — nothing under `server/tests/` runs until the test branch exists
- T008 and T009 in Foundational (different files; T006, T007, and T010–T014 have ordering constraints)
- Every test task inside one story — they live in different `describe` blocks and are marked [P]
- Phase 9 governance runs alongside any code phase
- T065–T068 in the deferred phase are five separate documents

---

## Parallel Example: User Story 1

```bash
# Launch all four US1 tests together, before any implementation:
Task: "Contract test for POST /api/ai/chat in server/tests/ai/chat.test.ts"
Task: "Grounding test — hallucinated event id discarded — in server/tests/ai/chat.test.ts"
Task: "Visibility test — draft/past/sold-out never surface — in server/tests/ai/chat.test.ts"
Task: "Authorisation test — unauthenticated 401, no row changes — in server/tests/ai/chat.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup
2. Phase 2 Foundational — blocks everything
3. Phase 3 US1
4. **STOP and VALIDATE**: quickstart Scenario 1. One question, one grounded answer, SPA navigation
5. Demoable at this point: it is already a better assistant than what ships today

### Incremental Delivery

1. Setup + Foundational → the 8-second budget and the shared contract are already live, which alone closes two audit findings
2. + US1 → grounded chat endpoint, old endpoint gone (MVP)
3. + US2 → real conversation
4. + US4 → every degradation path safe; this is the phase that satisfies Principle III
5. + US3 → domain boundary asserted
6. + US5 → allowance honest; closes the last audit finding
7. Polish → coverage, quickstart, cleanup
8. Governance → amendment and ADR; **merge to `main` unblocked here**
9. Deferred → the five documents

### Suggested Stopping Points

- After US1: demonstrable
- After US4: constitutionally compliant on Principle III, which is the bar that matters for this feature
- After US5: the full audit closed

---

## Notes

- Phases 4–7 all edit `server/src/modules/ai/ai.service.ts`. Assign one owner or sequence them; do not staff them concurrently
- Verify each test fails before writing the implementation it covers
- Commit after each task or logical group; commits stay local and are authored by the user
- The OpenAI key is pasted into `.env` by a team member. It is never committed, never logged, and never handled through an assistant
- T062 blocks merge to `main`, not development on the branch
- The suite runs against `TEST_DATABASE_URL` and truncates thirty tables before every case. Point it at a Neon branch nobody else uses. `DATABASE_URL` is never the answer, and `server/src/config.ts` refuses to fall back to it precisely so that mistake cannot be made silently
