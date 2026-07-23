<!--
SYNC IMPACT REPORT
==================
Version change: 1.1.0 → 2.0.0
Bump rationale (2.0.0): Team-approved amendment (2026-07-23) — backward-incompatible
  governance changes, so MAJOR:
  1. Integration cap redefined two → four (added Google OAuth sign-in and Resend
     transactional email; a fifth still needs an amendment).
  2. Wallet refunds reintroduced into scope (refund to store-credit wallet per ticket,
     D3); real-money settlement/payouts remain out of scope.
  3. Seat lifecycle DATA-03 `pending_payment` state removed — wallet-only checkout is
     one atomic local transaction with no gateway leg (D2).
  4. Hosting moved from Vercel/Render to a single team-managed VPS (Nginx, same-origin).
Prior (1.1.0): Added Principle VI (Clean Codebase & Seamless FE/BE
  Integration) — a new material principle → MINOR bump.
Prior (1.0.0): Initial ratification of a concrete constitution from the template.
  First codified set of principles, constraints, and governance → MAJOR baseline 1.0.0.

Modified principles: N/A (Principle VI added, none redefined)
Added sections:
  - Purpose & Scope
  - Core Principles (6): Reliability Under Load, Security & Trust by Default,
    AI Is Assistive Grounded & Non-Blocking, Verifiable Requirements &
    Test-First for Critical Logic, Simplicity & Free-Tier Discipline,
    Clean Codebase & Seamless FE/BE Integration
  - Technology Stack & Constraints
  - Architecture & Coding Standards
  - Prohibited Patterns
  - Governance (incl. Decision-Making)
Removed sections: none (all template placeholders resolved)

Templates requiring updates:
  ✅ .specify/memory/constitution.md (this file)
  ⚠ .specify/templates/plan-template.md — "Constitution Check" gate is generic;
     recommend adding TixHub-specific gates (reliability, security, AI-fence).
  ⚠ .specify/templates/spec-template.md — no principle-driven mandatory sections
     added; review when writing first feature spec.
  ⚠ .specify/templates/tasks-template.md — review to ensure task categories cover
     security tests, load tests, and AI-fallback tasks per Principles I–IV.
  ✅ README.md — tech stack consistent; no change required.
  ✅ CONTEXT.md — glossary consistent with principles; no change required.

Follow-up TODOs: none. RATIFICATION_DATE set to constitution adoption date.
-->

# TixHub Constitution

## Purpose & Scope

TixHub is an event-ticket-sales web application for the Vietnamese market. It brings three
roles onto one marketplace: **Admins** who keep it trustworthy, **Organizers** who publish
events and sell tickets, and **Attendees** who discover events, pay, and check in via a
unique QR ticket. Its reason to exist is to give small and first-time organizers — who today
sell through social-media posts and bank transfers — professional-grade tooling: a real-time
interactive seat map, secure checkout, QR door check-in, and optional AI assistance.

**In scope:** the eleven core features in the Vision Document (event creation, checkout via
VNPay sandbox, QR tickets + door scanner, discovery/search/filters, AI recommendations, AI
listing assistant, real-time analytics, notifications/reminders/waitlist, reviews & ratings,
admin moderation & organizer approval, real-time seat selection & holds), Vietnamese-language
UI, VND-only pricing, and sandbox (non-settling) payments.

**Explicitly out of scope:** multi-currency / international sales, and real-money settlement or
payouts. **Refunds to the store-credit wallet are in scope** (per ticket, once, closed-loop — no
money leaves the platform as cash; schema decision D3). These exclusions protect the fixed 13-week
academic timeline and MUST NOT be reintroduced without a constitution amendment. *(Amended 2026-07-23,
v2.0.0: wallet refunds moved into scope; real-money settlement stays out.)*

## Core Principles

### I. Reliability Under Load Is the Product

The #1 user pain is platforms falling over under demand; a lost ticket is a lost user. The
system MUST stay correct and responsive when many buyers contend for the same seats.

- The **database is the source of truth**, not the seat map UI. When the two disagree, the
  database decides.
- No two attendees may ever be sold the same seat. Concurrent purchases on one seat MUST be
  serialized so exactly one wins (DATA-02), and order-plus-ticket issuance MUST run in a
  single ACID transaction that rolls back fully on any failure (DATA-01).
- Seat lifecycle MUST be explicit (`available` → `held` → `sold`). Checkout debits the store-credit
  wallet in one atomic local transaction, so no `pending_payment` state waits on a gateway callback
  (D2; amended 2026-07-23 — DATA-03's `pending_payment` mandate removed); `held` seats auto-release on
  TTL (REL-02).
- Concurrency and performance claims are only true when **proven by load/stress tests** (k6),
  not by a clean demo. PERF/REL targets (Vision §6.1, §6.4) are the acceptance bar.

*Rationale: reliability under contention is TixHub's core differentiator and its top-rated
user need (UN-01). It is an engineering guarantee, not a best-effort hope.*

### II. Security & Trust by Default

TixHub handles real money and personal data. Payment integrity and user-data protection are
the two highest-consequence risks, and security is enforced on the server, never assumed.

- Role-based access control (Admin/Organizer/Attendee) MUST be enforced on **every API
  endpoint** (SEC-04) — hiding a button in the UI is not access control.
- Payment state changes **only** via VNPay's signed server-to-server callback, validated on
  signature AND amount/order reference, and processed idempotently (SEC-06, REL-03). The
  browser return URL is display-only.
- Card/bank data MUST NEVER touch TixHub — no such columns exist in the schema (SEC-05).
- All traffic is HTTPS/TLS (SEC-01); passwords are bcrypt-hashed cost 12 (SEC-02); every
  input is schema-validated; queries are parameterized; user content is output-encoded
  (SEC-07). Secrets live in environment/host secret stores, never in git (SEC-11).
- Every privileged admin action writes an immutable audit record (SEC-09).
- The **OWASP Top 10** is the working checklist; an OWASP ZAP baseline scan MUST report zero
  High-severity alerts before submission (STD-01).

*Rationale: a marketplace that handles money is only viable if trust is structural. Security
requirements trace back to payment integrity or data protection or they do not belong here.*

### III. AI Is Assistive, Grounded, and Non-Blocking

The survey rates AI a bonus, not the deciding factor. AI (Gemini) enhances the product; it
never gates it and never invents facts.

- **Non-blocking:** AI features MUST NOT sit on the critical purchase path. During an AI call
  the UI stays interactive; on timeout or quota exhaustion the system degrades gracefully to
  cached results or a non-AI fallback — never an error that blocks a user (PERF-05, SCAL-03).
- **Grounded:** every factual claim about a TixHub Event or Ticket MUST come from platform
  data (a tool/SQL result), never the model's memory (ADR-0001). Only prose is generated;
  every number cited is real.
- **Bounded & scoped:** the Attendee Assistant and Organizer Co-pilot decline requests
  outside the TixHub domain. Personal-data tools are scoped in SQL to the server-injected
  session identity — the model never supplies or chooses a user id, so prompt injection
  cannot widen the query.
- **Assistive, not autonomous:** AI output is always editable and overridable before it goes
  live. The user stays in control.

*Rationale: AI is a genuine differentiator only if it is trustworthy and never the reason a
buyer cannot complete a purchase (UN-08).*

### IV. Verifiable Requirements & Test-First for Critical Logic

A requirement without a verification method is an opinion. Every non-functional requirement
in the Vision Document names how it is checked, and the code lives up to that.

- The critical-logic modules — **seat holding, order processing, payment-callback handling**
  — MUST reach ≥ 60% automated test coverage (Jest/Vitest) by PA5 (MAIN-03), and their
  invariants (no double-sell, no early release, idempotent callbacks, atomic orders) MUST
  have explicit concurrency and failure-injection tests.
- Security-sensitive behaviour (RBAC matrix, forged/replayed callbacks, brute-force lockout,
  AI rate limits) MUST have tests that assert the *denial*, not just the happy path.
- Write the test that pins a critical invariant before or alongside the implementation of
  that invariant; do not merge such logic on manual verification alone.
- TypeScript compiles in `strict` mode with zero type errors; ESLint + Prettier pass in CI
  before any merge to `main` (MAIN-01, MAIN-02).

*Rationale: TixHub's guarantees around money and seats are only real if they are continuously
proven, not asserted once and hoped-for thereafter.*

### V. Simplicity & Free-Tier Discipline (YAGNI)

This is a 13-week academic build running at near-zero cost on free tiers. Complexity is spent
only where a real requirement demands it.

- Build the simplest thing that meets the requirement; prefer boring, well-understood
  patterns over cleverness. Do not add infrastructure ahead of a proven need (e.g. no
  pgvector approximate index while the SQL hard filter keeps candidate sets to dozens —
  ADR-0001).
- Stay inside free-tier ceilings: bounded DB connection pool ≤ 20 (SCAL-01), backend memory
  < ~450 MB at peak (PERF-07), AI responses cached to conserve quota (SCAL-02).
- The paid-tier upgrade path MUST remain a configuration change, not a rewrite: no lock-in
  that would force re-architecture to scale.
- Out-of-scope items (multi-currency, real settlement, refunds) stay out. Scope creep is the
  primary risk to delivery.

*Rationale: the constraint is the design. Discipline about scope and cost is what makes the
timeline and the free-tier deployment achievable.*

### VI. Clean Codebase & Seamless FE/BE Integration

Five people ship one product. The codebase MUST read as if written by one careful author, and
the frontend and backend MUST meet at one agreed, machine-checked contract — not by trial and
error against a running server.

- **One shared contract.** Request/response shapes are defined once as shared TypeScript types
  (or a schema the types derive from) and imported by both frontend and backend. The two sides
  never re-declare a payload independently, so a backend change that breaks a client fails at
  compile time, not in the browser.
- **Typed boundary end-to-end.** No untyped payloads cross the wire (reaffirms Principle II /
  MAIN-01). API errors follow one consistent shape the frontend can rely on; the frontend
  handles loading, empty, and error states as first-class, not afterthoughts.
- **Clean code.** Clear, intention-revealing names; small focused modules; no dead code,
  commented-out blocks, or `console.log` debris merged to `main`. Match the style of
  surrounding code (Prettier/ESLint enforce format — Principle IV / MAIN-02). Duplicated logic
  is extracted, not copy-pasted.
- **Contract changes are deliberate.** Changing an endpoint's shape updates the shared type and
  every consumer in the same change; no silent drift between what the API returns and what the
  UI expects.

*Rationale: most integration bugs are avoidable contract mismatches. A single typed contract
plus a consistently clean codebase turns FE/BE integration from a debugging phase into a
compile-time guarantee, which the 13-week timeline and five-person team cannot afford to skip.*

## Technology Stack & Constraints

The stack is fixed for this project; changing a listed technology requires an amendment.

| Layer | Technology | Why |
|---|---|---|
| Frontend | React (SPA), Recharts (analytics), html5-qrcode (door scanner) | Component model fits role-based UIs; Recharts covers live dashboards; html5-qrcode enables camera QR scan in a mobile browser with no native app. |
| Backend | Node.js, Express (REST API), Socket.IO (real-time seat channel) | One language across the stack (TypeScript); Socket.IO delivers the live seat-map updates that PERF-03/06 require. |
| Database | PostgreSQL (+ `pgvector` extension) | ACID transactions and row locking underpin the seat/order invariants (DATA-01/02/03); pgvector adds AI retrieval without a separate vector store. |
| Payments | VNPay sandbox | Vietnamese gateway; sandbox-only, no real settlement. TixHub never stores card data. |
| AI | Google Gemini API (chat + `text-embedding-004`) | Powers the assistive AI features under a shared free-tier quota, with non-AI fallbacks. |
| CI/CD | GitHub Actions | Runs type-check, lint, tests, coverage, and gitleaks on every push / PR. |
| Hosting | Single team-managed **VPS** (Nginx: TLS + static SPA + reverse proxy, same-origin at `tixhub.fit`), Neon (Postgres) | Amended 2026-07-23 (was Vercel + Render): self-hosted VPS; TLS is team-managed; scale-out / paid upgrade remains a config change. |

- Language: **TypeScript** on both frontend and backend, `strict` mode mandatory.
- Money: all monetary values stored and displayed as **VND integers** — no floating-point
  money, ever (STD-03).
- Localization: primary user-facing text is **Vietnamese** for this submission (USE-03).

## Architecture & Coding Standards

**Architecture rules**

- Standard client-server split: React SPA ↔ REST/JSON over HTTPS, with a Socket.IO WebSocket
  channel dedicated to live seat status. External integrations are limited to **four**: VNPay
  (payments), Gemini (AI), Google (OAuth sign-in), and Resend (transactional email). Adding a fifth
  external dependency requires an amendment. *(Amended 2026-07-23, v2.0.0: was two — Google and Resend
  added for the account & authentication feature.)*
- The request path MUST stay **stateless** so the backend can scale horizontally; session-mode
  database features that would break the transaction-pooled endpoint are avoided (SCAL-01).
- Server-side identity is authoritative: the authenticated session identity is injected by the
  server and used to scope every user-data query. Clients never assert their own user id.
- Keep clear module boundaries between the API layer, the real-time (seat/hold) domain, the
  payment/callback domain, and the AI tool layer. Cross-cutting concerns (auth, validation,
  audit) are middleware, not copy-paste.

**Coding standards**

- Formatting and linting are non-negotiable and machine-enforced: **Prettier** for format,
  **ESLint** for lint; both MUST pass in CI before merge (MAIN-02). No hand-formatting debates.
- Naming follows conventional TypeScript/React idiom: `PascalCase` for components and types,
  `camelCase` for variables/functions, `SCREAMING_SNAKE_CASE` for constants. Match the
  surrounding code.
- All API inputs are validated against a strict schema before use (SEC-07). API responses are
  typed — no untyped payloads crossing the client/server boundary.
- Every code change is reviewed and approved by **at least one team member other than the
  author** before merging to `main`; branch protection enforces this (MAIN-04).
- Secrets are read from environment variables; a committed `.env.example` documents required
  keys with placeholder values (SEC-11).

## Prohibited Patterns

The following are never acceptable in this codebase:

- **Storing or logging card/bank data or plaintext passwords.** No card/bank columns; no
  plaintext credentials anywhere (SEC-02, SEC-05).
- **Trusting the browser for payment or authorization.** No confirming payment from the return
  URL; no authorization decisions made only in the UI (SEC-04, SEC-06).
- **Raw SQL string concatenation** with user input — parameterized queries only (SEC-07).
- **Rendering user-supplied content as raw HTML** — output-encode to block XSS (SEC-07).
- **Untyped API responses** or bypassing `strict` type-checking (`any` as an escape hatch on
  boundary data) (MAIN-01).
- **Letting AI block the purchase flow, or citing AI-generated facts** about Events/Tickets
  that did not come from platform data (Principle III, ADR-0001).
- **Floating-point money.** VND integers only (STD-03).
- **Committing secrets** or merging on a red CI (type errors, lint failures, gitleaks hits)
  (MAIN-02, SEC-11).
- **Reintroducing out-of-scope work** (multi-currency, real-money settlement or payouts) without an
  amendment. *(Wallet refunds are in scope as of the 2026-07-23 amendment; real-money settlement is
  not.)*
- **Independently re-declaring FE/BE payload shapes** (contract drift) or merging dead code,
  commented-out blocks, or debug `console.log` to `main` (Principle VI).

## Governance

This constitution supersedes ad-hoc practice. When code, a comment, or a conversation
conflicts with it, the conflict is resolved before proceeding.

**Amendment procedure.** Any team member may propose an amendment via pull request describing
the change and its rationale. An amendment merges only with agreement from the team
(majority, with the Team Leader breaking ties). The change is recorded here with a version
bump and a dated entry in the Sync Impact Report at the top of this file.

**Versioning policy.** This constitution is versioned with semantic versioning:
- **MAJOR** — backward-incompatible governance changes or the removal/redefinition of a
  principle.
- **MINOR** — a new principle or section, or materially expanded guidance.
- **PATCH** — clarifications, wording, and non-semantic refinements.

**Decision-making (resolving principle conflicts).** When principles pull in different
directions, resolve in this priority order:

1. **Security & data integrity** (Principles I, II) — never traded away. Correctness of money
   and seats, and protection of user data, win over everything else.
2. **Reliability of the core buying flow** — the attendee's ability to browse, hold a seat,
   pay, and get a ticket. AI and nice-to-haves yield to this (Principle III is explicitly
   subordinate: AI degrades rather than blocks).
3. **Scope & timeline discipline** (Principle V) — when a "better" solution threatens the
   13-week delivery or the free-tier budget, choose the simpler in-scope option and record the
   deferral.
4. **Everything else** — resolved by the team, defaulting to the simplest choice that satisfies
   the relevant requirement.

Any deviation from a principle MUST be justified in the PR and, if lasting, captured as an ADR
under `docs/adr/` or as an amendment here. Reviewers verify compliance as part of the
mandatory review (MAIN-04). Runtime and domain guidance lives in `CONTEXT.md` (glossary) and
`docs/adr/` (architecture decisions); this constitution governs how that work is done.

**Version**: 2.0.0 | **Ratified**: 2026-07-10 | **Last Amended**: 2026-07-23
