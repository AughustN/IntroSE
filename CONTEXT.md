# TixHub

Event-ticket-sales marketplace for the Vietnamese market. This glossary pins the project-specific
language so the five-person team and the FE/BE contract use one word per concept (Constitution
Principle VI).

## Language

### Identity & roles

**Nickname**:
The display handle a user chooses and the UI shows (e.g. "Anh"). Not a legal name. The single
canonical name for this field from the database column through the API to the UI.
_Avoid_: full name, display name, username, `full_name`.

**Attendee**:
The base capability **every** account has — discover events, hold seats, pay, own tickets. Not a stored
role; it is what an account can do before any elevation.
_Avoid_: user, customer, buyer, member.

**Organizer**:
A *derived* capability: an account that has an Organizer Application with status `approved`. There is no
organizer role column — organizer-ness is recomputed per request from the application.
_Avoid_: role, seller, host, vendor.

**Admin**:
A boolean flag (`is_admin`) on an account, not a role column. The only stored privilege.
_Avoid_: superuser, moderator (moderation is an admin action, not a separate role).

**Organizer Application**:
An account's request to become an Organizer, carrying a status (`pending` / `approved` / `rejected` /
`suspended`) and its review history. An account may accumulate several over time; at most one is *live*.
_Avoid_: organizer request, organizer profile.

### Sessions

**Session**:
A revocable, server-stored proof that a browser acts as an account — realised as a **refresh-token
family** (all tokens descended from one login = one device). Revocable by design: logout, logout-all,
suspend, password-change, and reset all end it. Distinct from the short-lived access token, which only
proves identity for a request.
_Avoid_: JWT session, login token, self-contained session.

**Access token**:
The short-lived credential (JWT, in memory) that proves *identity* on a single request. It is never
trusted for authorization *state* — status and session liveness are read live per request.
_Avoid_: bearer session, auth token (ambiguous).

**Refresh token**:
The long-lived, rotating, httpOnly-cookie credential that mints new access tokens. One row per issued
token, hashed at rest; presenting a superseded one is reuse and kills its family.
_Avoid_: remember-me token, persistent token.

**Auth event**:
An immutable record of a security-relevant account action (login success/failure, logout, reuse
detected, reset requested…). Its identifier is stored hashed and its account may be unknown. Distinct
from the **audit log**, which records privileged admin actions and always has a known actor.
_Avoid_: audit entry, security log (for auth events); activity log.
