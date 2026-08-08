# Quickstart: Admin Catalog Settings

## Prerequisites

- PostgreSQL is reachable through `DATABASE_URL`.
- Required environment variables exist: `DATABASE_URL`, `JWT_SECRET`, `AUTH_EVENT_HASH_KEY`.
- Dependencies are installed.
- An Admin account and at least one non-Admin account exist.
- Existing catalog seed contains at least one unused category, one category assigned to an event, and one publicly visible event.

## Apply schema

From repository root:

```powershell
npm run db:migrate
```

Expected: migration for `system_settings` and `featured_events` completes without changing existing catalog rows.

## Run validation

Start server and web app in separate terminals:

```powershell
npm run dev:server
npm run dev:web
```

Run automated tests:

```powershell
npm test -- --run
npm run typecheck
```

## REST scenarios

Use an authenticated Admin browser session or test fixture against `/api/admin`.

1. `GET /api/admin/categories` returns seeded categories.
2. `POST /api/admin/categories` with a unique `labelVi` returns `201`; repeat same normalized name returns conflict.
3. `PUT /api/admin/categories/{id}` renames unused category; public `GET /api/events?category={code}` remains valid.
4. `DELETE /api/admin/categories/{id}` succeeds for unused category and returns conflict for category referenced by events.
5. `GET /api/admin/homepage/featured` returns entries ordered by `displayOrder`.
6. `PUT /api/admin/homepage/featured` with duplicate, negative, or unavailable event data returns validation/conflict and leaves prior list unchanged.
7. `PUT /api/admin/homepage/featured` with valid entries changes homepage result on the next public request.
8. `GET /api/admin/settings` returns defaults when no overrides exist.
9. `PUT /api/admin/settings` with valid values returns new effective settings; out-of-range or cross-field-invalid values return validation error and preserve all old values.
10. Successful settings update creates one append-only `audit_logs` row containing actor, changed fields, before values, after values, and timestamp.
11. Start a hold, update TTL/grace/ceiling, then verify active reservation timestamps and extension behavior stay captured; create a new hold and verify it uses new settings.
12. Repeat protected requests as Attendee or unauthenticated client; server denies access and makes no mutation.

## Frontend scenarios

Open Admin Console and verify:

- Tabs `Danh mục` and `Cấu hình` load current server state, not mock-only state.
- Category create/rename/delete displays field and conflict errors.
- Featured list supports membership and order editing, with deterministic order display.
- Settings form shows defaults/current values, bounds errors, atomic save feedback, and no partial updates.
- Successful changes are visible after refresh or on next browse/homepage request.

See [OpenAPI contract](contracts/admin-catalog-settings.openapi.yaml) and [data model](data-model.md) for payload and persistence details.
