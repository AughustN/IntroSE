# Specification Quality Checklist: Seat Map Designer

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-06 (covers the hall-scheme parity amendment; the original 005 scope shipped without one)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

### Validation pass — 2026-08-06 (amendment)

**15/16 at first pass**, the one failure being the deliberate `[NEEDS CLARIFICATION]` on fan zones.

Notes from the review:

- **Amendment discipline held.** FR-001–FR-046 and SC-001–SC-014 are byte-identical; the amendment starts
  at FR-047 and SC-015 and re-states no shipped behaviour as new. Verified: FR-001–FR-079 contiguous with
  no duplicates, the five original suffixed ids (FR-023a/026a/027a/030a/039a) preserved.
- **Two design decisions are recorded rather than left implicit**, both with rationale in Clarifications:
  shape points ride on the element row (not a shape-point table), and the section size multiplier feeds
  the overlap test so the drawing cannot contradict the publish gate.
- **Out of scope is stated, not implied** — multi-level charts, embeddable widgets, and any change to how
  a seat is held or sold each get a paragraph saying why.
- **Every new refusal path has a success criterion** (SC-016..SC-023), matching the feature's existing bar
  that refusals get asserting tests.

### Re-validation — 2026-08-06 (after `/speckit-clarify`)

**16/16.** Five questions answered; the marker is resolved and no new ones were introduced.

- **Fan zones → out of scope.** Showtimes stay seated-or-GA; a fan zone is FR-080's standing area, sold
  seat by seat through the unchanged path. Recorded in Out of Scope as a decision, not an omission.
- **A contradiction was found and removed, not just clarified.** FR-064 promised section colour "in the
  editor and in both buyer renderers" while FR-067 promised colour by tier — two different fills for one
  seat. Section colour is now editor-only (shape and size still reach buyers); colour on the buyer map
  means price and nothing else.
- **Tier colours are derived, not stored** — auto-assigned from a palette ordered by price — so this
  amendment adds no field to the ticket tier, which feature 006 owns.
- **Two gaps closed that would have surfaced during implementation**: the new objects are snapshotted onto
  a showtime like the geometry already is (FR-081–FR-083), so editing a layout cannot reshape a selling
  show; and a table carries its section, which its seats inherit (FR-049, FR-053), making the "Bàn 5"
  uniqueness check happen at placement rather than at save.

Final counts: **FR-001–FR-083** contiguous with no duplicates, the five original suffixed ids preserved;
**SC-001–SC-028**; 19 clarification entries. The amendment remains additive — no original requirement,
criterion, or clarification was altered.