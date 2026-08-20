# Research: Event Reviews & Ratings

## Decision: Eligibility is a paid, non-void ticket, derived per request

- **Decision**: A review may be written when the caller holds a ticket whose order is `paid` and whose ticket is not `void`, whether or not the event has started. Both facts are re-derived from the caller's own rows on every write; nothing about eligibility is stored on the review.
- **Rationale**: UC-18 formerly required a *checked-in* ticket. Check-in is an operational door process, so making it an eligibility gate makes a purchase-based opinion depend on staff scanning. A purchase is a fact TixHub owns end to end; a refunded, cancelled, or void ticket provides no stake and therefore no eligibility. The listing, pricing, and booking experience can be reviewed before showtime, when prospective buyers can still benefit from that information.
- **Alternatives considered**: Requiring a started event was rejected because it makes reviews of the booking and listing experience unavailable until after the decision window has passed. Storing an `eligible` flag on the review at write time was rejected: a refund afterwards would leave a rating that no longer has a purchase behind it, and the flag would have to be swept. Trusting a client-supplied "I attended" was never on the table (Principle II).

## Decision: Uniqueness is a database constraint, not a check-then-insert

- **Decision**: A partial unique index on `(event_id, user_id) WHERE user_id IS NOT NULL`, with the write path using an upsert on that key.
- **Rationale**: "Look for an existing review, then insert if absent" is two statements with a gap between them, and two devices submitting a first review at the same instant both find nothing and both insert. The specification calls for exactly one; the database is the only place that can promise it (Principle I: the database is the source of truth). The upsert then gives A2's "edit rather than duplicate" for free — a second submission is an update, not an error to explain.
- **Why partial**: `user_id` is nullable so a review survives its author's account deletion. Several orphaned reviews of one event would collide under a plain unique index; excluding NULLs lets them coexist.
- **Alternatives considered**: A transaction with `SELECT … FOR UPDATE` would also be correct but locks a row that may not exist and is more machinery than a constraint that states the rule declaratively.

## Decision: The aggregate is computed, not stored

- **Decision**: Average and count come from a `GROUP BY` over visible reviews at read time. No counter column on `events`, no trigger.
- **Rationale**: A stored aggregate has to be updated on insert, edit, delete and moderation removal — four paths, each a chance to drift, and drift here is silent: the number simply becomes wrong and nothing complains. SC-005 requires the displayed average to equal the mean of live reviews *immediately* after every one of those four. Deriving it makes that true by construction. At this scale the cost is a covered index scan of a few dozen rows; the counter would buy nothing measurable and cost the bug surface. Principle V says complexity is spent only where a requirement demands it.
- **Alternatives considered**: A denormalised counter with triggers was rejected on the above. A materialised view was rejected for the same reason plus a refresh schedule to get wrong.

## Decision: Moderation hides; the author deletes

- **Decision**: Two different operations. An admin sets `status = 'removed'`, which stops the review appearing and stops it counting. The author's own delete removes the row.
- **Rationale**: A moderation record has to keep its subject — the queue entry, the audit row and any later dispute all refer to a review that must still be readable by an admin. Erasing it would leave `content_reports` pointing at nothing. The author's own withdrawal carries no such obligation: they are taking back their own words, and keeping a hidden copy of an opinion someone retracted is not something to do quietly.
- **Alternatives considered**: One soft-delete for both was rejected because it silently retains withdrawn personal opinions. Hard-deleting on moderation was rejected because it orphans the report and the audit trail.

## Decision: Reports reuse `content_reports`

- **Decision**: Reporting a review writes to the existing `content_reports` table with `target_type = 'review'`.
- **Rationale**: The table's check constraint already reads `CHECK (target_type = ANY (ARRAY['event', 'review']))` — feature 004 anticipated reviews before they existed. The moderation queue, the resolution states and the audit path are all built. A second reporting concept would duplicate a working one and give admins two inboxes.
- **Alternatives considered**: None seriously. Building `review_reports` alongside `content_reports` would be inventing a divergence.

## Decision: Reviews outlive their authors

- **Decision**: `user_id` is nullable with `ON DELETE SET NULL`. A review whose author deleted their account remains readable, attributed to a withdrawn account.
- **Rationale**: The aggregate is a claim about an event, and letting it move because somebody closed an unrelated account makes the rating a function of account churn rather than of the event. The alternative also has a sharper edge: an organizer could lift a poor rating by persuading one reviewer to delete their account. `ON DELETE CASCADE` would have made both happen silently.
- **Alternatives considered**: Cascading the delete was rejected on the above. Copying the author's name onto the review at write time was rejected as retaining personal data past the deletion that was meant to remove it.

## Decision: Text is data, and rendering it is React's default

- **Decision**: Bodies are stored and returned as plain text. The UI renders them as text nodes; no path uses `dangerouslySetInnerHTML`.
- **Rationale**: SEC-07 asks for output encoding. Escaping on the way *in* is the classic mistake — it double-escapes when the same value is rendered twice, corrupts anything legitimately containing `<` or `&`, and still fails wherever the value reaches a context that does not decode it. Storing the user's characters and letting the renderer escape at the boundary is correct in every context and is what React does by default. The rule to enforce is therefore a prohibition, and it is testable: submitting `<script>` must come back byte-identical from the API and appear as literal characters on the page.
- **Alternatives considered**: Sanitising with an HTML allow-list was rejected — reviews are plain text with no reason to carry markup, so an allow-list adds a dependency and a parser to be wrong about.
