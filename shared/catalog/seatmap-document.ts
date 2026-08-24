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
} from "./seatmap.js";

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
  | "seating-block"
  | "curved-row"
  | "single-row"
  | "individual-seat"
  | "table"
  | "ga-zone"
  // Decoration. These mirror `ElementKind` one-for-one, deliberately: the editor must be able to
  // create everything `layout_elements` can hold, or a kind becomes unreachable the moment the old
  // element palette is retired. `text` is stored as `label` and `shape` as `boundary`; the rest keep
  // their names.
  | "stage"
  | "aisle"
  | "door"
  | "bar"
  | "text"
  | "shape"
  | "exit"
  | "restroom"
  | "food_drink"
  | "smoking"
  | "first_aid"
  | "lift_stairs"
  | "wheelchair";

/** Kinds that produce `seats` rows. Everything else is decoration and can never become inventory. */
export const SEAT_BEARING_KINDS = [
  "seating-block",
  "curved-row",
  "single-row",
  "individual-seat",
  "table",
  "ga-zone",
] as const;

export const isSeatBearing = (k: BlockKind): boolean =>
  (SEAT_BEARING_KINDS as readonly string[]).includes(k);

export type RowLabelScheme = "alpha-asc" | "alpha-desc" | "num-asc" | "num-desc";
export type SeatLabelScheme = "num-asc" | "num-desc" | "even" | "odd";

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
  /**
   * The level this section sits on (0044). Optional and nullable, both meaning the single implicit
   * floor — so every document written before floors parses unchanged and draws exactly as it did.
   */
  floorId?: number | null;
}

/**
 * A level of the venue (0044).
 *
 * Modelled like `DocumentRow`: an id the editor may mint negative before the first save, a name, and
 * an explicit order. Deriving floors from a label on the section was the shape rows had before 0032
 * and it fails the same way here — a floor could not exist before something stood on it.
 */
export interface DocumentFloor {
  id: number;
  name: string;
  displayOrder: number;
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
  /**
   * Which `layout_rows` row this seat belongs to (0032). Absent on a seat drawn before rows existed,
   * or on one the editor has minted this session and not yet saved.
   *
   * NOT the seat's identity and never a substitute for `rowLabel`: the label is what the row is
   * CALLED and what `showtime_seats` snapshots, this is what the row IS. A rename changes the first
   * and not the second, which is the whole reason it exists.
   */
  rowId?: number | null;
  /**
   * The ACCESSIBLE seat this seat accompanies — set only on the ordinary seat, never on the
   * wheelchair seat itself.
   *
   * The direction is deliberate: a companion is swappable, but an accessible seat is the exceptional
   * thing in the pair, and the rule set reads both ends through this pointer — an ordinary seat may
   * name it (`companion_wrong_target` if the target is not wheelchair-marked), and a wheelchair seat
   * with NO seat pointing at it is `accessible_without_companion`. At most one seat may point at a
   * given accessible seat; `seatmap-validate.ts` enforces that too.
   *
   * A seat id, positive or negative like `seatId` — the editor can pair seats before the first save,
   * so the pointer must survive a round trip through `stripIds` (template export — links are dropped,
   * re-pairing is an organizer's act), `remapDocument` (clones) and `stitchSeatIds` (the save's
   * real-id rewrite). Absent means "no companion". A dangling pointer is not an invariant this type
   * can express; the validator reports `companion_wrong_target` when the seat it names is not in the
   * chart.
   */
  companionSeatId?: number;
}

/** Resolve a seat's section without collapsing explicit `null` into block inheritance. */
export const resolvedSeatSectionId = (
  seat: Pick<DocumentSeat, "sectionId">,
  block: Pick<DocumentBlock, "sectionId">,
): number | null => (seat.sectionId === undefined ? block.sectionId : seat.sectionId);

/**
 * A row of seats, as a thing rather than as a string repeated on each of its seats.
 *
 * Rows were emergent until 0032 — a row "existed" because several seats shared a `rowLabel`. That is
 * enough to draw and to sell, and not enough to operate on: inserting a row above B, reversing row C
 * or renaming row D all had to be search-and-replace across seats, and an empty row could not be
 * represented at all.
 *
 * `id` is negative when minted in the editor and not yet saved, exactly like `DocumentSeat.seatId`.
 */
export interface DocumentRow {
  id: number;
  label: string;
  sectionId: number | null;
  /** Position within its section. Only ever a DISPLAY position — never an identity (§43, §44, §45). */
  displayOrder: number;
}

/**
 * The re-editable intent. Absent means the block is NOT parametric — a free group of seats the
 * organizer positions individually, which is what an adopted pre-document layout becomes.
 */
/**
 * The widest a curved row may sweep.
 *
 * 180 is not a taste decision. A curved row generates at `dx = rr * sin(a)` with `a` spanning
 * `±arcAngle/2` (seatmap-project.ts), so at 180 the sweep is exactly ±90° — the limit of `sin`'s
 * monotonicity. Past it the arms fold back over the same x range, and `bestAvailable`'s
 * `sortAlongRow`, which orders a row by its dominant cartesian axis, would interleave them and start
 * offering buyers "adjacent" pairs from opposite ends of the room.
 *
 * The editor's slider reads its `max` from here so raising the cap cannot be a one-character edit in
 * the UI. Anything above 180 needs `sortAlongRow` to order by angle about the arc's centre, or by
 * cumulative distance along it, first.
 */
export const MAX_ARC_ANGLE = 180;

export interface BlockParams {
  rowsCount?: number;
  seatsPerRow?: number;
  /** Centre-to-centre, in layout units. Not the reference's pixels. */
  seatSpacing?: number;
  rowSpacing?: number;
  /** Curved rows only. */
  radius?: number;
  /**
   * Lay a curved block out as CONCENTRIC arcs about one focus, rows receding away from it (0044).
   *
   * The default — false, and the only behaviour before this — offsets each row by `rowSpacing` in the
   * block's own +y as well as growing its radius. The result is a stack of parallel arcs that drift
   * TOWARD the centre of curvature, which is right for a bowed theatre tier and wrong for a stadium
   * stand: whichever way such a block is rotated, either its front row ends up furthest from the
   * pitch or its ends bow away from it. The two cannot both be right, because the row offset and the
   * arc direction are coupled.
   *
   * Concentric decouples them: every row is an arc about the SAME focus, so the ends bend toward the
   * focus and the rows recede from it at once — which is what a stand around a pitch actually is.
   *
   * Off by default on purpose. Turning it on moves every seat of a curved block, and doing that to
   * charts already drawn would relocate rows under tickets that are already sold.
   */
  concentric?: boolean;
  /** Total sweep in degrees. Capped at `MAX_ARC_ANGLE` — see that constant before widening it. */
  arcAngle?: number;
  rowLabelScheme?: RowLabelScheme;
  seatLabelScheme?: SeatLabelScheme;
  rowLabelPrefix?: string;
  seatLabelPrefix?: string;
  /** Where lettering/numbering starts, so a second block can continue the first. */
  startRowIndex?: number;
  startSeatNumber?: number;
  /** Appended after a row's letter or number: "A-L", "B-L" for a left-hand block (§14). */
  rowLabelSuffix?: string;
  /** How far apart consecutive seat numbers run — 2 gives 1, 3, 5, 7, 9 (§13). Default 1. */
  seatNumberStep?: number;
  /**
   * Zero-padding for the DISPLAYED seat number: 2 shows seat 1 as "01" (§13).
   *
   * Presentation only. `seats.seat_number` is an integer and stays one — see `seatDisplay`.
   */
  seatNumberPadding?: number;
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
  tableShape?: "round" | "rect";
  tableSeatCount?: number;
  sideCounts?: number[] | null;
  bookingMode?: TableBookingMode;
  /** Decoration: the rendered text, and the vertices of a `shape`. */
  label?: string | null;
  points?: ShapePoint[] | null;
  /** A drawn outline's fill colour (six hex digits), and the named shape it was generated as. */
  color?: string | null;
  geometry?: string | null;
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
  /**
   * Hidden from the canvas while drawing (§5, §23). Authoring-only, exactly like `locked`.
   *
   * The projection never reads it, and must never start to: hiding is how an organizer gets a
   * finished block out of the way while working behind it, and if it removed seats then tidying the
   * screen would quietly take a row off sale.
   */
  hidden?: boolean;
  /**
   * Blocks that move as one (§6). Authoring-only, like `locked` and `hidden`.
   *
   * A stage and the surround drawn around it are one thing to the person who drew them and two rows
   * to the database; this is the difference. The projection ignores it — grouping changes what a
   * DRAG does, never what is for sale.
   */
  groupId?: string;
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
  /**
   * The chart's rows (0032). Optional so every document written before rows existed still parses —
   * `adoptLayout` and the projection both derive rows from seat labels when this is absent, which is
   * exactly what they did before.
   */
  rows?: DocumentRow[];
  /**
   * The chart's levels (0044). Optional: absent means the chart is on one floor, which is what every
   * chart drawn before floors is and what most charts will always be.
   */
  floors?: DocumentFloor[];
}

/** An empty document, for a layout that has just been created. */
export function emptyDocument(gridSize = 50): ChartDocument {
  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    gridSize,
    sections: [],
    categories: [],
    blocks: [],
    rows: [],
  };
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
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const raw = input as Partial<ChartDocument>;
  if (
    !Array.isArray(raw.blocks) ||
    !Array.isArray(raw.categories) ||
    !Array.isArray(raw.sections)
  ) {
    return null;
  }
  // Only one schema exists so far. Future versions add cases here, never in SQL.
  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    gridSize: typeof raw.gridSize === "number" && raw.gridSize > 0 ? raw.gridSize : 50,
    // `companionSeatId` added after schema 1 shipped: old blobs simply lack it, and the rebuild below
    // keeps the field on any seat that carries one — the per-seat fields of `blocks` are NOT rebuilt
    // here, they pass through as stored, so an absent field stays absent and a present one survives.
    sections: raw.sections,
    categories: raw.categories,
    blocks: raw.blocks,
    // Named explicitly, like everything above it: this function rebuilds the document field by field
    // rather than spreading, so a field it does not mention is silently dropped on every read. That is
    // deliberate — it is what stops an unknown key surviving a schema change — but it means a new
    // field has to be added HERE as well as to the type, or it round-trips to nothing.
    //
    // `?? []` rather than left undefined: a document written before rows existed reads back as a
    // chart with no rows declared, which is exactly what it is, and the projection derives them.
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    // Floors (0044) — and this line is exactly what the note above is about. The field was added to
    // the type and to every writer, but not here, so every read rebuilt the document WITHOUT it: a
    // two-tier chart came back to the editor with no levels, no layer picker, and a section pointing
    // at a floor the document no longer declared.
    floors: Array.isArray(raw.floors) ? raw.floors : [],
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
  // Rows carry real ids too (0032), and a template that kept them would have the same failure mode as
  // one that kept seat ids: the importing layout's first save would UPDATE rows belonging to another
  // chart and then delete its own.
  const rowMap = new Map<number, number>();
  const rows = doc.rows?.map((r) => ({
    ...r,
    id: remap(rowMap, r.id) as number,
    sectionId: remap(sectionMap, r.sectionId),
  }));

  return {
    ...doc,
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    sections,
    categories,
    rows,
    blocks: doc.blocks.map((b) => ({
      ...b,
      sectionId: remap(sectionMap, b.sectionId),
      categoryId: remap(categoryMap, b.categoryId),
      tableId: b.tableId === null || b.tableId === undefined ? null : mint(),
      seats: b.seats?.map((s) => ({
        ...s,
        seatId: mint(),
        sectionId:
          s.sectionId === null || s.sectionId === undefined
            ? s.sectionId
            : remap(sectionMap, s.sectionId),
        categoryId:
          s.categoryId === null || s.categoryId === undefined
            ? s.categoryId
            : remap(categoryMap, s.categoryId),
        rowId: s.rowId === null || s.rowId === undefined ? s.rowId : remap(rowMap, s.rowId),
        // The companion link is DROPPED on template export. Both ends exist in the exported chart, so
        // the pair could in principle be remapped — but a link across a fresh import would silently
        // bind a seat the importing organizer never chose for it. Re-pairing is deliberate; an export
        // starts from scratch.
        companionSeatId: undefined,
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
  /** Rows (0032). Optional: on the save path `stitchRows` has already made them real. */
  rows?: Map<number, number>;
  /** Floors (0044). Optional for the same reason rows are, and absent on a single-floor chart. */
  floors?: Map<number, number>;
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
    /*
     * A section's FLOOR is remapped for the same reason its own id is: a clone that kept the source's
     * floor ids would point its sections at another layout's levels, and the floor picker would then
     * filter a chart by rows that belong to a different venue entirely.
     */
    sections: doc.sections.map((s) => ({
      ...s,
      id: ids.sections.get(s.id) ?? mint(),
      /*
       * Remapped ONLY when the floors themselves are, and never minted.
       *
       * `via` mints a fresh placeholder for anything the map does not answer, which is right for a
       * section or a category — a clone must not address the source's rows. It is wrong here: a
       * minted floor id points at a level that exists nowhere, so the section silently left the floor
       * it was on. Every caller that does not remap floors leaves both `floors` and `floorId` alone,
       * which keeps the document internally consistent either way.
       */
      floorId: ids.floors
        ? s.floorId === null || s.floorId === undefined
          ? s.floorId
          : (ids.floors.get(s.floorId) ?? null)
        : s.floorId,
    })),
    floors: ids.floors
      ? doc.floors?.map((f) => ({ ...f, id: ids.floors!.get(f.id) ?? f.id }))
      : doc.floors,
    categories: doc.categories.map((c) => ({ ...c, id: ids.categories.get(c.id) ?? mint() })),
    /*
     * Rows carry a section id too, and it has to be remapped for exactly the reason the blocks' is.
     *
     * Missing this was subtle rather than loud: a row drawn into a section created in the same save
     * kept the section's PLACEHOLDER id, while the seats in it got the real one. Nothing failed — the
     * document stored and read back fine — but the projection keys rows on `(sectionId, label)`, so
     * on the NEXT save no stored row matched any seat's row and a second, complete set of rows was
     * minted. The chart silently doubled its rows on every save.
     */
    rows: doc.rows?.map((r) => ({
      ...r,
      id: ids.rows?.get(r.id) ?? r.id,
      sectionId: via(ids.sections, r.sectionId),
    })),
    blocks: doc.blocks.map((b) => ({
      ...b,
      sectionId: via(ids.sections, b.sectionId),
      categoryId: via(ids.categories, b.categoryId),
      tableId: via(ids.tables, b.tableId),
      seats: b.seats?.map((s) => ({
        ...s,
        seatId: ids.seats.get(s.seatId) ?? mint(),
        sectionId:
          s.sectionId === null || s.sectionId === undefined
            ? s.sectionId
            : via(ids.sections, s.sectionId),
        categoryId:
          s.categoryId === null || s.categoryId === undefined
            ? s.categoryId
            : via(ids.categories, s.categoryId),
        // A CLONE keeps its wheels: both ends of a companion pair live in the same chart, and this map
        // covers every seat of it, so the pointer resolves to the companion's own clone id — even
        // across blocks, because `ids.seats` is complete before any block is remapped. A target the
        // map does not cover is handled like every other unknown id: a fresh placeholder, which the
        // subsequent validation flags as `companion_wrong_target` rather than silently surviving.
        companionSeatId:
          s.companionSeatId === undefined
            ? undefined
            : (via(ids.seats, s.companionSeatId) ?? undefined),
      })),
    })),
  };
}

/** Decoration element kinds mapped to the block kind that renders them. */
const ELEMENT_TO_BLOCK: Record<ElementKind, BlockKind> = {
  stage: "stage",
  aisle: "aisle",
  door: "door",
  bar: "bar",
  label: "text",
  area: "ga-zone",
  boundary: "shape",
  divider: "shape",
  exit: "exit",
  restroom: "restroom",
  food_drink: "food_drink",
  smoking: "smoking",
  first_aid: "first_aid",
  lift_stairs: "lift_stairs",
  wheelchair: "wheelchair",
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
  // Seats that lose their id, indexed old id → new placeholder. Built BEFORE the seats are rewritten,
  // so a companion pointer whose target was re-minted keeps following it. Without that map, reviving
  // a revision that dropped the wheelchair seat would leave its companion pointing at a dead row, and
  // the validator would report `companion_wrong_target` for a pairing the organizer never broke.
  const revived = new Map<number, number>();
  const freshOf = (id: number): number => {
    const known = revived.get(id);
    if (known !== undefined) return known;
    const fresh = mint();
    revived.set(id, fresh);
    return fresh;
  };
  for (const b of doc.blocks) {
    for (const seat of b.seats ?? []) {
      if (seat.seatId > 0 && !liveSeatIds.has(seat.seatId)) freshOf(seat.seatId);
    }
  }

  return {
    ...doc,
    blocks: doc.blocks.map((b) =>
      b.seats
        ? {
            ...b,
            seats: b.seats.map((seat) => {
              const seatId = revived.has(seat.seatId) ? revived.get(seat.seatId)! : seat.seatId;
              const companionSeatId =
                seat.companionSeatId === undefined
                  ? undefined
                  : (revived.get(seat.companionSeatId) ?? seat.companionSeatId);
              return { ...seat, seatId, companionSeatId };
            }),
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
      // Carried for the same reason the style fields are: adoption happens whenever the rows change
      // outside the document, and handing back a section with no floor would drop it onto the ground
      // level on the next save — silently flattening a balcony an organizer had already built.
      floorId: s.floorId ?? null,
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
      kind: "table",
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
        // Normalise the nullable column onto the document's `number | undefined` shape (0036).
        companionSeatId: seat.companionSeatId ?? undefined,
      });
      continue;
    }
    const k = `${seat.sectionId ?? "none"}|${seat.categoryId ?? "none"}`;
    const bucket = groups.get(k);
    if (bucket) bucket.push(seat);
    else groups.set(k, [seat]);
  }

  for (const [k, seats] of groups) {
    const [sec, cat] = k.split("|");
    const sectionId = sec === "none" ? null : Number(sec);
    const originX = Math.min(...seats.map((s) => s.x));
    const originY = Math.min(...seats.map((s) => s.y));
    blocks.push({
      key: key(),
      kind: seats.length === 1 ? "individual-seat" : "seating-block",
      title: sectionId === null ? "Ghế chưa thuộc khu" : (sectionName.get(sectionId) ?? "Khu"),
      x: originX,
      y: originY,
      rotation: 0,
      width: Math.max(1, Math.max(...seats.map((s) => s.x)) - originX),
      height: Math.max(1, Math.max(...seats.map((s) => s.y)) - originY),
      sectionId,
      categoryId: cat === "none" ? null : Number(cat),
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
        // Kept for the same reason the colour and geometry of an element are: re-adoption happens
        // whenever geometry changes outside the document, and handing back seats with no row would
        // make the next save mint a second set of rows for labels that already have them.
        rowId: s.rowId,
        // Normalise the nullable column onto the document's `number | undefined` shape (0036).
        companionSeatId: s.companionSeatId ?? undefined,
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
      // Both kept, for the same reason the colour below is. Re-adoption happens whenever geometry
      // changes outside the document — a table placed, a standing area reshaped — and it used to hand
      // back every element unassigned: a shape detached from the stand it outlines, and, worse, a
      // capacity zone detached from the price class its capacity is SOLD under, which turned a
      // publishable chart into `zone_without_category` with nothing to show what had changed.
      sectionId: el.sectionId ?? null,
      categoryId: el.categoryId ?? null,
      label: el.label,
      points: el.points ?? null,
      capacity: el.capacity ?? undefined,
      // Kept, or re-reading a chart after a table edit would strip every outline back to theme ink and
      // forget that a ring was ever meant to be a circle.
      color: el.color ?? null,
      geometry: el.geometry ?? null,
    });
  }

  // The layout's own rows, verbatim. A chart adopted before 0032 simply has none, and the projection
  // derives them from the seat labels exactly as it did then.
  const rows: DocumentRow[] = layout.rows.map((r) => ({
    id: r.id,
    label: r.label,
    sectionId: r.sectionId,
    displayOrder: r.displayOrder,
  }));

  /** The chart's levels, verbatim. A single-floor chart simply has none. */
  const floors: DocumentFloor[] = layout.floors
    .filter((f) => f.id !== undefined)
    .map((f) => ({ id: f.id as number, name: f.name, displayOrder: f.displayOrder }));

  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    gridSize,
    sections,
    categories,
    rows,
    floors,
    blocks,
  };
}
