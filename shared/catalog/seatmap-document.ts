// The seat-map authoring DOCUMENT, shared by server and web (Principle VI).
//
// This is the fourth shape in the seatmap contract, and the only one that is not a read:
//
//   `Layout`      (./seatmap.ts)  — the normalized rows, what the editor loads and the server saves
//   `SeatMap`     (./types.ts)    — the buyer's read, from `showtime_seats`
//   `ShowtimeMap` (./seatmap.ts)  — the organizer's read of one showtime's inventory
//   `ChartDocument` (here)        — design INTENT: how the chart was built, not what is for sale
//
// The distinction is the whole point. A `LayoutSeat` records that a seat sits at (4820, 3100); a
// `ChartDocument` records that it is the 7th seat of the 3rd row of a 6 × 18 block whose rows are
// lettered A-ascending — so changing that block to 20 seats per row is an edit rather than a redraw.
//
// The document is projected one way into the normalized rows on every save
// (./seatmap-project.ts). Nothing that sells ever reads it: a paid ticket reaches a chart through
// `showtime_seats.seat_id -> seats.id`, so the rows remain the sellable truth.
//
// Coordinates are LAYOUT UNITS — the same integer 0–10000 space as `LayoutSeat`, with a nominal seat
// diameter of 100 (./seatmap-validate.ts). Deliberately not pixels: the reference editor this was
// ported from authored in a 1600 × 1200 pixel canvas, and persisting a canvas size would mean every
// reader had to scale, and two documents with different canvas sizes could not be compared or cloned.
// The conversion is a one-time import concern (./seatmap-import.ts), not a stored property.

import type {
  ElementKind,
  Layout,
  SeatShape,
  SeatType,
  ShapePoint,
  TableBookingMode,
} from './seatmap.js';

/** Bumped only when a stored document needs `upgradeDocument` to read it. */
export const CHART_DOCUMENT_SCHEMA = 1;

/**
 * What a block is. Seat-bearing kinds project to `seats` rows; the rest to `layout_elements`.
 *
 * `table` rather than the reference's `vip-table` because `layout_tables` has no notion of VIP — that
 * is a category, and a table can be any class. `screen` and `shape` from the reference are gone:
 * `screen` had no renderer branch and no row to project to, and a decorative outline is `shape`.
 */
export type BlockKind =
  // Seat-bearing
  | 'seating-block'
  | 'curved-row'
  | 'single-row'
  | 'individual-seat'
  | 'table'
  | 'ga-zone'
  // Decoration. These mirror `ElementKind` one-for-one, deliberately: the editor must be able to
  // create everything `layout_elements` can hold, or a kind becomes unreachable the moment the old
  // element palette is retired. `text` is stored as `label` and `shape` as `boundary`; the rest keep
  // their names.
  | 'stage'
  | 'aisle'
  | 'door'
  | 'bar'
  | 'text'
  | 'shape'
  | 'exit'
  | 'restroom'
  | 'food_drink'
  | 'smoking'
  | 'first_aid'
  | 'lift_stairs'
  | 'wheelchair';

/** Kinds that produce `seats` rows. Everything else is decoration and can never become inventory. */
export const SEAT_BEARING_KINDS = [
  'seating-block',
  'curved-row',
  'single-row',
  'individual-seat',
  'table',
  'ga-zone',
] as const;

export const isSeatBearing = (k: BlockKind): boolean =>
  (SEAT_BEARING_KINDS as readonly string[]).includes(k);

export type RowLabelScheme = 'alpha-asc' | 'alpha-desc' | 'num-asc' | 'num-desc';
export type SeatLabelScheme = 'num-asc' | 'num-desc' | 'even' | 'odd';

/**
 * A price class, mirroring `LayoutCategory`.
 *
 * There is NO price field, and that omission is load-bearing rather than an oversight. Price lives on
 * `ticket_tiers` per showtime (migration 0021 states the reason: one chart resells at many prices
 * without being redrawn), and the buyer's colours are derived from this `color` joined through
 * `ticket_tiers.category_id` at read time. A price here would be a second price that no sale ever
 * reads — not merely redundant but wrong on screen, since the organizer would type one number and
 * sell at another. The reference editor put `price` on its category in six places; keeping the field
 * out means re-adding it is a compile error rather than something a reviewer has to catch.
 */
export interface DocumentCategory {
  id: number;
  name: string;
  color: string;
}

/**
 * A spatial group, mirroring `LayoutSection`.
 *
 * The reference editor has no section concept at all, but TixHub's sections carry `seatShape` and
 * `seatSizeMultiplier`, which reach buyers and feed the publish-time overlap test. A block with no
 * section projects to sectionless seats, which `validateLayout` reports as `seat_without_section` and
 * which therefore cannot be published — so every block names one.
 */
export interface DocumentSection {
  id: number;
  name: string;
  seatShape?: SeatShape;
  seatSizeMultiplier?: number;
}

/**
 * One materialised seat, positioned RELATIVE to its block.
 *
 * `seatId` is the crux of the whole design. Positive means a real `seats.id`: the projection copies it
 * onto the `LayoutSeat` it emits, so `saveLayout`'s existing "UPDATE if it has an id, INSERT if not"
 * keeps the row — and with it every `showtime_seats.seat_id` pointing at it. Negative means minted in
 * the editor and never persisted (`layoutOps.mintId`). The reference editor generated ids with
 * `Math.random()` on every page load, which would have detached a sold ticket on the first save.
 */
export interface DocumentSeat {
  seatId: number;
  rowLabel: string;
  /** Integer, ≥ 1: `seats.seat_number` is `INT NOT NULL` inside `UNIQUE (section_id, row_label, seat_number)`. */
  seatNumber: number;
  /** Offset from the block's origin, in layout units, before the block's rotation is applied. */
  dx: number;
  dy: number;
  rotation: number;
  /** Absent means "inherit the block's". */
  categoryId?: number | null;
  sectionId?: number | null;
  isAccessible?: boolean;
  seatType?: SeatType;
}

/**
 * The re-editable intent. Absent means the block is NOT parametric — a free group of seats the
 * organizer positions individually, which is what an adopted pre-document layout becomes.
 */
export interface BlockParams {
  rowsCount?: number;
  seatsPerRow?: number;
  /** Centre-to-centre, in layout units. Not the reference's pixels. */
  seatSpacing?: number;
  rowSpacing?: number;
  /** Curved rows only. */
  radius?: number;
  arcAngle?: number;
  rowLabelScheme?: RowLabelScheme;
  seatLabelScheme?: SeatLabelScheme;
  rowLabelPrefix?: string;
  seatLabelPrefix?: string;
  /** Where lettering/numbering starts, so a second block can continue the first. */
  startRowIndex?: number;
  startSeatNumber?: number;
}

export interface DocumentBlock {
  /**
   * Editor-local identity, and deliberately NOT a database id — `layout_elements` are replaced
   * wholesale on save because they carry no identity anything else points at.
   *
   * Must be deterministic (`nextBlockKey`), never `Date.now()` or `Math.random()` as the reference
   * used: otherwise two saves of identical content produce different documents and a diff means
   * nothing.
   */
  key: string;
  kind: BlockKind;
  title: string;
  /** Absolute, layout units. */
  x: number;
  y: number;
  rotation: number;
  /**
   * Advisory bounding box, used for hit-testing and for sizing decoration. It does NOT bound the
   * block's seats — a round table's seats sit outside it by design — and the projection never clips
   * seats to it.
   */
  width: number;
  height: number;
  sectionId: number | null;
  categoryId: number | null;
  params?: BlockParams;
  /** `ga-zone`: how many standing positions to generate inside the shape. */
  capacity?: number;
  /** `table`: mirrors `LayoutTable`. `round`/`rect` matches the `layout_tables.shape` CHECK. */
  tableId?: number | null;
  tableShape?: 'round' | 'rect';
  tableSeatCount?: number;
  sideCounts?: number[] | null;
  bookingMode?: TableBookingMode;
  /** Decoration: the rendered text, and the vertices of a `shape`. */
  label?: string | null;
  points?: ShapePoint[] | null;
  /** Seat-bearing kinds only. */
  seats?: DocumentSeat[];
  /**
   * Locked blocks are skipped by every editing operation.
   *
   * An authoring concern, not an inventory one: it protects a finished stage or a laid-out stalls
   * block from being dragged while the organizer works around it. It is deliberately NOT a
   * permission — the projection ignores it entirely, so a locked block sells exactly like any other.
   */
  locked?: boolean;
}

/**
 * The stored document.
 *
 * Deliberately absent, each because something else already owns it: `id`/`name`/`updatedAt`
 * (`venue_layouts`), `canvasWidth`/`canvasHeight` (the layout space is fixed at 0–10000),
 * `blueprint` (`venue_layouts.background_*` and `reference_*`, behind an upload pipeline that sniffs
 * magic bytes and re-encodes — a URL inside a pasted blob would be a file this server serves
 * unvalidated), `snapToGrid` (an input aid, and the reference's own toggle was wired to dead state),
 * and `zIndex` (stored but never used for ordering; draw order is array order).
 */
export interface ChartDocument {
  schemaVersion: number;
  /** Snap cell for the editor, in layout units. An input aid; stored so it survives a reload. */
  gridSize: number;
  sections: DocumentSection[];
  categories: DocumentCategory[];
  blocks: DocumentBlock[];
}

/** An empty document, for a layout that has just been created. */
export function emptyDocument(gridSize = 50): ChartDocument {
  return { schemaVersion: CHART_DOCUMENT_SCHEMA, gridSize, sections: [], categories: [], blocks: [] };
}

/**
 * The next free block key: `b1`, `b2`, … Monotonic and derived only from what is already there, so
 * saving the same chart twice produces byte-identical documents.
 */
export function nextBlockKey(doc: ChartDocument): string {
  let max = 0;
  for (const b of doc.blocks) {
    const n = /^b(\d+)$/.exec(b.key);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `b${max + 1}`;
}

/**
 * Bring a stored document up to the current schema, on READ.
 *
 * Not a SQL migration: a blob rewritten by SQL is a blob upgraded twice if the code also handles it,
 * and SQL cannot re-derive a label scheme. Read-time upgrade is the boring option, and it is the only
 * one compatible with "nothing auto-migrates" — an un-upgraded document simply reads correctly and is
 * rewritten by the next save.
 *
 * Returns null when the input is not a document at all, so `getLayout` can fall back to adoption
 * rather than throwing on a hand-edited row.
 */
export function upgradeDocument(input: unknown): ChartDocument | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const raw = input as Partial<ChartDocument>;
  if (!Array.isArray(raw.blocks) || !Array.isArray(raw.categories) || !Array.isArray(raw.sections)) {
    return null;
  }
  // Only one schema exists so far. Future versions add cases here, never in SQL.
  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    gridSize: typeof raw.gridSize === 'number' && raw.gridSize > 0 ? raw.gridSize : 50,
    sections: raw.sections,
    categories: raw.categories,
    blocks: raw.blocks,
  };
}

/**
 * Replace every persisted id with a fresh negative placeholder.
 *
 * An export is a TEMPLATE. Carrying `seats.id = 41827` into another venue would make that venue's
 * first save issue `UPDATE seats … WHERE id = 41827 AND layout_id = <the new one>` — a no-op — and
 * then delete every seat the new layout actually has. Silent, and it leaves a layout that looks
 * correct in the list with nothing in it.
 */
export function stripIds(doc: ChartDocument, mint: () => number): ChartDocument {
  const sectionMap = new Map<number, number>();
  const categoryMap = new Map<number, number>();
  const remap = (map: Map<number, number>, id: number | null | undefined): number | null => {
    if (id === null || id === undefined) return null;
    const existing = map.get(id);
    if (existing !== undefined) return existing;
    const fresh = mint();
    map.set(id, fresh);
    return fresh;
  };

  const sections = doc.sections.map((s) => ({ ...s, id: remap(sectionMap, s.id) as number }));
  const categories = doc.categories.map((c) => ({ ...c, id: remap(categoryMap, c.id) as number }));

  return {
    ...doc,
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    sections,
    categories,
    blocks: doc.blocks.map((b) => ({
      ...b,
      sectionId: remap(sectionMap, b.sectionId),
      categoryId: remap(categoryMap, b.categoryId),
      tableId: b.tableId === null || b.tableId === undefined ? null : mint(),
      seats: b.seats?.map((s) => ({
        ...s,
        seatId: mint(),
        sectionId: s.sectionId === null || s.sectionId === undefined ? s.sectionId : remap(sectionMap, s.sectionId),
        categoryId: s.categoryId === null || s.categoryId === undefined ? s.categoryId : remap(categoryMap, s.categoryId),
      })),
    })),
  };
}

/** Old id → new id, for every collection a clone re-creates. */
export interface IdRemap {
  sections: Map<number, number>;
  categories: Map<number, number>;
  seats: Map<number, number>;
  tables: Map<number, number>;
}

/**
 * Point a cloned document at the clone's own rows.
 *
 * Without this a clone opens holding the SOURCE's ids — the `stripIds` failure mode, but arrived at by
 * copying rather than exporting. Anything the maps do not cover becomes a negative placeholder, so the
 * next save re-creates it rather than silently addressing a row in another layout.
 */
export function remapDocument(doc: ChartDocument, ids: IdRemap, mint: () => number): ChartDocument {
  const via = (map: Map<number, number>, id: number | null | undefined): number | null => {
    if (id === null || id === undefined) return null;
    return map.get(id) ?? mint();
  };
  return {
    ...doc,
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    sections: doc.sections.map((s) => ({ ...s, id: ids.sections.get(s.id) ?? mint() })),
    categories: doc.categories.map((c) => ({ ...c, id: ids.categories.get(c.id) ?? mint() })),
    blocks: doc.blocks.map((b) => ({
      ...b,
      sectionId: via(ids.sections, b.sectionId),
      categoryId: via(ids.categories, b.categoryId),
      tableId: via(ids.tables, b.tableId),
      seats: b.seats?.map((s) => ({
        ...s,
        seatId: ids.seats.get(s.seatId) ?? mint(),
        sectionId: s.sectionId === null || s.sectionId === undefined ? s.sectionId : via(ids.sections, s.sectionId),
        categoryId: s.categoryId === null || s.categoryId === undefined ? s.categoryId : via(ids.categories, s.categoryId),
      })),
    })),
  };
}

/** Decoration element kinds mapped to the block kind that renders them. */
const ELEMENT_TO_BLOCK: Record<ElementKind, BlockKind> = {
  stage: 'stage',
  aisle: 'aisle',
  door: 'door',
  bar: 'bar',
  label: 'text',
  area: 'ga-zone',
  boundary: 'shape',
  divider: 'shape',
  exit: 'exit',
  restroom: 'restroom',
  food_drink: 'food_drink',
  smoking: 'smoking',
  first_aid: 'first_aid',
  lift_stairs: 'lift_stairs',
  wheelchair: 'wheelchair',
};

/**
 * Synthesise a document from the normalized rows, for a layout drawn before documents existed.
 *
 * Applied on read when `venue_layouts.document IS NULL`, which is every chart in the database today.
 * This is what makes the feature shippable without a data migration: no existing layout is rewritten,
 * no seat id changes, and nothing is silently relabelled.
 *
 * Seats are grouped by `(sectionId, categoryId)` into one block each, with `params` ABSENT — meaning
 * "not parametric". The editor shows such a block as a free group of seats: movable and editable
 * seat-by-seat, with the parametric controls offered but not applied until the organizer opts in
 * (which will relabel, and says so). Inferring `rowsCount × seatsPerRow` here instead would be a
 * guess, and a wrong guess would relabel seats that may already be sold.
 *
 * Lossless by construction: each block's origin is its seats' bounding-box corner and each seat keeps
 * its absolute position as `origin + (dx, dy)` with no rotation, so
 * `projectDocument(adoptLayout(L)).seats` reproduces `L.seats` exactly.
 */
/**
 * Make an old document safe to save again.
 *
 * A stored revision names the seat rows that existed when it was taken. Some of them are gone — that
 * is usually WHY the organizer is going back. `saveLayout` treats a positive id as "update this row",
 * and an update against a deleted row matches nothing and reports nothing, so restoring an older,
 * larger chart silently came back with the smaller one's seats and no error at all.
 *
 * So: a seat whose id is still live keeps it — that is what preserves identity, and with it any ticket
 * sold against that seat. A seat whose id is gone is re-minted as a fresh placeholder, and comes back
 * as a new row. The seats that survive are exactly the ones that can survive.
 */
export function reviveDocument(
  doc: ChartDocument,
  liveSeatIds: Set<number>,
  mint: () => number,
): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) =>
      b.seats
        ? {
            ...b,
            seats: b.seats.map((seat) =>
              seat.seatId > 0 && !liveSeatIds.has(seat.seatId)
                ? { ...seat, seatId: mint() }
                : seat,
            ),
          }
        : b,
    ),
  };
}

export function adoptLayout(layout: Layout, gridSize = 50): ChartDocument {
  const sections: DocumentSection[] = layout.sections
    .filter((s) => s.id !== undefined)
    .map((s) => ({
      id: s.id as number,
      name: s.name,
      seatShape: s.seatShape,
      seatSizeMultiplier: s.seatSizeMultiplier,
    }));
  const categories: DocumentCategory[] = layout.categories
    .filter((c) => c.id !== undefined)
    .map((c) => ({ id: c.id as number, name: c.name, color: c.color }));

  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  const blocks: DocumentBlock[] = [];
  let n = 0;
  const key = () => `b${(n += 1)}`;

  // Tables first: their seats belong to the table block, not to a section group.
  const tableOf = new Map<number, DocumentBlock>();
  for (const t of layout.tables) {
    if (t.id === undefined) continue;
    const block: DocumentBlock = {
      key: key(),
      kind: 'table',
      title: t.name,
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      width: t.width,
      height: t.height,
      sectionId: t.sectionId,
      categoryId: t.categoryId ?? null,
      tableId: t.id,
      tableShape: t.shape,
      tableSeatCount: t.seatCount,
      sideCounts: t.sideCounts ?? null,
      bookingMode: t.bookingMode,
      seats: [],
    };
    tableOf.set(t.id, block);
    blocks.push(block);
  }

  // Then the loose seats, grouped by where they are and what class they are.
  const groups = new Map<string, typeof layout.seats>();
  for (const seat of layout.seats) {
    if (seat.tableId != null && tableOf.has(seat.tableId)) {
      const block = tableOf.get(seat.tableId)!;
      // Offsets are BLOCK-LOCAL, so they must be un-rotated on the way in: the block carries the
      // table's rotation, and `projectDocument` re-applies it. Storing the world-space delta instead
      // would rotate a rotated table's seats a second time on every save, walking them around the
      // table a little further each time — invisible at rotation 0, which is why it hid.
      const rad = (((block.rotation % 360) + 360) % 360) * (Math.PI / 180);
      const wx = seat.x - block.x;
      const wy = seat.y - block.y;
      block.seats!.push({
        seatId: seat.id ?? 0,
        rowLabel: seat.rowLabel,
        seatNumber: seat.seatNumber,
        dx: Math.round(wx * Math.cos(rad) + wy * Math.sin(rad)),
        dy: Math.round(-wx * Math.sin(rad) + wy * Math.cos(rad)),
        rotation: seat.rotation,
        isAccessible: seat.isAccessible,
        seatType: seat.seatType,
      });
      continue;
    }
    const k = `${seat.sectionId ?? 'none'}|${seat.categoryId ?? 'none'}`;
    const bucket = groups.get(k);
    if (bucket) bucket.push(seat);
    else groups.set(k, [seat]);
  }

  for (const [k, seats] of groups) {
    const [sec, cat] = k.split('|');
    const sectionId = sec === 'none' ? null : Number(sec);
    const originX = Math.min(...seats.map((s) => s.x));
    const originY = Math.min(...seats.map((s) => s.y));
    blocks.push({
      key: key(),
      kind: seats.length === 1 ? 'individual-seat' : 'seating-block',
      title: sectionId === null ? 'Ghế chưa thuộc khu' : (sectionName.get(sectionId) ?? 'Khu'),
      x: originX,
      y: originY,
      rotation: 0,
      width: Math.max(1, Math.max(...seats.map((s) => s.x)) - originX),
      height: Math.max(1, Math.max(...seats.map((s) => s.y)) - originY),
      sectionId,
      categoryId: cat === 'none' ? null : Number(cat),
      // No `params`: this group was not built from parameters, and pretending otherwise would let a
      // regeneration relabel seats that may already be sold.
      seats: seats.map((s) => ({
        seatId: s.id ?? 0,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        dx: s.x - originX,
        dy: s.y - originY,
        rotation: s.rotation,
        isAccessible: s.isAccessible,
        seatType: s.seatType,
      })),
    });
  }

  for (const el of layout.elements) {
    blocks.push({
      key: key(),
      // Total map, so no stored element can be silently reduced to a generic shape.
      kind: ELEMENT_TO_BLOCK[el.kind],
      title: el.label ?? el.kind,
      x: el.x,
      y: el.y,
      rotation: el.rotation,
      width: el.width,
      height: el.height,
      sectionId: null,
      categoryId: null,
      label: el.label,
      points: el.points ?? null,
      capacity: el.capacity ?? undefined,
    });
  }

  return { schemaVersion: CHART_DOCUMENT_SCHEMA, gridSize, sections, categories, blocks };
}
