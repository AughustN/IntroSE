# Avatar images: user upload, stored on VPS disk, served by Nginx

**Status**: accepted (2026-07-23) — feature 001-account-auth

## Context

The spec assumed avatars are supplied as a URL, with file upload and storage out of scope — an
assumption made before the deployment shape was settled. The team now wants users to upload an avatar
image from their device, and the app runs on a single self-managed VPS (ADR 0003).

## Decision

- Users set their avatar by **uploading a file** via `POST /api/me/avatar` (multipart). Pasting an
  arbitrary avatar URL is removed — the only externally-sourced URL is the Google `picture` claim seeded
  at Google registration (a trusted CDN over https).
- **Storage = the VPS local disk**, served as static files by Nginx. Because the app is self-hosted this
  is just disk + a static route — **not** a new external integration, so it does not touch the
  two-integration cap. The stored `avatar_url` is `https://tixhub.fit/uploads/avatars/<uuid>.webp`.
- **Upload safety (mandatory)**: accept only raster `jpeg`/`png`/`webp`; **reject SVG** (embedded script
  → XSS on a same-origin host); verify the type by **magic bytes**, not `Content-Type`/extension; cap
  size at ~2 MB; **re-encode via `sharp`** to strip EXIF and any embedded payload; store under a
  random uuid name (never the user-supplied filename); serve with `X-Content-Type-Options: nosniff` from
  a directory Nginx never executes. Replacing an avatar deletes the previous file.

## Considered options (rejected)

- **URL paste only (original spec assumption)** — safest (no upload surface) but not the requested UX.
  Kept only for the trusted Google `picture` seed.
- **External object storage (S3 / Cloudinary)** — would be a third external integration (cap breach)
  and a cost/quota surface, for no benefit over local disk at this scale.
- **Bytes in Postgres (`bytea`)** — bloats the DB and its backups; wrong tool.

## Consequences

- New dependencies: `multer` (multipart) and `sharp` (decode/re-encode/strip).
- Ops: an `uploads/avatars` directory on the VPS, an Nginx static location, disk-usage awareness, and
  cleanup of orphaned files. Avatars are lost if the VPS disk is lost — acceptable (cosmetic, re-uploadable).
- Spec change: the "avatar is a URL, upload out of scope" assumption is superseded — flagged for
  `/speckit-clarify` (plan.md → Upstream follow-ups).
