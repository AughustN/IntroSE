# Cloudinary media storage

**Status**: accepted (2026-08-20) — supersedes ADR-0004 for uploaded media

## Context

The application already routes avatar processing through the backend and uploads the normalized image to
Cloudinary. The previous avatar decision in ADR-0004 selected VPS-local disk storage, while feature
`012-cloudinary-media-upload` defines a server-mediated Cloudinary pipeline for avatars and other managed
media. Keeping both decisions active makes the storage contract ambiguous and makes redeploy persistence
and cleanup behavior impossible to specify consistently.

## Decision

- Cloudinary is the canonical managed storage for uploaded TixHub media in the scope of
  `012-cloudinary-media-upload`, including user avatars.
- Clients send media to backend endpoints. The backend is the trust boundary for authentication,
  authorization, size/type checks, magic-byte validation, sanitization, normalization, and Cloudinary
  credentials. Clients do not choose Cloudinary credentials or arbitrary public IDs.
- Raster avatars are normalized to WebP before upload. Entity identifiers provide deterministic asset
  ownership and replacement semantics; replacing an asset updates the database reference and removes the
  previous remote asset when it is no longer referenced.
- Google-provided profile pictures remain an external URL seed rather than a user-uploaded asset. They are
  not converted into a second upload path by this decision.
- Existing local assets must be inventoried and backfilled before local static serving is decommissioned.
  Migration completion, orphan cleanup, and every non-avatar media endpoint remain operational verification
  items; this ADR does not claim that all of them are already migrated.

## Consequences

- Avatar persistence no longer depends on a single VPS filesystem and uses the existing Cloudinary
  configuration and CDN delivery path.
- Upload and replacement behavior is centralized in backend media modules, which reduces duplicated file
  validation but makes Cloudinary availability part of media writes.
- A migration utility and reconciliation checks are required before removing legacy local files or static
  routes. Failed uploads must leave the owning database record unchanged.
- Feature specifications describe product behavior in terms of managed media storage; folder names,
  resource types, and provider API calls remain implementation details unless an operational contract needs
  them.

## Related records

- `docs/adr/0004-avatar-upload-vps-disk.md` — superseded storage decision
- `src/specs/001-account-auth/spec.md` — profile behavior
- `src/specs/012-cloudinary-media-upload/spec.md` — cross-cutting media pipeline
- `server/src/modules/auth/avatar.ts` — current avatar processing/upload implementation
