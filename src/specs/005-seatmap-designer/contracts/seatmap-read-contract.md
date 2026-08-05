# The buyer seat-map read contract (diff)

Constitution Principle VI: the shape below is defined **once** in `shared/catalog/types.ts` and imported
by the server (`server/src/modules/catalog/catalog.repo.ts`) and by **both** renderers. All three move in
the same change — no side re-declares it (FR-044, SC-014).

## `shared/catalog/types.ts` — after

```ts
export interface SeatMapSeat {
  id: number;
  row: string;
  number: number;
  tier: string;
  price: number;          // whole VND
  status: SeatStatus;
  // --- added by 005 ---
  x: number;              // 0–10000, layout units
  y: number;              // 0–10000
  rotation: number;       // 0–359, cosmetic only
  section: string | null; // for the accessible label and the tab order (FR-039a)
}

export interface SeatMapElement {   // new — non-sellable decoration, never inventory (FR-017)
  kind: 'stage' | 'aisle' | 'door' | 'bar' | 'label';
  x: number; y: number; width: number; height: number; rotation: number;
  label: string | null;             // rendered as text, never markup (FR-018)
}

export interface SeatMapFloorPlan { // new — background layer only (FR-020)
  url: string;
  scale: number; offsetX: number; offsetY: number; opacity: number;
}

export interface SeatMap {
  eventType: EventType;
  seats?: SeatMapSeat[];            // seated
  tiers?: Tier[];                   // general admission
  // --- added by 005, seated only ---
  space?: { width: number; height: number; seatDiameter: number };
  elements?: SeatMapElement[];
  floorPlan?: SeatMapFloorPlan | null;  // present ONLY when the organizer made it buyer-visible (FR-026)
}
```

## What each consumer must do in the same change

| Consumer | Change |
|---|---|
| `server/src/modules/catalog/catalog.repo.ts` → `getSeatMap` | select `ss.pos_x, ss.pos_y, ss.rotation` and the section name from the existing `showtime_seats`/`seats` join (no new join — geometry lives on the row already read, R-2); read `elements` and the background from `showtimes.layout_snapshot`; **omit `floorPlan` entirely when `visibleToBuyers` is false** |
| `src/components/SeatMapView.tsx` | drop the `byRow` grouping and the flex rows; render through the shared `SeatCanvas` |
| `src/components/SeatLayout.tsx` | same, plus zoom/pan; the hold click path is untouched |

## Ordering guarantee

`getSeatMap` must return seats ordered **section → row → number**. That ordering is the buyer map's tab
order (FR-039a), so it is part of the contract, not an implementation detail of either renderer.

## GA is unchanged

A general-admission showtime returns `eventType: 'general_admission'` with `tiers` and none of the new
fields. This feature adds nothing to the GA path (US2 scenario 5).

---

## `shared/holds/types.ts` — one additive change

Feature 003's live payload stays layout-independent (FR-041, SC-012). Confirmed against
`shared/holds/types.ts:67` and `server/src/realtime/io.ts`:

```ts
export interface SeatUpdate {
  showtimeId: number;
  seats?: {
    showtimeSeatId: number;
    status: SeatStatus;
    tier?: string;    // added by 005 — present ONLY when an organizer retiers a live seat (FR-035)
    price?: number;   // whole VND; always accompanies `tier`
  }[];
  tier?: { ticketTierId: number; remaining: number | null };
}
```

Geometry is static for the life of a showtime's map, so it belongs to the once-per-page map read, not to
a broadcast that fires on every hold. **No geometry field may be added here.** A client receiving a
`seat:update` already knows where the seat is; it changes only the seat's colour.

The organizer's block/unblock and marquee tier assignment (FR-035) broadcast through this same payload:
`status` for a block or unblock, and the optional `tier`/`price` pair for a retier. Both fields are
optional and only ever set by an organizer action, so a feature 003 client that ignores them behaves
exactly as it does today — which is why this addition does not breach FR-041 and why
`server/tests/holds/**` must still pass unmodified (SC-012).

---

## Contract removed

`POST /api/organizer/showtimes/:id/seat-map` no longer returns `409 seat_map_exists`
(`server/src/modules/catalog/organizer.routes.ts:233`). Consumers move to the per-seat outcome shape:
`200`/`201` on success, or `409 map_edit_refused` carrying the refused seats and their reasons. Feature
002's `contracts/catalog.openapi.yaml:194` documents the old refusal and is listed as a follow-up to
amend in `spec.md`.
