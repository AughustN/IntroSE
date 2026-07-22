# Feature Specification: Account & Authentication

**Feature Branch**: `001-account-auth`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Account & authentication for TixHub. Scope = UC-01 register membership (email, phone, nickname, password; bcrypt cost 12; email+phone uniqueness; rate limit), UC-02 Google OAuth sign-in/registration (no password stored), UC-03 login by email or phone + password, UC-04 logout with session revocation, UC-05 password reset via emailed link, UC-06 manage profile (nickname, phone, avatar) and change password, UC-37 apply to become organizer (enters admin approval queue; not approved = cannot create/publish events). Roles: Attendee is the default; Admin is a flag; Organizer is derived from an approved application — no single role column."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an account and stay signed in (Priority: P1)

A visitor who wants to buy a ticket creates a TixHub account with their email, nickname, and a
password — optionally a phone number — then signs in with those credentials and stays recognised as
they move around the site and come back later.

**Why this priority**: Nothing else in TixHub works without an identity. Holding a seat, owning a
wallet, and owning a ticket all attach to an account. This is the smallest slice that produces a
signed-in attendee.

**Independent Test**: Register a new account through the registration form, reload the page, and
confirm the same person is still recognised; then sign in again in a fresh browser with the same
credentials. Requires no other story — in particular it does **not** require sign-out, which is
User Story 2.

**Acceptance Scenarios**:

1. **Given** a visitor who is not signed in, **When** they submit a valid email, nickname, and
   matching password pair — with or without a phone number — **Then** an Attendee account is created
   with an empty wallet and they are signed in immediately, with no confirmation step.
2. **Given** an email that already belongs to an account, **When** a visitor tries to register with
   it, **Then** registration is refused with an "account already exists" message that offers a link
   to sign in, and no second account is created.
3. **Given** a registered account, **When** the person signs in with the correct password using
   **either** their email address **or** their phone number, **Then** they reach their authenticated
   area.
4. **Given** a registered account, **When** someone signs in with a wrong password, **Then** access
   is refused with a message that does not reveal whether the identifier exists.
5. **Given** two people submitting the same brand-new email at the same instant, **When** both
   requests are processed, **Then** exactly one account is created and the other is refused.
6. **Given** a signed-in user, **When** they reload the page or close and reopen the browser,
   **Then** they are still recognised without re-entering their password.

---

### User Story 2 - End a session deliberately (Priority: P1)

A signed-in user signs out. Their session stops working immediately, on that device and on any
other device they choose to end.

**Why this priority**: An account you cannot reliably leave is not a security boundary. This is what
makes a shared or lost device recoverable, and it is required before the product is exposed to real
users.

**Independent Test**: Sign in, sign out, then attempt to use the previous session — it must be
rejected. Sign in on two devices, sign out everywhere, and confirm both are rejected. Builds on the
signed-in state produced by User Story 1; adds nothing to how that state is established.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they sign out, **Then** the session ends and any subsequent
   use of it is refused.
2. **Given** a user signed in on two devices, **When** they choose "sign out everywhere", **Then**
   both sessions stop working.
3. **Given** a session that ended, **When** it is replayed later, **Then** it is refused and the
   attempt is recorded.
4. **Given** a session credential that has already been rotated, **When** the superseded one is
   presented, **Then** it is refused and every remaining session for that account is ended, because
   a replayed credential means a copy is loose.

---

### User Story 3 - Sign in with Google (Priority: P2)

A visitor signs in or registers using their existing Google account instead of creating a TixHub
password.

**Why this priority**: Removes the largest drop-off point in registration, but every journey it
serves is already reachable through User Story 1. Also gated on the integration-cap decision (see
Dependencies).

**Independent Test**: Complete a Google sign-in as a brand-new visitor and confirm an Attendee
account exists; repeat with the same Google account and confirm no duplicate is created.

**Acceptance Scenarios**:

1. **Given** a visitor with no TixHub account, **When** they complete Google sign-in, **Then** an
   Attendee account is created holding no password, and they are signed in.
2. **Given** an existing Google-created account, **When** the same person signs in again, **Then**
   they reach the same account and no duplicate is created.
3. **Given** an account registered with an email and password, **When** a Google sign-in presents
   that same email address, **Then** the sign-in is refused with an instruction to sign in with the
   password instead, and the two are never linked or merged.
4. **Given** an account created through Google, **When** someone registers with a password using
   that same email address, **Then** registration is refused with an instruction to use the Google
   button, and no second account is created.
5. **Given** a Google account with no TixHub password, **When** the person tries to sign in with a
   password, **Then** they are told this account uses Google sign-in.

---

### User Story 4 - Recover a forgotten password (Priority: P1)

A user who cannot remember their password requests a reset link by email and sets a new password.

**Why this priority**: This is the **only** way back into a password account. Email verification was
removed (D-B) and Google is never an alternate entrance to the same account (D-C), so nothing else
recovers one. Every account owns a wallet (FR-007) that money enters and never leaves as cash (schema
D2), so an unreachable account is lost money, not lost convenience. Losing user funds is a
Principle II failure, which outranks scope discipline — therefore this ships with the first release,
not after it. See D-D.

**Independent Test**: Request a reset for a known account, follow the emailed link, set a new
password, and sign in with it while confirming the old one no longer works.

**Acceptance Scenarios**:

1. **Given** a registered email, **When** a reset is requested, **Then** a single-use link is sent
   and the response does not reveal whether that email is registered.
2. **Given** an unregistered email, **When** a reset is requested, **Then** the response is
   indistinguishable from the registered case and no mail is sent to a TixHub account.
3. **Given** a valid reset link, **When** the user sets a new password, **Then** the password is
   replaced, every existing session for that account is ended, and the link cannot be reused.
4. **Given** a reset link older than its lifetime, **When** it is opened, **Then** it is refused and
   a fresh one can be requested.
5. **Given** repeated reset requests for the same account, **When** they exceed the allowed rate,
   **Then** further requests are throttled.

---

### User Story 5 - Manage profile and change password (Priority: P3)

A signed-in user updates their nickname, phone number, and avatar, and changes their password by
confirming the current one.

**Why this priority**: Improves a working account rather than enabling one. Everything here is
survivable in an MVP demo.

**Independent Test**: Sign in, change nickname/phone/avatar and confirm the changes persist across a
reload; change the password and confirm the old one stops working.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they change their nickname, phone, or avatar, **Then** the
   change persists and is visible on their next visit.
2. **Given** a signed-in user, **When** they change their password with the correct current
   password, **Then** the new password works and the old one does not.
3. **Given** a signed-in user, **When** they submit a wrong current password, **Then** the change is
   refused and the existing password still works.
4. **Given** a user signed in on two devices, **When** they change their password on one, **Then**
   the other device's session stops working and the device they used stays signed in.
5. **Given** a signed-in user, **When** they submit a profile field the account does not own (for
   example an admin flag or a wallet balance), **Then** the field is ignored and the account's
   privileges are unchanged.

---

### User Story 6 - Apply to become an organizer (Priority: P3)

A signed-in attendee submits organizer details and waits in the admin approval queue. Until
approved, they cannot create or publish events.

**Why this priority**: Needed before any organizer feature ships, but no organizer feature exists
yet. The value it delivers on its own is the pending queue an admin can act on.

**Independent Test**: Apply as an attendee, confirm the application appears as pending and the
account still cannot act as an organizer, then confirm approval flips that capability.

**Acceptance Scenarios**:

1. **Given** a signed-in attendee with no application, **When** they apply with a display name and
   description, **Then** a pending application exists and they are told it is under review.
2. **Given** an attendee with a pending application, **When** they apply again, **Then** the second
   application is refused and the first is untouched.
3. **Given** an attendee whose application was rejected, **When** they correct it and apply again,
   **Then** a new pending application exists and the rejected one is kept as history.
4. **Given** an organizer whose application is suspended, **When** they apply again, **Then** it is
   refused — a new application must never be a way out of a suspension.
5. **Given** a pending or rejected applicant, **When** they attempt an organizer-only action,
   **Then** it is refused.
6. **Given** an approved organizer, **When** they attempt an organizer-only action, **Then** it is
   allowed.
7. **Given** an organizer whose status is later set to suspended, **When** they attempt an
   organizer-only action, **Then** it is refused on the very next request without waiting for their
   session to expire.

---

### User Story 7 - Resist credential guessing (Priority: P3)

A burst of sign-in, registration, or reset attempts from one source is throttled. Repeated failures
against one account are slowed down progressively. **No sequence of failures ever locks the rightful
owner out.**

**Why this priority**: The account is usable without it; the platform is not safely public without
it. It is separable because it changes the response to abuse, not the shape of any success path.

**Independent Test**: Drive failed sign-ins from one source past the threshold and confirm the source
is throttled while the same account still signs in successfully from a different source.

**Acceptance Scenarios**:

1. **Given** a burst of sign-in attempts from one source, **When** the rate is exceeded, **Then**
   that source is throttled regardless of which accounts it targeted.
2. **Given** an account with repeated failed sign-ins, **When** the failures accumulate, **Then**
   each subsequent attempt is answered more slowly, **and** a correct password is still accepted at
   any point.
3. **Given** an attacker who deliberately fails on someone else's account many times, **When** the
   rightful owner signs in from their own device with the correct password, **Then** they are let in.
4. **Given** a burst of registration or reset requests from one source, **When** the rate is
   exceeded, **Then** the requests are throttled.
5. **Given** any of these refusals, **When** the response is compared with the ordinary
   wrong-password response, **Then** neither reveals whether the account exists — in particular, the
   throttle must not fire for existing accounts only.

---

### Edge Cases

- **Identifier casing and whitespace**: `Ha@Example.com ` and `ha@example.com` are the same account,
  at registration and at sign-in.
- **Timing disclosure**: a sign-in attempt against a non-existent identifier must take
  indistinguishable time from one against a real account with a wrong password. Otherwise the
  response time itself enumerates which emails are registered.
- **Suspended account signs in with the correct password**: the suspension notice appears only after
  the password is verified, so it cannot be used to probe which accounts exist.
- **Concurrent registration on one identifier**: two simultaneous submissions must produce exactly
  one account, decided by the data store, not by a check-then-write in application code.
- **Reset link used twice, or after the password already changed**: refused both times.
- **Reset link requested, then the user remembers the password and signs in normally**: the
  outstanding link stays valid until it expires or is used, unless the password changes first.
- **Google identity whose email later changes at Google**: the account is identified by the stable
  provider identifier, not by the email string.
- **Profile update submitting an email change**: out of scope for this feature (see Assumptions).
- **Organizer application from an account that is already an approved organizer**: refused.
- **Account with no password (Google-created) requests a password reset**: refused, with an
  instruction to sign in with Google. Setting a password here would be a back-door link between the
  two account types, which FR-045 forbids.
- **Sign-in identifier is ambiguous**: a submitted value is matched as an email address if it looks
  like one and as a phone number otherwise; it MUST NOT match across both kinds.
- **Registration submits a phone number already held by another account**: refused on the same terms
  as a duplicate email — no partial account, message offers a route to sign in.
- **Registration submits no phone number**: accepted; the account signs in by email only, and may
  add a phone later through profile editing (subject to the same uniqueness rule).

## Requirements *(mandatory)*

### Functional Requirements

**Registration**

- **FR-001**: System MUST let a visitor register with an email address, nickname, and password, with
  a phone number as an optional extra field, and MUST reject the submission when any supplied field
  fails its format rules.
- **FR-002**: System MUST require the password to be confirmed and MUST refuse a mismatch.
- **FR-003**: System MUST enforce a minimum password strength and state the rule when refusing.
- **FR-004**: System MUST guarantee that one email address identifies at most one account, and MUST
  hold that guarantee under simultaneous requests.
- **FR-005**: System MUST refuse a duplicate registration with a message that offers a route to sign
  in, and MUST NOT create a partial account.
- **FR-006**: System MUST store passwords only as a salted one-way hash, and MUST NEVER store or log
  a password in readable form.
- **FR-007**: System MUST create exactly one wallet, with a zero balance, at the moment an account is
  created, so that no later flow has to cope with a walletless account.
- **FR-008**: System MUST ignore any privilege-bearing field submitted at registration (for example
  an administrator flag or an organizer status); privileges are never client-supplied.
- **FR-009**: System MUST require an email address on every account, and MUST treat a phone number as
  optional. When a phone number is present it MUST identify at most one account, so that it can be
  used to sign in. Two accounts MUST NOT share a phone number; any number of accounts may leave it
  blank.

**Sign-in and sessions**

- **FR-010**: Users MUST be able to sign in with **either** their email address **or** their phone
  number, together with their password. A single sign-in field MUST accept both.
- **FR-011**: System MUST refuse an incorrect password with a message that does not distinguish
  "no such account" from "wrong password".
- **FR-012**: System MUST take indistinguishable time to refuse an unknown identifier and a known
  identifier with a wrong password.
- **FR-013**: System MUST check account suspension only **after** the identity is established — after
  the password is verified for a password account, and after the provider has confirmed the identity
  for a Google account — so that the suspension notice can never be used to probe which accounts
  exist.
- **FR-051**: Every account MUST carry a status of either active or suspended, defaulting to active
  at creation. A suspended account MUST be refused sign-in with a message stating that the account is
  suspended and how to appeal.
- **FR-052**: Suspension MUST take effect on the very next request of an existing session, not when
  that session expires, and MUST end the account's sessions. Suspending an account that is currently
  signed in MUST NOT leave it usable.
- **FR-053**: A suspended account MUST NOT be able to obtain a new session by any route — password,
  Google, or password reset — and a reset request for one MUST return the same response as any other
  reset request, disclosing nothing.
- **FR-014**: System MUST refuse a password sign-in on an account that has no password, and MUST say
  which sign-in method that account uses.
- **FR-015**: System MUST keep a signed-in user recognised across a page reload and a browser
  restart without asking for the password again.
- **FR-016**: System MUST make the credential that survives a browser restart unreadable to scripts
  running in the page, so that a single content-injection flaw cannot yield a lasting account
  takeover.
- **FR-017**: System MUST end a session on request, and MUST refuse every later use of it.
- **FR-018**: Users MUST be able to end all of their sessions at once.
- **FR-019**: System MUST detect and refuse the reuse of a session credential that has already been
  superseded, and MUST end that account's remaining sessions when it happens.

**Identity, roles, and access**

- **FR-020**: System MUST treat Attendee as the capability every account has, MUST store
  administrator as a flag, and MUST derive organizer status from an approved application rather than
  a role column.
- **FR-021**: System MUST decide organizer capability from the current stored application status on
  every request, so that a suspension takes effect immediately rather than when a session expires.
- **FR-022**: System MUST enforce every access rule on the server; hiding an action in the interface
  is never sufficient.
- **FR-023**: System MUST scope every request for personal data to the identity the server
  established, and MUST NEVER accept a user identifier supplied by the client to select whose data
  is returned.

**Google sign-in**

- **FR-024**: Visitors MUST be able to sign in or register with a Google account, and the system
  MUST store no password for such an account.
- **FR-025**: System MUST identify a Google-created account by the provider's stable identifier, not
  by the email address, so that an email change at the provider does not orphan the account.
- **FR-026**: System MUST verify the credential presented by the browser with the provider before
  trusting any identity claim in it.
- **FR-045**: System MUST NOT link a Google identity to an existing password account, or the
  reverse, under any circumstance. There is no account-merge path in this feature.
- **FR-046**: When a Google sign-in presents an email address that already belongs to a password
  account, the system MUST refuse and MUST tell the person, in plain language, that this address is
  registered with a password and to sign in that way.
- **FR-047**: When a registration submits an email address that already belongs to a Google account,
  the system MUST refuse and MUST tell the person that this address is registered with Google
  sign-in and to use that button.

**Password reset**

- **FR-027**: Users MUST be able to request a password reset by email address.
- **FR-028**: System MUST return the same response whether or not the address is registered.
- **FR-029**: System MUST make a reset link single-use and time-limited.
- **FR-030**: System MUST end every existing session for the account when its password changes by
  reset.
- **FR-031**: System MUST store reset links so that reading the stored form does not let anyone use
  them.
- **FR-032**: System MUST limit how often reset links can be requested for one account.

**Profile**

- **FR-033**: Users MUST be able to view and update their nickname, phone number, and avatar.
- **FR-034**: Users MUST be able to change their password by supplying the current one.
- **FR-057**: Changing a password while signed in MUST end **every other** session for that account
  while keeping the current one alive. People change a password precisely because they suspect
  someone else has access; leaving those sessions working defeats the reason they acted.
- **FR-035**: System MUST accept only the fields a profile update is allowed to change, and MUST
  ignore anything else in the submission.
- **FR-050**: System MUST apply the same uniqueness rule when a phone number is added or changed
  through profile editing as at registration, and MUST refuse the change when the number already
  belongs to another account — otherwise a sign-in identifier could be taken over after the fact.

**Organizer application**

- **FR-036**: Signed-in attendees MUST be able to apply to become an organizer by submitting a
  display name and description.
- **FR-037**: System MUST record each application's status as pending, approved, rejected, or
  suspended, and MUST allow at most one application per account that is currently pending or
  approved. Superseded applications are kept.
- **FR-058**: A rejected applicant MUST be able to apply again. Rejection is usually a fixable
  mistake — a missing description, a wrong display name — and a permanent bar would make an admin's
  mis-click irreversible.
- **FR-059**: A **suspended** organizer MUST NOT be able to apply again. Otherwise a new application
  is simply a way to escape a suspension.
- **FR-060**: System MUST retain every superseded application, so an admin reviewing a new one can
  see how many times this account has applied before and why it was refused. That history is the
  evidence the decision rests on.
- **FR-038**: System MUST refuse organizer-only actions for any account whose application is not
  currently approved.

**Abuse resistance and audit**

- **FR-039**: System MUST throttle sign-in, registration, and reset requests **per source**, counting
  attempts whether or not the identifier they name exists.
- **FR-040**: System MUST keep throttling responses indistinguishable with respect to whether an
  account exists. A throttle that can only trigger on a real account is itself a disclosure and MUST
  NOT be used.
- **FR-048**: System MUST slow its response progressively as failures accumulate against one
  identifier, and MUST NEVER refuse a correct password because of earlier failures. There is no
  account lockout state: a third party who knows an email address MUST NOT be able to deny its owner
  access. See D-E.
- **FR-049**: System MUST apply the same progressive delay to an identifier that does not exist as to
  one that does, so the delay curve cannot be used to enumerate accounts.
- **FR-041**: System MUST record authentication events — sign-in success and failure, sign-out,
  password change, reset request and completion, organizer application — with enough detail to
  investigate an incident, and without recording credentials.
- **FR-054**: System MUST be able to record a failed sign-in for an identifier that matches **no**
  account, since a run of those is the primary signal that someone is enumerating the user base.
  These records therefore cannot require a known account to exist.
- **FR-055**: System MUST store the attempted identifier in a form that cannot be read back as an
  email address or phone number, while still letting repeated attempts on the same identifier be
  grouped. A failed attempt names a person who may never have agreed to anything with TixHub, and the
  log must not become a list of real addresses.
- **FR-056**: Authentication records MUST be kept separate from the administrative audit trail. The
  two differ in volume, in retention, and in whether an actor is known at all; mixing them degrades
  the audit trail that privileged actions depend on.
- **FR-042**: System MUST validate every submitted field against a strict schema before use.

**Account creation without verification**

- **FR-043**: System MUST sign a new account in immediately on successful registration. Confirming
  ownership of the email address is NOT required, and no action — holding a seat, topping up, buying
  a ticket — is gated on it. This resolves UC-01 step 7 in favour of "signs the guest in".
- **FR-044**: Because no address is proven, the system MUST NEVER treat a matching email address as
  evidence that two identities are the same person. Specifically, an account created with a password
  and an account created through Google are always separate accounts, even with identical email
  addresses (see FR-045).

### Key Entities

- **User Account**: a person's identity on TixHub. Holds email, phone, nickname, avatar, a status
  (active or suspended), an optional password credential, an optional external-provider identity, and
  an administrator flag. One account owns exactly one wallet. Status is read on every request, not
  captured into the session, so a suspension bites immediately.
- **Session**: proof that a browser is acting as a given account. Stored rather than self-contained,
  because every session requirement here is a revocation requirement. It is replaced on each renewal,
  and all renewals descending from one sign-in belong to one chain, so presenting a superseded one
  proves a copy is circulating. Records where and when it was issued, and why it ended.
- **Password Reset Request**: a single-use, time-limited, unguessable permission to set a new
  password on one account, stored so the stored form cannot be used.
- **Organizer Application**: an account's request for organizer capability, holding display name,
  description, logo, status (pending / approved / rejected / suspended), a review note explaining a
  refusal, and who decided it and when. Its presence with approved status *is* the organizer role. An
  account may accumulate several over time — only one may be live (pending, approved, or suspended)
  at once, and the rest are retained as review history.
- **Authentication Event**: an immutable record of a security-relevant account action — what
  happened, from which source, when, and against which account **if one was identified at all**. The
  account may be unknown, because a failed attempt on a non-existent identifier is exactly the event
  worth keeping. The identifier is stored in an unreadable but groupable form (FR-055). Distinct from
  the administrative audit trail, which always has a known actor and a target.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new visitor can complete registration and reach a signed-in state in under 2
  minutes, in no more than 5 interactions.
- **SC-002**: A returning user can sign in within 3 interactions.
- **SC-003**: 95% of sign-in and registration attempts return a result within 3 seconds under
  ordinary load.
- **SC-004**: A returning visitor is recognised without re-entering a password for at least 7 days
  of ordinary use.
- **SC-005**: Signing out makes the previous session unusable within 1 second, verified by an
  immediate replay attempt.
- **SC-006**: The measured response times for "unknown account" and "known account, wrong password"
  are statistically indistinguishable across 100 samples, so that response time discloses nothing
  about which addresses are registered.
- **SC-007**: 100 simultaneous registrations on one email address produce exactly 1 account.
- **SC-008**: An organizer suspension takes effect on the next request, with no sign-out required.
- **SC-009**: A single source attempting 100 sign-ins per minute is throttled, while the rightful
  owner of a targeted account signs in successfully from another source during the same window.
- **SC-013**: No sequence of failed attempts by a third party prevents an account owner from signing
  in with the correct password — verified by a test that fails 50 times against one identifier and
  then succeeds with the right password.
- **SC-010**: Every acceptance scenario above that describes a refusal has an automated test
  asserting the refusal, not only its happy-path counterpart.
- **SC-011**: A security scan of the finished feature reports zero high-severity findings.
- **SC-012**: No sequence of actions available to a user results in one account being reachable by
  both a password and a Google identity, verified by an automated test for each direction of the
  collision.

## Decisions Taken

Recorded here because each one closes a question the source documents left open, and later phases
must not silently reopen them.

- **D-A — Email is mandatory, phone is optional and unique.** Sign-in accepts either. An email
  address is the one identifier every account has, which is what keeps password reset (User Story 4)
  possible for everyone. Rejected: allowing phone-only accounts — they would have no recovery path
  short of an SMS provider, a fifth external integration.
- **D-B — No email verification.** Registration signs the person in at once; nothing is gated on
  proving the address. Rejected: gating seat holds or purchases, which would drag the mail provider
  into User Story 1 and inherit the unresolved integration-cap blocker for the P1 slice.
- **D-C — Google accounts and password accounts never link.** A colliding email address produces a
  refusal with instructions, in both directions, and there is no merge path at all. This follows
  directly from D-B: without a proven address, auto-linking would let anyone register a password
  account on someone else's email and inherit that person's account the moment they used Google.
  The refusal is the price of skipping verification, and it is the cheaper of the two.
- **D-D — Password reset ships with the first release (P1).** D-B and D-C together leave the reset
  link as the single way back into a password account, and FR-007 puts a wallet on every account. An
  account nobody can reach is money nobody can spend, and the schema has no cash-out path to return
  it. Rejected: keeping reset at P2 and shipping anyway — that trades user funds for schedule, which
  the constitution's own conflict-resolution order forbids (security and data integrity are never
  traded away). Accepted cost: the constitution amendment now gates the release rather than the
  second milestone.
- **D-E — No account lockout, ever.** Abuse is answered by throttling the **source** and by slowing
  responses per identifier, never by refusing a correct password. Rejected: the conventional
  "lock the account after N failures", for two independent reasons. It is a denial-of-service anyone
  can trigger against anyone whose email they know — and with D-D still gated on a team vote, a
  locked-out user may have no recovery path at all. It also leaks: a lockout can only fire on an
  account that exists, so watching *which* identifiers lock out enumerates the user base, defeating
  FR-011, FR-012, and FR-040. Accepted cost: a distributed attacker with many source addresses is
  slowed rather than stopped, which is the correct trade — the alternative punishes the victim.

**Reference schema is in sync.** `docs/Analysis_Design/SCHEMA_DATABASE.md` was updated on 2026-07-22
to match these decisions — they appear there as **D4** (email mandatory, unverified; phone optional
and unique) and **D5** (the two account kinds never merge). What changed:

| Was | Now | Because |
|---|---|---|
| `phone TEXT`, no constraint | `uq_users_phone` partial unique index on `phone WHERE phone IS NOT NULL` | FR-009 — phone is a sign-in identifier, but stays optional |
| `provider TEXT` nullable | `NOT NULL DEFAULT 'email'`, `CHECK (provider IN ('email','google'))` | FR-045 to FR-047 — it selects which refusal message is shown |
| nothing preventing a hybrid account | `CHECK users_credential_matches_provider` — a password hash XOR a provider subject id | FR-045 — makes a merged account unrepresentable, not merely discouraged |
| Google lookup unspecified | `uq_users_provider_subject` on `(provider, provider_user_id)` | FR-025 — identify by the provider's stable id, never by the email string |
| Auth endpoints listed as 4 bare paths | full contract with the refusal codes `email_registered_with_google`, `email_registered_with_password`, `account_uses_google` | FR-046, FR-047 — the refusals are the feature, so they belong in the contract |
| no account status column | `status NOT NULL DEFAULT 'active' CHECK IN ('active','suspended')` | FR-051 to FR-053 — suspension was referenced by the sign-in path but had nowhere to live |
| only `audit_logs`, whose `actor_user_id` is `NOT NULL` | new `auth_events` table — nullable `user_id`, hashed `identifier_hash`, `source_ip`, indexed for the throttle | FR-054 to FR-056 — a failed sign-in on an unknown identifier had no representable row, and it is the most useful row there is |
| — | schema decision **D6** recording the no-lockout rule | D-E — so the absence of `failed_attempts` / `locked_until` reads as a decision, not an omission |
| `organizers.user_id` `UNIQUE` | `NOT NULL` + partial unique index on `user_id WHERE status IN ('pending','approved','suspended')`, plus a `review_note` column | FR-058 to FR-060 — `UNIQUE` silently made a single rejection a permanent bar; `suspended` stays inside the index so re-applying cannot shed a suspension |
| **no session storage at all** | new `refresh_tokens` table — hashed token, `family_id`, `parent_id`, `revoked_at` + `revoked_reason`, indexed for logout-all and family kill; recorded as schema decision **D7** | FR-017 to FR-019, FR-052, FR-057, SC-005 — six requirements demand revoking a session before it expires, which a self-contained token cannot do; `/api/auth/refresh` already promised a "family" that had nowhere to exist |

## Assumptions

- **Email change is out of scope.** Profile editing covers nickname, phone, and avatar. Changing the
  email address that identifies an account needs its own ownership-proof flow and is deferred.
- **Account deletion is out of scope.** An account holding a wallet balance and issued tickets cannot
  simply disappear; deletion and its money consequences are deferred.
- **Two-factor authentication is out of scope** for this submission.
- **Attendee suspension is in scope as a state, not as a screen.** This feature owns the account
  status, its effect on sign-in and on live sessions (FR-051 to FR-053), and the check ordering that
  keeps it from leaking. The administrative interface that *sets* the status belongs to the later
  admin feature; until it exists, the status is set directly in the data store for testing.
- **Vietnamese is the user-facing language** for all messages in this feature.
- **Phone numbers are Vietnamese-format** for validation purposes, and are normalised to one
  canonical form before the uniqueness check, so `0901234567` and `+84901234567` cannot become two
  accounts.
- **Session lifetime** is assumed to be a short-lived working credential refreshed from a longer-lived
  one, rather than a single long-lived credential, so that revocation is possible at all.
- **The avatar is supplied as a URL**, not an upload; file storage is out of scope.
- **One wallet per account is created at registration** and never by a later flow.

## Dependencies

- **Unresolved governance conflict — now on the critical path.** The constitution
  (`.specify/memory/constitution.md`, *Architecture & Coding Standards*) states: *"External
  integrations are limited to two: VNPay (payments) and Gemini (AI). Adding a third external
  dependency requires an amendment."* This feature requires **Google** (User Story 3) and a
  **transactional email provider** (User Story 4) — four in total. The amendment procedure requires
  team agreement, so this cannot be resolved inside this specification.

  Since User Story 4 is P1 (see D-D), the email provider is no longer a nice-to-have that can wait:
  **the amendment gates the first release.** It should be raised with the team before planning
  finishes, not discovered during implementation.

  | Story | Blocked? | Note |
  |---|---|---|
  | US1, US2, US5, US6, US7 | No | Buildable immediately; no external dependency |
  | **US4 — password reset (P1)** | **Yes — email provider** | Must be resolved before release, not after |
  | US3 — Google sign-in (P2) | Yes — Google | May land after release without stranding anyone |

  If the team rejects the email provider, the fallback is **not** to ship without recovery. It is to
  ship with wallet top-up disabled, so no account can hold money it cannot reach.
- **Reference documents**: `docs/Analysis_Design/Group02_UseCaseSpecification.md` (UC-01 to UC-06,
  UC-37) is authoritative for flows; `docs/Analysis_Design/SCHEMA_DATABASE.md` is authoritative for
  the users, wallets, and organizers structures and for the API contract shape.
- **Downstream consumers**: seat holds, wallet top-up, checkout, ticket ownership, and organizer
  event management all require the signed-in identity this feature establishes. In particular, the
  wallet in FR-007 is the account that later features debit.
