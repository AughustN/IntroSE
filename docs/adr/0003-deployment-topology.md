# Deployment topology: single VPS, Nginx reverse proxy, same-origin SPA

**Status**: accepted (2026-07-23) — feature 001-account-auth

## Context

The auth design depends on two things the deployment shape decides: how the httpOnly refresh cookie is
scoped (FR-016), and what counts as the "source" for the per-source throttle (D6 / FR-039). The team
hosts on a single self-managed **VPS** at `tixhub.fit`, not the free-tier PaaS named in the constitution
(Vercel + Render). The React SPA and the API are served from the **same origin**.

## Decision

- **Topology**: one VPS — **Nginx** (TLS termination + static SPA + reverse proxy) → **Express/Node** →
  **Neon Postgres**. The SPA (`dist/`) and the API (`/api`) share the origin `https://tixhub.fit`.
- **Refresh cookie**: first-party, `httpOnly; Secure; SameSite=Lax; Path=/`. Same-origin makes Lax
  correct with no CORS and minimal CSRF surface.
- **Client-IP trust**: Nginx **overwrites** the forwarded header
  (`proxy_set_header X-Forwarded-For $remote_addr;`), and Express sets `trust proxy = 1` (exactly one
  hop). The throttle keys on `req.ip` normalized to `/32` (IPv4) or `/64` (IPv6).
- **Single instance**: session state lives in Postgres (ADR 0001 Option A), so the design already
  survives a later scale-out to multiple Node workers behind Nginx with no change.

## Consequences

- **Security ownership shifts to the team.** TLS (SEC-01) is now the team's Let's Encrypt/Caddy setup,
  not a platform's; reverse-proxy hardening, OS patching, firewall, and on-disk `.env` permissions
  (SEC-11) are DevOps responsibilities.
- **Footgun recorded**: using `$proxy_add_x_forwarded_for` (append) instead of `$remote_addr`
  (overwrite), or `trust proxy = true` (trust all hops), would let a client forge its source IP and
  bypass the throttle. The overwrite + single-hop trust is deliberate.
- **Governance**: swapping the constitution's *Hosting: Vercel/Render/Neon* row for a VPS is a change to
  a listed technology → folded into the single pending amendment vote (alongside the Google + Resend
  integration-cap breach), not a separate PR.
- If the SPA were ever moved to a separate origin (CDN subdomain), the cookie policy would have to change
  to `SameSite=None` + credentialed CORS + CSRF tokens — explicitly out of the current plan.
