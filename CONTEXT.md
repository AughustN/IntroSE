# TixHub

Event-ticket-sales marketplace for the Vietnamese market. This glossary pins the project-specific
language so the five-person team and the FE/BE contract use one word per concept (Constitution
Principle VI).

## Language

### Identity & roles

**Account**:
The single registered identity a person signs in as — the thing Attendee/Organizer/Admin are
capabilities *of*. One account, one set of credentials, one wallet. The table backing it is named
`users` for historical reasons; the word "user" is not the domain term and should not spread from the
schema into prose, API shapes, or UI copy.
_Avoid_: user, profile (a profile is the editable subset of an account).

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

### Events & catalog

**Event**:
A happening a visitor can attend, owned by one Organizer. Carries a stable **slug**, details, ticket
tiers, and one or more Showtimes. General-admission or seated. Public only when both on sale and
admin-approved.
_Avoid_: show, listing, MovieEvent (the old mock type — rename to Event).

**On sale**:
The organizer-facing lifecycle state (`status`) meaning the event is published and open. One of
`draft → on_sale → finished / cancelled`. Being on sale is necessary but **not sufficient** for public
visibility — it must also be approved.
_Avoid_: live, active, published (say "on sale").

**Moderation status**:
The admin-facing state (`moderation_status`), separate from the on-sale lifecycle: `pending_review`
(submitted, not yet visible to buyers), `approved` (visible if on sale — the single positive gate),
`flagged` (pulled, needs re-review), `removed` (taken down, kept for the organizer). Pre-publish
moderation: only `approved` is public.
_Avoid_: verified, status (ambiguous with the on-sale lifecycle).

**Showtime**:
A dated instance of an Event at a Venue with a start time and inventory. An event may have several.
_Avoid_: session (that's the auth term), screening, occurrence.

**Ticket tier**:
A price class within a Showtime (label + whole-đồng price; for general admission, a capacity with
sold/reserved counts). A tier is **active** or **archived**. Archiving is what happens instead of
deleting once a tier has sold anything: it becomes unpurchasable and disappears from buyer-facing
reads, but stays resolvable so existing orders and tickets still show their label and price. Archived
tiers do **not** count toward the active-tier limit (default **20 per Showtime**, configured by
`MAX_TIERS_PER_SHOWTIME`). They can be restored while a slot is available; creation, additions and
restores share this limit. On the wire the API says `held` where the column says `reserved_quantity`; same
number, buyer-facing name.
_Avoid_: ticket type, price band, category (that's the event classification); "deleted tier" (say
archived).

**Món bán kèm (Concession item)**:
What an Organizer sells alongside tickets — bắp rang bơ, nước suối — as one menu per Event,
offered on every public Showtime of it. Carries a label and a whole-đồng price; is **listed** or
**stopped**. Unlimited stock by design: there is no sold/held counter because nothing can sell out.
Stopped is the archived-but-resolvable move (same shape as a tier): hidden from buyers immediately,
kept forever so paid lines still show what they bought. Distinct from a **Ticket tier**: a tier is
a price class of seats/quantity within ONE Showtime with finite inventory; a concession item is
event-scoped, stockless, and never occupies a tier slot. Editing label or price reaches only future
purchases — paid lines are snapshots; an item any cart or order references can be stopped but never
deleted.
_Avoid_: snack (say món bán kèm in prose), add-on service, combo, product.

**Concession voucher**:
The ONE scannable proof per paid order that carries concessions — minted inside checkout when at
least one line was bought, UNIQUE per order. One scan at the Organizer's counter hands over every
line of the order; a rescan answers `already` and changes nothing. **Unredeemed**, **redeemed**, or
**void** — void means the order was refunded (self-cancelled or event cancelled), and a voided
voucher must never hand over snacks again. Its code/hash pair mirrors the ticket QR's, but it is
not a ticket: it admits nobody through a door, only feeds someone at a counter.
_Avoid__: meal ticket, coupon (a coupon discounts; a voucher redeems), F&B order (the order is the
payment record; the voucher is its claim check).

**Venue / Layout / Seat / Showtime seat**:
**Venue** = a reusable physical place (name, city, address). A **Layout** is one named arrangement of
that venue ("Nhạc hội đứng", "Kịch có ghế ngồi"); a venue owns several, which is how one place hosts
differently-shaped events without being duplicated. **Seats** (row, number, type, position, rotation)
belong to a Layout, and are **unique within their Section**, not within the venue — so two sections may
both hold a "row A seat 1". A **Showtime seat** is one bookable instance of a physical seat for a seated
Showtime, carrying a tier and a status (available / held / sold / blocked). A seated Showtime picks one
Layout and **snapshots** it when generating its Showtime seats: from then on the Showtime owns its map,
and a later Layout edit reaches it only through an explicit re-apply.
_Avoid_: room/hall (say Venue); slot (say Showtime seat); floor plan (that's the optional background
image, which never owns geometry — say Layout).

**Sold out**:
A derived state — an Event/Showtime is sold out because its inventory (seats or tier quantities) is
exhausted. Never a stored flag on the event.
_Avoid_: unavailable (broader), full.
