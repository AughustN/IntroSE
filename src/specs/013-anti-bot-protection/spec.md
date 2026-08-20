# Feature Specification: Comprehensive Anti-Bot Protection Suite

**Feature Branch**: `013-anti-bot-protection`

**Created**: 2026-08-20

**Status**: Draft

**Input**: User description: "Based on the anti-bot assessment in danh-gia-chong-bot-source-code.md, spec implementing all the proposed anti-bot measures across the TixHub codebase."

## Clarifications

### Session 2026-08-20

- Q: How should events and showtimes be configured to activate the Virtual Waiting Room and seat-hold CAPTCHA challenges? → A: **Explicit organizer/admin toggle per event/showtime (Option A).** Organizers and Admins manually enable high-demand anti-bot protection during event creation/editing via an explicit setting (e.g., `is_high_demand` or `anti_bot_enabled`).
- Q: How should the system handle upstream third-party CAPTCHA verification outages or network timeouts? → A: **Fail-closed with emergency config bypass (Option A).** The system rejects verification on timeout/outage by default, with an optional administrator environment flag (`TURNSTILE_FAIL_OPEN=true`) to permit temporary degradation under strict rate limits.
- Q: What validity duration should an admitted Virtual Waiting Room queue token have before the attendee must initiate a seat hold? → A: **3-minute admission window (Option A).** The queue token remains valid for 3 minutes upon admission to start selecting and holding seats; once a seat hold is established, the standard 7-minute reservation hold countdown takes over.
- Q: How should the system handle registration attempts when the IP rate limit threshold (5–8 accounts per hour) is reached? → A: **Interactive CAPTCHA challenge / Soft limit (Option A).** Exceeding the IP threshold triggers mandatory interactive CAPTCHA verification rather than a hard block, allowing legitimate human users on shared Wi-Fi/NAT networks to register successfully.
- Q: How should the behavioral interaction timing ticket (`viewTimestamp`) be verified against client-side tampering? → A: **Stateless HMAC-signed token (Option A).** The server issues a stateless HMAC-signed timestamp token on seat-map load. Client submits this token with the hold request; server verifies the HMAC signature and checks `now - viewTimestamp >= 1500ms` without storing server-side session state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fair Access & Anti-Scalping for High-Demand Drops (Priority: P1)

An attendee visiting a high-demand ticket release (Flash Drop) is guided through a fair Virtual Waiting Room where access is managed in orderly queues, interaction timing is validated to ensure human-speed participation, and a lightweight non-intrusive CAPTCHA challenge verifies human presence before seats can be held, preventing automated sniping bots from acquiring inventory in fractions of a second.

**Why this priority**: Scalping and automated inventory exhaustion are critical existential threats to an event ticketing marketplace. If bots instantly drain tickets at opening millisecond, legitimate fans are locked out and trust in the platform is destroyed.

**Independent Test**: Simulate simultaneous seat hold requests from both rapid automated scripts (sub-second submission and missing queue tokens) and legitimate browser sessions. Confirm that automated fast-path requests are rejected while genuine users passing the waiting room and timing verification successfully hold seats.

**Acceptance Scenarios**:

1. **Given** an event flagged as high-demand / Flash Drop, **When** attendees navigate to the seat selection / booking view during opening, **Then** they are admitted to a Virtual Waiting Room and issued a priority queue token.
2. **Given** an attendee who has cleared the waiting room, **When** they view the seat map and attempt to hold seats with an elapsed interaction time of less than 1.5 seconds from initial view, **Then** the hold request is rejected as an inhumanly fast interaction.
3. **Given** an attendee who has cleared the waiting room and interacted for at least 1.5 seconds, **When** they submit a seat hold request with a valid CAPTCHA token, **Then** the seat hold is granted within the standard hold lifecycle.
4. **Given** an automated request attempting to bypass the waiting room or submitting without a verified queue token, **When** the seat hold endpoint processes the request, **Then** the request is refused with a queue authorization required error.

---

### User Story 2 - Automated Fake & Disposable Account Prevention (Priority: P1)

A legitimate new user registers on TixHub smoothly with transparent background verification, while automated registration scripts, disposable temporary email services, sub-addressing alias tricks (`user+tag@example.com`), and rapid multi-account creation per IP address are blocked without requiring expensive and intrusive SMS OTP.

**Why this priority**: Scalpers and malicious actors mass-produce fake accounts to bypass per-buyer ticket limits (`max_tickets_per_buyer = 8`). Securing registration is the foundational identity defense.

**Independent Test**: Attempt registering accounts with disposable domains (e.g. `@mailinator.com`), alias variations of existing emails, missing/invalid CAPTCHA tokens, and high-frequency bulk requests. Confirm each abusive attempt is denied with clear feedback while legitimate standard registration succeeds on the first try.

**Acceptance Scenarios**:

1. **Given** a new user registering with a valid personal email and completing background CAPTCHA verification, **When** they submit the registration form, **Then** their account is created successfully.
2. **Given** a user or bot attempting to register using a known disposable/temporary email domain, **When** the registration is submitted, **Then** the system rejects the registration with a message requesting a permanent official email address.
3. **Given** a registration attempt using an email alias with sub-addressing (e.g. `jane.doe+promo1@gmail.com`), **When** processed by the system, **Then** the email is normalized to its canonical root mailbox before uniqueness validation, preventing duplicate accounts for the same underlying inbox.
4. **Given** a single IP address attempting to register more than the permitted threshold (5–8 accounts per hour), **When** subsequent registration requests arrive, **Then** the system requires interactive challenge verification (presenting a mandatory CAPTCHA challenge) allowing legitimate humans on shared IPs to proceed while stopping automated scripts.
5. **Given** an automated script submitting registration payloads directly to the API without a valid CAPTCHA verification token, **When** processed by the server, **Then** the request is immediately rejected with a verification failed error.

---

### User Story 3 - Adaptive Defense Against Credential Stuffing (Priority: P2)

An attendee logging into TixHub experiences frictionless authentication, but if an attacker or bot attempts automated password guessing or distributed credential stuffing against accounts, the system tightens IP rate limits and dynamically triggers CAPTCHA challenges after repeated failures, stopping brute-force attacks without permanently locking genuine users out of their accounts.

**Why this priority**: Compromised accounts lead to unauthorized ticket transfers, wallet drainage, and privacy breaches. Adaptive challenges protect accounts while preserving access for real users who simply forgot their password.

**Independent Test**: Submit multiple incorrect login attempts for an account. Verify that after 3 failed attempts, subsequent login requests require solving a CAPTCHA challenge alongside progressive delay, and that excessive attempts from a single IP are throttled.

**Acceptance Scenarios**:

1. **Given** a legitimate user entering correct credentials on their first attempt, **When** they log in, **Then** they are authenticated immediately without mandatory visual challenges.
2. **Given** an account or IP with 3 or more consecutive failed login attempts, **When** a new login attempt is submitted, **Then** the system requires a valid CAPTCHA token to be solved before evaluating credentials.
3. **Given** an IP address exceeding the login attempt threshold (10–15 attempts within a 15-minute window), **When** further login requests are received, **Then** the system enforces progressive response delays and rate limit throttling.
4. **Given** an account subject to repeated failed attempts by a bot, **When** the genuine owner subsequently provides their correct credentials alongside a valid CAPTCHA solution, **Then** login succeeds and the consecutive failure counter is reset.

---

### User Story 4 - Public Inventory & Price Scraping Protection (Priority: P3)

Prospective attendees browse events, schedules, and seat maps with responsive performance, while high-frequency automated scraping scripts and polling bots attempting to monitor inventory leaks or price adjustments are restricted via rate limits and short-term response caching, offloading pressure from the primary database.

**Why this priority**: Excessive scraping overloads database connection pools and server CPU during peak traffic, while enabling sniper bots to monitor released seats. Real-time updates should be consumed via WebSocket channels rather than aggressive REST polling.

**Independent Test**: Send high-frequency concurrent `GET` requests to public catalog and seat-map endpoints from a simulated bot. Verify that requests beyond standard browsing thresholds receive rate-limiting responses and that repeated requests within short intervals are served from low-overhead cache.

**Acceptance Scenarios**:

1. **Given** normal users browsing public event listings and seat maps, **When** they view pages, **Then** data loads smoothly with low latency.
2. **Given** a client sending rapid repetitive requests to public catalog or seat-map endpoints (exceeding 30–60 requests per minute per IP), **When** the threshold is reached, **Then** the server responds with a rate-limit status indicating when requests may resume.
3. **Given** frequent read requests for active event details or showtime seat maps, **When** multiple requests arrive within a 5–10 second window, **Then** the system serves cached or stale-while-revalidate data to minimize direct database queries.
4. **Given** a client needing real-time seat availability updates during an active session, **When** viewing the seat map, **Then** updates are delivered via the established real-time seat channel rather than continuous REST polling.

---

### User Story 5 - Payment Top-Up Abuse & Hold Extension Prevention (Priority: P3)

Legitimate buyers holding tickets can top up their wallet balance seamlessly, but bots or abusive actors are prevented from spamming top-up requests or opening multiple concurrent pending top-up orders in order to exploit grace-period hold extensions (`extendOnce`) and hoard seats.

**Why this priority**: While wallet top-ups offer a one-time hold grace extension (up to 7 minutes) for genuine buyers completing payment, malicious bots could abuse top-up creation to hoard high-demand seats indefinitely.

**Independent Test**: Attempt creating more than 2 pending top-up orders simultaneously or generating high-frequency top-up requests for a single account. Verify that excess requests are rejected with clear constraint errors.

**Acceptance Scenarios**:

1. **Given** an attendee with an active seat hold who initiates a wallet top-up, **When** creating the top-up order, **Then** the top-up is created and the one-time hold grace extension is applied as permitted.
2. **Given** a user who already has 2 uncompleted (`initiated` / pending) top-up orders, **When** attempting to create a 3rd top-up order, **Then** the system refuses the request until pending orders are resolved or expired.
3. **Given** a user attempting to generate top-up requests at an abnormal rate (exceeding 5 requests within 10 minutes), **When** submitting another request, **Then** the request is throttled with a rate-limit error.

---

### Edge Cases

- **CAPTCHA Service Unavailability / Network Timeout**: If the third-party CAPTCHA verification service experiences an outage or fails to respond within a timeout (2.5 seconds), the system fails closed by default (rejecting verification). In an active upstream crisis, operations can enable an emergency bypass flag (`TURNSTILE_FAIL_OPEN=true`) via environment configuration to temporarily degrade to strict IP throttling with critical security audit logging.
- **Shared IP / Carrier-Grade NAT Environments**: Users on public Wi-Fi (universities, cafes, corporate offices) or mobile 4G/5G networks sharing a single public IP may trigger coarse IP rate limits. In such cases, soft challenges (presenting CAPTCHA) are used rather than permanent hard bans, and rate-limit windows are bounded (e.g. 1 hour TTL).
- **Legitimate Users with Slow Connections in Waiting Room**: A user whose connection drops momentarily in the waiting room should be permitted to rejoin within a grace window without losing their queue priority.
- **Sub-addressing for Legitimate Services**: Users of email domains where `+` sub-addressing is standard (e.g., Google Workspace, Outlook) have their canonical email recognized for account uniqueness while preserving the ability to receive communications.
- **Seat Map Re-renders / Fast Selection by Real Humans**: A human user quickly clicking a seat after the map has been open for 10 seconds must pass the timing check effortlessly, as the timing baseline is measured from initial map data delivery to hold submission.

## Requirements *(mandatory)*

### Functional Requirements

#### Anti-Scalping & High-Demand Protection
- **FR-001**: System MUST support an explicit configuration toggle per event/showtime (`is_high_demand` / `anti_bot_enabled`) enabling the Virtual Waiting Room and seat-hold CAPTCHA challenges during high-demand releases, issuing verifiable queue tokens that regulate attendee access to seat selection and checkout.
- **FR-002**: System MUST validate that hold requests on high-demand events include a valid, non-expired (valid for 3 minutes from admission), and previously unused queue token before transitioning to the standard 7-minute reservation hold lifecycle.
- **FR-003**: System MUST issue an HMAC-signed interaction timing ticket upon seat map presentation and cryptographically verify both signature authenticity and minimum elapsed interaction duration (≥ 1.5 seconds) on seat hold submission to prevent client-side timestamp spoofing without server-side session state.
- **FR-004**: System MUST require a verified CAPTCHA challenge token upon seat hold submission for events configured with high-demand anti-bot protection.

#### Account Registration & Identity Integrity
- **FR-005**: System MUST require valid CAPTCHA verification on all user registration requests before account creation is processed.
- **FR-006**: System MUST validate registration email domains against an up-to-date blacklist of disposable and temporary email providers, rejecting registrations from disposable domains with a user-friendly error.
- **FR-007**: System MUST normalize registration email addresses by removing sub-addressing aliases (e.g., stripping `+tag` segments for supported providers such as Gmail and Outlook/Hotmail) prior to uniqueness checks and persistence.
- **FR-008**: System MUST enforce an IP-based registration rate limit (maximum 5–8 new accounts per IP per hour), dynamically requiring interactive CAPTCHA challenge verification rather than a hard block when exceeded to accommodate shared IP and NAT environments.

#### Credential Stuffing & Login Security
- **FR-009**: System MUST enforce a tightened IP rate limit on login attempts (maximum 10–15 attempts per IP per 15-minute window).
- **FR-010**: System MUST track consecutive failed authentication attempts per account identifier / IP and dynamically enforce mandatory CAPTCHA challenge verification when consecutive failures reach or exceed 3.
- **FR-011**: System MUST maintain progressive response delays for repeated failed login attempts to mitigate high-speed automated password guessing.
- **FR-012**: System MUST reset consecutive failed attempt counters upon successful authenticated login with valid credentials.

#### Inventory & Catalog Scraping Prevention
- **FR-013**: System MUST enforce rate limits on public catalog and seat map read endpoints (maximum 30–60 requests per minute per IP).
- **FR-014**: System MUST implement short-term caching (5–10 seconds) on public event detail and showtime seat map endpoints to protect database resources against scraping bursts.
- **FR-015**: System MUST encourage and maintain real-time seat status synchronization via dedicated WebSocket channels, discouraging high-frequency REST polling.

#### Top-Up & Hold Extension Abuse Prevention
- **FR-016**: System MUST enforce rate limiting on wallet top-up initiation (maximum 5 top-up creation requests per 10 minutes per user account).
- **FR-017**: System MUST restrict each user account to a maximum of 2 concurrent uncompleted (`initiated` / pending) wallet top-up transactions at any time.

#### Bot Defense Configuration & Operations
- **FR-018**: System MUST support configurable server-side CAPTCHA verification keys and site keys via standard environment variables, defaulting to fail-closed verification on upstream errors while supporting an explicit emergency bypass flag (`TURNSTILE_FAIL_OPEN=true`).
- **FR-019**: System MUST log security-relevant bot mitigation events (e.g., blocked disposable emails, failed CAPTCHA verifications, rate limit breaches, timing anomalies) for administrative audit and monitoring.

### Key Entities

- **Queue Token**: Represents a user's authorized place in the Virtual Waiting Room for a specific high-demand showtime. Key attributes include: token identifier, user identifier, showtime identifier, issued timestamp, expiration timestamp (3 minutes from queue admission to first seat hold), and admission status.
- **Interaction Timing Ticket**: Represents a stateless client-side viewing session for a seat map. Key attributes include: showtime identifier, issued view timestamp, and HMAC-SHA256 signature generated with the server secret key.
- **Login Attempt Record**: Tracks authentication history for rate limiting and adaptive challenges. Key attributes include: identifier (email or phone), client IP address, consecutive failure count, last attempt timestamp, and lock/challenge state.
- **Disposable Domain Blocklist**: Maintained repository of known temporary and disposable email domain names used to evaluate registration eligibility.
- **Anti-Bot Configuration**: System settings governing rate limit thresholds, waiting room activation status per event, timing thresholds, and CAPTCHA enforcement rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of automated mass-registration attempts using disposable email domains or automated headless scripts without genuine CAPTCHA tokens are rejected at the boundary.
- **SC-002**: During high-demand flash drop events, seat holds submitted faster than minimum human capability (< 1.5 seconds from view) or without queue clearance are rejected, preventing sub-second inventory depletion.
- **SC-003**: 99% of legitimate human users experience zero additional friction or latency > 2 seconds during registration and login under normal conditions.
- **SC-004**: Accounts with 3 or more consecutive failed login attempts are protected by mandatory CAPTCHA challenges, reducing brute-force vulnerability by over 95% while keeping accounts accessible to real owners.
- **SC-005**: Public inventory endpoints withstand sustained scraping bursts without degrading API availability or exceeding database connection limits, keeping seat map response latency under 300ms.
- **SC-006**: Seat hold manipulation via repeated abandoned top-up requests is constrained to a maximum of 2 concurrent pending transactions per user, preventing artificial hold hoarding.

## Assumptions

- Cloudflare Turnstile is used as the primary non-intrusive CAPTCHA provider, requiring zero user SMS/OTP costs and maintaining accessibility for legitimate human users.
- CAPTCHA integration does not require routing DNS or domain proxying through Cloudflare; token verification is performed directly via server-to-server API calls.
- Events are classified as standard or high-demand (Flash Drop); the Virtual Waiting Room and mandatory reservation CAPTCHA can be enabled automatically or configured per event.
- Email normalization for sub-addressing strips `+` tags for common email services (such as Gmail and Microsoft Outlook) while preserving standard mailbox delivery.
- Rate limiting uses sliding-window or token-bucket algorithms in server memory / cache with graceful degradation when limits are approached.
- All monetary transactions and wallet operations remain strictly in integer VND in accordance with the TixHub Constitution.
- For all changes related to the database (such as new tables, columns, indexes, or enum values for high-demand flags or anti-bot configurations), `data_base/InitDB.sql` MUST be updated accordingly to reflect the latest complete schema and seed definitions.
