# Quickstart: AI Attendee Chatbot

Validation guide for feature 008. Shapes are in [contracts/ai-chatbot.openapi.yaml](./contracts/ai-chatbot.openapi.yaml); field rules are in [data-model.md](./data-model.md).

## Prerequisites

- PostgreSQL reachable through `DATABASE_URL`; dependencies installed.
- `JWT_SECRET` and `AUTH_EVENT_HASH_KEY` set.
- An attendee account, an organizer account, and at least three publicly visible events that are upcoming and have availability.
- `OPENAI_API_KEY` set in `.env` **by a team member, pasted directly**. The key is never handed through an assistant, never committed, and `.env` stays git-ignored. `OPENAI_BASE_URL` and `OPENAI_MODEL` may stay at their `.env.example` defaults.

Every scenario below except "Live smoke test" runs without a key and without network access, because the tests inject a fake provider.

## Apply schema

```powershell
npm run db:migrate
```

Expected: `0017_ai_chat.sql` creates `ai_usage_windows`, removes any `ai_response_cache` rows with `kind = 'recommendation'`, and replaces that column's check constraint with `kind IN ('chat', 'listing')`. No other AI table changes.

## Run the automated suite

```powershell
npm run typecheck
npm test -- --run
npm run lint
```

Expected: zero type errors, zero lint errors, all `server/tests/ai/` specs passing, and AI module statement coverage at or above 60%.

## Scenario 1 — Grounded first answer

Start both processes in separate terminals:

```powershell
npm run dev:server
npm run dev:web
```

Sign in as the attendee, open the assistant on the events page, and ask a question in Vietnamese.

Expected: a prose reply plus up to six events. Every title, city, start time, and starting price matches the database row for that event. Selecting an event opens its detail page with no full document reload — the network tab shows an API call, not a document request.

## Scenario 2 — Follow-up turn

Ask an opening question, then send a follow-up that means nothing on its own, such as "rẻ hơn nữa đi".

Expected: the answer accounts for the earlier turn. The request body carries the earlier turns in `history`; no conversation row exists in the database afterwards. Reload the page: the transcript is empty and unrecoverable.

## Scenario 3 — Off-domain question

Ask something unrelated to events.

Expected: `declined: true`, a one-sentence Vietnamese decline, and an empty `recommendations` array.

## Scenario 4 — Cache costs no allowance

Ask one question, note the response `source`, then ask the identical question again within the cache lifetime.

```sql
SELECT request_count FROM ai_request_limits WHERE user_id = $1;
```

Expected: the first answer is `source: "ai"`; the second is `source: "cache"`; `request_count` is identical before and after the second ask.

## Scenario 5 — Per-user allowance

Send ten distinct questions in one clock hour, then an eleventh.

Expected: the tenth succeeds; the eleventh returns HTTP 429 with code `ai_rate_limited`. This is the only degradation reported as an error. After the hour boundary, a further question succeeds.

## Scenario 6 — Platform ceiling

Set the ceiling low as an Admin, then ask as the attendee:

```sql
UPDATE ai_usage_windows SET request_count = 999999 WHERE window_started_at = date_trunc('day', now());
```

Expected: HTTP 200, `source: "fallback"`, a notice, and live upcoming events. No outbound request appears in the server log.

## Scenario 7 — Admin kill switch

Set `ai_features_enabled` to false in the Admin panel and ask again.

Expected: HTTP 200, `source: "fallback"`, a notice, and no external call. Restore the setting afterwards.

## Scenario 8 — Provider failure and timeout

With `OPENAI_BASE_URL` pointed at an unroutable host, ask a question. Then point it at a host that accepts the connection and never responds.

Expected: both return HTTP 200 with `source: "fallback"`, a notice, and usable events. The second returns in roughly eight seconds, not sixty — time it. Restore the variable afterwards.

## Scenario 9 — Authorisation

With no session, call `POST /api/ai/chat`, `POST /api/ai/event-assistant`, `GET /api/ai/bookmarks`, `POST /api/ai/events/{slug}/bookmark`, and `POST /api/ai/events/{slug}/view`.

Expected: every one returns 401 and no row changes in `ai_request_limits`, `ai_usage_windows`, or `ai_response_cache`. Signed in as an attendee, `/event-assistant` returns 403.

## Scenario 10 — Live smoke test

Requires the real key. Ask three genuine questions as the attendee.

Expected: three grounded answers, `request_count` at three, and `ai_usage_windows.request_count` advanced by three. Confirm the server log contains no fragment of the key and no request body.

## Cleanup

```sql
DELETE FROM ai_response_cache WHERE user_id = $1;
DELETE FROM ai_request_limits WHERE user_id = $1;
DELETE FROM ai_usage_windows;
```

Restore `ai_features_enabled`, `OPENAI_BASE_URL`, and any lowered ceiling to their original values.
