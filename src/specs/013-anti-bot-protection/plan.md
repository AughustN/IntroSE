# Implementation Plan: Comprehensive Anti-Bot Protection Suite

**Branch**: `013-anti-bot-protection` | **Date**: 2026-08-20 | **Spec**: [`spec.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/013-anti-bot-protection/spec.md)

**Input**: Feature specification from `/specs/013-anti-bot-protection/spec.md`

---

## Summary

Implement a full-spectrum anti-bot defense architecture across TixHub addressing all 5 identified bot threat vectors: (1) Scalping & Sniping via a Virtual Waiting Room, stateless HMAC behavioral timing verification (≥ 1.5s), and Cloudflare Turnstile CAPTCHA on high-demand seat holds; (2) Mass fake accounts via mandatory background Turnstile on registration, disposable email domain blocking, `+tag` alias normalization, and soft-challenge IP rate limits; (3) Carding & hold-extension exploitation via top-up rate limiting and a maximum of 2 pending transactions; (4) Credential stuffing via tightened IP limits, progressive delays, and adaptive CAPTCHAs triggered on ≥ 3 failed attempts; and (5) Inventory scraping via public catalog rate limiting (30–60 req/min) and short-term response caching (5–10s). All database schema changes (`is_high_demand`) are synchronized in [`data_base/InitDB.sql`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/data_base/InitDB.sql).

---

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 22 & React 19)  
**Primary Dependencies**: Cloudflare Turnstile (`challenges.cloudflare.com`), `disposable-email-domains`, Express, Socket.IO, PostgreSQL, React 19, Lucide React  
**Storage**: PostgreSQL (Neon / Single VPS), in-memory sliding-window trackers, `data_base/InitDB.sql`  
**Testing**: Vitest, Supertest (Unit, Concurrency, and Integration tests)  
**Target Platform**: Node.js API server & Web Browser (SPA) on single team-managed VPS  
**Project Type**: Full-stack web application (React SPA + Express REST API)  
**Performance Goals**: Turnstile verification < 500ms, HMAC timing check < 1ms, cached seat map response < 50ms, 0 human user latency degradation > 2s (SC-003)  
**Constraints**: Zero SMS/OTP costs, stateless request path (Principle V & SCAL-01), fail-closed verification default with emergency bypass flag (`TURNSTILE_FAIL_OPEN=true`), database synchronization in `InitDB.sql`  
**Scale/Scope**: 5 threat defense vectors, 6 API route updates, 1 new waiting room module, reusable frontend Turnstile widget and timing hook.

---

## Constitution Check

*GATE: Passed pre-research and post-design validation.*

1. **Reliability Under Load (Principle I)**:
   - Database remains the source of truth for seat states. Timing verification and Turnstile validation execute before acquiring row locks, protecting DB connection pools from bot thrashing.
   - Public catalog short-term caching (5–10s) and rate limits shield PostgreSQL from scraping surges.
2. **Security & Trust by Default (Principle II)**:
   - Stateless HMAC-SHA256 tokens prevent client-side timing forgery.
   - Fail-closed verification policy by default prevents bypass during third-party glitches.
   - Private `TURNSTILE_SECRET_KEY` and `SERVER_TIMING_SECRET` reside securely in environment variables.
   - All rate-limit breaches, blocked disposable domains, and failed verifications write security audit records.
3. **AI Is Assistive, Grounded, and Non-Blocking (Principle III)**:
   - Anti-bot mitigation operates entirely on deterministic cryptographic, heuristic, and CAPTCHA algorithms without depending on AI latency or quotas.
4. **Verifiable Requirements & Test-First (Principle IV)**:
   - Automated tests in `server/tests/security/` assert denials for sub-second holds, disposable emails, forged timing signatures, and unverified registrations.
5. **Simplicity & Free-Tier Discipline (Principle V)**:
   - Non-intrusive Turnstile CAPTCHA eliminates SMS telecommunications fees.
   - Stateless HMAC timing tickets avoid external session cache infrastructure on the single VPS deployment.
6. **Clean Codebase & Seamless FE/BE Integration (Principle VI)**:
   - Shared TypeScript definitions (`QueueToken`, `TimingTicket`, CAPTCHA response interfaces) shared between `server/` and `src/`.
7. **Database Synchronization Mandate**:
   - `data_base/InitDB.sql` is strictly updated with `is_high_demand` column and index definitions.

---

## Project Structure

### Documentation (this feature)

```text
specs/013-anti-bot-protection/
├── spec.md              # Feature specification
├── plan.md              # Implementation plan (this file)
├── research.md          # Phase 0 technical research & decisions
├── data-model.md        # Phase 1 schema, state models & transitions
├── quickstart.md        # Phase 1 verification & test scenarios
├── contracts/           # Phase 1 API interface contracts
│   └── anti-bot-api.md
└── checklists/
    └── requirements.md
```

### Source Code Layout

```text
server/src/
├── services/
│   ├── turnstile.ts             # Cloudflare Turnstile token verification service
│   ├── timingTicket.ts          # HMAC-SHA256 interaction timing generator & verifier
│   └── waitingRoom.service.ts   # In-memory Virtual Waiting Room queue & admission manager
├── middleware/
│   ├── rateLimit.ts             # Sliding-window IP & user rate limiting middleware
│   ├── emailFilter.ts           # Disposable domain filter & +tag alias normalizer
│   └── botDefense.ts            # Timing ticket & high-demand hold gate middleware
├── modules/
│   ├── auth/
│   │   ├── auth.routes.ts       # Registration CAPTCHA & adaptive login updates
│   │   └── identifier.ts        # Extended email normalization functions
│   ├── holds/
│   │   ├── reservations.routes.ts # High-demand queue & timing verification integration
│   │   └── holds.throttle.ts    # Hold rate limiting enhancements
│   ├── catalog/
│   │   └── catalog.public.routes.ts # Catalog rate limiting & short-term cache headers
│   ├── wallet/
│   │   └── wallet.routes.ts     # Top-up throttling & max 2 pending checks
│   └── waitingRoom/
│       └── waitingRoom.routes.ts # Waiting room join & status endpoints
└── db/
    └── migrations/              # Database migration scripts

data_base/
└── InitDB.sql                   # Synchronized unified database schema & seed script

src/
├── types.ts                     # Shared TypeScript contracts & interfaces
├── components/
│   ├── common/
│   │   ├── TurnstileWidget.tsx  # Reusable Cloudflare Turnstile React component
│   │   └── WaitingRoomModal.tsx # Live queue position & countdown dialog
│   ├── auth/
│   │   ├── RegisterModal.tsx    # Integrated Turnstile registration form
│   │   └── LoginModal.tsx       # Adaptive Turnstile login challenge form
│   └── seatmap/
│       └── SeatMapContainer.tsx # Timing ticket management & waiting room triggers
└── services/
    ├── api.ts                   # Updated API client passing timing/queue tokens
    └── waitingRoomClient.ts     # Waiting room polling & token management

server/tests/
└── security/
    ├── turnstile.test.ts        # Turnstile verify, fail-closed & emergency bypass tests
    ├── timingVerification.test.ts # Sub-second rejection & HMAC forgery tests
    ├── emailSanitization.test.ts # Disposable domains & alias normalization tests
    ├── adaptiveLogin.test.ts    # Consecutive failures & adaptive CAPTCHA tests
    ├── waitingRoom.test.ts      # Queue admission & 3-minute expiration tests
    └── topupAbuse.test.ts       # Max 2 pending topups & throttling tests
```

---

## Complexity Tracking

> **No violations**. All architectural decisions comply strictly with the TixHub Constitution v2.0.0.
