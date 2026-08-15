# Contract: AI Listing Assistant (UC-22)

The wire shape lives in `studio.openapi.yaml` under `POST /api/organizer/ai/listing`. This document
covers the parts a schema cannot express: what the endpoint promises to *never* do, and the order in
which its guards run. Both are constitutional obligations (Principle III), not implementation
preferences.

## The four promises

1. **It never blocks.** Timeout, upstream error, and quota exhaustion all return `200
   {available:false, reason}`. The client's fallback is therefore the ordinary rendering path, not an
   error path — a UI cannot accidentally treat a degraded assistant as a broken page (R-7, PERF-05,
   SCAL-03).
2. **It never invents a number.** The suggested price is computed in SQL from comparable published
   events and is never requested from, or shown to, the model. The model writes prose only (R-6,
   FR-033, ADR-0001).
3. **It never writes to the event.** The response is a suggestion. Nothing enters the form until the
   organizer accepts it, per field, after any edits they make (FR-028).
4. **It never sees another organizer's data.** The prompt carries only the caller's own inputs and, if
   `eventId` is supplied, their own draft — ownership checked server-side first (FR-033, SEC-04).

## Guard order

The order is load-bearing and is asserted by tests, because two of the four steps are only correct in
this position.

```text
1. requireAuth + requireOrganizer                       → 401 / 403
2. ownership of eventId (if supplied)                   → 403 not_owner
3. event is approved AND on sale?                       → 409 ai_unavailable_live_event   (FR-027)
4. per-user rate limit: 10 / rolling hour               → 429 ai_rate_limited              (SEC-08)
5. cache lookup (24 h, keyed by normalised input)       → 200 {available:true, cached:true}
6. platform-wide daily quota guard                      → 200 {available:false, quota_exhausted}
7. SQL price from comparables  ─┐
8. Gemini call, 8 s AbortSignal ┘ → normalise → cache → 200 {available:true}
   on timeout/error             → 200 {available:false, timeout|error}
```

**Why the rate limit precedes the cache (step 4 before 5).** The spec settled this: SEC-08's stated
verification fires 11 identical calls and expects the 11th to be blocked. Eleven identical calls are
ten cache hits, so a cache checked first would let all eleven through and the fairness control would
be unverifiable. The rate limit governs the *endpoint*; the cache governs the *upstream call*.

**Why the live-event refusal precedes both (step 3).** It is a property of the target, not of the
caller's usage, and refusing early means a doomed request never spends the organizer's hourly
allowance.

## Normalisation before response

Everything the model returns passes through validation, and a field that fails is **dropped, not
escalated** — a malformed tag must never cost the organizer their description.

| Field | Rule |
|---|---|
| `titles` | trimmed, non-empty, ≤ 200 chars, at most 3 kept |
| `description` | trimmed, non-empty; dropped if empty after trimming |
| `tags` | trimmed, deduplicated, ≤ 40 chars each, at most 8 kept |
| `price` | never from the model; the SQL median, floored to a whole đồng, or absent |

If every field is dropped, the response is `{available:false, reason:"error"}` — indistinguishable to
the client from a timeout, which is the correct outcome: an unusable suggestion is a failed one.

## Cache key

A hash of the normalised request: lower-cased and whitespace-collapsed `topic`, sorted `keywords`,
`categoryCode`, `city`. Deliberately **not** keyed by user — two organizers describing the same idea
should share one upstream call, which is the point of a shared free-tier quota (SCAL-02). The response
carries nothing user-specific, so there is no leak in sharing it.

## Test seam

`listing.model.ts` exports the model interface plus `FakeListingModel`, selected when `config.isTest`
or when no API key is configured — the same shape `modules/auth/mailer.ts` uses for `ConsoleMailer`.
The fake can be told to hang past the timeout, to throw, or to return malformed fields, which is how
the three degradation branches (SC-013) are covered deterministically with no network call.

## What this endpoint is not

It is not a chat surface, and it has no conversation state. UC-22 is a one-shot draft. The Attendee
Assistant and Organizer Co-pilot described elsewhere in the Vision document are separate features with
their own grounding rules; nothing here is a step toward them.
