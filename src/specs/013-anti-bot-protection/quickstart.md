# Quickstart Validation Guide: Anti-Bot Protection Suite

**Feature**: Comprehensive Anti-Bot Protection Suite  
**Branch**: `013-anti-bot-protection`  
**Date**: 2026-08-20  

---

## 1. Prerequisites & Environment Setup

Ensure the following environment variables are present in `.env`:

```dotenv
# Cloudflare Turnstile Keys
TURNSTILE_SITE_KEY="0x4AAAAAAAx..."
TURNSTILE_SECRET_KEY="0x4AAAAAAAx..."
TURNSTILE_FAIL_OPEN=false

# Stateless Interaction Timing Secret
SERVER_TIMING_SECRET="dev-timing-secret-key-must-be-32-chars-long"
```

---

## 2. Validation Scenarios

### Scenario 1: Mass Fake Account & Disposable Email Defense (User Story 2)

#### Test 1.1: Disposable Email Domain Rejection
1. Send registration request with disposable domain:
   ```bash
   curl -X POST http://localhost:5000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"fullName":"Bot User","email":"test@mailinator.com","phone":"0987654321","password":"Password123!","turnstileToken":"valid-token"}'
   ```
2. **Expected Outcome**: HTTP `400 Bad Request` with `{"error": "disposable_email_blocked"}`.

#### Test 1.2: Email Sub-addressing (`+tag`) Normalization
1. Register user with email `alice+test1@gmail.com`.
2. Attempt to register another account with `alice+test2@gmail.com`.
3. **Expected Outcome**: Second registration is rejected with `{"error": "email_already_registered"}` because both normalize to `alice@gmail.com`.

#### Test 1.3: Registration Rate Limit Soft Challenge
1. Send 6 registration requests rapidly from the same IP.
2. **Expected Outcome**: On the 6th request, if no interactive CAPTCHA is provided, the API returns `{"requireCaptcha": true, "error": "registration_limit_challenge_required"}` instead of an outright ban, allowing humans to solve the challenge.

---

### Scenario 2: Adaptive Credential Stuffing Defense (User Story 3)

#### Test 2.1: Progressive Delay & 3-Attempt Adaptive CAPTCHA
1. Submit 3 incorrect passwords for `alice@gmail.com`:
   - Attempt 1: Returns `401` (`failedAttempts: 1, requireCaptcha: false`) in ~50ms.
   - Attempt 2: Returns `401` (`failedAttempts: 2, requireCaptcha: false`) with 500ms delay.
   - Attempt 3: Returns `401` (`failedAttempts: 3, requireCaptcha: true`) with 1000ms delay.
2. Attempt 4 without `turnstileToken`:
   - **Expected Outcome**: Request immediately rejected with `401 Unauthorized` (`error: 'captcha_required'`).
3. Attempt 5 with correct password AND valid `turnstileToken`:
   - **Expected Outcome**: HTTP `200 OK`, authentication succeeds, and `failedAttempts` resets to 0.

---

### Scenario 3: High-Demand Anti-Scalping & Timing Verification (User Story 1)

#### Test 3.1: Sub-Second Timing Rejection (< 1.5s)
1. Fetch seat map to obtain `timingTicket`.
2. Immediately submit `POST /api/reservations` within 200ms using the ticket.
3. **Expected Outcome**: HTTP `400 Bad Request` (`error: 'inhuman_interaction_speed'`).

#### Test 3.2: Virtual Waiting Room Admission & 3-Minute Expiry
1. For an event with `is_high_demand = true`, submit `POST /api/reservations` without `queueToken`.
   - **Expected Outcome**: HTTP `403 Forbidden` (`error: 'queue_token_required'`).
2. Join waiting room (`POST /api/waiting-room/join`), obtain `queueToken`.
3. Wait > 3 minutes and then submit `POST /api/reservations`.
   - **Expected Outcome**: HTTP `403 Forbidden` (`error: 'queue_token_expired'`).
4. Re-join, obtain valid `queueToken`, interact for > 1.5s, submit hold with `turnstileToken`.
   - **Expected Outcome**: HTTP `201 Created`, seats successfully held.

---

### Scenario 4: Public Inventory Scraping & Top-Up Abuse (User Stories 4 & 5)

#### Test 4.1: Seat Map Rate Limiting & Cache Header
1. Send 65 rapid `GET /api/showtimes/:id/seat-map` requests in 30 seconds.
2. **Expected Outcome**: Requests 1–60 return cached data (`max-age=5, stale-while-revalidate=10`); request 61+ returns `429 Too Many Requests`.

#### Test 4.2: Maximum 2 Pending Top-Ups Limit
1. Create Top-Up 1 (`POST /api/wallet/topups`).
2. Create Top-Up 2 (`POST /api/wallet/topups`).
3. Create Top-Up 3.
4. **Expected Outcome**: Top-Up 3 is rejected with `400 Bad Request` (`error: 'too_many_pending_topups'`).

---

### Scenario 5: Database Synchronization Verification

1. Run the unified database initialization script:
   ```bash
   psql -U postgres -d tixhub_test -f data_base/InitDB.sql
   ```
2. Verify columns and indexes:
   ```sql
   SELECT column_name, data_type, column_default 
   FROM information_schema.columns 
   WHERE table_name = 'events' AND column_name = 'is_high_demand';
   ```
3. **Expected Outcome**: Column `is_high_demand` is present as `boolean` with default `false`, and `idx_events_is_high_demand` index is created.
