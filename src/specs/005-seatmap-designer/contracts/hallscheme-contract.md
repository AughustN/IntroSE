# Contract: hall-scheme parity (amendment, 2026-08-06)

Additive to `seatmap-read-contract.md` and `seatmap.openapi.yaml`, both of which stay valid. This
document covers only what the amendment changes, and the parts a schema cannot express.

## 1. The layout contract gains four things

`shared/catalog/seatmap.ts` — one definition, imported by the server, the editor, and **both** buyer
renderers in the same change (Principle VI, FR-078).

| Addition | Shape |
|---|---|
| `LayoutTable` | `{ id?, sectionId, name, shape: 'round' \| 'rect', x, y, width, height, rotation, seatCount, sideCounts? }` |
| Shape points | `LayoutElement` gains `points?: { x, y }[]`; the rectangle fields remain its bounding box |
| Element kinds | `+ boundary, divider, exit, restroom, food_drink, smoking, first_aid, lift_stairs, wheelchair` |
| Section style | `Section` gains `color \| null`, `seatShape: 'circle' \| 'square'`, `seatSizeMultiplier` |

`LayoutSeat` gains `tableId?` so the editor can select a table as one object. Nothing else about a seat
changes — to the overlap test, the snapshot, and both renderers, a table seat is an ordinary seat.

## 2. The buyer read gains price, and loses nothing

`shared/catalog/types.ts` — `SeatMap`:

- each `SeatMapSeat` gains its **tier id**;
- the map gains a **`tierLegend`**: `{ tierId, label, price, color }[]`, ordered by price ascending.

`price` is a whole Vietnamese đồng integer (STD-03). `color` is **derived at read time** from the tier's
position in that ordering — it is not stored, and no `ticket_tiers` column is added, because feature 006
owns that table (R-17).

**Section colour is deliberately absent from this payload.** On the buyer map colour means price and
only price; section colour is an editor-only aid (FR-064). Seat **shape** and **size** do cross, so
sections stay distinguishable to buyers by form.

## 3. What must not change

- **`shared/holds/types.ts` is untouched again.** Tables, shapes, icons and section style are static per
  layout and belong to the map read, never to a per-hold broadcast. `server/tests/holds/**` must pass
  **unmodified** (SC-025).
- **Feature 004's checkout is untouched.** A table seat is held, released and sold by the existing path.
- **The bookable-seat count is unchanged** by any amount of decoration: a layout with 100 tables, a
  boundary and twelve icons generates exactly as many `showtime_seats` as it has seats (SC-018).

## 4. Both renderers, one visual language

`shared/catalog/tier-palette.ts` is a **single exported function**, not a constant copied per component:
given a showtime's tiers it returns the legend. `SeatMapView` and `SeatLayout` both import it and both
render from the same `tierLegend` in the payload, which is what makes FR-069's "one visual language"
structural rather than a code-review promise.

Status still outranks price in the rendering order: a **sold** or **held** seat stays visibly
unavailable and stays unclickable whatever its tier colour (FR-068). Colour is never the only carrier —
the legend names every tier and price, and a seat exposes its tier to assistive technology alongside its
identity, status and price (FR-071).

## 5. New endpoints, same rules

All under `/api/organizer`, all behind `requireAuth + requireOrganizer`, all resolving layout ownership
on the server and **refusing** another organizer's layout (SEC-04, FR-079).

| Endpoint | Purpose | Notable refusals |
|---|---|---|
| `POST /layouts/:id/tables` | place a table; generates its seats | `table_name_taken` (same section), `seat_limit_reached`, `table_limit_reached` |
| `PATCH /tables/:id` | move, rotate, rename, re-count, re-section | `seat_sold`, `seat_held` — whole refusal, nothing moves |
| `DELETE /tables/:id` | delete the table and its seats | `seat_sold`, `seat_held` |

Shapes, icons and section style ride on the **existing versioned full-document layout save** rather than
gaining endpoints of their own — they are layout content, and the optimistic-locking rule (FR-015) that
already protects it protects them too.

## 6. Error vocabulary

Reuses the shipped codes rather than inventing parallel ones: `seat_sold` and `seat_held` for anything a
table operation would disturb, `not_owner` for ownership, `validation_failed` for schema. New codes are
added only where no existing one fits: `table_name_taken`, `table_limit_reached`, `polygon_points_invalid`.
