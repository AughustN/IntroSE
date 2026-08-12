# Implementation Plan: AI Attendee Chatbot

**Branch**: `008-ai-chatbot` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-ai-chatbot/spec.md`, UC-10 and UC-22 in `docs/Analysis_Design/Group02_UseCaseSpecification.md`, the existing `server/src/modules/ai` implementation merged from `dev_hieu`, and the gap audit of that implementation carried out on 2026-08-11. The team holds an OpenAI API key; it will be supplied through the environment and is never committed.

## Summary

Turn the existing single-shot recommendation box into the conversational, grounded, non-blocking assistant UC-10 describes, and repair the four deviations the audit found in the shared AI plumbing that both UC-10 and UC-22 sit on.

The assistant keeps its current shape — Express router, `AIProvider` seam, PostgreSQL-backed cache and rate limit — and gains: a bounded client-held conversation window; a prose reply alongside the event cards; an explicit out-of-domain decline; an automatic platform-wide usage ceiling beneath the existing Admin kill switch; an 8-second timeout budget in place of 60; cache consulted before the per-user allowance is spent; a shared `shared/ai/types.ts` contract replacing the payload the web client re-declares today; and the module's first test suite, built on a provider test double so every degradation path is deterministic.

`POST /api/ai/recommendations` is deleted and replaced by `POST /api/ai/chat` in the same change, with its single consumer rewritten.

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js 22, strict mode

**Primary Dependencies**: Express 4, PostgreSQL via `pg`, Zod, React 19, Vitest, Supertest, existing `requireAuth`, `requireOrganizer`, `validate`, `withTransaction`, `SettingService`, and the catalog visibility predicate. No new runtime dependency: the provider is called with the platform `fetch`.

**Storage**: PostgreSQL. Migration `0016_ai.sql` already provides `ai_request_limits`, `ai_response_cache`, `user_event_bookmarks`, `user_event_views`. This feature adds `0017_ai_chat.sql` for `ai_usage_windows` and the `ai_response_cache.kind` constraint change.

**Testing**: Vitest + Supertest with an injected fake `AIProvider`; no test touches the network. Type-check and lint required.

**Target Platform**: Same-origin React SPA behind VPS/Nginx, stateless Express API

**Project Type**: Web application with React frontend and Express REST backend

**Performance Goals**: Model call abandoned at 8 s (`[PERF-05]`); cache hits and every fallback path answer in one round trip with no external call; the whole feature stays off the purchase critical path, so no target here gates checkout

**Constraints**: Authentication on every AI endpoint; every personal-data query scoped in SQL to the server-injected session identity; parameterized SQL; strict Zod validation on all input including conversation history; typed shared contract with no re-declaration; VND integers; ten model-backed requests per attendee per hour; conversation content never persisted; no secret in git; DB pool ≤ 20

**Scale/Scope**: One new endpoint replacing one removed endpoint, one migration, one new shared contract module, one rewritten React panel, two new Admin settings, one new test suite. No new role, no new external service beyond the AI provider already configured, no embedding or vector index.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability Under Load**: PASS. The assistant is entirely off the purchase path — it reads the catalog and never holds, sells, or reserves anything. The database remains the source of every event fact shown. No seat or order behaviour changes.

- **II. Security & Trust by Default**: PASS. `aiRouter.use(requireAuth)` already guards every route and `requireOrganizer` guards the listing route; both are kept. The user whose purchases, saved events, and view history are read is `req.auth.userId`, injected by the server — the client cannot name a user and neither can the model, so conversation history cannot widen a query. All input including each history turn is Zod-validated with `.strict()`. All SQL stays parameterized. The API key is read from the environment and is never logged; the provider error message deliberately reports only origin and pathname, never the key or the body.

- **III. AI Is Assistive, Grounded, and Non-Blocking**: PASS, and materially strengthened. Non-blocking: the timeout falls from 60 s to the 8 s the specification states, the platform ceiling degrades automatically instead of waiting for an Admin, and every failure returns suggestions rather than an error. Grounded: the model receives a server-built candidate set and may only return ids from it; anything else is discarded, so no price, date, or title is ever model-authored. Bounded: an explicit `declined` flag makes the out-of-domain boundary a tested contract. Assistive: the organizer's suggestions remain editable drafts that reach an event only on acceptance.

- **IV. Verifiable Requirements & Test-First for Critical Logic**: PASS. The module has no tests today while every other server module has a suite. This plan adds one covering the denial and degradation paths the principle names specifically — allowance exhaustion, unauthenticated refusal, platform ceiling, timeout, provider error, unparseable output, hallucinated id, injected instructions — each asserting the denial, not the happy path.

- **V. Simplicity & Free-Tier Discipline**: PASS. No new infrastructure: the conversation lives in the client, the counters and cache live in PostgreSQL, and the ceiling is one indexed row. No embedding model, no vector index — the SQL candidate set is at most twenty rows, exactly the case ADR-0001's reasoning covers. The cache and the ceiling both exist to conserve quota, which is what `[SCAL-02]` and `[SCAL-03]` ask for.

- **VI. Clean Codebase & Seamless FE/BE Integration**: PASS after the change, FAIL today. The AI payload is currently declared twice — `server/src/modules/ai/providers/ai.provider.ts` and again in `src/services/aiClient.ts` — which the constitution names explicitly as prohibited contract drift; `shared/ai/types.ts` is the missing fifth shared module beside `admin`, `auth`, `catalog`, and `holds`. Removing the superseded endpoint in the same change satisfies the rule that a contract change updates every consumer and leaves no dead code.

### Open gate: technology substitution requires an amendment

**Status: not passed. Governance action required before merge.**

The constitution fixes the technology table — "changing a listed technology requires an amendment" — and its AI row reads *Google Gemini API (chat + `text-embedding-004`)*. The architecture section further enumerates the four permitted external integrations by name: VNPay, **Gemini**, Google OAuth, Resend. Principle III itself says "AI (Gemini)".

The code on `mvp-demo` calls OpenAI, and the key the team holds is an OpenAI key. The count of integrations is unchanged at four, but a named one is substituted, which the amendment procedure covers.

This is a governance defect, not a design defect, and no decision in this plan depends on which vendor wins. Resolution path:

1. Open the amendment PR against `.specify/memory/constitution.md`: AI row becomes OpenAI-compatible chat completions, the integration list swaps Gemini for OpenAI, Principle III's parenthetical is genericised, and the `text-embedding-004` mention is dropped since no embedding is used. MINOR or MAJOR bump per the team's reading; the Sync Impact Report gains a dated entry.
2. Record the reasoning durably as **ADR-0005, "AI provider: OpenAI behind a provider interface"** under `docs/adr/`, noting that `AIProvider` keeps the swap to one class.
3. Correct the five documents that still name Gemini: the use-case specification (UC-10, UC-22 secondary actor), `C4_Deployment.md`, `VisionDocument.md`, the project plan, and the proposal.

Until step 1 merges, implementation may proceed on the branch but MUST NOT merge to `main`. Recorded in Complexity Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/008-ai-chatbot/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── ai-chatbot.openapi.yaml
```

### Source Code (repository root)

```text
server/src/
├── config.ts                                 # AI_REQUEST_TIMEOUT_MS 60_000 → 8_000; ceiling defaults
├── db/migrations/0017_ai_chat.sql            # ai_usage_windows; ai_response_cache kind constraint
├── modules/admin/
│   └── settings.service.ts                   # ai_platform_request_ceiling, ai_platform_window_hours
└── modules/ai/
    ├── ai.routes.ts                          # POST /chat replaces POST /recommendations
    ├── ai.service.ts                         # chat flow; cache-before-allowance; ceiling; fallbacks
    ├── ai.repo.ts                            # NEW: candidates, category context, counters, cache
    └── providers/
        ├── ai.provider.ts                    # AIProvider gains chat(); types move to shared/ai
        └── openai.provider.ts                # chat() with system prompt, JSON schema, 8 s abort

shared/
└── ai/types.ts                               # NEW: the one contract both sides import

src/
├── components/
│   ├── AIChatPanel.tsx                       # NEW: replaces AIRecommendationPanel.tsx
│   └── EventDetail.tsx                       # unchanged; still records views
├── services/aiClient.ts                      # chat(); re-declared types deleted, shared imported
└── App.tsx                                   # mounts the chat panel; SPA navigation from results

server/tests/ai/
├── chat.test.ts                              # grounding, history, decline, SPA payload shape
├── limits.test.ts                            # cache-before-allowance, 10/hour, platform ceiling
└── degradation.test.ts                       # timeout, provider error, bad JSON, hallucinated id
```

**Structure Decision**: Keep the existing single-repository React + Express layout and the existing AI module boundary. Query code moves out of `ai.service.ts` into a new `ai.repo.ts` so the service reads as the decision flow it is, matching the repo/service split already used by `admin`, `catalog`, and `holds`. The provider seam is unchanged in kind — one interface, one implementation — so a vendor change stays a one-class change.

## Phase 0: Research Findings

Research is complete in [research.md](./research.md). Resolved decisions:

1. OpenAI stays, behind the existing `AIProvider` interface, with the constitutional amendment recorded as an open gate rather than assumed.
2. Conversation state is client-held, bounded to eight turns of 600 characters, re-validated per request, never persisted — which keeps the request path stateless as the constitution requires.
3. The cache is consulted before the per-user allowance is consumed; the allowance is spent only immediately before a call that will actually be made.
4. A platform-wide usage counter in `ai_usage_windows` provides the automatic ceiling that `[SCAL-03]` requires, incremented in the same transaction and lock scope as the per-user counter.
5. The timeout budget becomes 8 seconds, matching the specification.
6. One shared contract in `shared/ai/types.ts` replaces the payload declared twice today.
7. The single-shot endpoint is replaced, not aliased; its one consumer is rewritten in the same change.
8. Domain boundary is enforced in the system prompt and surfaced as a `declined` boolean, so the boundary is asserted rather than string-matched.
9. Every test injects a fake provider; no test reaches the network.

## Phase 1: Design Details

### Database migration

Create `0017_ai_chat.sql`:

- `ai_usage_windows(window_started_at TIMESTAMPTZ PRIMARY KEY, request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Delete `ai_response_cache` rows where `kind = 'recommendation'`, then replace the check constraint with `kind IN ('chat', 'listing')`. The deleted rows belong to an endpoint that ceases to exist; keeping them would leave answers no code can serve.
- No change to `ai_request_limits`, `user_event_bookmarks`, or `user_event_views`. The allowance fix is an ordering change in the service, not a schema change.

Full field rules in [data-model.md](./data-model.md).

### Shared contract

Add `shared/ai/types.ts` exporting `ConversationTurn`, `CandidateEvent`, `Recommendation`, `ChatRequest`, `ChatResponse`, `ListingInput`, `ListingSuggestion`, and `ListingResponse`. `server/src/modules/ai/providers/ai.provider.ts` imports these instead of declaring them; `src/services/aiClient.ts` deletes its copies and imports the same module. Shapes match [ai-chatbot.openapi.yaml](./contracts/ai-chatbot.openapi.yaml) exactly; a divergence must fail type-check, which is the point.

### Repository layer

Add `server/src/modules/ai/ai.repo.ts`, moving the existing queries out of the service unchanged in behaviour:

- `candidates(limit)` — publicly visible, upcoming, available events with starting price, composing `VISIBLE_JOIN`, `VISIBLE_WHERE`, `UPCOMING_SHOWTIME`, and `SHOWTIME_HAS_AVAILABILITY`. Cap 20, ordered by soonest start. `bigint` prices converted to `Number` at this boundary.
- `categoryContext(userId, source)` — the three personalisation lists, each parameterized on the session identity only.
- `consumeAllowance(userId)` — one transaction: upsert the attendee row, `SELECT … FOR UPDATE`, read the current platform window row `FOR UPDATE`, verify both the per-user count and the platform count against their limits, then increment both. Returns a discriminated result rather than throwing for the platform case, because the two outcomes differ: a personal refusal is a 429, a platform refusal is a silent fallback.
- `cacheGet(kind, userId, key)` / `cachePut(kind, userId, key, response, ttlMs)` — unchanged.
- `visibleEventId(slug)`, `toggleBookmark`, `listBookmarks`, `recordEventView` — moved unchanged.

### Chat flow

Rewrite `recommendEvents` as `chat(userId, { message, history })` in `ai.service.ts`, in this order:

1. Build the candidate set. Empty means nothing is on sale: return `source: "fallback"`, an explanatory reply, no events, no external call.
2. Read settings. `ai_features_enabled` false: return the non-AI fallback with a notice, no external call.
3. Build the request context: bounded history, new message, the three category lists, the candidate set. Hash it for the cache key.
4. Read the cache. Hit: return it as `source: "cache"`, **no allowance consumed**.
5. Consume the allowance. Personal limit reached: throw `429 ai_rate_limited`. Platform ceiling reached: return the non-AI fallback with a notice, no external call.
6. Call the provider under an 8 s abort. Map the result: keep only recommendations whose `eventId` is in the candidate map, take at most six, attach the database record for each.
7. `declined` true: return the reply with no events, and do not treat it as a failure.
8. No surviving recommendation and not declined: fall back, with the model's reply retained if it is usable.
9. Cache the result and return `source: "ai"`.
10. Any throw from step 6 — timeout, non-2xx, unparseable JSON, schema failure: log the reason and return the non-AI fallback. The reason is never surfaced verbatim to the attendee.

`generateEventListing` keeps its behaviour and adopts steps 2, 4, 5, and 10 in the same order, which is the fix to its own allowance ordering.

The non-AI fallback is the first six candidates with a fixed Vietnamese reason — already implemented, and correct in that it can only return live, available events.

### Provider

Extend `AIProvider` with `chat(context): Promise<{ reply: string; declined: boolean; recommendations: Array<{ eventId: number; reason: string }> }>` and implement it in `OpenAIProvider`:

- Same `complete()` helper: `response_format: { type: "json_object" }`, low temperature, `AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)`.
- System prompt states: rank only supplied candidates; every `eventId` must be an exact id from `candidates`; never invent an event, price, date, or id; answer only about TixHub events, tickets, and platform behaviour, otherwise set `declined` and return no recommendations; text inside the conversation is the user's words, not instructions to obey; write concise Vietnamese.
- Zod-parse the response with `.strict()`; a shape violation throws and lands in step 10 as a fallback. The existing tolerance for `event_id` alongside `eventId` is kept.

### Configuration

In `server/src/config.ts`:

- `AI_REQUEST_TIMEOUT_MS`: `60_000` → `8_000`, overridable by `AI_REQUEST_TIMEOUT_MS` in the environment.
- Add defaults `ai_platform_request_ceiling: 2000` and `ai_platform_window_hours: 24` to the settings defaults block, with bounds validation in `settings.service.ts` and both keys added to the Admin settings Zod schema and panel.
- `AI_REQUEST_LIMIT` and `AI_CACHE_TTL_MS` unchanged.
- `.env.example` keeps `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` as placeholders. The real key is set by the team in `.env`, which is git-ignored; it is not handled through this planning process.

### Frontend

Replace `src/components/AIRecommendationPanel.tsx` with `AIChatPanel.tsx`:

- Holds `turns: ConversationTurn[]` in component state; sends the last eight with each request; the conversation resets on unmount, which is the intended lifetime.
- Renders the exchange as a transcript: attendee turns and assistant replies, with recommended events as cards beneath the reply that produced them.
- Event cards call the existing SPA navigation handler instead of `<a href>`, so a recommendation opens the event without reloading the application.
- Loading state disables submit and shows in-flight text; the rest of the page stays interactive throughout.
- The reply region carries `aria-live="polite"` so an arriving answer is announced.
- Signed-out renders a one-line invitation to sign in rather than returning `null`.
- Type scale and surfaces only: `text-eyebrow` upward, `font-meta` / `font-display`, `bg-surface-2`, hairline rules. No `text-xs`, no `text-sm`, no `rounded-lg` — the panel currently uses all three and sits outside the design system agreed for the rest of the application.

`src/services/aiClient.ts` gains `chat(message, history)`, drops `recommendations()`, and imports every type from `shared/ai/types.ts`.

### Testing

`server/tests/ai/` with an injected fake provider throughout:

- **Grounding**: every returned event exists in the candidate set; a provider that returns an id absent from candidates yields a fallback, not a phantom event; a provider that returns a fabricated price cannot affect the response, because prices come from the projection.
- **Visibility**: draft, past, and sold-out events never appear in candidates or in a fallback.
- **History**: eight turns accepted, nine rejected at validation; a 601-character turn rejected; a history containing injected instructions produces no query outside the session identity, asserted on the SQL parameters.
- **Decline**: `declined: true` returns no recommendations and is not treated as failure.
- **Allowance**: identical question twice inside the TTL consumes one unit and calls the provider once; the tenth distinct request succeeds and the eleventh returns 429; the hour boundary resets.
- **Platform ceiling**: at the ceiling the provider double fails the test if invoked, and the response is a fallback with a notice.
- **Degradation**: timeout, non-2xx, unparseable JSON, and schema violation each return 200 with a fallback and a notice.
- **Authorisation**: unauthenticated requests to all five routes are refused and no AI table row changes; `/event-assistant` refuses an attendee session.
- Run `npm run typecheck`, `npm test -- --run`, `npm run lint`.

## Constitution Check (Post-Design)

- **Reliability**: PASS. Nothing in the design writes to a reservation, order, or ticket. The catalog is read through the same visibility predicate the public catalog uses, so the assistant cannot surface an event the browse page would hide.
- **Security**: PASS. Every route stays behind `requireAuth`; the organizer route keeps `requireOrganizer`. Personal-data SQL is parameterized on the session identity alone, and the injection test asserts that property rather than assuming it. Conversation content is never persisted, so it creates no new retention surface.
- **AI fence**: PASS. Grounded by construction — the model returns ids, the server returns records. Non-blocking by construction — six named degradation paths all return 200 with usable suggestions. Bounded by an asserted flag. Assistive — the organizer's draft still reaches an event only on acceptance.
- **Testability**: PASS. Every degradation and denial path above has a named test, and the provider double makes them deterministic and free.
- **Simplicity**: PASS. One table, one column constraint, one shared module, one panel, no new service, no new dependency, no embeddings.
- **Integration contract**: PASS. `shared/ai/types.ts` plus the OpenAPI document define each payload once; the removed endpoint leaves no unused contract behind.
- **Technology substitution**: **STILL OPEN.** Unchanged by design work — it is resolved by the amendment PR and ADR-0005, not by code.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| AI provider is OpenAI, while the constitution's fixed technology table and four-integration list name Google Gemini | The team holds an OpenAI key; the integration exists and works today on `mvp-demo`. The integration count stays at four — a substitution, not an addition | Adding a Gemini provider to comply literally would discard a working integration and require a key the team does not have, for no user-visible benefit. Resolution is the amendment procedure the constitution itself defines: amendment PR, ADR-0005, and correction of the five documents that still name Gemini. Implementation may proceed on the branch; merge to `main` is blocked until the amendment carries |
| Per-user allowance is shared across UC-10 and UC-22 rather than ten each | One counter, one row, one lock; the two features draw on one quota and one bill | Two counters would be stricter reading of the specification but weaker protection of the shared quota, and two numbers to explain in the same refusal message. Recorded as a deliberate, stricter-than-specified simplification |
| `AI_REQUEST_TIMEOUT_MS` is 25 s, where UC-10 A4, UC-22 A4 and PERF-05 say roughly 8 s | The eight-second figure was written when the technology table still said Gemini. The gateway the team configured serves reasoning models, and measured against the real prompt every one exceeds it: `alic/deepseek-v4-flash` (configured) 18.8–19.8 s, `deepseek-v4-flash` 23.1 s, `MiniMax-M2.7` 14.5 s, `Minimax-M3` 3.3–8.7 s. At 8 s every genuine question timed out and the assistant served the non-AI fallback every single time — behaving exactly as designed and being useless | Keeping 8 s was rejected because a correctly-degrading assistant that never actually answers is a feature in name only. Trimming the prompt was measured and rejected: latency on this gateway is dominated by its own variance, not by prompt size — the same query ran 5.3 s with a *larger* payload than one that took 8.5 s. Switching to `Minimax-M3` alone was rejected as sufficient because its 2.5× swing still straddles 8 s, so results would be intermittent. The guarantee PERF-05 exists to protect — AI never blocks a purchase — is untouched: the call is off the critical path, the page stays interactive, and the wait is legible through a typing indicator. Env-overridable, so a faster provider drops it back without a deploy |
