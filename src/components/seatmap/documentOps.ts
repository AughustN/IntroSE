/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type BlockKind,
  type BlockParams,
  type ChartDocument,
  type DocumentBlock,
  type DocumentCategory,
  type DocumentSeat,
  type DocumentSection,
  isSeatBearing,
  nextBlockKey,
} from "@/shared/catalog/seatmap-document";
import type { ShapePoint } from "@/shared/catalog/seatmap";
import { inferStartLabels, regenerateBlock, rowLabelFor } from "@/shared/catalog/seatmap-project";
import { LAYOUT_MAX_SEATS, LAYOUT_SPACE, clampCoord } from "@/shared/catalog/seatmap-validate";
import { CATEGORY_COLORS, GRID, MAX_ROWS, mintId, snap } from "./layoutOps";

/**
 * Block-level operations on a `ChartDocument`.
 *
 * The document counterpart of `layoutOps.ts`, and the same discipline: every function is pure and
 * returns a new document, so each one is a single undoable commit and each is testable without a DOM.
 *
 * The difference in level is the point of the whole feature. `layoutOps` moves SEATS — once a row is
 * drawn, "6 × 18, rows lettered A-ascending" is gone and only coordinates remain. These functions move
 * and re-shape BLOCKS, so that description survives and can be edited: changing `seatsPerRow` from 18
 * to 20 is an edit here, where it was a delete-and-redraw before.
 */

/** How big a new block is, and how its seats are laid out, per kind. */
const DEFAULTS: Record<string, { width: number; height: number; params?: BlockParams }> = {
  "seating-block": {
    width: 900,
    height: 750,
    params: { rowsCount: 5, seatsPerRow: 10, seatSpacing: 150, rowSpacing: 150 },
  },
  "single-row": {
    width: 1350,
    height: 150,
    params: { rowsCount: 1, seatsPerRow: 10, seatSpacing: 150, rowSpacing: 150 },
  },
  "curved-row": {
    width: 2400,
    height: 900,
    params: { rowsCount: 3, seatsPerRow: 12, seatSpacing: 150, rowSpacing: 200, radius: 1500, arcAngle: 90 },
  },
  "individual-seat": {
    width: 100,
    height: 100,
    params: { rowsCount: 1, seatsPerRow: 1, seatSpacing: 150, rowSpacing: 150 },
  },
  "ga-zone": { width: 1800, height: 1200 },
  stage: { width: 3000, height: 600 },
  aisle: { width: 200, height: 2000 },
  door: { width: 400, height: 150 },
  bar: { width: 1200, height: 400 },
  text: { width: 900, height: 200 },
  shape: { width: 1500, height: 1000 },
};

/** Facility markers are all drawn at one small square size. */
const FACILITY_SIZE = { width: 350, height: 350 };

/** Vietnamese names, used as the default title so a new block reads as something. */
export const BLOCK_LABEL: Record<BlockKind, string> = {
  "seating-block": "Khối ghế",
  "curved-row": "Hàng cong",
  "single-row": "Một hàng",
  "individual-seat": "Ghế lẻ",
  table: "Bàn",
  "ga-zone": "Khu đứng",
  stage: "Sân khấu",
  aisle: "Lối đi",
  door: "Cửa",
  bar: "Quầy",
  text: "Ghi chú",
  shape: "Hình khối",
  exit: "Lối thoát hiểm",
  restroom: "Nhà vệ sinh",
  food_drink: "Đồ ăn / uống",
  smoking: "Khu hút thuốc",
  first_aid: "Sơ cứu",
  lift_stairs: "Thang máy / cầu thang",
  wheelchair: "Lối xe lăn",
};

/** Seats already in the document — what a new block's budget is measured against. */
export function seatCount(doc: ChartDocument): number {
  let n = 0;
  for (const b of doc.blocks) n += b.seats?.length ?? 0;
  return n;
}

export const remainingBudget = (doc: ChartDocument): number =>
  Math.max(0, LAYOUT_MAX_SEATS - seatCount(doc));

/**
 * The row index a new block should start lettering from, so it does not collide with what is already
 * in its section.
 *
 * `seats` is UNIQUE on `(section_id, row_label, seat_number)`. Every seat-bearing block used to be
 * generated from row index 0, so adding a SECOND block to a section produced A1..A10 again and the save
 * was refused by the database — which surfaced as "a name is duplicated", a sentence with nothing in it
 * the organizer could act on.
 *
 * Walks forward until the labels it would generate are all unused, rather than counting rows: labels
 * can be arbitrary strings once a chart has been adopted or hand-relabelled, so counting is not the
 * same question as "is this free".
 */
function rowLabelsUsedIn(doc: ChartDocument, sectionId: number | null, exceptKey?: string): Set<string> {
  const used = new Set<string>();
  for (const b of doc.blocks) {
    if (b.key === exceptKey) continue;
    for (const seat of b.seats ?? []) {
      const section = seat.sectionId ?? b.sectionId;
      if (section === sectionId) used.add(seat.rowLabel);
    }
  }
  return used;
}

/** Would a block starting at `start` land on a row label another block in the section already uses? */
function rowsCollide(used: Set<string>, rows: number, params: BlockParams, start: number): boolean {
  for (let r = 0; r < rows; r++) {
    if (used.has(rowLabelFor(r, rows, params.rowLabelScheme, params.rowLabelPrefix, start))) return true;
  }
  return false;
}

/**
 * The row index a block should letter from, so it does not collide with the rest of its section.
 *
 * `seats` is UNIQUE on `(section_id, row_label, seat_number)`, and two blocks in one section share a
 * single label namespace with nothing coordinating them. Every seat-bearing block used to letter from
 * index 0, so a second block in a section repeated A1..A10 and the save was refused by the database.
 *
 * Walks forward until the labels are free rather than counting rows: labels are arbitrary strings once
 * a chart has been adopted or hand-relabelled, so counting is not the same question as "is this free".
 */
function firstFreeRowIndex(
  doc: ChartDocument,
  sectionId: number | null,
  rows: number,
  params: BlockParams,
  exceptKey?: string,
): number {
  const used = rowLabelsUsedIn(doc, sectionId, exceptKey);
  if (used.size === 0) return 0;

  // Bounded so a pathological chart cannot spin: past MAX_ROWS the publish gate reports the collision
  // rather than the editor hunting forever.
  for (let start = 0; start <= MAX_ROWS; start++) {
    if (!rowsCollide(used, rows, params, start)) return start;
  }
  return 0;
}

/**
 * Where the next block should go, as the organizer has stated it.
 *
 * Three states per field, and they are all different things: `undefined` is "nothing said, work it
 * out", a number is "that one", and `null` is "none — put it outside every section". Collapsing the
 * last two is what made a section-less block unreachable.
 */
export interface BlockTarget {
  sectionId: number | null | undefined;
  categoryId: number | null | undefined;
}

/**
 * Which section and price class a NEW block should join.
 *
 * Every new block used to land in `sections[0]` / `categories[0]` regardless of what the organizer was
 * working on, so building a VIP area meant: add the block, scroll past the inspector to the price-class
 * panel, reassign it — every single time.
 *
 * The selection is the best available statement of intent: if you are working on a VIP block, the next
 * block you add is almost certainly VIP too. A remembered last-used value comes next, and the first of
 * each is the fallback for an empty chart.
 */
export function nextBlockContext(
  doc: ChartDocument,
  selected: Set<string>,
  lastUsed: BlockTarget = { sectionId: undefined, categoryId: undefined },
): { sectionId: number | null; categoryId: number | null } {
  // A single selected block is an unambiguous statement; a mixed selection is not, so it is ignored.
  const picked = selected.size === 1 ? doc.blocks.find((b) => selected.has(b.key)) : undefined;

  const known = (id: number | null | undefined, pool: { id: number }[]) =>
    id != null && pool.some((x) => x.id === id) ? id : null;

  /**
   * Explicit first, then the selection, then the first of each.
   *
   * `null` outranks everything because it is a DECISION — the organizer asking for a block that belongs
   * to no section, which the schema has allowed since 0024 and the validator reports at publish rather
   * than forbidding while drawing. Resolving it away, as this did by falling through to
   * `doc.sections[0]`, made a section-less block impossible to draw however the UI asked for one.
   */
  const resolve = (
    stated: number | null | undefined,
    from: number | null | undefined,
    pool: { id: number }[],
  ) => {
    if (stated === null) return null;
    if (stated !== undefined && known(stated, pool) !== null) return stated;
    return known(from, pool) ?? pool[0]?.id ?? null;
  };

  return {
    sectionId: resolve(lastUsed.sectionId, picked?.sectionId, doc.sections),
    categoryId: resolve(lastUsed.categoryId, picked?.categoryId, doc.categories),
  };
}

/**
 * A name for a new shape: "Hình 1", "Hình 2", …
 *
 * Numbered rather than all called the same thing, because a shape's name is how it is referred to
 * afterwards — in the validation list, in the inspector, and on the map itself. Counting the shapes
 * already present rather than every block, so adding a stage does not push the next shape to "Hình 4".
 * A shape whose name has been taken over by the organizer no longer matches, and is simply skipped.
 */
export function nextShapeName(doc: ChartDocument): string {
  let max = 0;
  for (const b of doc.blocks) {
    const n = /^Hình (\d+)$/.exec(b.label ?? "");
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `Hình ${max + 1}`;
}

/**
 * Add a block at a point, with its seats generated if it is a seat-bearing kind.
 *
 * Placed where the caller asks rather than always at the centre of the map: the reference editor
 * dropped everything at a fixed (500, 300) regardless of pan or zoom, so a second block landed exactly
 * on the first and neither could be told apart.
 */
export function addBlock(
  doc: ChartDocument,
  kind: BlockKind,
  at: { x: number; y: number },
  opts: {
    sectionId?: number | null;
    categoryId?: number | null;
    grid?: boolean;
    geometry?: Exclude<BlockGeometry, "free">;
    color?: string | null;
  } = {},
): { doc: ChartDocument; key: string } {
  const spec = DEFAULTS[kind] ?? FACILITY_SIZE;
  const key = nextBlockKey(doc);
  const grid = opts.grid ?? true;

  let block: DocumentBlock = {
    key,
    kind,
    title: BLOCK_LABEL[kind],
    x: clampCoord(snap(at.x, grid)),
    y: clampCoord(snap(at.y, grid)),
    rotation: 0,
    width: spec.width,
    height: spec.height,
    sectionId: opts.sectionId ?? null,
    categoryId: opts.categoryId ?? null,
    params: spec.params,
    seats: isSeatBearing(kind) && kind !== "table" ? [] : undefined,
    capacity: kind === "ga-zone" ? 200 : undefined,
    // Only the kinds that RENDER their text get one; a facility icon is drawn as a marker.
    label:
      kind === "text" || kind === "stage" || kind === "exit" || kind === "aisle" || kind === "bar"
        ? BLOCK_LABEL[kind]
        : null,
  };
  if (block.params) {
    // Start lettering past the section's existing rows, or the database refuses the save.
    const rows = block.params.rowsCount ?? 1;
    const start = firstFreeRowIndex(doc, block.sectionId, rows, block.params);
    if (start > 0) block = { ...block, params: { ...block.params, startRowIndex: start } };
    block = regenerateBlock(block, mintId, remainingBudget(doc));
  }

  if (kind === "shape") {
    // A shape is DRAWN from its points, and the canvas needs at least two of them — so a shape created
    // without any is a block that can be selected, moved and saved while being completely invisible.
    // Defaulting to a rectangle means placing one always puts something on the map, which the organizer
    // can then re-shape or drag by the vertices.
    const geometry = opts.geometry ?? "rect";
    block = { ...block, geometry, points: geometryPoints(geometry, block), label: nextShapeName(doc) };
  }
  if (opts.color !== undefined && colorable(kind)) block = { ...block, color: opts.color };

  return { doc: { ...doc, blocks: [...doc.blocks, block] }, key };
}

/** Replace one block, by key. The single mutation every inspector control goes through. */
export function updateBlock(
  doc: ChartDocument,
  key: string,
  patch: Partial<DocumentBlock>,
): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)),
  };
}

/**
 * Change a block's parameters and rebuild its seats.
 *
 * The budget passed to `regenerateBlock` excludes THIS block's current seats, so growing a block is
 * measured against the rest of the chart rather than against itself.
 */
export function setBlockParams(
  doc: ChartDocument,
  key: string,
  patch: Partial<BlockParams>,
): ChartDocument {
  const target = doc.blocks.find((b) => b.key === key);
  if (!target) return doc;
  const others = seatCount(doc) - (target.seats?.length ?? 0);
  // The FIRST time a block becomes parametric, take its starting row and seat number from the labels it
  // already carries. Without this the regeneration restarts at A1, which renumbers an adopted chart and
  // slides every surviving seat id along its row — the seat a ticket was sold for is no longer the seat
  // the buyer picked. Inferred values sit UNDER the patch, so anything the organizer types still wins.
  const inferred = target.params ? {} : inferStartLabels(target);
  let params: BlockParams = { ...inferred, ...target.params, ...patch };

  /*
   * Growing a block runs it into its neighbours: five rows lettered A..E become A..J, and the block
   * beside it already holds F..J. Nothing coordinated the two, so the edit produced fifty duplicate
   * labels that the organizer only met later as "hai ghế trùng nhãn".
   *
   * Shifted out of the way only when it is SAFE to relabel — that is, when none of this block's seats
   * has been saved yet. A seat with a real database id may have been sold, and moving its label would
   * move the ticket; there the collision is reported by the publish gate instead, which is the honest
   * outcome because the organizer has to decide which block gives way.
   *
   * An explicit `startRowIndex` in the patch always wins: the organizer typed it.
   */
  const rows = target.kind === 'single-row' ? 1 : Math.max(1, Math.floor(params.rowsCount ?? 1));
  const persisted = (target.seats ?? []).some((s) => s.seatId > 0);
  if (patch.startRowIndex === undefined && !persisted) {
    const used = rowLabelsUsedIn(doc, target.sectionId, target.key);
    if (rowsCollide(used, rows, params, params.startRowIndex ?? 0)) {
      params = { ...params, startRowIndex: firstFreeRowIndex(doc, target.sectionId, rows, params, target.key) };
    }
  }

  const next = regenerateBlock(
    { ...target, params },
    mintId,
    Math.max(0, LAYOUT_MAX_SEATS - others),
  );
  return updateBlock(doc, key, next);
}

/**
 * A table's geometry belongs to `layout_tables`, and only the table endpoints write that row — the
 * document merely MIRRORS it so the canvas has something to draw. Editing a table block here would
 * therefore move its SEATS on the next save (the projection carries them) while the table itself stayed
 * put, leaving the seats detached from the table they belong to and the block re-adopted at the old
 * position with nonsense offsets.
 *
 * So every operation below leaves tables exactly as it found them, and `ChartEditor` routes a table
 * gesture to `updateTable`/`deleteTable` instead. Enforcing it here rather than only in the editor is
 * deliberate: this module is the half that can be tested without a DOM.
 */
function serverOwned(b: DocumentBlock): boolean {
  return b.kind === "table";
}

/**
 * Whether an operation acting on `keys` should touch this block.
 *
 * Two reasons a selected block is left alone: the server owns it (a table), or the organizer locked
 * it. Both funnel through here so a new operation cannot forget one of them — the failure mode is
 * silent, and with tables it corrupts the chart.
 */
function selectedAndEditable(b: DocumentBlock, keys: Set<string>): boolean {
  return keys.has(b.key) && !serverOwned(b) && b.locked !== true;
}

/**
 * The space a block actually occupies — its seats, or its box if it has none.
 *
 * Not `width`/`height`: those are an advisory bounding box that deliberately does not bound the seats (a
 * round table's sit outside it), so using them to keep a block on the map would let seats off the edge.
 * Decoration is drawn centred on (x, y), matching `SeatCanvas`.
 */
function blockExtent(b: DocumentBlock): { minX: number; maxX: number; minY: number; maxY: number } {
  const rad = ((((b.rotation % 360) + 360) % 360) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  if (b.seats?.length) {
    for (const s of b.seats) see(b.x + s.dx * cos - s.dy * sin, b.y + s.dx * sin + s.dy * cos);
  } else if (b.points?.length) {
    // A drawn outline's real extent is its vertices; `width`/`height` is only an advisory box and can
    // be much smaller, which would let a shape be dragged off the edge of the map.
    for (const p of b.points) see(p.x, p.y);
  } else {
    see(b.x - b.width / 2, b.y - b.height / 2);
    see(b.x + b.width / 2, b.y + b.height / 2);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Clamp a shift so an extent of `lo..hi` stays inside the map.
 *
 * Never reverses the gesture. Clamping to the legal window alone would mean a block already overhanging
 * an edge — legacy geometry, or a rotation that pushed it out — jumped BACKWARDS when dragged forwards,
 * which reads as the editor fighting the pointer. A drag either moves the block or does nothing.
 *
 * A span wider than the map cannot be placed legally at all, so it stays put rather than being squashed
 * against an edge.
 */
function fitDelta(shift: number, lo: number, hi: number): number {
  if (LAYOUT_SPACE - hi < -lo) return 0;
  const room = shift > 0 ? LAYOUT_SPACE - hi : -lo;
  if (shift > 0) return Math.max(0, Math.min(shift, room));
  if (shift < 0) return Math.min(0, Math.max(shift, room));
  return 0;
}

/**
 * How far a selection may actually move before it leaves the map.
 *
 * The projection clamps every seat into 0..LAYOUT_SPACE INDEPENDENTLY, so without this a block dragged
 * past the edge did not stop — each seat beyond the boundary landed on exactly LAYOUT_SPACE and they
 * stacked. A block flush against the right wall lost a handful of seats to one point on the first drag,
 * which is what "the seats overlap each other after I move the block" was.
 *
 * Measured across the WHOLE selection so a group meeting the wall keeps its internal geometry rather
 * than compressing into it. A block wider than the map cannot be placed legally, so it does not move on
 * that axis at all instead of being silently squashed.
 */
export function allowedDelta(
  doc: ChartDocument,
  keys: Set<string>,
  dx: number,
  dy: number,
): { dx: number; dy: number; clamped: boolean } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of doc.blocks) {
    if (!selectedAndEditable(b, keys)) continue;
    const e = blockExtent(b);
    minX = Math.min(minX, e.minX);
    maxX = Math.max(maxX, e.maxX);
    minY = Math.min(minY, e.minY);
    maxY = Math.max(maxY, e.maxY);
  }
  if (minX === Infinity) return { dx, dy, clamped: false };

  const ax = fitDelta(dx, minX, maxX);
  const ay = fitDelta(dy, minY, maxY);
  return { dx: ax, dy: ay, clamped: ax !== dx || ay !== dy };
}

/**
 * Move a block, taking its drawn outline with it.
 *
 * `points` are ABSOLUTE layout coordinates — that is what `layout_elements.points` stores and what the
 * canvas draws from — so changing `x`/`y` alone moved an invisible box and left the outline where it was
 * drawn. Rotation is unaffected: the canvas rotates the element group about `x`/`y`, so the points come
 * round with it already.
 */
function translated(b: DocumentBlock, x: number, y: number): DocumentBlock {
  const dx = x - b.x;
  const dy = y - b.y;
  return {
    ...b,
    x,
    y,
    points: b.points
      ? b.points.map((p) => ({ x: clampCoord(p.x + dx), y: clampCoord(p.y + dy) }))
      : b.points,
  };
}

/**
 * Where a block lands when dragged by a delta.
 *
 * Exported because `ChartEditor` has to compute the SAME landing spot for a table, which it sends to
 * the table endpoint instead of writing here. Two copies of this arithmetic would drift, and the
 * symptom would be a table that lands a grid step away from the blocks it was dragged with.
 */
export function movedPosition(
  b: Pick<DocumentBlock, "x" | "y">,
  dx: number,
  dy: number,
  grid: boolean,
): { x: number; y: number } {
  return { x: clampCoord(snap(b.x + dx, grid)), y: clampCoord(snap(b.y + dy, grid)) };
}

/**
 * What a press does to the current selection.
 *
 * Pure, and deliberately here rather than inline in the editor: the canvas has no test harness, and
 * this is the rule that decides whether a drag moves one block or all of them — the exact thing that
 * broke. Three cases, and the middle one is the one that was missing:
 *
 *   shift-press            toggle that block in or out
 *   press inside selection KEEP the selection, so the whole of it can be dragged
 *   press outside          replace the selection with that block
 *
 * Without the middle case, marquee-selecting several blocks and then pressing one to drag collapsed
 * the selection to that block: only it moved, and the rest of the marquee was silently discarded.
 */
export function selectionAfterPress<T>(current: Set<T>, key: T, additive: boolean): Set<T> {
  if (additive) {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }
  if (current.has(key)) return current;
  return new Set([key]);
}

/**
 * The named shapes a block can be drawn as.
 *
 * `free` is the hand-drawn polygon — a run of points the organizer placed themselves. The rest are
 * generated from the block's box, so switching between them is one click rather than re-drawing.
 */
export type BlockGeometry = "rect" | "square" | "circle" | "oval" | "triangle" | "hexagon" | "free";

/** How many points each named shape uses. A circle is sampled; the rest are their literal corners. */
const GEOMETRY_STEPS: Record<Exclude<BlockGeometry, "free">, number> = {
  rect: 4,
  square: 4,
  circle: 32,
  oval: 32,
  triangle: 3,
  hexagon: 6,
};

/**
 * The outline of a named shape, as a closed run of points.
 *
 * Everything is a polygon underneath — `layout_elements.points` stores a vertex list and the canvas
 * draws it closed — so a circle is a polygon with enough points to read as round, and switching shape is
 * just regenerating that list. There is no second representation to keep in step, and a shape stays
 * editable vertex by vertex after it was generated.
 *
 * 32 points for a curve: smooth at any zoom the editor allows, and comfortably inside the 64-point cap
 * the route enforces, so a generated shape can never be refused at the boundary.
 *
 * Points are ABSOLUTE layout coordinates, like `layout_elements.points`, and are wound clockwise from
 * the top-left so two shapes of the same kind always list their vertices in the same order — otherwise
 * dragging vertex 3 would mean something different from one shape to the next.
 */
export function geometryPoints(
  geometry: Exclude<BlockGeometry, "free">,
  box: { x: number; y: number; width: number; height: number },
): ShapePoint[] {
  // The box is a CENTRE and a size, matching how decoration is drawn.
  const halfW = Math.max(1, box.width) / 2;
  const halfH = Math.max(1, box.height) / 2;
  const r = Math.min(halfW, halfH); // square and circle take the smaller side, so they stay regular
  const rx = geometry === "circle" || geometry === "square" ? r : halfW;
  const ry = geometry === "circle" || geometry === "square" ? r : halfH;

  if (geometry === "rect" || geometry === "square") {
    return [
      { x: box.x - rx, y: box.y - ry },
      { x: box.x + rx, y: box.y - ry },
      { x: box.x + rx, y: box.y + ry },
      { x: box.x - rx, y: box.y + ry },
    ].map((p) => ({ x: clampCoord(p.x), y: clampCoord(p.y) }));
  }

  const steps = GEOMETRY_STEPS[geometry];
  const points: ShapePoint[] = [];
  for (let i = 0; i < steps; i++) {
    // Starting at -90° puts the first vertex at the top, so a triangle points up and a hexagon sits
    // flat — the orientations people expect when they pick those by name.
    const angle = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    points.push({
      x: clampCoord(box.x + Math.cos(angle) * rx),
      y: clampCoord(box.y + Math.sin(angle) * ry),
    });
  }
  return points;
}

/**
 * The drag-and-drop payload a palette item carries onto the canvas.
 *
 * A custom MIME type rather than `text/plain`, so dragging a block never lands in a text field and text
 * dragged from elsewhere is never mistaken for a block.
 */
export const BLOCK_DRAG_TYPE = "application/x-tixhub-block";

/** `"stage"`, or `"shape:circle"` when the item names a shape to draw. */
export function formatBlockDrag(kind: BlockKind, geometry?: Exclude<BlockGeometry, "free">): string {
  return geometry ? `${kind}:${geometry}` : kind;
}

/**
 * Read a dropped payload back, or `null` if it is not one of ours.
 *
 * Validated rather than cast: what comes off a `DataTransfer` is an arbitrary string — anything on the
 * page or from another tab can be dropped on the canvas — and an unrecognised kind used to be cast
 * straight to `BlockKind`, producing a block with no label, no size and no way to tell what it was.
 */
export function parseBlockDrag(
  payload: string,
): { kind: BlockKind; geometry: Exclude<BlockGeometry, "free"> | null } | null {
  const [kind, geometry] = payload.split(":");
  if (!Object.hasOwn(BLOCK_LABEL, kind)) return null;
  if (geometry !== undefined && !Object.hasOwn(GEOMETRY_STEPS, geometry)) return null;
  return {
    kind: kind as BlockKind,
    geometry: (geometry as Exclude<BlockGeometry, "free">) ?? null,
  };
}

/** Where a seat lives in the document: which block, and its position in that block's list. */
export interface SeatRef {
  blockKey: string;
  index: number;
}

/**
 * Patch individual seats inside their blocks.
 *
 * A block is a DEFAULT, not a container: the projection resolves `seat.categoryId ?? block.categoryId`,
 * so a single block can legitimately hold VIP and standard seats, accessible seats, or seats of
 * different types. The storage and the inventory path have always supported that — nothing in the
 * editor could produce it.
 *
 * Addressed by block key and index rather than by seat id, because a seat that has never been saved has
 * no database id to address it by, and those are exactly the seats a new chart is made of.
 */
export function updateSeats(
  doc: ChartDocument,
  targets: SeatRef[],
  patch: Partial<DocumentSeat>,
): ChartDocument {
  if (targets.length === 0) return doc;
  const byBlock = new Map<string, Set<number>>();
  for (const t of targets) {
    const set = byBlock.get(t.blockKey);
    if (set) set.add(t.index);
    else byBlock.set(t.blockKey, new Set([t.index]));
  }

  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      const indices = byBlock.get(b.key);
      // A table's seats belong to `layout_tables` and are regenerated server-side, so patching them
      // here would be overwritten on the next read — the same reason every other op skips tables.
      if (!indices || !b.seats || serverOwned(b)) return b;
      return {
        ...b,
        seats: b.seats.map((seat, i) => (indices.has(i) ? { ...seat, ...patch } : seat)),
      };
    }),
  };
}

/** Move a selection of blocks by a delta, clamped into the space. */
export function moveBlocks(
  doc: ChartDocument,
  keys: Set<string>,
  dx: number,
  dy: number,
  grid: boolean,
): ChartDocument {
  const limit = allowedDelta(doc, keys, dx, dy);
  // Grid snapping is skipped on the axis that hit the wall: rounding to the nearest grid line there
  // could push the block back out by up to half a step, and the per-seat clamp would stack the
  // overflow again. Flush against the edge is the honest landing spot.
  const snapping = grid && !limit.clamped;
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (!selectedAndEditable(b, keys)) return b;
      const to = movedPosition(b, limit.dx, limit.dy, snapping);
      // `translated`, not a spread: a drawn outline's points are absolute and have to come along.
      return translated(b, to.x, to.y);
    }),
  };
}

export function rotateBlocks(doc: ChartDocument, keys: Set<string>, degrees: number): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) =>
      selectedAndEditable(b, keys)
        ? { ...b, rotation: (((b.rotation + degrees) % 360) + 360) % 360 }
        : b,
    ),
  };
}

export function removeBlocks(doc: ChartDocument, keys: Set<string>): ChartDocument {
  return { ...doc, blocks: doc.blocks.filter((b) => !selectedAndEditable(b, keys)) };
}

/**
 * Duplicate a selection, offset, with FRESH seat ids and fresh keys.
 *
 * Seat labels are deliberately left alone. Unlike `layoutOps.duplicateSeats` — where a copy landed in
 * the same section and collided on `(section, row, number)` — a duplicated block is a new block, and
 * the organizer normally puts it in a different section or renumbers it from the inspector. The
 * publish gate still reports a collision if they do neither, which is the honest place to catch it.
 */
export function duplicateBlocks(
  doc: ChartDocument,
  keys: Set<string>,
  dx: number,
  dy: number,
): { doc: ChartDocument; keys: Set<string> } {
  const made = new Set<string>();
  let next = doc;
  // A table is skipped rather than copied: its seats are generated server-side, so a copy made here
  // would be a table-shaped block owning seats no `layout_tables` row accounts for.
  for (const source of doc.blocks.filter((b) => selectedAndEditable(b, keys))) {
    const key = nextBlockKey(next);
    made.add(key);
    next = {
      ...next,
      blocks: [
        ...next.blocks,
        {
          ...translated(source, clampCoord(source.x + dx), clampCoord(source.y + dy)),
          key,
          // A copy is not the same table, and it owns no database row yet.
          tableId: source.tableId == null ? source.tableId : null,
          seats: source.seats?.map((s) => ({ ...s, seatId: mintId() })),
        },
      ],
    };
  }
  return { doc: next, keys: made };
}

/**
 * Lock or unlock a selection.
 *
 * Goes through `updateBlock` rather than the guard above on purpose: the guard is what locking DOES,
 * so routing the unlock through it would make a locked block impossible to unlock.
 */
export function setLocked(doc: ChartDocument, keys: Set<string>, locked: boolean): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (keys.has(b.key) ? { ...b, locked } : b)),
  };
}

/**
 * Whether a colour set on this kind of block would survive a save.
 *
 * The projection writes a colour onto `layout_elements`, and only a block that BECOMES an element has
 * one: a seat block becomes a section plus its seats, which have no colour of their own — a seat's
 * colour comes from its price class. Offering a colour there would be accepted in the editor and gone
 * on the next read, so the control is not offered at all. A capacity zone is the exception among the
 * seat-bearing kinds: it draws its own outline as an `area` element and keeps a colour like any other.
 */
export function colorable(kind: BlockKind): boolean {
  return !isSeatBearing(kind) || kind === "ga-zone";
}

/**
 * Paint a selection, or clear it back to the theme's own ink with `null`.
 *
 * Locked and server-owned blocks are skipped for the same reason they are skipped by move and delete —
 * one rule for what a selection may do to a block, not one per operation.
 */
export function setBlockColor(
  doc: ChartDocument,
  keys: Set<string>,
  color: string | null,
): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) =>
      selectedAndEditable(b, keys) && colorable(b.kind) ? { ...b, color } : b,
    ),
  };
}

/** The bounding box of a selection, for align and for framing. */
export function selectionBounds(
  doc: ChartDocument,
  keys: Set<string>,
): { x: number; y: number; w: number; h: number } | null {
  const sel = doc.blocks.filter((b) => keys.has(b.key));
  if (sel.length === 0) return null;
  const x = Math.min(...sel.map((b) => b.x));
  const y = Math.min(...sel.map((b) => b.y));
  const right = Math.max(...sel.map((b) => b.x + b.width));
  const bottom = Math.max(...sel.map((b) => b.y + b.height));
  return { x, y, w: right - x, h: bottom - y };
}

export type BlockAlignEdge = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";

/** Where one block lands when aligned to an edge of the selection's box. Shared with `ChartEditor`,
 *  which applies it to tables through their own endpoint — see `movedPosition`. */
export function alignedPosition(
  box: { x: number; y: number; w: number; h: number },
  b: Pick<DocumentBlock, "x" | "y" | "width" | "height">,
  edge: BlockAlignEdge,
): { x: number; y: number } {
  switch (edge) {
    case "left":
      return { x: clampCoord(box.x), y: b.y };
    case "right":
      return { x: clampCoord(box.x + box.w - b.width), y: b.y };
    case "top":
      return { x: b.x, y: clampCoord(box.y) };
    case "bottom":
      return { x: b.x, y: clampCoord(box.y + box.h - b.height) };
    case "centerX":
      return { x: clampCoord(box.x + (box.w - b.width) / 2), y: b.y };
    default:
      return { x: b.x, y: clampCoord(box.y + (box.h - b.height) / 2) };
  }
}

/** Align two or more blocks. Fewer than two has no meaning, so it is a no-op rather than an error. */
export function alignBlocks(
  doc: ChartDocument,
  keys: Set<string>,
  edge: BlockAlignEdge,
): ChartDocument {
  const box = selectionBounds(doc, keys);
  const sel = doc.blocks.filter((b) => keys.has(b.key));
  if (!box || sel.length < 2) return doc;

  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      // A selected table still counts toward the bounding box — it is part of what the organizer
      // framed — but it is not moved to the edge here.
      if (!selectedAndEditable(b, keys)) return b;
      const to = alignedPosition(box, b, edge);
      // Same hazard as a drag, and the same reason: `alignedPosition` works from `width`/`height`, which
      // do not bound the seats, so aligning a wide row to an edge could push seats past the boundary
      // where the projection would clamp them onto one point. Pull the block back by the overflow.
      const e = blockExtent(b);
      return translated(
        b,
        clampCoord(b.x + fitDelta(to.x - b.x, e.minX, e.maxX)),
        clampCoord(b.y + fitDelta(to.y - b.y, e.minY, e.maxY)),
      );
    }),
  };
}

// ---- Sections and categories -------------------------------------------------------------------

export function addSection(doc: ChartDocument, name: string): { doc: ChartDocument; id: number } {
  const id = mintId();
  const section: DocumentSection = { id, name, seatShape: "circle", seatSizeMultiplier: 1 };
  return { doc: { ...doc, sections: [...doc.sections, section] }, id };
}

export function updateSection(
  doc: ChartDocument,
  id: number,
  patch: Partial<DocumentSection>,
): ChartDocument {
  return { ...doc, sections: doc.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/**
 * Drop a section and leave its blocks section-LESS rather than deleting them.
 *
 * Same rule as `layoutOps.removeSection`: losing a block's worth of work to a mis-click is not
 * recoverable once saved, while a sectionless block is a visible, fixable validation issue.
 */
export function removeSection(doc: ChartDocument, id: number): ChartDocument {
  return {
    ...doc,
    sections: doc.sections.filter((s) => s.id !== id),
    blocks: doc.blocks.map((b) => (b.sectionId === id ? { ...b, sectionId: null } : b)),
  };
}

export function addCategory(doc: ChartDocument, name: string): { doc: ChartDocument; id: number } {
  const id = mintId();
  const category: DocumentCategory = {
    id,
    name,
    color: CATEGORY_COLORS[doc.categories.length % CATEGORY_COLORS.length],
  };
  return { doc: { ...doc, categories: [...doc.categories, category] }, id };
}

export function updateCategory(
  doc: ChartDocument,
  id: number,
  patch: Partial<DocumentCategory>,
): ChartDocument {
  return { ...doc, categories: doc.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Drop a category and leave its blocks unclassified — never delete their seats. */
export function removeCategory(doc: ChartDocument, id: number): ChartDocument {
  return {
    ...doc,
    categories: doc.categories.filter((c) => c.id !== id),
    blocks: doc.blocks.map((b) => ({
      ...b,
      categoryId: b.categoryId === id ? null : b.categoryId,
      seats: b.seats?.map((s) => (s.categoryId === id ? { ...s, categoryId: null } : s)),
    })),
  };
}

/** Assign a whole block to a section or category — the common case, done at block level. */
export const assignSection = (doc: ChartDocument, keys: Set<string>, sectionId: number | null) => ({
  ...doc,
  blocks: doc.blocks.map((b) => (keys.has(b.key) ? { ...b, sectionId } : b)),
});

export const assignCategory = (doc: ChartDocument, keys: Set<string>, categoryId: number | null) => ({
  ...doc,
  blocks: doc.blocks.map((b) => (keys.has(b.key) ? { ...b, categoryId } : b)),
});

/** Snap step for keyboard nudging, matching the seat editor's. */
export const NUDGE = GRID;

/**
 * Give a block a new starting row index, rewriting the labels its seats already carry.
 *
 * NOT `regenerateBlock`, and the difference is the whole point. That function matches existing seats
 * by `rowLabel|seatNumber` — "identity survives iff the label survives" — which is right when the
 * labels are what stay put and the shape changes. Here the labels are exactly what changes, so every
 * seat would fail to match, every seat would be minted anew, and the save would delete the originals
 * (or be refused `seat_in_use` once a showtime had bound them).
 *
 * So the rename is POSITIONAL: row r under the old start becomes row r under the new one, and each
 * seat keeps its id, its number, its offset and everything else. A seat whose label is not one this
 * block would generate — hand-edited — is left alone rather than guessed at.
 */
export function relabelRows(block: DocumentBlock, newStart: number): DocumentBlock {
  const p = block.params;
  if (!p) return block;
  const oldStart = p.startRowIndex ?? 0;
  if (oldStart === newStart) return block;

  const rows = block.kind === "single-row" ? 1 : Math.max(1, Math.floor(p.rowsCount ?? 1));
  const rename = new Map<string, string>();
  for (let r = 0; r < rows; r += 1) {
    rename.set(
      rowLabelFor(r, rows, p.rowLabelScheme, p.rowLabelPrefix ?? "", oldStart),
      rowLabelFor(r, rows, p.rowLabelScheme, p.rowLabelPrefix ?? "", newStart),
    );
  }

  return {
    ...block,
    params: { ...p, startRowIndex: newStart },
    seats: block.seats?.map((s) => {
      const next = rename.get(s.rowLabel);
      return next === undefined ? s : { ...s, rowLabel: next };
    }),
  };
}

/**
 * Close the gaps in every section's row lettering.
 *
 * `addBlock` letters a new block PAST what its section already uses, so a section fills up A, B, C…
 * as blocks are added. Nothing did the reverse: delete the block holding A–E and the survivors stayed
 * at F–J, so a section could be lettered F–J with no A in it at all, and the next block added would
 * take A–E and sit lettered before rows that are physically in front of it.
 *
 * Three kinds of block are deliberately left alone, and between them they cover every case where
 * re-lettering would be a wrong answer rather than a tidy one:
 *
 *   - LOCKED. The existing "do not touch this" signal — a block lettered to match signage bolted to
 *     the building says so by being locked.
 *   - NO PARAMS. An adopted chart carries literal labels and no description of how they were made;
 *     inventing one to re-letter from would rename rows nobody asked to change.
 *   - TABLES. Their seats belong to `layout_tables` and are not the document's to renumber.
 *
 * Those blocks keep their labels, and everything else letters AROUND them — `firstFreeRowIndex` is
 * the same collision walk `addBlock` uses, so a packed section is exactly what adding the same blocks
 * in the same order would have produced.
 *
 * Order is preserved: blocks are re-placed in the order they were already lettered in, so closing a
 * gap never also reshuffles the section.
 */
export function repackRowLabels(doc: ChartDocument): ChartDocument {
  const movable = (b: DocumentBlock) =>
    !!b.params && isSeatBearing(b.kind) && b.kind !== "table" && !b.locked;

  const order = doc.blocks
    .map((b, i) => ({ b, i }))
    .filter((x) => movable(x.b))
    .sort((x, y) => (x.b.params!.startRowIndex ?? 0) - (y.b.params!.startRowIndex ?? 0) || x.i - y.i)
    .map((x) => x.b.key);

  // Emptied first so the blocks being re-placed do not collide with their own OLD labels — otherwise
  // the second block would letter past the first's labels while the first was still sitting on them.
  let work: ChartDocument = {
    ...doc,
    blocks: doc.blocks.map((b) => (movable(b) ? { ...b, seats: [] } : b)),
  };

  for (const key of order) {
    const original = doc.blocks.find((b) => b.key === key)!;
    const p = original.params!;
    const rows = original.kind === "single-row" ? 1 : Math.max(1, Math.floor(p.rowsCount ?? 1));
    const start = firstFreeRowIndex(work, original.sectionId, rows, p, key);
    const next = relabelRows(original, start);
    work = { ...work, blocks: work.blocks.map((b) => (b.key === key ? next : b)) };
  }
  return work;
}

/**
 * The seat types the editor may set.
 *
 * `seats.seat_type` has allowed three values since 0002 — `single`, `double`, `standing` — and this is
 * deliberately only the first two, because `standing` is not a style of seat at all. It is a structural
 * marker owned by the standing-area path, which uses it as a DELETE key:
 *
 *     DELETE FROM seats WHERE layout_id = $1 AND row_label = $2 AND seat_type = 'standing'
 *
 * A seat the organizer marked `standing` from the editor would therefore be silently destroyed by a
 * later reshape of an unrelated standing area that happened to share its row label. Offering it would
 * be offering a way to lose seats.
 */
export const EDITABLE_SEAT_TYPES = ["single", "double"] as const;
export type EditableSeatType = (typeof EDITABLE_SEAT_TYPES)[number];

/**
 * Set the type of individual seats.
 *
 * Per SEAT rather than per block, matching the column: a block is a row of ordinary seats with a pair
 * of love seats at the end far more often than it is uniformly one or the other.
 *
 * The value is checked at runtime as well as in the type, because it arrives from a `<select>` — a
 * string from the DOM, which the compiler has no say over.
 */
export function setSeatType(
  doc: ChartDocument,
  targets: SeatRef[],
  seatType: EditableSeatType,
): ChartDocument {
  if (!EDITABLE_SEAT_TYPES.includes(seatType)) return doc;
  return updateSeats(doc, targets, { seatType });
}
