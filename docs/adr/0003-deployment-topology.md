# Deployment topology: single VPS, Nginx reverse proxy, split-origin SPA behind Cloudflare

**Status**: accepted (2026-07-23) — feature 001-account-auth
**Amended**: 2026-08-05 — same-origin → split origin (`api.tixhub.fit`), Cloudflare added in front

## Context

The auth design depends on two things the deployment shape decides: how the httpOnly refresh cookie is
scoped (FR-016), and what counts as the "source" for the per-source throttle (D6 / FR-039). The team
hosts on a single self-managed **VPS** at `tixhub.fit`, not the free-tier PaaS named in the constitution
(Vercel + Render).

The original decision served the SPA and the API from **one origin**. As deployed they are **two
origins** on one registrable domain — `https://tixhub.fit` (static `dist/`) and `https://api.tixhub.fit`
(Express) — with **Cloudflare** proxying both. See the amendment below for what that changes.

## Decision

- **Topology**: one VPS — **Cloudflare** (edge TLS, WAF, DDoS) → **Nginx** (static SPA + reverse proxy)
  → **Express/Node** → **Neon Postgres**.
- **Refresh cookie**: first-party, `httpOnly; Secure; SameSite=Lax; Path=/`.
- **Client-IP trust**: Nginx **overwrites** the forwarded header
  (`proxy_set_header X-Forwarded-For $remote_addr;`), and Express sets `trust proxy = 1` (exactly one
  hop). The throttle keys on `req.ip` normalized to `/32` (IPv4) or `/64` (IPv6).
- **Single instance**: session state lives in Postgres (ADR 0001 Option A), so the design already
  survives a later scale-out to multiple Node workers behind Nginx with no change.

## Amendment (2026-08-05): split origin + Cloudflare

### Split origin does NOT require SameSite=None

The original consequences section claimed that moving the SPA to a separate origin would force
`SameSite=None` + credentialed CORS + CSRF tokens. **That is wrong for this split** and the cookie code
needs no change: `tixhub.fit` and `api.tixhub.fit` are cross-**origin** but same-**site** — SameSite is
evaluated on the registrable domain (eTLD+1), not the origin. `SameSite=Lax` in
`server/src/modules/auth/auth.routes.ts` keeps sending the refresh cookie across the subdomain
boundary, and still blocks the cross-site POST that Lax exists to block. The claim would only hold for a
genuinely cross-site host (a CDN on a different domain).

What the split **does** require, and what the code already does:

- **Explicit CORS.** No longer same-origin, so the API must answer the preflight and echo the allowed
  origin. `server/src/app.ts` does this against `config.corsOrigins`, and every browser call sends
  `credentials: "include"`.
- **`CORS_ORIGINS` must not contain `http://localhost:3000` in production.** The default in
  `server/src/config.ts` includes it for local development; a production `.env` that inherits the
  default leaves an http origin permanently allowed to make credentialed calls.
- **Absolute asset URLs.** `avatar_url` is stored root-relative (`/uploads/avatars/<uuid>.webp`, see
  `server/src/modules/auth/avatar.ts`); the SPA prefixes it with the API origin at render time
  (`apiAssetUrl` in `src/services/api.ts`). ADR 0004's `https://tixhub.fit/uploads/...` is superseded
  by `https://api.tixhub.fit/uploads/...`.
- **Nginx on `api.tixhub.fit` must proxy `/`, not just `/api/`.** `/uploads/` and `/socket.io/` are on
  that host too.

### Cloudflare makes it TWO hops — real_ip is mandatory

This ADR's `X-Forwarded-For $remote_addr` overwrite assumed **one** proxy hop. With Cloudflare in front
there are two, and at the origin `$remote_addr` is the **Cloudflare edge IP**, not the visitor. Passed
through unchanged, every visitor sharing a Cloudflare colo collapses into **one throttle bucket**
(`ipKey` in `server/src/modules/auth/throttle.ts`) — turning a per-source limit into a global one that a
single noisy user can exhaust for an entire region, and destroying the per-source property FR-039
depends on.

The fix is in Nginx, not the app: `real_ip_header CF-Connecting-IP` plus `set_real_ip_from <Cloudflare
ranges>` rewrites `$remote_addr` to the true visitor IP *before* `proxy_set_header` runs. The overwrite
above stays correct exactly as written and `trust proxy = 1` stays right, because Express still sees one
hop it trusts. `set_real_ip_from` is the load-bearing half: Nginx honours `CF-Connecting-IP` **only**
from those addresses, so a client hitting the origin IP directly cannot forge it.

**This makes the origin firewall part of the security model, not hardening.** If the VPS accepts
:80/:443 from anywhere, the origin IP is a direct route past Cloudflare's WAF, rate limiting, and DDoS
absorption.

### SSL mode: Flexible is deployed, Full (strict) is correct

Cloudflare's SSL mode is currently **Flexible** — TLS terminates at the edge and the Cloudflare→VPS leg
is **plaintext HTTP**. This is a real gap against SEC-01: on that leg, session cookies, passwords, and
access tokens travel in the clear. Anything with a view of the path between the edge and the origin sees
them. The upgrade is one Cloudflare Origin Certificate away and is documented in
`docs/deploy/nginx.conf`.

Two Flexible-specific footguns, both recorded because each is a silent outage or a silent security
downgrade:

- **`return 301 https://$host$request_uri` on port 80 causes an infinite redirect loop.** The request
  arriving from Cloudflare is `http://` at the origin, so the redirect bounces the browser back through
  the edge and hits the same 301 forever. Force HTTPS at the edge (SSL/TLS → Edge Certificates → Always
  Use HTTPS) instead, where the scheme is genuinely https.
- **`X-Forwarded-Proto` must come from Cloudflare's header, not `$scheme`.** `$scheme` is `http` at the
  origin under Flexible; forwarding it tells Express the request was insecure.

### `NODE_ENV=production` is load-bearing

`secure: config.isProd` in `auth.routes.ts` reads `NODE_ENV === "production"`
(`server/src/config.ts`). A production host that never sets it serves the refresh cookie **without the
`Secure` flag** — httpOnly, but transmittable over plaintext. Combined with Flexible mode's plaintext
origin leg, the cookie has no transport protection at all.

Related: `npm run dev:server` is `tsx watch` and is not a production process. It dies with the SSH
session, does not restart on crash, and holds file watches. Run the API under systemd or pm2 with
`WorkingDirectory` set to the repo root — `uploads/` is resolved from `process.cwd()`
(`server/src/app.ts`), so a wrong working directory silently loses every avatar.

## Consequences

- **Security ownership shifts to the team.** Reverse-proxy hardening, OS patching, firewall, the
  Cloudflare origin firewall, and on-disk `.env` permissions (SEC-11, mode 600) are DevOps
  responsibilities. Edge TLS is Cloudflare's; **origin** TLS is still the team's and is currently absent.
- **Footgun recorded (client IP)**: using `$proxy_add_x_forwarded_for` (append) instead of
  `$remote_addr` (overwrite), or `trust proxy = true` (trust all hops), would let a client forge its
  source IP and bypass the throttle. Omitting `real_ip` under Cloudflare breaks the throttle a different
  way — not by forgery but by collapsing all visitors into one bucket.
- **Governance**: swapping the constitution's *Hosting: Vercel/Render/Neon* row for a VPS is a change to
  a listed technology → folded into the single pending amendment vote (alongside the Google + Resend
  integration-cap breach), not a separate PR. Cloudflare is edge infrastructure for a host the team
  already runs, not an application integration, so it does not touch the two-integration cap.
- **Outstanding**: Cloudflare SSL mode is Flexible (origin leg unencrypted, SEC-01) — upgrade to Full
  (strict) with an Origin Certificate.
