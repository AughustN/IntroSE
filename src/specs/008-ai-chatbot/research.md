# Research: AI Attendee Chatbot

## Decision: Use OpenAI chat completions behind the existing `AIProvider` interface

- **Decision**: Keep `server/src/modules/ai/providers/ai.provider.ts` as the seam and continue calling OpenAI through `OpenAIProvider`, configured by `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`. Add a `chat` method to the interface alongside the existing two.
- **Rationale**: The key the team holds is an OpenAI key, the provider already exists and is already the only call site, and the interface means a later switch is one class, not a rewrite. Responses are requested as JSON objects so the reply and the event ids arrive in one parseable payload with no prose-scraping.
- **Constitutional consequence**: The constitution's fixed technology table names "Google Gemini API (chat + `text-embedding-004`)" and its integration list enumerates Gemini as one of exactly four permitted external integrations. Substituting OpenAI changes a listed technology, which the constitution says requires an amendment. This is recorded as an open gate in the plan, with ADR-0005 as the durable record. It is a governance action, not a code action, and it does not change any design decision below.
- **Alternatives considered**: Adding a Gemini provider to satisfy the constitution literally was rejected for now because the team has no Gemini key and the existing working integration would be discarded to obtain no user-visible benefit. Running both providers behind a switch was rejected as unpaid-for complexity under Principle V.

## Decision: Carry conversation state on the client, bounded and re-validated on the server

- **Decision**: The client sends the recent turns with each request. The server accepts at most the last eight turns, each at most 600 characters, validates them with a strict schema, and stores nothing. No conversation table, no session cache.
- **Rationale**: The constitution requires the request path to stay stateless so the backend can scale horizontally, and a conversation that dies with the tab is exactly what UC-10 needs — there is no requirement to resume a chat later. This also keeps the feature free of a new table and a retention policy for user-authored text.
- **Injection containment**: Prior turns are untrusted text and are treated as such. They influence only the prose the model writes. They cannot widen a query, because every personal-data query is scoped in SQL to the server-injected `req.auth.userId` and the model never supplies an identifier. They cannot introduce an event, because only ids present in the server-built candidate set survive filtering. The system prompt states that instructions appearing inside conversation content are data, not commands.
- **Alternatives considered**: Server-side conversation storage was rejected for the statelessness rule, the retention burden on user-authored content, and the absence of a resume requirement. Passing a conversation id and reconstructing from cache was rejected as the same cost with a shorter lifetime.

## Decision: Check the cache before consuming the per-user allowance

- **Decision**: Order every AI operation as: feature switch, catalog candidates, cache read, then allowance consumption, then the model call. The allowance is decremented only immediately before a call that will actually be made.
- **Rationale**: UC-10 A1 defines a cache hit as costing no model call, and the allowance exists to bound model cost. The current implementation decrements first, so ten repeats of one question exhaust the hour while spending nothing. The reordering makes the counter mean what its name says.
- **Consequence for the cache key**: The key hashes the request context, which includes the candidate list. The candidate list changes whenever availability changes, so hit rates are modest by construction. Narrowing the key to the conversation alone was considered and rejected: a cached answer must never outlive the availability it was grounded in, and a stale hit would present a sold-out event as bookable, violating grounding.
- **Alternatives considered**: A separate, larger allowance for cached requests was rejected as two counters to explain instead of one to order correctly.

## Decision: Add a platform-wide usage counter as an automatic guard beneath the Admin switch

- **Decision**: Add one row per window to `ai_usage_windows`, incremented in the same transaction that consumes a per-user allowance. When the window count reaches the configured threshold, all AI operations serve cache or non-AI fallback and make no external call. The threshold and window length are Admin-managed settings with config defaults.
- **Rationale**: UC-10 A3 and UC-22 A3 require automatic degradation at a platform quota threshold, and `[SCAL-03]` names it. Today only a manual boolean exists, which protects nothing at three in the morning. Counting in the same transaction as the per-user counter means one lock, one write, and no drift between the two numbers.
- **Alternatives considered**: Reading spend from the provider's billing API was rejected as a second external dependency for an operational guard. An in-memory counter was rejected because it resets on deploy and would not survive the process restart that a quota incident tends to cause.

## Decision: Set the timeout budget to 8 seconds, from configuration

- **Decision**: `AI_REQUEST_TIMEOUT_MS` becomes 8000, sourced from configuration so it can be tuned without a code change, and remains enforced by `AbortSignal.timeout` on the fetch.
- **Rationale**: Both UC-10 A4 and UC-22 A4 state a roughly eight-second budget under `[PERF-05]`. The implemented 60 seconds is not a slower version of the same behaviour; it is a minute of an attendee watching a spinner before the fallback they could have had at eight seconds.
- **Alternatives considered**: Keeping 60 seconds and showing partial progress was rejected because the endpoint returns one payload and there is no partial state to show. Streaming to make the wait tolerable was rejected as out of scope.

## Decision: One shared contract in `shared/ai/types.ts`

- **Decision**: Move `AICandidateEvent`, the recommendation shape, the chat request and response, and the listing suggestion into `shared/ai/types.ts`, imported by both `server/src/modules/ai` and `src/services/aiClient.ts`.
- **Rationale**: The payload is currently declared twice — once in the provider module, once again in the web client — which Principle VI names explicitly as prohibited contract drift. The repository already has `shared/admin`, `shared/auth`, `shared/catalog`, and `shared/holds`; this is the missing fifth, not a new idea.
- **Alternatives considered**: Generating types from the OpenAPI contract was rejected as tooling the project does not otherwise use.

## Decision: Replace the single-shot endpoint rather than run both

- **Decision**: `POST /api/ai/chat` replaces `POST /api/ai/recommendations`, which is deleted in the same change. Its only consumer, `AIRecommendationPanel`, is rewritten as the chat panel.
- **Rationale**: Principle VI requires a contract change to update every consumer in the same change and prohibits merging dead code. There is exactly one consumer, so the migration is complete on the day it lands.
- **Alternatives considered**: Keeping the old route as a thin alias was rejected: nothing would call it, and an uncalled route is an untested surface that still accepts requests.

## Decision: Bound the assistant to the TixHub domain in the system prompt, verified by test

- **Decision**: The system prompt states the assistant answers only about TixHub events, tickets, and platform behaviour, declines anything else in one Vietnamese sentence, and returns no events when declining. The response schema carries an explicit `declined` flag so the server can assert the contract rather than infer it from prose.
- **Rationale**: Principle III requires the assistant to be bounded and scoped. A flag makes "did it decline" a testable fact instead of a string match on generated Vietnamese, which would be brittle in exactly the test that matters.
- **Alternatives considered**: A pre-classifier call was rejected as doubling the cost and latency of every question to enforce a rule the same call can enforce.

## Decision: Retrieve lexically in Postgres, and leave the dense half unbuilt

- **Decision**: The candidate set is retrieved *against the question*, by Postgres full-text search over a generated `events.search_doc` tsvector (title and original title weighted A, line-up and genre B, description C), plus trigram similarity on the unaccented title and on the venue city. Eligibility — visible, upcoming, available — stays a `WHERE` clause and is never something relevance can outrank. No embedding column and no vector index.
- **Rationale**: The first implementation handed the model "the twenty soonest events on sale" regardless of what was asked. That is indistinguishable from working while the catalog holds twenty sellable events and silently wrong the moment it holds a hundred: the model can only rank what it is given, so an event outside that window may as well not exist — and the assistant reports its absence with confidence. Retrieval is therefore the component that decides what the assistant is *capable* of answering, and it has to see the question. `unaccent` is what makes it usable in Vietnamese: nobody types tones into a chat box, and "trinh cong son" has to reach "Trịnh Công Sơn". `simple` rather than a language configuration because Postgres ships no Vietnamese stemmer and Vietnamese is analytic, so plain tokenisation loses very little.
- **Why not dense/semantic**: `pgvector` 0.8.1 is available on this Neon instance and an `events.embedding` column with an HNSW index would slot in beside the existing indexes without changing the service — `candidates()` already returns a ranked list and no caller sees how it was ranked. What is missing is a way to fill it: the configured gateway rejects every embedding model on this API key (`403 FORBIDDEN — Please subscribe to model in the API Key`, tested against `text-embedding-3-small`, `text-embedding-ada-002`, `bge-m3`, `embedding-2`). An empty vector index retrieves nothing and costs a write on every event edit, so the column is added when there is a model to fill it and not before. The constitution anticipated embeddings (`text-embedding-004` in the technology table); that line should be removed with the rest of the Gemini correction if the team does not intend to subscribe to one.
- **Alternatives considered**: Extracting city, price and category from the question with the model and feeding them back as SQL filters was rejected as a second model round-trip on the critical path of a feature already fighting a latency budget. Raising the candidate ceiling instead of ranking was rejected because it only postpones the problem and makes the prompt — already the cause of the timeouts — larger.

## Decision: Cut by relative score, not an absolute floor

- **Decision**: Keep rows scoring within `RELATIVE_FLOOR` (0.25) of the best score. If the best score is itself below `SIGNAL_FLOOR` (0.08), treat the question as having no lexical subject: return every eligible event, re-sorted soonest-first.
- **Rationale**: Trigram similarity gives almost any pair of Vietnamese strings a small non-zero score. Under a single fixed threshold, a question with no subject — "có gì hay không" — scraped past it on exactly one event through shared syllables, and that lucky row then hid every other event on sale; the reader is told there is one thing on. Worse, the same noise ordered the list, floating a distant event above one happening tomorrow. Two tests separate the questions "did anything match?" from "what is competitive with the best match?", and the no-signal branch drops relevance from the ordering as well as the filter. Both failure modes were found by tests before the code shipped, which is why the thresholds are named constants rather than inline numbers.
- **Alternatives considered**: Raising the single floor was rejected — it trades one arbitrary cut-off for another and still lets a lone noisy match suppress the list. Applying trigram only when full-text search returns nothing was considered and kept in reserve; the relative cut solves the observed problem without giving up fuzzy matching on queries that also have exact hits.

## Decision: Test with a provider test double, never the network

- **Decision**: All tests inject a fake `AIProvider`. Cases cover cache hit without allowance consumption, allowance exhaustion at eleven, platform threshold blocking the call outright, timeout, provider error, unparseable output, hallucinated event id, off-domain decline, injected instructions in history, and unauthenticated refusal.
- **Rationale**: Principle IV requires denial paths to be tested, not just happy paths, and the AI module currently has no tests at all while every other server module has a suite. A test double makes the degradation paths — which are the whole point of Principle III — deterministic and free.
- **Alternatives considered**: Recorded HTTP fixtures were rejected as a second thing to maintain for behaviour that is entirely ours, not the provider's.
