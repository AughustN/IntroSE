# UI/UX Polish Plan — A2, B3–B7, C8–C9, D

Approved by user 2026-08-20. Plan-mode rules: implement in the order below; run D gates after each phase.

Scope decisions (from user answers):

- B5: tooltip shows buyer **nickname + check-in** (same data as attendees CSV export)
- C8: **full end-to-end** companion seats
- A2: compact **strip above content + keep existing side rail**
- B6: **verify-only** (feature already fully built)

---

## 1. A2 — Persistent checklist strip in EventEditor

Files: `src/components/organizer/flowSteps.ts`, new `src/components/organizer/FlowProgressStrip.tsx`, `src/components/organizer/EventEditor.tsx`, `src/components/organizer/EventFlowRail.tsx`.

a. In `flowSteps.ts`:

- Extract and `export` the `ACTION_LABEL` map (currently private in `EventFlowRail.tsx:116-122`) plus export type `FlowAction = "showtimes" | "tiers" | "chart" | "apply" | "submit"`; use it in `FlowStep.action`.
- Add pure helper `export function stepProgress(steps: FlowStep[]): { doneCount: number; active: FlowStep | null }` where `doneCount = steps.filter(s => s.state !== "todo").length` (blocked counts — the server gate for it is real; skipping it makes a fresh draft show 0/0) and `active = steps.find(s => s.state !== "done") ?? null`.

b. `EventFlowRail.tsx`: import `ACTION_LABEL` from `./flowSteps`; delete its local copy.

c. New `FlowProgressStrip.tsx`: props `{ steps, onAction }`. Renders `aria-label="Tiến độ chuẩn bị sự kiện"`; contents:

- Left: `Chuẩn bị: {doneCount}/{steps.length}` in `font-mono text-[11px] text-beige-kem/60`;
- Middle: active step label + reason (truncate to one line `truncate`);
- Right: if `active?.action` → button `${ACTION_LABEL[action]} →` calling `onAction(active.action)` in `text-burgundy-ink underline` style (EventFlowRail's link style).
- If every step done: show final step label only (e.g. "Đang bán").
- Do NOT make it sticky (page has no app header; sticky would pin it under the browser chrome on scroll — the rail already carries stickiness on `lg`).

d. `EventEditor.tsx`: import and render `<FlowProgressStrip steps={steps} onAction={runAction} />` between the header row (ends L288) and the rail grid (L294). Keep everything else.

Tests: `src/components/organizer/flowSteps.test.ts` may exist — check; add `stepProgress` cases (all-todo → 0 + first active; blocked counts as progress; all-done → null active).

## 2. C9 — Form-based statuses on the organizer chart

File: `src/components/seatmap/ShowtimeMapPanel.tsx` (mirror buyer `SeatLayout.tsx:263-279` forms).

a. Add shared CSS in `src/index.css` (single definition of the hatch, Principle VI):

```css
/* Held seats on charts: hatched fill, one FORM for "temporarily somebody else's". */
.seat-held {
  fill: url(#tixhub-hatch);
}
```

Plus a `<pattern id="tixhub-hatch">` must be injected once inside `SeatCanvas`'s SVG `<defs>` (render in SeatCanvas so every consumer gets it; the pattern is neutral `stone-500` strokes).

b. `ShowtimeMapPanel.tsx` `seatClass` (L121-132):

- selected → keep `fill-burgundy stroke-burgundy`
- blocked → dashed stone: `fill-transparent stroke-stone-500` + `strokeDasharray` (SVG dash via className is not Tailwind — use `strokeDasharray="24 16"` style prop or add class `.seat-blocked { stroke-dasharray: 24 16; }` in index.css)
- sold → `fill-stone-800 stroke-stone-800` (keep: solid = finished)
- held → `.seat-held` hatch + `stroke-stone-500`
  c. Legend swatches (L246-252) redraw the same forms: sold solid square, held hatch square (inline `repeating-linear-gradient(45deg,...)` like buyer `SeatLayout.tsx:494-502`), blocked dashed border square.
  d. On C8 completion, add a fourth distinguishable treatment for `checkedInAt` seats (see task 5): a `Check`-style overlay tick drawn via the `overlay`/seat extras — but keep it FORM-based (e.g. small ring), never hue-only.

## 3. B4 — Category/tier legend in ChartEditor

File: `src/components/seatmap/ChartEditor.tsx`.

Mount a legend line below the canvas area (after `SeatCanvas` block, before StatusBar ~L2415): for each category with ≥1 seat in the document, chip = color swatch (category.color) + name + seat count; order alphabetically (matches server ORDER BY name). Pattern-copy from `ShowtimeMapPanel.tsx:254-266`. No prices here (price is per-showtime tier — the BlockInspector comment explains why deliberately).

## 4. B7 — Live seat-count preview in BlockInspector

File: `src/components/seatmap/BlockInspector.tsx`.

a. For parametric blocks show `→ rows × perRow = N ghế` under the layout grid, computed live from the DRAFT inputs. Problem: `CommittedNumber` only commits on blur/Enter, so the "would be" number must come from the inputs' local drafts. Simplest: keep a small local `draftRows`/`draftPerRow` state mirrored from props, updated on onChange of the two CommittedNumber-style fields (convert these two to plain controlled numeric inputs with the same commit-on-blur semantics but exposing the draft value), display `sẽ có: N ghế` line in `text-[11px] text-beige-kem/60`. If N > seats + seatBudget, reuse the existing amber `wouldClip` notice wording.
b. Arc angle slider already capped 180 (L305-313) — no change.

## 5. B5 — Order-aware organizer chart (nickname + check-in)

Contract (shared, Principle VI): `shared/catalog/seatmap.ts` — extend `ShowtimeMapSeat` with `buyerName?: string | null; checkedInAt?: string | null;` (nullable ISO strings, optional in wire shape).

Server: `server/src/modules/seatmap/layouts.repo.ts` `getShowtimeMap` (L1303-1379): LEFT JOIN the chain `showtime_seats ss → reservation_items ri ON ri.showtime_seat_id = ss.id → tickets tk ON tk.reservation_item_id = ri.id → users u ON u.id = tk.user_id` and select `u.nickname AS buyer_name, tk.checked_in_at`. Use the exact join shape already proven in `server/src/modules/.../checkin.service.ts` attendees query (TICKET_LOOKUP L51-66). Check for row duplication risk: one seat could have multiple tickets (refund → reissue)? Use `DISTINCT ON (ss.id)` ordered by ticket created_at desc or aggregate — inspect existing attendees query handling first; mirror it.

Client: `ShowtimeMapPanel.tsx`:

- Tooltip (L218-226): when sold + buyerName show `· {buyerName}{checkedInAt ? " · đã vào" : ""}`.
- `seatLabel` (L213-217): same info for screen readers.
- Form-based checked-in mark from task 2d (ring/tick overlay).
- Keep refusals unchanged; no new endpoints.

Tests (server): new case in `server/tests/seatmap/` (or extend `apply-rules.test.ts` / add `showtime-map-orders.test.ts`): generate map on a showtime with a sold seat (reuse helpers from `server/tests/holds/hold.test.ts` for checkout path), assert `getShowtimeMap` returns buyerName + checkedInAt null, then check in via checkin service and assert checkedInAt set. Assert absence for available/held/blocked seats.

## 6. C8 — Companion seats, end-to-end

Order: shared doc model → zod schema → migration → repo round-trip → projection → validation → editor → buyer alert → tests.

a. `shared/catalog/seatmap-document.ts`:

- `DocumentSeat.companionSeatId?: number | null` (add after `isAccessible` for grouping).
- `upgradeDocument` (L346-368): add the field to the per-seat rebuild (round-trip requirement documented at L359-366).
- `reviveDocument` (L528-548): keep companionSeatId when both seats survive; when the companion re-mints to a negative id, remap the pointer via the same mint mapping the function builds — inspect its id-map mechanism and extend it.
- `remapDocument` (L441-478): remap companionSeatId through `ids.seats` (unmapped → new placeholder pairing must NOT be invented; drop pointer if target remapped away? NO — keep consistency: remap both; if companion seat itself is remapped the link follows).
- `stripIds` (L378-422): set companionSeatId → null (drop links on template export; re-pairing is an organizer action). Decide: exporting a linked pair breaks the link silently — acceptable + note in code comment.
- `adoptLayout`: if `seats.companion_seat_id` column exists, carry through when synthesizing docs.
  b. `server/src/modules/seatmap/document.schema.ts` `documentSeat` (L19-32): `companionSeatId: z.number().int().nullable().optional()`.
  c. Migration `server/src/db/migrations/0036_companion_seats.sql`:

```sql
ALTER TABLE seats ADD COLUMN companion_seat_id INT REFERENCES seats(id) ON DELETE SET NULL;
ALTER TABLE showtime_seats ADD COLUMN companion_seat_id INT REFERENCES showtime_seats(id) ON DELETE SET NULL;
```

Self-reference allowed by ordering; if FK complaint on initial ADD (old data all NULL → fine, no backfill needed).
d. Repo: `layouts.repo.ts` seat upsert (L760-811) writes `companion_seat_id` (positive ids only; NULL when seat is freshly minted — pairing only persists once both seats have real ids; document this constraint in code comment). `stitchSeatIds` handles document pointers the same as any seat id. `getShowtimeMap`/generation (`catalog.write.ts:531-557`): copy companion link at snapshot time — require both seat's showtime seat ids known; simplest: after bulk insert of showtime_seats, UPDATE showtime_seats SET companion_seat_id = partner.new_id via the seats-id mapping the generation already builds.
e. `shared/catalog/seatmap.ts`: `LayoutSeat.companionSeatId`; `ShowtimeMapSeat.companionSeatId?` — and `shared/catalog/seatmap-project.ts` projection passes it through.
f. Validation `shared/catalog/seatmap-validate.ts`:

- BLOCKING `companion_wrong_target`: seat.companionSeatId points to a seat without `isAccessible` or not in the same block/row vicinity.
- WARNING `accessible_without_companion`: isAccessible seat with no companion pointing at it (or stated: accessible seat should have a companion) — wording VN: "Gế xe lăn chưa có ghế đi kèm."
- Cycle/double-companion guard: one seat may be companion of at most one accessible seat (blocking if two seats claim the same companion).
  g. Editor UI: contextual toolbar has `Xe lăn` toggle already (ChartEditor L1952-1960). Add pairing action: when exactly 2 seats selected and one is accessible → button "Ghép ghế đi kèm" sets the non-accessible one's companionSeatId to the accessible seat's seatId; when the accessible seat is selected, a small indicator in BlockInspector/RowInspector or the selection toolbar shows "Ghế đi kèm: {label}" with an unpair button. Minimal surface: toolbar-level only.
  h. Buyer alert (`src/components/SeatLayout.tsx`): in `toggleSeatSelection`/`pick` path, when the picked seat `isAccessible` set a notice (reuse `bestNotice` pattern, L213-219): "Ghế này dành cho người dùng xe lăn và kèm một ghế cho người đi cùng." Non-blocking.
  i. Socket/holds: no changes — companion seat is an ordinary seat for holds; buyer must select it manually unless whole-table rule (out of scope).

Tests:

- Shared: `shared/catalog/seatmap-validate.test.ts` companion rules; `seatmap-project.test.ts` pointer passthrough if applicable.
- Web: documentOps/round-trip test asserting `companionSeatId` survives upgrade/strip/remap (extend existing document test in `src/components/seatmap/*` or `shared`).
- Server: seatmap test: save layout with companion, re-read, assert persistence; generation → showtime seat companion link present.

## 7. B6 — Verify only

- Run `npm run test:web` (covers bestAvailable.test.ts, orphan rule), check "Chọn giúp tôi" copy in `SeatLayout.tsx:200-231` against the notices; fix wording only if misleading. No feature code.

## 8. D — Gates (after each phase and finally)

- `npm run typecheck` (both tsconfig.web + tsconfig.server)
- `npm run lint`
- `npm test` (server, incl. seatmap 0036 migration order — runner auto-applies migrations in numeric order; 0036 slot is free between 0035 and 0037)
- `npm run test:web`
- Manual smoke: organizer console flow (strip visible at all levels of EventEditor), showtime map statuses, chart editor legend, accessible-seat pairing, buyer alert.

## Regression invariants to NOT touch (feature D)

- localStorage crash-recovery drafts + beforeunload guard in ChartEditor/OrganizerEventsPage
- 50-level undo (`useLayoutHistory.ts`), optimistic-concurrency `version`/`stale_version` publish path
- Autosave 12s idle cadence
- Holds row-locking (`FOR UPDATE`), TTL sweep, one active reservation per (user, showtime)
- SeatChart shared renderer contract — buyer ≡ organizer same pixels (FR-064/067 separation: color=price, form=status)

## Conventions in force

- USE-03: all user-facing strings in Vietnamese.
- Principle VI: shared types once in `shared/`, both sides import; update every consumer in same change.
- SEC-04/07: zod-validate new fields (done via document.schema.ts), RBAC untouched (org endpoints already gated).
- Money: VND integers only (no change needed anywhere in this plan).
