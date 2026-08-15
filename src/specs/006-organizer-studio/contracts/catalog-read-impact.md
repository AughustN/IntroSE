# Contract Impact: archived tiers must disappear from every buyer-facing read

This feature adds `ticket_tiers.archived_at`. That is a one-column migration with a
disproportionately wide blast radius, because four existing read paths currently assume every row in
`ticket_tiers` is sellable. Principle VI requires a contract change to update every consumer in the
same change, so this document names them all. **The shared TypeScript types do not change** — `Tier`
keeps its shape and its meaning; what changes is which rows are returned.

## The paths

| # | File | Current behaviour | Required change | Consequence if missed |
|---|---|---|---|---|
| 1 | `server/src/modules/catalog/catalog.repo.ts` — the GA tier list on an event/showtime read | returns every tier of the showtime | `AND archived_at IS NULL` | a retired tier is offered to buyers; FR-006 is false |
| 2 | `server/src/modules/catalog/visibility.ts` — `SHOWTIME_HAS_AVAILABILITY` | a tier with remaining capacity makes the showtime look available | same predicate | a showtime whose only remaining tier is archived shows as on-sale and lands the buyer on a dead end |
| 3 | `server/src/modules/holds/holds.repo.ts` — the GA hold path (`lockTier` caller) | locks and holds any tier by id | refuse when `archived_at IS NOT NULL` | **the important one** — see below |
| 4 | `server/src/modules/catalog/catalog.write.ts` — `eventShowtimesManage` | returns every tier, unlabelled | return archived tiers **with the flag** | the organizer cannot see or restore what they archived (FR-009, FR-006) |

Note that #4 moves in the opposite direction from #1–#3: the organizer view must keep showing archived
tiers. "Hidden from buyers" and "hidden from everyone" are different requirements, and conflating them
would make restore unreachable from the UI.

## Why #3 is the one that matters

Excluding an archived tier from the catalog read makes it **invisible**. FR-006 requires it to be
**unpurchasable**, which is a stronger claim. A client holding a tier id from before the archive — a
stale tab, a bookmarked payload, a replayed request — can still call the GA hold endpoint, and feature
003's `lockTier` has no notion of archival. Without the guard in the hold path, archiving is a display
change wearing the costume of an inventory control, and the failure would only surface as a buyer
holding tickets in a tier the organizer believes they retired.

The guard applies to **new** holds only. Reservations placed before the archive keep their seats and
their captured prices and convert normally at checkout — the spec is explicit that archiving does not
disturb live hold state, which belongs to feature 003.

## Test obligation

One test per path, asserting the *absence*:

- an archived tier is absent from the public event detail payload (#1);
- a showtime whose only tier is archived is absent from the browse list and reads as unavailable (#2);
- a GA hold against an archived tier is refused, **and** a reservation placed before the archive still
  converts (#3);
- the organizer's showtime view still returns the archived tier, flagged, and can restore it (#4).

The first three are `server/tests/catalog/` and `server/tests/holds/` additions — that is, this
feature adds tests to two other features' suites. That is the correct location: the assertion belongs
where the behaviour lives, and a future change to those reads should fail there.
