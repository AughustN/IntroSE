# Specification Quality Checklist: Waitlist for Sold-Out Tickets

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-13
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

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Validation log

**Iteration 1 — three failures, all fixed.**

1. *No implementation details* — **FAILED**. The first draft named endpoints (`POST /api/waitlists`), source files (`notifications.routes.ts`, `holds.service.ts`), a migration (`0015_notifications.sql`), a column (`joined_at`), and a message type (`waitlist_open`). Fixed by restating each in domain language: "queue", "place", "when they joined", "a message saying tickets are available". The defect that motivated the feature is now described by its user-visible symptom (FR-002, SC-004) rather than by the query that causes it. Those implementation details survive where they belong — `plan.md` and `data-model.md`.
2. *Success criteria are technology-agnostic* — **FAILED**. SC-002 read "within one worker tick" and SC-006 cited a coverage percentage of a code module. Rewritten as "within fifteen minutes" and as a statement about which rules are covered by automated checks.
3. *Requirements are testable and unambiguous* — **PARTIAL**. FR-014 did not exist; refusals were described only inside scenarios, so "the reason is stated" had no requirement backing it. Added.

**Iteration 2 — all items pass.**

No `[NEEDS CLARIFICATION]` markers were needed. Four decisions had more than one defensible answer and were settled from existing project documents rather than asked, and each is recorded under Assumptions:

- Queue scope is per occasion, not per event — the existing data model already scopes it that way.
- The cap of ten and the five told per release come from UC-17 and the schema notes, not from a fresh guess.
- Whether being told ends a place: UC-17 A5 says it does not, so the state model keeps it open.
- Organizer visibility into queues is excluded, keeping this feature to the attendee-facing use case it names.
