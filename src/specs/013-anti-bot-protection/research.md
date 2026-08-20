# Phase 0: Technical Research & Architectural Decisions

**Feature**: Comprehensive Anti-Bot Protection Suite  
**Branch**: `013-anti-bot-protection`  
**Date**: 2026-08-20  

---

## 1. Cloudflare Turnstile Integration & Outage Policy

### Decision
Integrate Cloudflare Turnstile as the primary non-intrusive CAPTCHA challenge layer across User Registration (`POST /api/auth/register`), Adaptive Login (`POST /api/auth/login`), and High-Demand Seat Holds (`POST /api/reservations`). Token verification is performed directly by the backend via `https://challenges.cloudflare.com/turnstile/v0/siteverify` using standard Node.js `fetch`.

### Verification Logic & Resilience
- The backend helper `verifyTurnstile(token: string, remoteIp?: string)` calls the Cloudflare verify endpoint with a 2.5-second timeout.
- **Fail-Closed by Default**: If the verify endpoint returns non-200, invalid JSON, or times out, verification fails (`success: false`), preventing automated bots from exploiting network glitches.
- **Emergency Bypass Configuration**: An environment variable `TURNSTILE_FAIL_OPEN=true` allows operations to temporarily bypass CAPTCHA checks during a confirmed Cloudflare global outage, while automatically tightening IP rate limits and emitting high-severity security audit logs.

### Alternatives Considered
- *reCAPTCHA v2 / v3*: Rejected due to intrusive image puzzle UX, heavy tracking scripts, and user friction.
- *Custom Math/SVG CAPTCHA*: Rejected because automated OCR / LLM vision scripts solve text/math CAPTCHAs trivially in < 200ms.
- *SMS OTP*: Rejected per the anti-bot assessment and TixHub free-tier cost discipline; SMS incurs per-message telecommunications costs and high user friction.

---

## 2. Behavioral Interaction Timing Verification

### Decision
Implement a stateless, tamper-proof interaction timing verification mechanism using HMAC-SHA256 signatures.

### Workflow
1. When a client requests seat map data (`GET /api/showtimes/:id/seat-map`), the server returns an HMAC-signed `timingTicket` containing the payload `{ showtimeId, viewTimestamp, signature }`.
2. The signature is computed as `HMAC-SHA256(showtimeId + ":" + viewTimestamp, SERVER_TIMING_SECRET)`.
3. When the user selects seats and submits `POST /api/reservations`, the payload includes `timingTicket`.
4. The server recalculates the HMAC signature to verify authenticity. If authentic, it verifies:
   $$\text{elapsedTime} = \text{Date.now}() - \text{viewTimestamp} \ge 1500\text{ms}$$
5. If $\text{elapsedTime} < 1500\text{ms}$, the request is rejected with `400 Bad Request` (`code: 'inhuman_interaction_speed'`).

### Rationale
- Completely stateless: Requires 0 database reads and 0 server memory allocations, perfectly adhering to TixHub Constitution Principle I (Reliability Under Load) and Principle V (Stateless request path / Free-tier discipline).
- Mathematically unforgeable: Automated bots cannot fabricate an earlier `viewTimestamp` without possessing the private server secret.

---

## 3. Disposable Email & Alias Sub-Addressing Normalization

### Decision
Implement two-stage email sanitization and validation in the authentication pipeline before uniqueness evaluation and database insertion:

1. **Sub-Addressing (`+` tag) Normalization**:
   - For recognized email providers (Gmail, Googlemail, Outlook, Hotmail, Live, Yahoo), strip any `+...` sub-address tag from the username portion (e.g., `john.doe+promo12@gmail.com` $\rightarrow$ `john.doe@gmail.com`).
   - Periods (`.`) in Gmail usernames are also normalized to prevent `j.o.h.n@gmail.com` multi-account proliferation.
2. **Disposable Domain Blacklist Filter**:
   - Use the standard `disposable-email-domains` dataset (bundled as an in-memory Set lookup).
   - If `domain` matches a known disposable email provider (e.g. `mailinator.com`, `10minutemail.com`, `temp-mail.org`), reject immediately with `400 Bad Request` (`code: 'disposable_email_blocked'`).

### Alternatives Considered
- *External Disposable Email API*: Rejected to avoid adding another external runtime dependency and API latency to the critical registration path. In-memory Set lookup executes in $O(1)$ sub-microsecond time.

---

## 4. Rate Limiting & Adaptive Challenge Architecture

### Decision
Leverage sliding-window memory rate limiters for IP-based and user-based throttling:

1. **Registration Rate Limiting (`POST /api/auth/register`)**:
   - Base limit: 5 new accounts per IP per hour.
   - **Soft Limit Fallback**: When an IP exceeds 5 registrations/hour, instead of returning a hard `429 Too Many Requests`, the server marks the request as requiring an explicit interactive Turnstile CAPTCHA. If valid CAPTCHA is provided, registration completes, accommodating users sharing university/cafe Wi-Fi and mobile NAT IPs.
2. **Login Attempt Protection (`POST /api/auth/login`)**:
   - Limit: 15 login attempts per IP per 15 minutes.
   - **Adaptive CAPTCHA**: Track consecutive failed attempts per identifier/IP. If `consecutiveFailures >= 3`, return `401 Unauthorized` with `{ requireCaptcha: true }`. Subsequent attempts MUST include a valid `turnstileToken`. Progressive response delays (0ms $\rightarrow$ 5000ms) are maintained.
3. **Public Catalog & Seat Map Throttling**:
   - Rate limit `GET /api/events` and `GET /api/showtimes/:id/seat-map` to 60 requests per minute per IP.
   - Implement short-term response caching (5–10 seconds TTL) using in-memory `stale-while-revalidate` cache to prevent PostgreSQL connection pool exhaustion during scraping spikes.
4. **Wallet Top-Up Protection (`POST /api/wallet/topups`)**:
   - Rate limit to max 5 top-up creations per 10 minutes per user.
   - Enforce database constraint: A user cannot have more than 2 top-ups in `initiated` (pending) status simultaneously.

---

## 5. Virtual Waiting Room for High-Demand Drops

### Decision
Implement an in-memory / Redis-ready priority queue for showtimes configured with `is_high_demand = true`:

1. **Admission Flow**:
   - Organizers / Admins toggle `is_high_demand = true` on hot events / showtimes.
   - When an attendee navigates to a high-demand showtime booking view, the client connects to `/api/waiting-room/join` (via REST or WebSocket).
   - At drop opening time, the queue shuffles entrants to prevent sub-millisecond network sniping, then admits attendees in batches (e.g. 50 users every 10 seconds).
   - Upon admission, the server generates an HMAC-signed `queueToken` with a **3-minute admission validity window**.
2. **Reservation Validation**:
   - `POST /api/reservations` validates that `queueToken` is authentic, not expired (< 3 min), not previously consumed, and matches the authenticated user and target showtime.
   - Once the reservation hold is created, the standard 7-minute seat hold TTL countdown takes over.

---

## 6. Database Synchronization Requirement

### Decision
Add the `is_high_demand` boolean flag to the `events` table (and `showtimes` where granular override is needed) with a default of `FALSE` and an index for catalog filtering.

### Rule & Requirement
In strict compliance with the user instructions, the complete database initialization script [`data_base/InitDB.sql`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/data_base/InitDB.sql) MUST be updated to include:
- `is_high_demand BOOLEAN NOT NULL DEFAULT FALSE` in the table definitions.
- Corresponding index `idx_events_is_high_demand` on `"events"("is_high_demand") WHERE "is_high_demand" = TRUE`.
- Any required seed data updates for test events.
