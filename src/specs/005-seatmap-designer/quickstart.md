# Quickstart: Seat Map Designer (005)

Runnable validation that the designer works end-to-end. Details live in
[data-model.md](./data-model.md), [contracts/](./contracts/), [research.md](./research.md), and
[spec.md](./spec.md).

## Prerequisites

- Features 001–004 migrated; `0007_seatmap.sql` applied.
- No new packages: `multer` and `sharp` are already dependencies from the 001 avatar upload (ADR-0004).
- Seed loaded — the seated demo event **"Đêm Nhạc Trịnh Công Sơn"** (`server/src/db/seed-dev.ts`) gives
  a venue whose existing seats the migration lifts into a **"Sơ đồ mặc định"** layout.
- An `uploads/floorplans/` directory, served by Nginx with `X-Content-Type-Options: nosniff` (same
  location block shape as `uploads/avatars/`).

## Setup

```bash
npm run db:migrate        # applies 0007_seatmap.sql, incl. the default-layout backfill
npm run seed
npm run dev:server        # API :4000
npm run dev:web           # SPA :3000
```

---

## Scenario 0 — Nothing regressed on migration (R-9)

Before touching anything: open the seeded seated event as a buyer.

**Expected**: the map looks the way it did before this feature. The migration seeded each seat's
position from its old row/number grid, so an un-edited venue is visually unchanged and every existing
showtime still has a working map.

## Scenario 1 — Draw a layout (US1, SC-001)

1. Sign in as the organizer that owns the venue → **Sơ đồ ghế** → the venue's layouts.
2. Create a layout **"Kịch có ghế ngồi"**. Run the Section / Row / Count generator: section *Khu A*,
   row *A*, count *10*.
3. On the canvas: drag one seat; marquee-select row A and **curve along an arc**; align and distribute a
   block; rotate the selection to face the stage; delete two seats.
4. Press undo twice, then redo once.
5. Save as draft, close the editor, reopen it.

**Expected**: every seat is exactly where you left it, including the arc. Each multi-seat operation
undid as **one** step. The generator seeded positions rather than replacing the canvas.

## Scenario 2 — Buyers see the real shape (US2, SC-002 — the mandatory half)

1. Add a **stage** and two **aisles** (Scenario 4), publish the layout, bind it to a showtime, generate.
2. Open the event page as an attendee (the read-only preview map), then **Tiếp tục chọn ghế**.

**Expected**: both surfaces draw the authored shape — the arc curves, the stage and aisles are where you
put them. Neither shows the old uniform grid. Zoom and pan work. Check at **360 / 768 / 1920 px**: no
horizontal page scroll, every control reachable (PLAT-01).

3. **Keyboard only** (FR-039a, SC-010a): tab into the map.

**Expected**: you reach every seat in section → row → number order, each announcing identity, status and
price ("Khu A, hàng B, ghế 12, còn trống, 250.000đ"); you can select one with the keyboard alone; zoom
and pan are reachable without a pointer.

4. Click a seat to hold it.

**Expected**: holding behaves exactly as feature 003 already does — geometry changed where the seat is
drawn, nothing about how it is held.

## Scenario 3 — Correct a live map (US3, SC-003/004/005 — the core refusal test)

Set up three seats on a generated map: one **sold**, one **held** by a second signed-in user, one
**available**.

| Attempt | Available seat | Sold seat | Held seat |
|---|---|---|---|
| Move / rotate | succeeds | **succeeds** | **refused**, names the live hold |
| Relabel / re-section / retier | succeeds | **refused**, names the sale | **refused** |
| Delete | succeeds | **refused** | **refused** |

Then submit one edit touching **both** the available seat and the sold seat's label.

**Expected**: the whole edit is rejected (`409 map_edit_refused`), the response names which seats were
refused and why, and the map is left exactly as it was — the available seat's change did **not** land
(FR-029, SC-005). Let the hold lapse and retry: the previously-refused change now succeeds.

## Scenario 3b — The snapshot holds (SC-005a)

1. Generate maps for **two** showtimes from the same layout.
2. Edit the layout — move a seat, delete a row.
3. Open both showtimes' maps.

**Expected**: **neither** changed. A layout edit reaches nothing implicitly (FR-005).

4. Re-apply the layout to **one** showtime with `dryRun: true`.

**Expected**: a preview listing what would change, and any refusals, with nothing written. Confirm it.

**Expected**: that showtime's map now matches; the other is still untouched.

## Scenario 4 — Floor plan (US4, SC-006/007)

1. Upload a JPEG floor plan; set scale, offset and opacity until a doorway lines up; place seats over it.

**Expected**: the background moves under the seats; the seats do not move.

2. Attempt each refusal:

| File | Expected |
|---|---|
| `plan.svg` (real SVG) | refused — regardless of name or declared content type |
| a text file renamed `plan.png` | refused — decided from its own bytes |
| a `image/png` header on non-PNG bytes | refused |
| a 7 MB JPEG | refused (`413`) |
| a small PNG decoding to 20000×20000 | refused **before** re-encoding (decompression bomb) |
| ten uploads in quick succession | throttled with "try again shortly", never queued or half-attached |

3. Inspect the stored file.

**Expected**: no original metadata, a name unrelated to what you uploaded, served with `nosniff`.

4. Toggle buyer visibility on, then off, checking the buyer map each time; then remove the plan.

**Expected**: the plan appears and disappears for buyers; **seat status is identical either way**; after
removal every seat keeps its exact position (SC-007). Note the known bound: the old URL still opens if
someone kept it — the file is unguessable, not access-controlled (FR-026a), and the upload panel says so.

## Scenario 5 — Nothing decorative becomes inventory (US5, SC-009)

With a stage, two aisles, a door, a bar and a text label on the layout, generate the showtime's map.

**Expected**: the bookable-seat count equals the **seat** count exactly. No element appears in any tier,
capacity figure, or seat list. Give the label a value like `<img src=x onerror=alert(1)>`.

**Expected**: it renders as literal text on both the organizer canvas and the buyer map (FR-018).

## Scenario 6 — Publishing is gated (US6, SC-008)

Build a layout with three problems at once: an overlapping pair, a duplicate label in one section, and a
sectionless seat. Run validate, then attempt to publish.

**Expected**: publishing is blocked and **all three** are reported in one pass, each naming the seats or
sections at fault (the overlap names the *pair*). Fix them and publish succeeds. Repeat for the other
two checks — a section with seats but no tier, and zero capacity — independently.

Boundary check: place two seats **exactly** 100 units apart.

**Expected**: publishable — touching is not overlapping (the rule is *less than* one diameter, FR-030a).

## Scenario 7 — Block and marquee-tier (US7)

1. Block one available seat.

**Expected**: buyers can no longer select it; it leaves available capacity; viewers see it live (~1 s).
Unblock and confirm it returns. Try blocking the held and the sold seat: both refused.

2. Marquee-select 12 seats spanning two sections and assign a tier.

**Expected**: all 12 carry the new tier and price. Include a sold seat in the selection: the whole action
is refused and names it (never silently repricing an owned ticket).

## Scenario 8 — Reuse (US8, SC-013)

Save the layout as a template; clone it into a second venue you own; edit the clone.

**Expected**: seats, sections, elements and background alignment all came across as an independent
**draft**; the source is unchanged. Cloning another organizer's layout is **refused**.

## Scenario 9 — Ownership is a refusal, not a filter (SC-011)

As organizer B, against organizer A's venue/layout/seat/upload, hit each route in
[`contracts/seatmap.openapi.yaml`](./contracts/seatmap.openapi.yaml).

**Expected**: `403 not_owner` on every one — never `200` with an empty list (SEC-04, FR-042).

## Scenario 10 — Feature 003 is untouched (SC-012)

```bash
npm run test                # server/tests/holds/** must pass UNMODIFIED
```

**Expected**: every hold, release, expiry, grace, GA and realtime test passes with no edits. Inspect a
`seat:update` frame on the wire.

**Expected**: `{ showtimeId, seats: [{ showtimeSeatId, status }] }` — **no geometry**, and no `tier`/`price`
either, since those appear only on an organizer retier (FR-041, Scenario 7).

## Scenario 11 — Performance and contract integrity (SC-010, SC-014)

```bash
npm run typecheck           # one shared SeatMap definition; no re-declared payload anywhere
npm run test:coverage
```

Then generate a **2,000-seat** layout and open it as a buyer.

**Expected**: the map read stays under 500 ms p95 at the 25-VU normal load profile (PERF-02), and zoom
and pan stay interactive.

---

## Done when

Scenarios 0–11 pass, `npm run lint && npm run typecheck && npm run test` are green, and the four
follow-up documents named in [spec.md](./spec.md) (UC-21, `SCHEMA_DATABASE.md`, the `CONTEXT.md`
glossary, feature 002's spec/contract) have been amended.

---

# Amendment (007-scope) validation — 2026-08-06

Additive to the guide above. Prerequisites are unchanged, plus one migration:

```bash
npm run db:migrate                 # applies 0012_hallscheme.sql
VITEST=1 npm run db:migrate        # and the TEST branch — the suite runs against TEST_DATABASE_URL
```

> The two must be migrated separately. `config.ts` resolves `TEST_DATABASE_URL` only under vitest, so a
> plain `db:migrate` leaves the test database on the old schema and every new test fails on a missing
> column rather than on its assertion.

## Automated

```bash
npx vitest run server/tests/seatmap        # incl. tables, shapes-icons, section-style
npx vitest run server/tests/catalog        # buyer read: seat tier + legend
npx vitest run server/tests/holds          # MUST pass unmodified (SC-025)
npm run typecheck
```

| File | Covers |
|---|---|
| `seatmap/tables.test.ts` | placement and distribution (round + rect), move/rotate carrying seats, re-count redistributing, **refusals** on sold/held for move, rotate, re-count, delete and re-section, name collision at placement (SC-016, SC-017, SC-028) |
| `seatmap/shapes-icons.test.ts` | points round-trip with the bounding box, the widened `kind` CHECK leaving pre-amendment rows valid, decoration never entering inventory (SC-018, SC-019) |
| `seatmap/section-style.test.ts` | defaults reproduce today's rendering and today's overlap outcomes; a scaled section overlaps when it visibly overlaps (SC-020) |
| `seatmap/apply-rules.test.ts` (extended) | tables and shapes snapshotted; a layout edit changes nothing on a showtime that already generated (SC-027) |
| `catalog/seatmap-read.test.ts` (extended) | every seat carries a tier; the legend names tier, colour and whole-đồng price; section colour is **absent** from the buyer payload (SC-021) |

## Manual — the three worth seeing

**1. A gala dinner (US9, SC-015).** Place 20 round tables of 10, set a section, drag one across the hall
and confirm its ten seats travel with it. Change one table from 8 to 10 and watch the seats redistribute.
Apply to a showtime and confirm a buyer can select **"Bàn 3 - Ghế 7"**.

**2. The refusal that protects a buyer (SC-017).** Sell one seat at a table, then try to move, rotate,
re-count, re-section, and delete that table. Each is refused naming the sold seat, and the table is
exactly where it was afterwards. This is the case the whole tables design is shaped around.

**3. Colour means price (US10, SC-021).** Open a three-tier showtime at 360, 768 and 1920 px on **both**
the event page and the seat-selection screen. The colours, legend and shapes must be identical on both;
the legend names each tier and its price in đồng; sold and held seats stay visibly unavailable and
unclickable whatever their tier colour. Then set two sections to different colours in the editor and
confirm **buyers see no change** — section colour is an editor aid only.

## Rollback

`0012_hallscheme.sql` is additive: one new table, four nullable-or-defaulted columns, one widened CHECK.
Reverting the application code leaves the new columns unread and the new table unreferenced — nothing
breaks, because every default reproduces the pre-amendment rendering.

The one thing that must **not** be rolled back independently is `apply.ts`'s snapshot write while tables
are in use: without it a showtime keeps its seats but loses the tables they are named after, so buyers
would see "Bàn 5 - Ghế 3" with no table drawn.
