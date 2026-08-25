# Quickstart & Validation: Event Catalog & Discovery

Runnable validation for feature 002. Proves the catalog works end-to-end. Details live in
[data-model.md](./data-model.md) and [contracts/catalog.openapi.yaml](./contracts/catalog.openapi.yaml);
this is the run/verify guide.

## Prerequisites

- **Feature 001 (auth) running** — provides identity, the approved-organizer capability, and the admin
  flag this feature authorizes against. The same `server/` app and Neon DB.
- Migration **`0002_catalog.sql`** applied (creates the 8 catalog tables + `venues.created_by`; seeds
  `event_categories`).
- Test fixtures: one **approved organizer** account, one **admin** account, one **second organizer**
  (for cross-organizer tests). Organizer approval / admin flag are set via feature 001 (status in DB in
  test, as there is no admin UI for those yet).

## Setup

```bash
npm run db:migrate            # applies 0001_auth.sql then 0002_catalog.sql
npm run dev:server            # API :4000 (public + organizer + admin catalog routes)
npm run dev:web               # SPA :3000 — browse/detail now read the real catalog, not src/data.ts
```

## Validate by user story

### US1 — Browse & search (P1)
1. `GET /api/events` as a guest → only public events (on sale + approved + organizer approved); a draft
   or pending event never appears. **(FR-001/029, SC-004)**
2. Filter by `category`, `city`, `minPrice`/`maxPrice`, `date` → results match **all** filters; keyword
   `q` ranks title matches above lineup above description. **(FR-002/003)**
3. Sell out every showtime of an event → it still appears, labelled sold-out, sorted last; `availability=available` hides it. **(FR-004, SC-005)**

### US2 — Event detail (P1)
1. `GET /api/events/:slug` → title, description, tiers with **VND-integer** prices, venue guide, refund
   policy, upcoming showtimes, related events. **(FR-006/007/008, SC-003/009)**
2. Unknown/undisclosed slug → `404` (drafts/removed never leaked). **(FR-009, SC-004)**

### US3 — Showtimes & seat map (P1)
1. `GET /api/events/:id/showtimes` → upcoming only; past/cancelled excluded. **(FR-007/013)**
2. `GET /api/showtimes/:id/seat-map` as a guest → seated: each seat row/number/tier/status; GA: tier
   remaining. No hold can be created here. **(FR-010/011/012)**

### US4 — Organizer create & publish (P2)
1. Approved organizer `POST /api/organizer/events` → draft, owned, slug generated, **not public**. **(FR-014/016)**
2. `POST /…/publish` → `on_sale` + `pending_review`; still **not visible to buyers**. **(FR-017/030)**
3. Non-organizer create → `403`; organizer B editing organizer A's event → `403`. **(FR-018, SC-007)**
4. Edit title → slug unchanged. **(FR-031, SC-010)**; fractional price → `400`. **(FR-019, SC-009)**

### US5 — Venues & seat maps (P2)
1. `POST /api/organizer/venues` → venue owned by caller (`created_by`); another organizer can't edit it. **(FR-020, D-F)**
2. Add sections/seats; `POST /api/organizer/showtimes/:id/seat-map` → one `showtime_seat` per physical
   seat, all available, tier-assigned; regenerating over a live map → `409`. **(FR-022/024, R-7)**

### US6 — Admin moderation (P2, on the critical path)
1. `GET /api/admin/moderation` (admin) → the pending review queue; non-admin → `403`. **(FR-027)**
2. `POST /api/admin/events/:id/approve` → event now appears in the public catalog on the next request;
   an `audit_logs` row is written. **(FR-025/029, SC-006/008)**
3. Reject / flag / remove → event never public / pulled next request; organizer still sees it with the
   reason. **(US6-2..4)**
4. **Suspend the organizer** (feature 001) → all their approved events disappear from public reads next
   request; un-suspend restores them. **(FR-033, D-E)**

### US7 — SEO (P3)
1. Event detail exposes SEO title/description, preview image, and JSON-LD event data; slug is the
   canonical URL and is stable across title edits. **(FR-031/032)**

## Automated test gate

```bash
npm run test        # server/tests/catalog/** — visibility-leak (SC-004), cross-organizer (SC-007),
                    # sold-out derivation (SC-005), moderation transitions, VND-integer refusal (SC-009)
npm run typecheck && npm run lint
```

Note: the ≥60% coverage gate stays on the later money/seat modules (holds/orders); the catalog is
verified by targeted denial + derivation tests, not a blanket coverage threshold.
