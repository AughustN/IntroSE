# TixHub Anti-Bot & Threat Defense Architecture

## 1. Overview & Objectives

The TixHub Anti-Bot Protection Suite protects the ticket purchasing platform against all five major bot and abuse threat vectors:
1. **Flash-Drop Scalping & Script Hold Snatching**: Snatching high-demand tickets in sub-second scripts.
2. **Automated Fake Account Creation**: Mass registration with disposable burner emails and alias variations (`+tag`).
3. **Credential Stuffing & Brute Force**: Automated account takeovers.
4. **Inventory & Price Scraping**: Continuous aggressive polling exhausting database pools.
5. **Payment Top-Up Hoarding & Hold Extension Exploitation**: Spamming top-up orders to lock seats indefinitely.

---

## 2. Core Protection Mechanisms

### 2.1 Behavioral Interaction Timing Verification
- **Mechanism**: Stateless HMAC-SHA256 timestamp token issued on `GET /api/showtimes/:id/seat-map`.
- **Threshold**: Human seat selection and confirmation must take $\ge 1500\text{ms}$.
- **Security**: Cryptographically signed with `SERVER_TIMING_SECRET` to prevent client spoofing.
- **Resource Footprint**: 0 server memory overhead (stateless validation).

### 2.2 Virtual Waiting Room Queue
- **Activation**: Configurable per high-demand event/showtime via `is_high_demand = true`.
- **Lifecycle**: Enqueued users receive randomized priority shuffle upon ticket drop and are admitted in batches.
- **Queue Token TTL**: 3-minute admission window (`queueToken`) required by `POST /api/reservations` before transitioning to the standard 7-minute seat hold.

### 2.3 Cloudflare Turnstile Integration
- **Gate Points**:
  - All user registrations (`POST /api/auth/register`).
  - Adaptive login triggers after $\ge 3$ consecutive password failures (`POST /api/auth/login`).
  - Seat hold creation for high-demand events (`POST /api/reservations`).
- **Emergency Bypass**: Strict fail-closed by default with `TURNSTILE_FAIL_OPEN=true` environment flag during Cloudflare API outages.

### 2.4 Email Sanitization & Disposable Blacklist
- **Sub-address Normalization**: Automatically strips `+tag` aliases and dots for Gmail, Outlook, Hotmail, and Yahoo.
- **Domain Blacklist**: Reject temporary/burner domains (`tempmail.com`, `10minutemail.com`, `mailinator.com`, etc.).
- **NAT Soft Challenge**: Rate limit of 6 registrations/hour/IP before requiring Turnstile verification.

### 2.5 Scraping & Top-Up Rate Limiting
- **Catalog Caching & Throttling**: 60 req/min/IP limit with `Cache-Control: public, max-age=5` headers.
- **Top-Up Abuse Protection**: Max 5 top-ups per 10 minutes per user and max 2 concurrent pending `initiated` transactions.

---

## 3. Environment Variables Configuration

| Variable | Type | Default | Description |
|:---|:---:|:---|:---|
| `TURNSTILE_SITE_KEY` | String | `""` | Public site key for Cloudflare Turnstile widget. |
| `TURNSTILE_SECRET_KEY` | String | `""` | Server secret key for Turnstile `/siteverify` verification. |
| `TURNSTILE_FAIL_OPEN` | Boolean | `false` | Emergency outage flag. When `true`, permits requests if Turnstile fails. |
| `SERVER_TIMING_SECRET` | String | `JWT_SECRET` | Secret key for signing and verifying HMAC timing tickets. |
| `VITE_TURNSTILE_SITE_KEY` | String | `""` | Client-side environment variable for Turnstile widget. |

---

## 4. Database Schema Changes & Sync Rules

- **Database column**: `"is_high_demand" BOOLEAN NOT NULL DEFAULT FALSE` on `"events"` table.
- **Database index**: `"idx_events_is_high_demand"` on `"events"("is_high_demand") WHERE "is_high_demand" = TRUE`.
- **Database Synchronization Rule**: Whenever schema changes are introduced, `data_base/InitDB.sql` must be updated alongside incremental migrations (`server/src/db/migrations/0036_anti_bot_high_demand.sql`).
