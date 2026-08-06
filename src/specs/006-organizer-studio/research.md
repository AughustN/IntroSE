# Phase 0 Research: Organizer Event Studio

Nine decisions. Each names what was chosen, why, and what was rejected. The Technical Context in
`plan.md` carried no NEEDS CLARIFICATION markers — the spec's clarification session resolved the
product questions — so this phase resolves the *design* unknowns that the spec deliberately left to
planning.

---

## R-1 — "Never approved" is derived from `audit_logs`, not stored on the event

**Decision.** FR-020 lets an organizer delete an event only if it was **never approved**. Nothing in
the schema records that today: `events.moderation_status` holds the *current* state, and an event
approved on Monday and edited on Tuesday reads `pending_review`, indistinguishable from one that was
never reviewed. The check becomes:

```
deletable ⟺ moderation_status NOT IN ('flagged','removed')
          ∧ NOT EXISTS (SELECT 1 FROM audit_logs
                        WHERE target_type='event' AND target_id=$1 AND action='event_approved')
          ∧ no showtime of the event has a sold ticket or a live hold
```

`0011_studio.sql` adds `idx_audit_logs_target ON audit_logs(target_type, target_id)`. The table is
about to get much busier — FR-026 writes a row on every material edit, where previously only admin
moderation wrote to it — so the index is a response to a real change in access pattern, not
speculation (Principle V).

**Rationale.** `audit_logs` is already the immutable record of approvals: `moderation.routes.ts`
writes `event_approved` on every approval and nothing deletes those rows. Deriving from it keeps one
source of truth for moderation history. A denormalised `events.first_approved_at` column would be a
second copy of a fact the audit table already owns, and the failure mode of a drifted copy is exactly
the one FR-020 exists to prevent — an event that looks deletable when it is not.

**Alternatives considered.** (a) `events.first_approved_at TIMESTAMPTZ` — rejected as a second source
of truth for the same fact. (b) Allowing deletion of any never-public event and relying on
`moderation_status` alone — rejected because it misses the case FR-020 is actually about: approved,
then edited back to `pending_review`, then deleted. (c) Soft-delete everything — rejected as scope
creep with no requirement behind it.

**Consequence to flag.** The audit table is now load-bearing for a *refusal*, not merely a record. A
test must assert that an event with an approval in its history cannot be deleted, so a future change
that prunes audit rows fails loudly rather than quietly re-opening the delete-and-resubmit path.

---

## R-2 — One choke point decides re-moderation, and the exemption is opt-in

**Decision.** Every organizer write that touches an event goes through a single function in
`modules/studio/moderation-guard.ts`:

```ts
applyOrganizerEdit(client, eventId, changedFields: string[]): Promise<{ returnedToReview: boolean }>
applyInventoryEdit(client, eventId, changedFields: string[]): Promise<void>   // the FR-021 exemption
```

`applyOrganizerEdit` runs inside the caller's transaction: it flips `moderation_status` to
`pending_review` **only** when the current value is `approved`, sets the review note, and writes the
FR-026 audit row with the changed field names. `applyInventoryEdit` writes the audit row and does not
touch moderation — used by exactly two callers, GA capacity change and (later) 005's seat block.

**Rationale.** The spec's clarification defined material edits by *exemption* rather than enumeration
precisely because an enumerated list is what leaves holes. That reasoning only survives into the code
if the default path re-moderates and skipping it requires calling a differently-named function. A
handler that forgets to call anything writes no audit row either, which the SC-018 test catches. The
transaction scope is what satisfies FR-023: the content change and the visibility change commit
together, so there is no window where edited content is public under the old approval.

**Alternatives considered.** (a) A Postgres trigger on `events` — rejected: it cannot see edits to
`ticket_tiers` and `showtimes`, which are most of the material surface, and it would fight the
exemption. (b) An Express middleware wrapping every organizer route — rejected: it sits outside the
transaction and cannot know which fields actually changed. (c) Each service calling `setModeration`
itself — rejected: this is the "handler remembers" pattern the security requirement cannot rely on.

**How SC-009 pins it.** A table test enumerates every organizer write endpoint with a minimal valid
payload, runs each against an approved on-sale event, and asserts the resulting moderation state
matches an expected map. A new editable field added without wiring the guard fails that test.

---

## R-3 — The capacity floor is enforced under the same row lock feature 003 already takes

**Decision.** A capacity change runs inside `withTransaction`, opens with the existing
`lockTier(client, tierId)` (`SELECT … FOR UPDATE` on `ticket_tiers`), reads live `sold_quantity +
reserved_quantity`, and refuses when the requested capacity is below that sum, naming both numbers in
`HttpError.details`. The existing table constraint `CHECK (sold_quantity + reserved_quantity <=
COALESCE(total_quantity, …))` is kept as the last line of defence, and a `23514` violation is mapped
to the same refusal code rather than surfacing as a 500.

**Rationale.** Feature 003's GA hold path already locks that exact row before moving
`reserved_quantity`. Taking the same lock means the two serialize with no new mechanism: either the
hold commits first and the capacity change sees it and refuses, or the capacity change commits first
and the hold's own remaining check refuses it. There is no interleaving in which both succeed, which
is what SC-002 asserts. Re-using an existing lock ordering also avoids introducing a second lock and,
with it, the possibility of a deadlock against the hold path.

**Alternatives considered.** (a) An optimistic `UPDATE … WHERE $2 >= sold_quantity +
reserved_quantity` with no lock — works, but returns "0 rows updated" with no numbers to put in the
refusal message, and FR-018 requires naming what blocked it. (b) Advisory locks — a second mechanism
for a row that already has one. (c) Trusting the CHECK constraint alone — rejected: a constraint
violation is an error, not a refusal, and produces neither a specific code nor a Vietnamese message.

---

## R-4 — `archived_at TIMESTAMPTZ NULL`, and archiving must also bite in the hold path

**Decision.** Add `ticket_tiers.archived_at TIMESTAMPTZ NULL`. Active means `archived_at IS NULL`;
archive sets `now()`; restore sets `NULL`. Add
`CREATE INDEX idx_ticket_tiers_active ON ticket_tiers(showtime_id) WHERE archived_at IS NULL`.

Four read paths must learn about it, and the fourth is the one that matters:

1. `catalog.repo.ts` — the buyer's tier list and `remaining`.
2. `visibility.ts` `SHOWTIME_HAS_AVAILABILITY` — an archived tier must not keep a showtime looking
   available.
3. `catalog.write.ts` `eventShowtimesManage` — the organizer view shows archived tiers, marked.
4. **`holds.repo.ts` — the GA hold path must refuse an archived tier.**

**Rationale for the nullable timestamp.** Restore is `SET archived_at = NULL`, "active" is a partial
index predicate, and *when* it was archived comes free. A `status TEXT CHECK (…)` column would need a
value for every existing row, a check constraint, and would still not record when.

**Rationale for the fourth path — this is the important finding.** FR-006 promises an archived tier is
"unpurchasable". Excluding it from the catalog read makes it *invisible*, which is not the same thing:
a client holding a tier id from before the archive, or simply replaying a request, could still place a
GA hold, and 003's `lockTier` has no idea the tier was retired. Archiving would be a display change
wearing the costume of an inventory control. So the guard belongs in the hold path, and it is in scope
for this feature even though the file belongs to 003. Holds placed *before* the archive still convert
normally — the spec is explicit that existing reservations are honoured — so the guard applies to new
holds only.

**Alternatives considered.** (a) Deleting the tier and copying its label/price onto tickets — rejected:
it duplicates data and breaks any later join from an order back to what was sold. (b) `is_archived
BOOLEAN` — same cost, less information. (c) Leaving the hold path alone and relying on the catalog
read — rejected for the reason above.

---

## R-5 — Sold and reserved are computed per tier, branching on event type, in one grouped query

**Decision.** For a general-admission tier, sold and reserved are the tier's own counters. For a seated
tier they are counts over `showtime_seats` grouped by `ticket_tier_id` and `status`. `tiers.repo.ts`
exposes one function returning both shapes for a whole showtime in a single query, so the organizer
console's tier panel (FR-009) is one round trip regardless of how many tiers a showtime has.

**Rationale.** The spec's clarification fixed the definitions; the only design question is cost. The
existing `idx_showtime_seats_showtime(showtime_id, status)` covers the grouped count, and a showtime is
bounded at 2,000 seats by 005's ceiling, so no new index is justified (Principle V).

**Alternatives considered.** (a) Maintaining seated sold/reserved counters on `ticket_tiers` — rejected:
a denormalised counter that 003 and 004 would both have to maintain, for a number that is cheap to
count and, unlike the GA counters, has no concurrency role. (b) One query per tier — up to four round
trips for one panel, for no benefit.

---

## R-6 — The assistant writes prose; the price is computed in SQL

**Decision.** `listing.service.ts` composes the suggestion from two sources:

- **Price** — `comparables.repo.ts` runs an aggregate over publicly-visible events in the same
  category and city with an upcoming showtime, and returns a median tier price. The model is never
  asked for a price and never shown one to repeat. If there are too few comparables, the price
  suggestion is simply absent from the response.
- **Prose** — title candidates, description, and tags come from Gemini, given only the organizer's own
  rough inputs. The prompt carries no other organizer's data and no platform facts beyond what the
  caller typed.

The response is normalised before it leaves the server: the price is coerced to a whole-đồng integer or
dropped, tags are trimmed and capped, and any field that fails validation is omitted rather than
allowed to fail the whole response.

**Rationale.** FR-033 says every factual claim about a TixHub event must come from platform data. A
prompt that *asks* a model not to invent a price is an instruction; a system that never lets a model
produce one is a guarantee. The price is the only genuinely factual number in the whole suggestion, so
moving it out of the model removes essentially all of the grounding risk for the cost of one SQL
aggregate. It also makes the suggestion better: a median of what comparable events actually charge is
more useful to an organizer than a language model's guess.

**Alternatives considered.** (a) Ask the model for a price and validate it against the SQL range —
rejected: strictly more work than computing it, and it still risks shipping a number the model made up
that happens to fall in range. (b) Retrieval-augmented grounding via pgvector — rejected as
infrastructure ahead of need (Principle V, ADR-0001's own reasoning); a category-and-city SQL filter
returns dozens of rows here. (c) Let the model see the comparables and summarise them — rejected: it
re-introduces the chance of a misquoted number for no gain.

---

## R-7 — Failure is a `200 {available:false}`; only the rate limit is an error status

**Decision.** The assistant endpoint's failure semantics are deliberately split:

| Condition | Response | Why |
|---|---|---|
| Success (fresh or cached) | `200 {available:true, suggestion}` | — |
| Timeout (8 s), upstream error, daily quota exhausted | `200 {available:false, reason}` | PERF-05 / SCAL-03 — the client renders manual entry, never an error |
| Per-user rate limit (10/h) | `429 ai_rate_limited` | UC-22 A2 explicitly wants a visible "try again later" |
| Approved, on-sale event | `409 ai_unavailable_live_event` | FR-027 |

The 8 s bound is an `AbortSignal.timeout` on the model call, so a slow upstream is abandoned rather
than waited out.

**Rationale.** The constitution forbids AI producing "an error that blocks a user". A 5xx would be
rendered by the shared client error handler as exactly that, and every consumer would have to learn to
special-case it. Making degradation a *successful* response with a false flag means the fallback path
is the ordinary rendering path — the UI cannot accidentally treat it as a failure, because at the
transport level it is not one. The rate limit is the one case the use case wants surfaced, and it is
the one case where the user can actually do something (wait), so it keeps a real error status.

**Alternatives considered.** (a) 503 for all degradation — rejected as above. (b) 200 for the rate
limit too — rejected: it hides a state the user needs to understand, and SEC-08's stated verification
("assert the 11th is blocked") reads much more naturally against a status code.

---

## R-8 — In-process rate limit, cache, and quota guard, reusing the shape already shipped

**Decision.** `ai.throttle.ts` follows `holds.throttle.ts` exactly: a `Map` of per-user buckets for the
10/hour limit (FR-031, checked **before** the cache so a cache hit still consumes allowance, per the
spec's clarification), a second `Map` for the 24 h suggestion cache keyed by a hash of the normalised
inputs, and a process-wide daily counter for SCAL-03. The cache is capped at `AI_CACHE_MAX_ENTRIES`
with oldest-first eviction. All four numbers are `config.ts` settings with defaults, not constants
(UC-36). A `resetAiThrottle()` test seam mirrors `resetHoldRateLimit()`.

**Rationale.** One Node process behind Nginx (ADR-0003) makes process-local state correct, and the
pattern is already reviewed and shipped in this codebase. A bounded cache matters because the backend
is held under ~450 MB (PERF-07) and suggestion payloads are text blobs — an unbounded map keyed by
arbitrary user input is a slow memory leak with a user-controlled key.

**Alternatives considered.** (a) Redis — a fifth piece of infrastructure for a 10/hour counter on a
free-tier deployment. (b) A database table for the counters — durable, but adds a write to every
assistant call to protect a quota that a process restart resets anyway. (c) An unbounded cache —
rejected on PERF-07.

**Test seam.** `listing.model.ts` exports the interface plus `FakeListingModel`, selected when
`config.isTest` or when no API key is configured — the same fallback shape `mailer.ts` uses for
`ConsoleMailer`. The suite therefore covers the timeout, error, and quota branches deterministically
and makes no network call.

---

## R-9 — The material-edit predicate is one shared function, not a rule the console re-derives

**Decision.** FR-042 requires the console to warn the organizer *before* saving that the edit will pull
their event from the public catalog. But `returnedToReview` (R-2) is only known *after* the write
commits, so the client needs the answer earlier than the server can give it. Rather than have the
console re-implement the exemption rule, the predicate moves into the shared contract:

```ts
// shared/catalog/material-edit.ts
export const INVENTORY_ONLY_FIELDS = ['tier.capacity'] as const;   // + 005's seat block/unblock
export function isMaterialEdit(changedFields: string[]): boolean;
```

`moderation-guard.ts` imports it to decide whether to call `applyOrganizerEdit` or
`applyInventoryEdit`; `EventEditor.tsx` imports the same function to decide whether to show the
confirmation. The server response stays authoritative — the client's use is advisory, for a dialog.

**Rationale.** The alternative the plan implied was for the console to know that "everything except
general-admission capacity is material". That is a small rule, which is exactly what makes it
dangerous: small enough to copy and never think about again, so the day someone adds a new exempt
field the server and the warning disagree — silently, and in the direction of a live event vanishing
without notice. Principle VI's prohibition on independently re-declared shapes is written about
payloads, but the reasoning applies verbatim to a rule both sides must agree on. There is precedent in
the codebase: feature 005 put its layout validation in `shared/catalog/seatmap-validate.ts` as a pure
function imported by server and client for exactly this reason.

**Alternatives considered.** (a) A `wouldReturnToReview` flag on the organizer's event read — a round
trip per keystroke, or a stale flag, to answer a question that is a pure function of the diff. (b) A
server dry-run endpoint — a whole endpoint with its own auth and tests to compute one boolean. (c)
Warn *after* the fact from `returnedToReview` — that is a notification, not a confirmation, and FR-042
asks for the organizer's consent before the event leaves the catalog. (d) Warn on every edit — trains
organizers to dismiss the dialog, which is worse than not showing one.

**Consequence.** The exemption list has exactly one definition. A new exempt field is added in one
place and both sides move together, which is the property the enumerated-vs-exemption clarification in
the spec was reaching for.
