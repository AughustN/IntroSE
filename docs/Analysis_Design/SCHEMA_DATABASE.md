# Backend and SQL Handoff for TixHub Frontend MVP

This frontend currently uses mock data in `src/data.ts` and browser `localStorage`.
Backend can replace the mock layer without changing the main user flow.

> **Domain note:** TixHub is a **general event-ticketing** marketplace (concerts, workshops,
> theatre, community/club events) — not a cinema. The frontend `MovieEvent` type is a
> repurposed movie-ticketing UI and should be renamed to `Event`. The decisions behind this
> schema are recorded in [Design Decisions](#design-decisions) below; this file is
> self-contained and cites nothing outside itself.

## Core Modules

- Auth: email/password or Google, session refresh with revocation. Email mandatory, phone optional but unique and usable to sign in; no email verification (D4). The two account kinds never merge (D5). (Admin is a flag; Organizer is derived from an approved application — no single role column.)
- Events: general-admission and seated events (concerts, workshops, theatre, community/club events) with searchable metadata. **Physical only** — no online events in MVP.
- Venues: theatre, concert hall, community/workshop space, seat maps, city/location guidance.
- Showtimes: date/time inventory per event and venue (single-session and multi-session events).
- Reservations: temporary seat hold with expiration. **Login required to hold a seat** (no anonymous holds).
- Wallet: per-attendee store-credit balance + append-only ledger. **Closed loop** — money in via VNPay top-up, out only as tickets, no cash-out (D2).
- Orders: checkout **paid from the wallet**, service fee, promo discount. An order is created `paid` in one transaction; there is no gateway leg.
- Payments: VNPay sandbox integration for **top-ups only** (single gateway for MVP). The signed IPN is the **sole** trigger for crediting a wallet, and it touches no inventory.
- Tickets: QR/barcode generation, one-time check-in, resend email, per-ticket `refundable_amount` snapshot.
- Refunds: to the wallet, per ticket, once only. Self-cancel until T-24h (fee kept); event cancellation 100% (D3).
- Social proof: one **Rating** (1–5 stars) per attendee per event feeds the aggregate; unlimited **Comments** per attendee.
- Admin: event CRUD, showtime CRUD, seat map CRUD, event cancellation, voucher, reports, moderation, audit log. **Read-only on wallets** — no admin path creates or removes balance.
- SEO: public event pages with slug, metadata, JSON-LD schema.

## Design Decisions

Seven decisions shape most of the schema below. Tables and columns cite them as **D1**–**D7**.

### D1 — Money is integer VND đồng

Every `*_amount` column is `BIGINT` holding whole đồng. No `*_cents` column, no `currency` column.

- VND has no minor unit in practice, so a cents column would store a constant `00` and invite
  double-scaling bugs at every boundary.
- Floating point is excluded outright: `0.1 + 0.2` in a ledger that must sum exactly is a defect.
- Single currency, single gateway (VNPay) — a `currency` column would be dead weight enforcing nothing.

*Consequence:* discount allocation across tickets is `floor()` per ticket with the remainder on the
first ticket, so `SUM(refundable_amount) = subtotal_amount - discount_amount` holds exactly.

### D2 — Checkout is wallet-only; VNPay funds top-ups, never orders

Money enters through a VNPay top-up into a per-user wallet. Buying a ticket debits that wallet in
one local transaction. A closed loop: in via top-up, out only as tickets, **no cash-out**.

- The alternative (VNPay per order) puts a third party inside the seat lifecycle: seats must sit in
  `payment-pending` waiting on a callback that may arrive late, twice, or never. Every seat-release
  path then has to reason about gateway state.
- Wallet purchase is a single ACID transaction — order, debit, ledger row, seat flip, ticket
  issuance commit or none do. No partial sale exists.
- Top-up failure costs a seat at worst, never money: a pending top-up **never** freezes or extends a
  hold, otherwise anyone locks a seat map for free by starting a top-up and walking away.
- One gateway integration, one signed-IPN code path, one idempotency key — testable without a seat map.

*Consequences:* `orders.payment_status` is born `paid` (`pending`/`failed` vestigial);
`payment_transactions` references `wallet_id`, not `order_id`; there is no payment-window timeout;
`wallet_transactions` has no `adjustment` type, so no code path — admin included — can create money;
organizers hold no wallet and are settled off-platform.

### D3 — Refunds go to the wallet, per ticket, once, with a T-24h self-cancel cutoff

| Trigger | Amount | Seat |
|---|---|---|
| Self-cancel ≥ 24h before showtime | `tickets.refundable_amount`; service fee kept | released |
| Self-cancel < 24h | not offered | stays `sold` |
| Event cancellation (any time before start) | 100%, service fee included | released |

- Refunding to the wallet keeps the loop closed — no payout rail, no reversal API, no PCI surface.
- The cutoff is an **inventory freeze**, not a money rule: without it a buyer holds a ticket, watches
  the event sell out, and dumps it at T-1h at zero cost.
- Refund amount is the stored `refundable_amount` (post-discount, pre-fee, frozen at issue), never
  recomputed. Refunding face value on a voucher order mints money: 4 × 200,000₫ bought for 620,000₫
  after a 200,000₫ voucher would refund 800,000₫.
- Refund state is **derived, not stored** — `orders.payment_status` stays `paid`; read
  `tickets.qr_status` + `wallet_transactions`. Net revenue must read the ledger anyway.

*Consequence:* `uq_wallet_txn_refund_per_ticket` enforces once-ever at the database, which is what
makes both double-click self-cancel and a resumable bulk event-cancellation job safe.

### D4 — Email is mandatory and unverified; phone is optional but unique

Every account carries an email address. A phone number is optional, unique when supplied, and
accepted as a sign-in identifier alongside the email. Registration signs the user in immediately —
nothing is gated on proving the address.

- Email is the only identifier every account has, so it is the only thing password reset can rely
  on. Phone-only accounts would have no recovery path short of an SMS provider.
- Verification would put a mail provider on the registration path, which is the one path that must
  work before anything else in the product does.
- Phone uniqueness is what makes "sign in with your số điện thoại" unambiguous; it is a partial
  index so that leaving it blank stays free.

*Consequences:* no verification columns and no verification token table; phone is normalised to one
canonical form before the uniqueness check; **unverified addresses must never be treated as proof of
identity** — which is what forces D5.

### D5 — A Google account and a password account never merge

One email address, one account, one sign-in method — chosen at creation and permanent. A collision
in either direction is refused with an instruction, never linked.

- This is the direct cost of D4. With no verified address, auto-linking would let anyone register a
  password account on a stranger's email and silently inherit that account the moment its real owner
  signed in with Google.
- Merging identities is also a one-way door: once two credentials open one wallet, unpicking them
  after a dispute is guesswork.
- Refusing is legible to the user — "this address uses Google sign-in" is an instruction, not a dead
  end.

*Consequences:* `provider` is `NOT NULL` and is what selects the refusal message; the
`users_credential_matches_provider` CHECK makes a hybrid account unrepresentable rather than merely
discouraged; password reset is refused for Google accounts, since granting one would be the same
link by another route; Google lookups go through `(provider, provider_user_id)`, never email.

### D6 — No account lockout; throttle the source, slow the identifier

Failed sign-ins never put an account into a locked state. Abuse is answered by rate-limiting the
**source** and by answering a repeatedly-failing identifier more slowly. A correct password is always
accepted.

- Locking after N failures is a denial-of-service anyone can aim at anyone whose email they know.
  The victim, not the attacker, is the one who loses access.
- A lockout can only fire on an account that exists, so watching which identifiers lock out
  enumerates the user base — defeating the equal-response and equal-timing rules the login path is
  built around.
- The progressive delay applies to unknown identifiers too, or the delay curve leaks the same
  information the lockout would have.

*Consequences:* no `failed_attempts` or `locked_until` column on `users`; the throttle reads
`auth_events` by `source_ip`, which is why that partial index exists; a distributed attacker is
slowed rather than stopped, accepted deliberately because the alternative punishes the victim.

### D7 — Sessions are stored and rotated, not self-contained

A refresh token is a database row, rotated on every use, with all tokens from one login sharing a
`family_id`. The short-lived access token stays in memory; the refresh token lives in an httpOnly
cookie so a script injected into the page cannot read it.

- Every session requirement is a revocation requirement: log out, log out everywhere, suspend an
  account, change a password. A self-contained token cannot be withdrawn before it expires, so
  "signed out" would mean "signed out in up to 15 minutes" — and suspension would not bite at all.
- Rotation plus a shared family turns theft into a detectable event. Presenting an already-rotated
  token proves a copy exists, because no honest client goes backwards; the answer is to kill the
  whole family, which logs the thief out and costs the real user one sign-in.
- Storing only a hash means a leaked database yields no usable session.

*Consequences:* `refresh_tokens` grows by one row per refresh and needs a periodic sweep of rows that
are both expired and revoked; every revocation path names itself in `revoked_reason`, so an incident
can be reconstructed; `users.status` is read per request rather than copied into the access token,
because a token already issued cannot be edited.

## API Contract Draft

### Public

- `GET /api/events`
  - Query: `q`, `category`, `date`, `city`, `minPrice`, `maxPrice`, `status`
  - Returns event cards and availability summary (sold-out is derived from showtimes).
- `GET /api/events/:slug`
  - Returns detail, ticket tiers, venue guide, refund policy, related events.
- `GET /api/events/:id/showtimes`
  - Returns dates/times and seat inventory counts.
- `GET /api/showtimes/:id/seat-map`
  - Returns rows, seats, seat type, tier price, availability. **Viewable by guests; selecting a seat requires login.**

### Auth

- `POST /api/auth/register`
  - Body: `email` (required), `password`, `nickname`, `phone` (optional).
  - Creates the Attendee account **and its wallet row** in one transaction, then signs in. No
    verification step (D4).
  - `409 { error: 'email_taken' }` · `409 { error: 'phone_taken' }`
  - `409 { error: 'email_registered_with_google' }` — the address belongs to a Google account; the UI
    tells the user to use the Google button. No merge (D5).
- `POST /api/auth/login`
  - Body: `identifier` (email **or** phone), `password`. One field, both kinds.
  - `401 { error: 'invalid_credentials' }` for both "no such account" and "wrong password" — and in
    indistinguishable time, so the response cannot enumerate registered addresses.
  - `409 { error: 'account_uses_google' }` only after the identifier is known to exist and to be a
    Google account.
- `POST /api/auth/oauth/google`
  - Body: the Google credential. Verified with Google before any claim in it is trusted.
  - Looks the account up by `(provider, provider_user_id)`, never by email.
  - `409 { error: 'email_registered_with_password' }` when the asserted address already belongs to a
    password account. Refuse and instruct — never link (D5).
- `POST /api/auth/refresh` — rotates the session; reuse of a superseded token revokes the family.
- `POST /api/auth/logout` · `POST /api/auth/logout-all`
- `POST /api/auth/password/forgot` · `POST /api/auth/password/reset`
  - Identical response whether or not the address is registered. Refused outright for a Google
    account: setting a password there would be a back-door link (D5).
- `GET /api/me` · `PATCH /api/me` (nickname, phone, avatar) · `POST /api/me/password`

### Booking (login required)

- `POST /api/reservations`
  - Body: `showtimeId`, `seatIds`
  - Creates a temporary hold owned by the logged-in user, returns `reservationId`, `expiresAt`.
- `PATCH /api/reservations/:id`
  - Add/remove seats while hold is valid.
- `DELETE /api/reservations/:id`
  - Cancel hold.
- `POST /api/orders`
  - Body: `reservationId`, customer info, promo code. Reservation must still be `active`; one order per reservation.
  - **Debits the wallet and completes the sale in one transaction** — order is created `paid`, seats → `sold`, tickets issued. No redirect.
  - `422 { error: 'insufficient_balance', shortfall: <VND> }` if the balance is short. Nothing is created; the seat hold keeps its normal TTL.
- `GET /api/orders`
  - User booking history.
- `GET /api/orders/:id/ticket`
  - Returns ticket and QR payload.
- `POST /api/orders/:id/resend`
  - Resend confirmation email.
- `POST /api/tickets/:id/cancel`
  - Attendee self-cancel: void ticket, release seat, **refund `refundable_amount` to wallet**. Refused at/after T-24h before showtime start.

### Wallet (login required)

- `GET /api/wallet`
  - Returns `balanceAmount` and the caps, for the header widget and shortfall prompts.
- `GET /api/wallet/transactions`
  - Paginated ledger: `type`, `amount`, `balanceAfter`, linked order/event, `createdAt`. The wallet-history statement (UC-41).
- `POST /api/wallet/topups`
  - Body: `amount` (5,000 ≤ amount ≤ 10,000,000), optional `reservationId` for the return deep-link.
  - Validates the balance cap **before** hand-off. Creates `payment_transactions` row (`status='initiated'`), returns the signed VNPay URL.
- `GET /api/wallet/topups/:ref`
  - Poll status after the browser returns (`initiated` | `success` | `failed`) — the return URL itself never changes state.
- `POST /api/payments/webhook`
  - VNPay IPN; must be idempotent. **Sole trigger for crediting a wallet.** Touches no seats, no orders, no tickets.
- `POST /api/reports`
  - Body: `targetType` (`event`|`comment`), `targetId`, `reason`. Feeds moderation queue.
- `POST /api/waitlists`
  - Join waitlist for a sold-out `showtimeId` (+ optional `ticketTierId`).

### Admin / Organizer

- `GET/POST/PATCH/DELETE /api/admin/events`
- `POST /api/admin/events/:id/cancel` — void all tickets, release seats, mark orders `cancelled`, email + notify every buyer.
- `GET/POST/PATCH/DELETE /api/admin/showtimes`
- `GET/POST/PATCH/DELETE /api/admin/venues`
- `GET/POST/PATCH/DELETE /api/admin/seat-maps`
- `GET /api/admin/orders`
- `GET/POST/PATCH/DELETE /api/admin/vouchers`
- `POST /api/admin/checkins` — idempotent QR check-in.
- `GET /api/admin/reports` / `PATCH /api/admin/reports/:id` — moderation queue.
- `GET /api/admin/reports/revenue`
- `POST /api/admin/organizers/:id/approve` / `POST /api/admin/organizers/:id/suspend` — writes an audit log row.

## SQL Schema Draft

```sql
-- ---------- USERS ----------
-- Email is mandatory and is the one identifier every account has (D4). Phone is optional but
-- unique when present, because it is also a sign-in identifier. There is no email-verification
-- column: registration signs the user in immediately (D4).
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,             -- lowercased before insert; UNIQUE is what makes D5's
                                          -- refusal expressible: one address, one account, ever
  phone TEXT,                             -- normalized to one canonical form (+84…) before write,
                                          -- so 0901234567 and +84901234567 cannot become 2 accounts
  nickname TEXT,                          -- display handle; canonical name DB->API->UI (renamed from full_name; see CONTEXT.md, feature 001 Q4b)
  password_hash TEXT,                     -- NULL for a Google account; never both this and provider
                                          -- ='google' (D5 — the two kinds never merge)
  provider TEXT NOT NULL DEFAULT 'email'  -- always populated: it selects which refusal message the
    CHECK (provider IN ('email', 'google')),  -- collision paths show
  provider_user_id TEXT,                  -- Google's stable subject id; the account is identified by
                                          -- this, not by the email, so a change at Google is survivable
  is_admin BOOLEAN NOT NULL DEFAULT false,   -- only stored privilege; Attendee is the base capability
  status TEXT NOT NULL DEFAULT 'active'      -- read per request, never captured into a session token,
    CHECK (status IN ('active', 'suspended')),  -- so a suspension bites on the very next request
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A password account has a hash; a Google account has a provider id. Never neither, never both.
  CONSTRAINT users_credential_matches_provider CHECK (
    (provider = 'email'  AND password_hash IS NOT NULL AND provider_user_id IS NULL) OR
    (provider = 'google' AND password_hash IS NULL     AND provider_user_id IS NOT NULL)
  )
);

-- Phone is a sign-in identifier, so it must be unique — but only among accounts that supplied one.
-- A plain UNIQUE would be wrong: it permits multiple NULLs in PostgreSQL, which is what we want,
-- but stating it as a partial index documents the intent and keeps the index small.
CREATE UNIQUE INDEX uq_users_phone ON users(phone) WHERE phone IS NOT NULL;

-- Google sign-in looks the account up by provider subject id, not by email.
CREATE UNIQUE INDEX uq_users_provider_subject
  ON users(provider, provider_user_id) WHERE provider_user_id IS NOT NULL;

-- ---------- WALLETS ----------
-- One closed-loop store-credit balance per user (D2).
-- Money in: validated VNPay IPN only. Money out: ticket purchases only. No cash-out.
CREATE TABLE wallets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE NOT NULL REFERENCES users(id),
  balance_amount BIGINT NOT NULL DEFAULT 0,   -- integer VND đồng
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Overdraft is structurally impossible. Note this is the ONLY hard bound:
  CONSTRAINT wallet_balance_non_negative CHECK (balance_amount >= 0)
);
-- The 20,000,000₫ ceiling is a TOP-UP rule, enforced in the application before the
-- VNPay hand-off — NOT a CHECK constraint. A refund reverses money already paid and
-- must never be blocked: an attendee at the ceiling whose event is cancelled has to be
-- refunded, even though it pushes the balance above it. A CHECK here would abort that
-- transaction and strand money that has no other way home.

-- ---------- REFRESH TOKENS ----------
-- Sessions must be revocable, so they cannot be self-contained tokens with nothing stored: logout,
-- logout-everywhere, suspension, and password change all have to kill a session that has not yet
-- expired (D7).
--
-- One row per issued refresh token, rotated on every use. All tokens descended from one login share
-- a family_id. Presenting an already-rotated token means a copy is in circulation — no honest client
-- ever goes backwards — so the whole family dies and both the user and the thief are logged out.
CREATE TABLE refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  family_id UUID NOT NULL,               -- shared by every token descended from one login
  token_hash TEXT UNIQUE NOT NULL,       -- hash only: a leaked database must not yield usable tokens
  parent_id BIGINT REFERENCES refresh_tokens(id),   -- the token this one replaced
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,                -- non-NULL ⇒ rotated, logged out, or killed with its family
  revoked_reason TEXT CHECK (revoked_reason IN (
    'rotated', 'logout', 'logout_all', 'reuse_detected',
    'password_changed', 'password_reset', 'account_suspended'
  )),
  user_agent TEXT,
  source_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "log out everywhere", and "kill every session on suspension / password change".
CREATE INDEX idx_refresh_user_live ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
-- Reuse detection kills the family in one statement.
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);
-- Cleanup sweep: rows that are both expired and revoked carry no information worth keeping.
CREATE INDEX idx_refresh_expired ON refresh_tokens(expires_at) WHERE revoked_at IS NOT NULL;

-- ---------- AUTH EVENTS ----------
-- Authentication history. Deliberately NOT audit_logs: that table is the admin trail (SEC-09) and
-- requires a known actor and a target. An auth event happens BEFORE identity is established, is
-- thousands of times higher in volume, and its most valuable row is a failure against an identifier
-- that matches nothing — which is what enumeration looks like.
CREATE TABLE auth_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),   -- NULL when the identifier matched no account
  identifier_hash TEXT,                  -- keyed hash of the attempted email/phone, NEVER the value:
                                         -- a failed attempt names someone who may not be a user at
                                         -- all, so this table must not become a list of real
                                         -- addresses. Groupable, not readable.
  event TEXT NOT NULL CHECK (event IN (
    'login_success', 'login_failure', 'logout', 'logout_all',
    'password_changed', 'password_reset_requested', 'password_reset_completed',
    'session_reuse_detected', 'organizer_applied'
  )),
  source_ip INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Investigation queries: "what happened to this account", and "how many failures on this identifier".
CREATE INDEX idx_auth_events_user ON auth_events(user_id, created_at DESC);
CREATE INDEX idx_auth_events_identifier ON auth_events(identifier_hash, created_at DESC);
-- Drives the per-source throttle (D6) and the enumeration sweep.
CREATE INDEX idx_auth_events_source ON auth_events(source_ip, created_at DESC)
  WHERE event = 'login_failure';

-- ---------- ORGANIZERS ----------
-- Organizer-ness is derived: a user is an Organizer iff they have a row here with status='approved'.
-- A user may hold SEVERAL rows over time: rejection is usually a fixable mistake, so a rejected
-- applicant may correct and re-apply, and every superseded attempt is kept as the evidence the next
-- admin decision rests on. What must stay unique is the LIVE application, not the history.
CREATE TABLE organizers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),   -- deliberately NOT UNIQUE; see the index below
  display_name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended', 'rejected')),
  review_note TEXT,                          -- why it was rejected/suspended; shown on re-application
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id),   -- admin who approved
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one LIVE application per user. 'rejected' rows are excluded so a corrected re-application
-- is possible; 'suspended' rows are INCLUDED so that applying again cannot be used to shed a
-- suspension.
CREATE UNIQUE INDEX uq_organizers_live_application
  ON organizers(user_id) WHERE status IN ('pending', 'approved', 'suspended');

CREATE INDEX idx_organizers_status ON organizers(status);
-- Review history for one applicant, newest first.
CREATE INDEX idx_organizers_user_history ON organizers(user_id, applied_at DESC);

-- ---------- VENUES ----------
CREATE TABLE venues (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  raw_address TEXT NOT NULL,
  address_line TEXT,
  map_url TEXT,
  guide TEXT,
  normalized_name TEXT GENERATED ALWAYS AS (lower(regexp_replace(name, '\s+', ' ', 'g'))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name, city)
);

-- ---------- SECTIONS ----------
CREATE TABLE sections (
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,          -- 'Khu A', 'Balcony', 'VIP Front'...
  description TEXT,
  UNIQUE (venue_id, name)
);

-- ---------- SEATS ----------
CREATE TABLE seats (
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id),
  section_id BIGINT REFERENCES sections(id),
  row_label TEXT NOT NULL,
  seat_number INT NOT NULL,
  seat_type TEXT NOT NULL DEFAULT 'single' CHECK (seat_type IN ('single', 'double', 'standing')),
  UNIQUE (venue_id, row_label, seat_number)
);

-- ---------- EVENT CATEGORIES ----------
CREATE TABLE event_categories (
  id SMALLSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  label_vi TEXT NOT NULL,
  label_en TEXT
);

-- ---------- EVENTS ----------
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  organizer_id BIGINT NOT NULL REFERENCES organizers(id),
  category_id SMALLINT NOT NULL REFERENCES event_categories(id),

  title TEXT NOT NULL,
  original_title TEXT,
  description TEXT NOT NULL,
  age_restriction TEXT NOT NULL DEFAULT 'all'
    CHECK (age_restriction IN ('all', '13+', '16+', '18+')),
  age_description TEXT,
  duration_minutes INT,
  genre TEXT[] NOT NULL DEFAULT '{}',
  lineup TEXT[] NOT NULL DEFAULT '{}',        -- performers / speakers / artists
  rating NUMERIC(3,1),                        -- aggregate; fed only by ratings table
  review_count INT NOT NULL DEFAULT 0,        -- count of ratings
  image_url TEXT,
  local_image_path TEXT,
  trailer_url TEXT,
  refund_policy TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT false,

  event_type TEXT NOT NULL DEFAULT 'general_admission'
    CHECK (event_type IN ('general_admission', 'seated')),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'on_sale', 'finished', 'cancelled')),  -- organizer lifecycle; sold-out derived from showtimes

  moderation_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (moderation_status IN ('pending_review', 'approved', 'flagged', 'removed')),

  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_category ON events(category_id);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_organizer ON events(organizer_id);
CREATE INDEX idx_events_moderation ON events(moderation_status);

-- ---------- SHOWTIMES ----------
CREATE TABLE showtimes (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id),
  venue_id BIGINT NOT NULL REFERENCES venues(id),   -- every event is physical
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'on_sale', 'sold_out', 'finished', 'cancelled'))  -- inventory truth
);

CREATE INDEX idx_showtimes_event ON showtimes(event_id);
CREATE INDEX idx_showtimes_starts_at ON showtimes(starts_at);

-- ---------- TICKET TIERS ----------
-- Per showtime, so pricing can differ per session. VIP / SUPER VIP / Economy / Budget.
CREATE TABLE ticket_tiers (
  id BIGSERIAL PRIMARY KEY,
  showtime_id BIGINT NOT NULL REFERENCES showtimes(id),
  label TEXT NOT NULL,
  price_amount BIGINT NOT NULL,           -- integer VND đồng
  description TEXT,
  badge TEXT,
  total_quantity INT,                     -- GA capacity; NULL for seated (capacity = seat rows)
  sold_quantity INT NOT NULL DEFAULT 0,
  reserved_quantity INT NOT NULL DEFAULT 0,
  CHECK (sold_quantity + reserved_quantity <= COALESCE(total_quantity, sold_quantity + reserved_quantity))
);

CREATE INDEX idx_ticket_tiers_showtime ON ticket_tiers(showtime_id);

-- ---------- SHOWTIME SEATS ----------
-- Seated events only. Bookable instance of a physical seat for one showtime.
CREATE TABLE showtime_seats (
  id BIGSERIAL PRIMARY KEY,
  showtime_id BIGINT NOT NULL REFERENCES showtimes(id),
  seat_id BIGINT NOT NULL REFERENCES seats(id),
  ticket_tier_id BIGINT NOT NULL REFERENCES ticket_tiers(id),   -- price class (VIP/Economy...)
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'held', 'sold', 'blocked')),
  hold_owner_id BIGINT REFERENCES users(id),   -- required (app-enforced) while status='held'; no anonymous holds
  hold_expires_at TIMESTAMPTZ,
  UNIQUE (showtime_id, seat_id)
);

CREATE INDEX idx_showtime_seats_showtime ON showtime_seats(showtime_id, status);
CREATE INDEX idx_showtime_seats_hold_expiry ON showtime_seats(hold_expires_at) WHERE status = 'held';

-- ---------- RESERVATIONS ----------
CREATE TABLE reservations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),   -- login required to hold/reserve
  showtime_id BIGINT NOT NULL REFERENCES showtimes(id),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'converted', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reservations_expiry ON reservations(status, expires_at);

-- ---------- RESERVATION ITEMS ----------
CREATE TABLE reservation_items (
  id BIGSERIAL PRIMARY KEY,
  reservation_id BIGINT NOT NULL REFERENCES reservations(id),
  ticket_tier_id BIGINT NOT NULL REFERENCES ticket_tiers(id),
  showtime_seat_id BIGINT REFERENCES showtime_seats(id),   -- NULL for GA (quantity-based)
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_amount BIGINT NOT NULL,                       -- price snapshot at hold time
  UNIQUE (reservation_id, showtime_seat_id)
);

-- ---------- VOUCHERS ----------
CREATE TABLE vouchers (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed', 'percent')),
  discount_amount BIGINT NOT NULL,          -- VND đồng (used when discount_type='fixed')
  discount_percent NUMERIC(5,2),            -- used when discount_type='percent'
  min_order BIGINT NOT NULL DEFAULT 0,
  usage_limit INT,
  usage_limit_per_user INT DEFAULT 1,
  used_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true
);

-- ---------- ORDERS ----------
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  order_code TEXT UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),                 -- every order owned by an Attendee
  reservation_id BIGINT UNIQUE NOT NULL REFERENCES reservations(id),  -- one order per reservation
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  subtotal_amount BIGINT NOT NULL,
  service_fee_amount BIGINT NOT NULL,
  discount_amount BIGINT NOT NULL DEFAULT 0,
  final_total_amount BIGINT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'wallet',   -- wallet-only checkout (D2)
  payment_status TEXT NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled')),
    -- Born 'paid': the wallet debit and ticket issuance are one transaction, so there is
    -- no gateway leg to wait on. 'pending'/'failed' are vestigial.
    -- No refund states: refund is derived from tickets.qr_status + wallet_transactions (D3).
  voucher_id BIGINT REFERENCES vouchers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- PAYMENT TRANSACTIONS ----------
-- Top-ups ONLY. Orders have no gateway leg (D2), so this references wallets, not orders.
CREATE TABLE payment_transactions (
  id BIGSERIAL PRIMARY KEY,
  wallet_id BIGINT NOT NULL REFERENCES wallets(id),
  provider TEXT NOT NULL DEFAULT 'vnpay',
  provider_txn_id TEXT,
  provider_txn_ref TEXT,
  amount BIGINT NOT NULL,                    -- VND đồng; 5,000 .. 10,000,000 (app-enforced)
  status TEXT NOT NULL CHECK (status IN ('initiated', 'success', 'failed')),
  reservation_id BIGINT REFERENCES reservations(id),  -- return deep-link: resume this checkout
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_txn_ref)        -- IPN idempotency (REL-03)
);

CREATE INDEX idx_payment_txn_wallet ON payment_transactions(wallet_id, created_at);
-- drives the querydr reconciliation sweep for IPNs that never arrived
CREATE INDEX idx_payment_txn_stale ON payment_transactions(created_at) WHERE status = 'initiated';

-- ---------- TICKETS ----------
-- Issued inside the wallet-debit transaction (D2), never by a gateway callback.
CREATE TABLE tickets (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  reservation_item_id BIGINT NOT NULL REFERENCES reservation_items(id),
  price_amount BIGINT NOT NULL,             -- face value, for display
  refundable_amount BIGINT NOT NULL,        -- this ticket's share of what was actually paid:
                                            -- post-discount, pre-service-fee, frozen at issue time.
                                            -- INVARIANT per order:
                                            --   SUM(refundable_amount) = subtotal_amount - discount_amount
  qr_token_hash TEXT UNIQUE NOT NULL,
  barcode_value TEXT UNIQUE NOT NULL,
  qr_status TEXT NOT NULL DEFAULT 'unused' CHECK (qr_status IN ('unused', 'checked_in', 'void')),
  checked_in_at TIMESTAMPTZ,
  checked_in_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_order ON tickets(order_id);

-- ---------- WALLET TRANSACTIONS ----------
-- Append-only ledger. Never UPDATEd, never DELETEd. Explains wallets.balance_amount.
-- No 'adjustment' type on purpose: no code path, admin included, can create money (D2).
CREATE TABLE wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  wallet_id BIGINT NOT NULL REFERENCES wallets(id),
  type TEXT NOT NULL CHECK (type IN ('topup', 'purchase', 'refund')),
  amount BIGINT NOT NULL,          -- signed: +topup, -purchase, +refund
  balance_after BIGINT NOT NULL,   -- snapshot, so the statement page needs no arithmetic
  order_id BIGINT REFERENCES orders(id),                            -- purchase / refund
  ticket_id BIGINT REFERENCES tickets(id),                          -- refund only
  payment_transaction_id BIGINT REFERENCES payment_transactions(id),-- topup only
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (type = 'topup'    AND amount > 0 AND payment_transaction_id IS NOT NULL) OR
    (type = 'purchase' AND amount < 0 AND order_id IS NOT NULL) OR
    (type = 'refund'   AND amount > 0 AND ticket_id IS NOT NULL)
  )
);

-- A ticket can be refunded exactly ONCE, ever, by any code path. This single index
-- makes both self-cancel double-clicks and bulk event-cancellation retries safe,
-- and is what lets the bulk refund job be resumable (D3).
CREATE UNIQUE INDEX uq_wallet_txn_refund_per_ticket
  ON wallet_transactions(ticket_id) WHERE type = 'refund';

CREATE INDEX idx_wallet_txn_wallet ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX idx_wallet_txn_order ON wallet_transactions(order_id);

-- ---------- RATINGS ----------
-- One 1-5 star score per attendee per event; the only input to the aggregate score.
-- App enforces: the ticket must be checked_in (attended) before a rating is allowed.
CREATE TABLE ratings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  event_id BIGINT NOT NULL REFERENCES events(id),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id),   -- proof of attendance
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX idx_ratings_event ON ratings(event_id);

-- ---------- COMMENTS ----------
-- Unlimited free-text posts per attendee on an attended event. Does not affect the aggregate score.
-- App enforces: the ticket must be checked_in before commenting.
CREATE TABLE comments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  event_id BIGINT NOT NULL REFERENCES events(id),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id),   -- proof of attendance
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_event ON comments(event_id);

-- ---------- WAITLISTS ----------
CREATE TABLE waitlists (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  showtime_id BIGINT NOT NULL REFERENCES showtimes(id),
  ticket_tier_id BIGINT REFERENCES ticket_tiers(id),   -- NULL = any tier
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'expired', 'converted')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  UNIQUE (user_id, showtime_id, ticket_tier_id)
);

-- ---------- NOTIFICATIONS ----------
CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,   -- 'order_confirmed','reminder_24h','event_changed','waitlist_open',... (open TEXT)
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email')),
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

-- ---------- NOTIFICATION LOGS ----------
-- Delivery attempts, for the email-retry requirement.
CREATE TABLE notification_logs (
  id BIGSERIAL PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES notifications(id),
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  attempt_no INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_logs_notification ON notification_logs(notification_id);

-- ---------- REPORTS ----------
-- Attendee flags against an event or a comment; feeds the admin moderation queue (UC-39 -> UC-34).
CREATE TABLE reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_user_id BIGINT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('event', 'comment')),
  target_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  resolved_by BIGINT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_status ON reports(status);

-- ---------- AUDIT LOGS ----------
-- Written on privileged actions: organizer approve/suspend (UC-33), event moderation (UC-34).
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,           -- 'organizer_approved','organizer_suspended','event_removed',...
  target_type TEXT NOT NULL,      -- 'organizer','event',...
  target_id BIGINT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at);

-- ---------- SAVED EVENTS ----------
CREATE TABLE saved_events (
  user_id BIGINT NOT NULL REFERENCES users(id),
  event_id BIGINT NOT NULL REFERENCES events(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- ---------- EVENT VIEWS ----------
CREATE TABLE event_views (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  event_id BIGINT NOT NULL REFERENCES events(id),
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_views_user ON event_views(user_id, viewed_at);
```

## Seat Concurrency Requirement

Two-layer locking, matching the schema (`showtime_seats` + `reservations`/`reservation_items`):

- `showtime_seats.status` is the fast, real-time layer: a seat flips to `held` (with `hold_owner_id` — the logged-in user; **login is required to hold a seat**) the moment it's clicked, and is broadcast over the socket so other viewers see it as unavailable immediately.
- `reservations` + `reservation_items` is the checkout-session layer: created when the user proceeds to checkout, referencing the already-held `showtime_seats` rows.
- Before inserting `reservation_items`, verify no active reservation or paid order owns the same `showtime_id + seat_id` (`SELECT ... FOR UPDATE` on `showtime_seats`).
- Add a unique partial index or transactional lock around active holds.
- Expire both `showtime_seats.hold_expires_at` and `reservations.expires_at` via a scheduled job every minute; release the seat back to `available` on expiry.
- `POST /api/orders` converts the reservation only if it is still `active` — re-check under the lock, inside the same transaction as the wallet debit.
- Rate-limit holds per user to prevent hold-spam. (No anonymous holds — a hold always has a `hold_owner_id`.)
- **A pending top-up never freezes a hold.** If a top-up could extend or pause the TTL, anyone could lock a whole seat map for free by starting a top-up and never finishing it. The hold expires normally; only the seat is lost, never the money (D2).

## QR One-Time Check-In

- Store only a hash of the QR token.
- `POST /api/admin/checkins` must be idempotent.
- First valid scan changes `qr_status` from `unused` to `checked_in`.
- Later scans return `already_checked_in` with timestamp and staff id.
- Cancelled tickets (self-cancel or event cancellation) scan as `void`.

## Wallet & Top-up

Closed loop: money in via a validated VNPay IPN, out only as tickets, **no cash-out** (D2).

**Top-up flow**

1. `POST /api/wallet/topups` — validate `5,000 ≤ amount ≤ 10,000,000` **and** `balance + amount ≤ 20,000,000` **before** hand-off. Rejecting after the IPN would strand money that cannot be returned. (Application rule, not a `CHECK` — refunds are exempt from the ceiling.)
2. Insert `payment_transactions` (`status='initiated'`, unique `provider_txn_ref`), build the VNPay URL signed with `vnp_HashSecret` (HMAC-SHA512 over sorted params), return it.
3. Browser pays on the sandbox. The **return URL is display-only** and never writes (SEC-06); the frontend polls `GET /api/wallet/topups/:ref`.
4. IPN arrives server-to-server. Validate in order: signature → `97`; ref exists → `01`; amount matches → `04`; not already terminal → `02` (idempotent exit); `vnp_ResponseCode='00'` → else mark `failed`.
5. Credit in one transaction:

```sql
BEGIN;
  SELECT balance_amount FROM wallets WHERE id = $1 FOR UPDATE;

  UPDATE payment_transactions
     SET status = 'success', provider_txn_id = $2, raw_payload = $3
   WHERE provider_txn_ref = $4 AND status = 'initiated';   -- 0 rows ⇒ replay, ROLLBACK

  UPDATE wallets SET balance_amount = balance_amount + $5, updated_at = now() WHERE id = $1;

  INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, payment_transaction_id)
  VALUES ($1, 'topup', $5, $6, $7);
COMMIT;
```

6. Reply `{"RspCode":"00","Message":"Confirm Success"}` — VNPay retries otherwise, which is why step 5 must be idempotent.
7. If `reservation_id` was carried, send the attendee back to `/checkout/:reservationId`. If the hold expired meanwhile, say so plainly — the seats are gone, the money is not.

**Purchase** — one local transaction, no external system: lock the wallet row `FOR UPDATE`, re-check the reservation is `active` and the seats still held, `422 insufficient_balance` (with shortfall) on a short balance, else insert the `paid` order, debit, write the `purchase` ledger row, flip seats to `sold`, issue tickets with their `refundable_amount` allocation.

**Operational notes**

- VNPay **cannot reach `localhost`** — the IPN is server-to-server. Deploy the backend (Render) or tunnel (`ngrok` / `cloudflared`). Add a dev-only simulated-IPN endpoint, guarded by `NODE_ENV !== 'production'`, so the team can work on wallet logic without a tunnel.
- Reconciliation sweep: for `status='initiated'` rows older than ~15 min, call VNPay `querydr` and settle. Until then the attendee sees **Pending**, not lost money.

**Invariants** (assert these in CI — they are the point of the ledger)

```sql
-- per wallet: the ledger fully explains the cached balance
SUM(wallet_transactions.amount) WHERE wallet_id = W  =  wallets.balance_amount

-- platform-wide: no code path creates money
SUM(topup) - SUM(purchase) + SUM(refund)  =  SUM(all wallet balances)
-- and every topup row joins 1:1 to payment_transactions WHERE status='success'
```

## Cancellation & Refund

Refunds go to the **wallet**, per **ticket**, **once only** — rationale in [D3](#d3--refunds-go-to-the-wallet-per-ticket-once-with-a-t-24h-self-cancel-cutoff).

| Trigger | Cutoff | Amount | Seat |
|---|---|---|---|
| **Self-cancel (UC-16)**, ≥ 24h before showtime | applies | `tickets.refundable_amount`; service fee **kept** | released → `available`, waitlist notified |
| **Self-cancel**, < 24h before showtime | — | **action not offered** | stays `sold`; a no-show leaves it empty |
| **Event cancellation (UC-25/UC-34)** | ignored | **100%, service fee included** | released; orders → `cancelled`; buyers emailed + notified (`event_changed`) |

- The cutoff is an **inventory freeze**, not only a money rule: it prices out costless optionality (hold a ticket, watch it sell out, dump it at T-1h).
- Event cancellation is permitted only for showtimes that have **not started**; a multi-showtime event refunds future showtimes only. This makes a `checked_in` ticket inside a refund set unreachable by construction.
- Bulk refund runs **one transaction per ticket**, not one for the whole event — locking hundreds of wallet rows at once deadlocks against live purchases. `uq_wallet_txn_refund_per_ticket` makes the job resumable: a rerun skips what is done.
- Refund state is **derived, never stored**. `orders.payment_status` stays `paid`; read `tickets.qr_status` + `wallet_transactions` for what happened after. Net revenue must read the ledger anyway.
- Refund amount comes from the stored `refundable_amount` and is never recomputed. Refunding face price on a voucher-discounted order **mints money** — 4 × 200,000₫ tickets bought for 620,000₫ after a 200,000₫ voucher would refund 800,000₫.

## Money

- All money is stored as **integer VND đồng** in `*_amount` columns. No minor-unit (`*_cents`) columns and no `currency` column — single-currency (VND), single gateway (VNPay) — rationale in [D1](#d1--money-is-integer-vnd-đồng).
- Discount allocation across tickets is `floor()` per ticket with the **remainder on the first ticket**, so `SUM(refundable_amount) = subtotal_amount - discount_amount` holds *exactly*. Never spread the remainder evenly — it breaks the invariant.
- Organizers have **no wallet**. Sale proceeds are reported by `GET /api/admin/reports/revenue` and settled with them off-platform.

## Reviews (Rating vs Comment)

- **Rating** = one 1–5 star score per attendee per event (`ratings`, `UNIQUE(user_id, event_id)`); the only input to `events.rating` / `events.review_count`.
- **Comment** = unlimited free-text posts per attendee (`comments`); does not affect the aggregate.
- Both require a `checked_in` ticket for that event (attendance gate, app-enforced).

## Notification & Email Retry

- `notifications.channel` supports `in_app` and `email` (no SMS in scope).
- Store delivery attempts in `notification_logs`.
- Resend endpoint should rate-limit by order and user.
- Email content should include event, seat, venue, QR, refund policy, support link.
- `type` covers the in-scope flows: `order_confirmed`, `reminder_24h`, `event_changed`, `waitlist_open`.

## Waitlist

- Per **showtime + ticket tier** (`ticket_tier_id` NULL = any tier); one row per `(user, showtime, tier)`.
- Each list holds **at most 10 entries**; reject the join once the tier's list is at 10.
- Inventory now frees from **two** sources, not three: self-cancel (only until T-24h — after that inventory is frozen, D3) and hold-TTL expiry. The payment-window timeout is gone entirely, since wallet purchases are atomic and no seat waits on a callback (D2). Waitlist notifications therefore go quiet in the final 24 hours.
- When inventory frees, notify the earliest-joined waiters by `joined_at` — the first **5** if the list holds more than 5, otherwise all of them — with a `waitlist_open` notification; **no seat is reserved** — they race to buy.
- `status`: `waiting → notified → converted` (bought) or `expired` (showtime started). `notified` is not terminal: a waiter who loses the race stays eligible and keeps `joined_at` priority at the next release, so order by `joined_at` regardless of status. `notified_at` records the most recent notification, not a one-shot burn.

## SEO

Each event should have:

- Stable slug.
- Server-rendered title and description.
- Open Graph image.
- JSON-LD `Event` schema with `startDate`, `location`, `offers`, and availability.
- Canonical URL.
