# Specification Quality Checklist: Account & Authentication

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-22
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

### Iteration 1 — 2026-07-22

Rewrites applied during validation, each against a named checklist item:

- *No implementation details* — removed "bcrypt cost 12", "JWT", "httpOnly cookie", and "rate limit"
  from the requirement text supplied in the feature description. FR-006 now states the property
  (salted one-way hash, never readable) and FR-016 states the goal (the surviving credential is
  unreadable to page scripts) without naming a mechanism. The specific algorithm and cost factor are
  constitution-level constraints (SEC-02) that belong in `plan.md`.
- *Technology-agnostic success criteria* — SC-003 and SC-005 are stated as user-observable durations
  rather than endpoint latencies.
- *Testable and unambiguous* — SC-006 replaces "timing must not leak" with a stated sample size and
  comparison; SC-009 names a concrete failure count.
- *Scope is clearly bounded* — email change, account deletion, two-factor authentication, and avatar
  upload are recorded in Assumptions as explicit exclusions rather than left silent.

### Iteration 2 — 2026-07-22

All 3 `[NEEDS CLARIFICATION]` markers resolved by the user; recorded in the spec's *Decisions Taken*
section as D-A / D-B / D-C.

| # | Question | Resolution |
|---|---|---|
| Q1 | Is email verification required before holding a seat or buying? | **No.** Register signs in immediately (D-B, FR-043). |
| Q2 | Is a phone number unique across accounts? | **Email mandatory; phone optional, unique when present, usable to sign in** (D-A, FR-009, FR-010). |
| Q3 | Google identity collides with a password account? | **Never link, in either direction** — refuse with instructions (D-C, FR-045 to FR-047). |

Q3 was deliberately deferred until Q1 was settled, because the two interact: with no verified email
(Q1 = no), auto-linking would let anyone claim another person's account by registering a password on
their address first. The refusal in D-C is what pays for skipping verification.

Requirements added during this iteration: FR-044 through FR-047, SC-012, three edge cases covering
phone identifiers, and a *Schema delta* table recording where these decisions contradict
`SCHEMA_DATABASE.md` as currently written.

### Iteration 3 — 2026-07-23 (adversarial review)

The spec was read end to end looking for contradictions, unbuildable requirements, and silent
omissions. Seven defects found, all resolved by the user. FR-048 to FR-060 and SC-013 were added.

| # | Defect | Resolution |
|---|---|---|
| 1 | The buildable slice had **no account recovery**: US4 was P2 and blocked, D-B removed verification, D-C removed Google as an alternate entrance — while every account holds a wallet with no cash-out. A forgotten password meant lost money. | US4 raised to **P1** (D-D). Dependencies rewritten: the constitution amendment now gates the release. Stated fallback if the team refuses: ship with top-up disabled, never without recovery. |
| 2 | **Account lockout was both a DoS and a disclosure.** Anyone knowing an email could lock it out; and a lockout can only fire on a real account, so it enumerated the user base — contradicting FR-011, FR-012, FR-040 in the same document. | Lockout removed entirely (D-E). Throttle the source, slow the identifier, never refuse a correct password. FR-048, FR-049, SC-013. |
| 3 | **US1 was not independently testable** despite claiming to be — its test used sign-out, which is US2; while US2 owned "survives a browser restart", which is US1's concern. | Boundary redrawn: US1 = create account, sign in, stay signed in. US2 = end sessions only. Both tests now standalone. |
| 4 | **Account suspension** was relied on by FR-013, an edge case, and an assumption — but had no entity field, no schema column, and no defined behaviour. Ordering was undefined for Google sign-in, which has no password step. | Brought into scope as a state: FR-051 to FR-053, `users.status`, and the check ordered after identity is established by *either* route. |
| 5 | **Changing a password revoked nothing.** FR-030 covered reset only, so the session on a shared computer survived the very act taken to stop it. | FR-057 — changing a password ends every other session, keeps the current one. |
| 6 | **One rejection barred an account forever.** FR-037 plus `organizers.user_id UNIQUE` made a corrected re-application impossible, turning an admin mis-click into a permanent ban. | FR-058 to FR-060: rejected applicants may re-apply, suspended ones may not, history retained. Schema switched to a partial unique index over live statuses. |
| 7 | **No session storage existed.** Six requirements (FR-017, FR-018, FR-019, FR-052, FR-057, SC-005) demand revoking a session before it expires; the schema had no table to revoke anything in, and the API contract already referenced a token "family" with nowhere to live. | New `refresh_tokens` table with rotation and family-based reuse detection, recorded as schema decision D7. |

Defects 4, 6, and 7 were schema-level: the specification asked for behaviour the reference schema
could not represent. `docs/Analysis_Design/SCHEMA_DATABASE.md` was updated in the same pass and now
carries decisions **D1–D7**.

### Open items

Separately, and **not** a specification defect: the constitution's two-integration cap conflicts with
this feature's need for Google and transactional email. Recorded under Dependencies. It is a
governance decision for the team, not something this spec can resolve.
