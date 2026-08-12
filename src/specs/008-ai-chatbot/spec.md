# Feature Specification: AI Attendee Chatbot

**Feature Branch**: `008-ai-chatbot`
**Created**: 2026-08-11
**Status**: Draft
**Input**: User description: "Write plan for AI chatbot in this website, already have the OpenAI API key." Scope derives from UC-10 (Get AI event recommendations) and the shared AI plumbing behind UC-22 (Use AI listing assistant) in `docs/Analysis_Design/Group02_UseCaseSpecification.md`, plus the gap audit of the existing `server/src/modules/ai` implementation carried out on 2026-08-11.

## Context

An AI surface already exists on `mvp-demo`: `POST /api/ai/recommendations`, a DB-backed per-user rate limit, a DB-backed response cache, bookmark and view-history capture, and an `AIProvider` interface with an OpenAI implementation. It is a single-shot question box, not a chatbot: each submission is independent, no prior turn is carried, and the answer is rendered as three cards with no prose reply.

This feature turns that surface into the conversational assistant UC-10 describes, and closes four deviations found in the audit: an ~8 s timeout budget stated by the spec but implemented as 60 s, a rate limit consumed before the cache is consulted, an absent platform-wide quota guard, and a frontend that re-declares the response payload instead of importing a shared contract.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask the assistant for events in natural language (Priority: P1)

A signed-in attendee opens the assistant, types a question in Vietnamese such as "cuối tuần này có nhạc gì dưới 500k không", and receives a short written answer plus a set of real events that are on sale, each opening the event detail page.

**Why this priority**: This is UC-10's basic flow and the reason the feature exists. Nothing else in the feature is observable without it.

**Independent Test**: Sign in, open the assistant, ask one question, and verify the reply text and that every event shown exists in the catalog, is currently on sale, and opens its detail page.

**Acceptance Scenarios**:

1. **Given** a signed-in attendee and at least one event on sale, **When** they ask a question in Vietnamese, **Then** the system returns a prose reply and between zero and six events, each drawn from the catalog.
2. **Given** a returned event, **When** the attendee selects it, **Then** the event detail page opens without a full page reload.
3. **Given** any returned event, **When** its title, date, city, or price is compared with the database, **Then** every value matches the stored record.
4. **Given** the assistant is generating an answer, **When** the attendee scrolls, filters, or begins a purchase, **Then** the rest of the application stays fully interactive.

### User Story 2 - Continue the conversation (Priority: P1)

The attendee follows up with "rẻ hơn nữa đi" or "ở Hà Nội thôi" and the assistant answers in the context of what was already asked, without the attendee restating the original question.

**Why this priority**: This is what distinguishes a chatbot from the current one-shot box, and it is the wording UC-10 uses. Without it the feature is the existing implementation renamed.

**Independent Test**: Ask an opening question, then a follow-up that is meaningless in isolation, and verify the answer reflects the earlier turn.

**Acceptance Scenarios**:

1. **Given** a prior turn in the same conversation, **When** the attendee sends a follow-up that refers to it implicitly, **Then** the reply accounts for the earlier turn.
2. **Given** a conversation longer than the retained window, **When** the attendee sends another turn, **Then** the oldest turns are dropped and the request still succeeds.
3. **Given** the attendee reloads the page, **When** the assistant opens, **Then** the conversation starts empty and no earlier turn is recoverable.
4. **Given** any turn in the history, **When** it contains text that instructs the assistant to ignore its rules or to reveal another user's data, **Then** the assistant answers within its normal scope and no data outside the signed-in attendee's own records is read.

### User Story 3 - Stay inside the TixHub domain (Priority: P2)

The attendee asks something unrelated — a maths problem, a recipe, a political question — and the assistant declines briefly and offers to help find events instead.

**Why this priority**: Constitution Principle III requires the assistant to be bounded and scoped. It also protects the quota from being spent on questions the product does not answer.

**Independent Test**: Ask three off-domain questions and verify each is declined in Vietnamese without an attempt to answer.

**Acceptance Scenarios**:

1. **Given** an off-domain question, **When** it is sent, **Then** the assistant declines and redirects to event discovery, and returns no events.
2. **Given** a question about TixHub itself (how holds work, how to get a refund), **When** it is sent, **Then** the assistant answers from platform behaviour rather than declining.

### User Story 4 - Degrade instead of failing (Priority: P1)

When the model is slow, erroring, disabled by an Admin, or the platform quota is exhausted, the attendee still receives useful suggestions and never an error page.

**Why this priority**: Constitution Principle III and Decision-Making rule 2 make graceful degradation non-negotiable; the assistant may never be the reason a user is blocked.

**Independent Test**: Force each of the four degradation causes in turn and verify a usable non-AI result every time.

**Acceptance Scenarios**:

1. **Given** the model does not answer within the timeout budget, **When** the budget elapses, **Then** the request is abandoned and non-AI suggestions are returned with a notice.
2. **Given** the model returns an error or unparseable output, **When** the response is received, **Then** non-AI suggestions are returned with a notice.
3. **Given** an Admin has switched AI features off, **When** the attendee asks a question, **Then** non-AI suggestions are returned with a notice and no external call is made.
4. **Given** the platform-wide quota threshold is reached, **When** any attendee asks a question, **Then** the last cached answer or non-AI suggestions are returned and no external call is made.
5. **Given** the attendee has exceeded their personal hourly allowance, **When** they ask again, **Then** they are told to try later, and this is the only degradation case that is reported as a refusal rather than as suggestions.

### User Story 5 - Respect the per-user allowance honestly (Priority: P2)

An attendee who repeats a question they already asked is served from cache and is not charged against their hourly allowance for it.

**Why this priority**: UC-10 A1 states a cache hit costs no model call; charging the allowance for a free answer exhausts the ten-per-hour budget without cause.

**Independent Test**: Ask the same question twice inside the cache lifetime and verify the remaining allowance is unchanged by the second ask.

**Acceptance Scenarios**:

1. **Given** an answer already cached for this attendee, **When** the same question is asked again, **Then** the cached answer is returned, the allowance is not decremented, and no external call is made.
2. **Given** ten model-backed questions in the current hour, **When** an eleventh distinct question is asked, **Then** it is refused with a try-later message.
3. **Given** the hour boundary passes, **When** the attendee asks again, **Then** the allowance has reset.

### Edge Cases

- Attendee is signed out: the assistant invites sign-in rather than disappearing silently; no AI endpoint is reachable without authentication.
- Catalog is empty or nothing is on sale: the assistant says so plainly and returns no events; no external call is made.
- Attendee has no purchase, saved, or view history: the assistant still answers, and the non-AI fallback ranks by soonest upcoming on-sale event.
- The model names an event id that is not in the supplied candidate set: that item is discarded; if nothing survives, the non-AI fallback is used.
- The model returns prose but no events: the prose is shown on its own.
- Two requests from the same attendee arrive together: the allowance is decremented exactly once per model-backed request.
- Message exceeds the accepted length: the request is rejected by validation before any external call.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose one authenticated conversational endpoint that accepts the attendee's new message plus the recent turns of the current conversation and returns a prose reply with zero or more recommended events.
- **FR-002**: The system MUST reject any request from an unauthenticated caller before performing any catalog query, cache read, allowance change, or external call.
- **FR-003**: The system MUST scope every personal-data query — purchases, saved events, view history — to the server-injected session identity. No client-supplied value may select the user whose data is read.
- **FR-004**: Every event fact presented to the attendee (title, category, city, start time, starting price, link) MUST come from a platform query. The model MUST NOT be the source of any such value, and any event the model names that is not in the supplied candidate set MUST be discarded.
- **FR-005**: The system MUST retain a bounded window of recent conversation turns per request and MUST NOT persist conversation content beyond the response.
- **FR-006**: The system MUST decline questions outside the event-ticketing domain and return no events for them.
- **FR-007**: The system MUST consult the response cache before consuming any part of the attendee's hourly allowance, and MUST consume the allowance only when a model call is about to be made.
- **FR-008**: The system MUST limit each attendee to ten model-backed AI requests per clock hour across all AI features, and MUST refuse further requests in that hour with a try-later message.
- **FR-009**: The system MUST cap total platform AI spend by a configurable threshold, and once reached MUST serve cached answers or non-AI suggestions without making any external call, for all attendees, until the threshold window resets.
- **FR-010**: The system MUST abandon any model call that has not completed within the configured timeout budget and MUST fall back to non-AI suggestions.
- **FR-011**: Every degradation path — feature switched off, platform quota reached, timeout, model error, unparseable output, no surviving events — MUST return a successful response carrying non-AI suggestions and an explanatory notice, never an error status. The per-user allowance refusal (FR-008) is the sole exception.
- **FR-012**: The non-AI fallback MUST return only events that are publicly visible, upcoming, and have availability.
- **FR-013**: The system MUST cache each model-backed answer against the attendee and the request context for a bounded lifetime, and MUST mark cache-served answers as such in the response.
- **FR-014**: The response payload MUST be defined once as a shared TypeScript contract imported by both server and web client; neither side may re-declare it.
- **FR-015**: The assistant panel MUST show a distinct loading state while a request is in flight, MUST keep the rest of the page interactive, and MUST announce arriving replies to assistive technology.
- **FR-016**: Recommended events MUST navigate within the single-page application, without a full document reload.
- **FR-017**: The assistant MUST render entirely within the established type scale and surface palette; no size below 14px and no control shape foreign to the surrounding design.
- **FR-018**: All model-facing configuration — key, base URL, model name, timeout, per-user allowance, cache lifetime, platform threshold — MUST come from environment variables or Admin-managed settings. No key or endpoint may be committed.
- **FR-019**: The existing single-shot recommendation endpoint MUST be removed in the same change that introduces the conversational endpoint, with its only consumer updated, so no unused contract remains.

### Key Entities

- **Conversation turn**: one message with a role of attendee or assistant and its text. Supplied by the client, bounded in count and length, never stored.
- **Candidate event**: a publicly visible, upcoming, available event with id, slug, title, category, city, start time, and starting price, drawn from the catalog and offered to the model as the only permissible answer set.
- **Recommendation**: a candidate event paired with a short Vietnamese reason.
- **Attendee AI allowance**: a per-user counter of model-backed requests within the current clock hour.
- **Cached answer**: a stored reply keyed by kind, attendee, and a hash of the request context, valid for a bounded lifetime.
- **Platform AI usage**: a counter of model-backed requests across all attendees within the current threshold window.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in attendee receives a grounded answer to a first question in a conversation, with every displayed event fact matching the database, in 100% of sampled runs.
- **SC-002**: A follow-up turn that is meaningless in isolation is answered in the context of the previous turn in at least 9 of 10 sampled conversations.
- **SC-003**: No answer ever presents an event that is not publicly visible, not upcoming, or has no availability — verified by automated test, zero tolerance.
- **SC-004**: With the model made unreachable, 100% of requests return usable non-AI suggestions and a notice, with no error status and no unhandled rejection.
- **SC-005**: No model call is left running longer than the configured timeout budget, verified by a test that holds the connection open.
- **SC-006**: Asking one identical question twice inside the cache lifetime consumes exactly one unit of the hourly allowance.
- **SC-007**: The eleventh distinct model-backed request within one clock hour is refused, and the tenth succeeds.
- **SC-008**: With the platform threshold reached, zero external calls are made, verified by a provider test double that fails the test if invoked.
- **SC-009**: An unauthenticated request to any AI endpoint is refused, and no row in any AI table changes.
- **SC-010**: A conversation history crafted to contain injected instructions produces no query outside the signed-in attendee's own data, verified by an automated test.
- **SC-011**: The AI module reaches at least 60% automated statement coverage, matching the bar the constitution sets for critical modules.
- **SC-012**: Type-check, lint, and the full test suite pass with zero errors.

## Assumptions

- The OpenAI API key is available to the team and will be supplied through the environment; it is never committed and never handled in chat.
- Choosing OpenAI in place of Google Gemini contradicts the fixed technology table in the constitution and requires an amendment plus an ADR before implementation merges. This specification assumes that amendment is proposed and carried; the plan records it as an open gate rather than a settled fact.
- The Admin switch `ai_features_enabled` already exists and remains the manual kill switch; the platform threshold of FR-009 is an automatic guard layered beneath it.
- UC-22's organizer listing assistant keeps its current behaviour except where the shared plumbing it depends on — allowance ordering, timeout, platform threshold, shared contract — changes underneath it. Redesigning the organizer AI panel is out of scope.
- Streaming token-by-token output is out of scope; a single response per turn is sufficient for the non-blocking requirement.
- Retrieval by embedding is out of scope. The candidate set is produced by SQL and stays small enough that no vector index is warranted, consistent with the free-tier discipline principle.
