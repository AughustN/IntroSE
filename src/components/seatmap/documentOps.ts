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
  type DocumentSection,
  isSeatBearing,
  nextBlockKey,
} from "@/shared/catalog/seatmap-document";
import { regenerateBlock, rowLabelFor } from "@/shared/catalog/seatmap-project";
import { LAYOUT_MAX_SEATS, clampCoord } from "@/shared/catalog/seatmap-validate";
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
function firstFreeRowIndex(
  doc: ChartDocument,
  sectionId: number | null,
  rows: number,
  params: BlockParams,
): number {
  const used = new Set<string>();
  for (const b of doc.blocks) {
    for (const seat of b.seats ?? []) {
      const section = seat.sectionId ?? b.sectionId;
      if (section === sectionId) used.add(seat.rowLabel);
    }
  }
  if (used.size === 0) return 0;

  // Bounded so a pathological chart cannot spin: past MAX_ROWS the publish gate reports the collision
  // rather than the editor hunting forever.
  for (let start = 0; start <= MAX_ROWS; start++) {
    let clear = true;
    for (let r = 0; r < rows && clear; r++) {
      const label = rowLabelFor(r, rows, params.rowLabelScheme, params.rowLabelPrefix, start);
      if (used.has(label)) clear = false;
    }
    if (clear) return start;
  }
  return 0;
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
  opts: { sectionId?: number | null; categoryId?: number | null; grid?: boolean } = {},
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
  const next = regenerateBlock(
    { ...target, params: { ...target.params, ...patch } },
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

/** Move a selection of blocks by a delta, clamped into the space. */
export function moveBlocks(
  doc: ChartDocument,
  keys: Set<string>,
  dx: number,
  dy: number,
  grid: boolean,
): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) =>
      selectedAndEditable(b, keys) ? { ...b, ...movedPosition(b, dx, dy, grid) } : b,
    ),
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
          ...source,
          key,
          x: clampCoord(source.x + dx),
          y: clampCoord(source.y + dy),
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
    blocks: doc.blocks.map((b) =>
      // A selected table still counts toward the bounding box — it is part of what the organizer
      // framed — but it is not moved to the edge here.
      selectedAndEditable(b, keys) ? { ...b, ...alignedPosition(box, b, edge) } : b,
    ),
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
