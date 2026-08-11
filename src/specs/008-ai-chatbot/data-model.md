# Data Model: AI Attendee Chatbot

Migration `0016_ai.sql` already created four tables. This feature adds one table, widens one check constraint, and adds two Admin-managed settings. Conversation content is deliberately not modelled: it is never stored.

## Attendee AI Allowance

Existing table: `ai_request_limits`. Unchanged in shape.

| Field | Type | Rules |
|---|---|---|
| `user_id` | `BIGINT` | Primary key; foreign key to `users(id)`, cascade on delete. |
| `window_started_at` | `TIMESTAMPTZ` | Start of the clock hour the count belongs to. |
| `request_count` | `INTEGER` | Non-negative; number of model-backed requests consumed in that hour. |

Rules:

- One row per attendee, created lazily on first AI use.
- The row is locked with `FOR UPDATE` inside the consuming transaction, so two concurrent requests cannot both read nine and both write ten.
- The counter is shared by every AI feature. UC-10 and UC-22 draw from the same ten per hour, which is stricter than the specification's two independent allowances and is recorded as a deliberate simplification.
- **Behaviour change**: consumption moves to after the cache read, so a cache hit no longer increments the count. The table itself does not change.

## Platform AI Usage

New table: `ai_usage_windows`.

| Field | Type | Rules |
|---|---|---|
| `window_started_at` | `TIMESTAMPTZ` | Primary key; start of the current threshold window, truncated to the window unit. |
| `request_count` | `INTEGER` | Non-negative; model-backed requests across all attendees in the window. |
| `updated_at` | `TIMESTAMPTZ` | Required, defaults to current time. |

Rules:

- One row per window; rows accumulate as a cheap usage history and are never required to be pruned for correctness.
- Incremented in the same transaction and the same lock scope as the per-user counter, so the two can never disagree about whether a call was authorised.
- When `request_count` has reached the configured threshold for the current window, no external call may be made by any AI operation until the window rolls over.
- Read on every AI request; the read is a single indexed primary-key lookup.

## Cached Answer

Existing table: `ai_response_cache`. One constraint widened.

| Field | Type | Rules |
|---|---|---|
| `kind` | `TEXT` | Part of the primary key. Check constraint currently `IN ('recommendation', 'listing')`; **widened to `IN ('chat', 'listing')`** as `recommendation` ceases to exist with its endpoint. |
| `user_id` | `BIGINT` | Part of the primary key; foreign key to `users(id)`, cascade on delete. |
| `cache_key` | `TEXT` | Part of the primary key; SHA-256 of the serialised request context. |
| `response` | `JSONB` | The full answer payload as returned to the client. |
| `expires_at` | `TIMESTAMPTZ` | Required; rows past this instant are treated as absent. |
| `created_at` | `TIMESTAMPTZ` | Required, defaults to current time. |

Rules:

- The cache key for a chat request hashes the bounded conversation window, the attendee's three category-context lists, and the candidate event set. Any change in availability therefore produces a new key, so a cached answer can never present an event that has since sold out.
- A hit is served without an external call and without consuming the allowance, and is marked `source: "cache"` in the response.
- Existing rows with `kind = 'recommendation'` are deleted by the migration before the constraint is tightened, since their endpoint no longer exists.

## Event Search Document

New generated column: `events.search_doc tsvector`, added by `0018_ai_retrieval.sql` along with the `unaccent` and `pg_trgm` extensions.

| Field | Type | Rules |
|---|---|---|
| `search_doc` | `tsvector` | `GENERATED ALWAYS … STORED`. Weight A: `title`, `original_title`. Weight B: `lineup`, `genre`. Weight C: `description`. Built with `to_tsvector('simple', immutable_unaccent(…))`. |

Rules:

- Maintained by the database, so an edited event is searchable immediately with no application code and no reindex job. There is a test that renames an event and asserts the old words stop matching.
- `simple` configuration, not a language one: Postgres ships no Vietnamese stemmer, and Vietnamese does not inflect, so plain tokenisation is close to lossless.
- Two helper functions exist only to make the column and its indexes legal. `unaccent(text)` is STABLE because the dictionary depends on the search path, and `array_to_string(anyarray, text)` is STABLE because an arbitrary element type's output function might be; `immutable_unaccent` names the dictionary and `immutable_join` narrows the signature to `TEXT[]`, which makes both promises the planner can actually keep.
- Indexes: GIN on `search_doc`; GIN trigram on `immutable_unaccent(events.title)` and on `immutable_unaccent(venues.city)`.
- **No embedding column.** `pgvector` is installed and available, but the configured gateway serves no embedding model on this key, so there is nothing to populate a vector with. See research.md.

## Candidate Event

Not a table. A projection built per request from `events`, `event_categories`, `showtimes`, `venues`, and `ticket_tiers`, filtered by the shared visibility predicate plus upcoming-showtime and availability conditions, then **ranked against the question**.

Relevance is the sum of three signals, and it decides order and cut only — never membership:

| Signal | Weight | Purpose |
|---|---|---|
| `ts_rank_cd(search_doc, websearch_to_tsquery(…))` | 1.0 | The event's own words. |
| `similarity(immutable_unaccent(title), query)` | 0.4 | Half-remembered and mistyped titles. |
| `max(similarity(immutable_unaccent(city), query))` | 0.3 | "ha noi" reaching "Hà Nội". |

Rows are kept when their score is within 25% of the best. When the best score is below 0.08 the question is treated as having no lexical subject: every eligible event is returned, ordered soonest-first, because "nothing matched your words" and "there is nothing on" are different answers.

| Field | Type | Rules |
|---|---|---|
| `id` | `number` | Event id; the only identifier the model may return. |
| `slug` | `string` | Used to build the in-application link. |
| `title` | `string` | Displayed verbatim from the database. |
| `category` | `string` | Category code. |
| `city` | `string \| null` | Venue city. |
| `startsAt` | `string` | Earliest upcoming showtime, ISO. |
| `startingPrice` | `number \| null` | Lowest tier price in VND, integer; `null` when no tier is priced. |

Rules:

- Bounded to at most twenty rows per request, ordered by soonest start.
- This set is the complete universe of events the answer may contain. An event id returned by the model that is absent here is discarded before the response is built.
- Every field displayed to the attendee is taken from this projection, never from generated text.

## Conversation Turn

Not persisted. Present only in the request body and in memory for the duration of the request.

| Field | Type | Rules |
|---|---|---|
| `role` | `"user" \| "assistant"` | Strict enum; any other value fails validation. |
| `content` | `string` | Trimmed, 1 to 600 characters. |

Rules:

- At most eight turns accepted per request; excess is rejected by validation rather than silently truncated, so the client and server agree on what was sent.
- Treated as untrusted input throughout. It shapes generated prose and nothing else — it cannot select a user, widen a query, or introduce an event.
- Never written to any table, log, or cache in isolation. It appears in the cache only as part of an opaque hash.

## Saved Event and Viewed Event

Existing tables: `user_event_bookmarks`, `user_event_views`. Unchanged.

Both are keyed `(user_id, event_id)` with cascade deletes, and both are read only through queries whose `user_id` parameter is the server-injected session identity. They supply the purchased, saved, and viewed category lists that form the personalisation context.

## Settings

Two keys added to the existing `system_settings` store, alongside `ai_features_enabled`.

| Key | Type | Default | Rules |
|---|---|---|---|
| `ai_platform_request_ceiling` | integer | 2000 | Non-negative. Model-backed requests permitted per window across all attendees. Zero disables external calls entirely, which is a valid emergency setting. |
| `ai_platform_window_hours` | integer | 24 | Between 1 and 720. Length of the threshold window. |

Rules:

- Both are read through the existing `SettingService`, so they inherit its cache, its bounds validation, and its audit trail.
- `ai_features_enabled` remains the manual kill switch and is checked first; the ceiling is the automatic guard beneath it.
- Timeout, per-user allowance, and cache lifetime remain environment and code constants, not Admin settings, because changing them is a deployment decision rather than an operational one.
