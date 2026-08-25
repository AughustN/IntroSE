// Built-in starter charts — the common venue shapes, drawn ready to edit.
//
// WHY THESE ARE DATA AND NOT DATABASE ROWS
//
// A template today is an organizer's own chart with `is_template` set, reached through
// `venue_layouts` and scoped by `WHERE v.created_by = $1`. A built-in has neither an owner nor a
// venue, so seeding these as rows would mean inventing a system account, parking its charts in
// somebody's venue list, and giving every deployment a data migration to keep them current. None of
// that buys anything: a starter is READ-ONLY and identical for everyone, which is the definition of
// code rather than data.
//
// So a starter is a `ChartDocument` factory. Using one creates a NORMAL layout in the organizer's
// chosen venue and saves this document into it — the same path a hand-drawn chart takes, so a
// started chart has no residual link to the starter and nothing about it is special afterwards.
//
// The shapes come from what the surveyed products offer as presets: Ticket Tailor opens by asking
// Simple / Sections-and-floors / traced plan; Eventbrite offers a preset layout or a blank canvas;
// Cvent's catalogue is built around banquet, classroom and theatre setups. The set below covers one
// of each structural family rather than many variants of one — two rectangles of different sizes
// teach an organizer nothing that changing `Số hàng` would not.

import type { ChartDocument, DocumentBlock, DocumentSeat } from "./seatmap-document.js";
import { CHART_DOCUMENT_SCHEMA } from "./seatmap-document.js";
import { regenerateBlock } from "./seatmap-project.js";
import { SEAT_DIAMETER } from "./seatmap-validate.js";

/** Centre-to-centre seat spacing: 1.5 nominal diameters, the gap a real row uses. */
const PITCH = SEAT_DIAMETER * 1.5;

/**
 * Placeholder ids, negative by the same convention `mintId` uses for anything the database has not
 * seen. `saveLayout` resolves them to real rows on the way in.
 *
 * Fixed rather than minted: a starter must produce a byte-identical document every time it is used,
 * or two charts started from one template would not compare equal.
 */
const SECTION = { stalls: -1, left: -2, right: -3, balcony: -4, floor: -5, tables: -6 } as const;
/** Levels (0044). Negative like every other starter id — placeholders the writer resolves on save. */
const FLOOR = { ground: -101, balcony: -102, tier1: -103, tier2: -104 } as const;

/** One section per stand of the bowl, so a ticket names a stand rather than a coordinate. */
const SECTION_BY_TAG: Record<string, number> = {
  B: -21,
  DB: -22,
  D: -23,
  DN: -24,
  N: -25,
  TN: -26,
  T: -27,
  TB: -28,
};
/**
 * The UPPER tier's own sections (0044).
 *
 * A separate set, and it has to be: a floor hangs off a SECTION, so a stand that shared one section
 * across both decks could not be on two levels. It is also how a real ticket reads — "Khán đài Bắc
 * T2" is a different place to sit from "Khán đài Bắc", with its own row letters and its own price.
 */
const UPPER_SECTION_BY_TAG: Record<string, number> = {
  B: -31,
  DB: -32,
  D: -33,
  DN: -34,
  N: -35,
  TN: -36,
  T: -37,
  TB: -38,
};
const CATEGORY = { premium: -11, standard: -12, economy: -13, standing: -14 } as const;

const CAT_COLOR = {
  premium: "#B3202C",
  standard: "#E08A3C",
  economy: "#3F7D58",
  standing: "#2F6F9F",
} as const;

/**
 * A wheelchair space and the companion seat beside it.
 *
 * Authored as explicit seats rather than generated, because the pair is a POINTER: the companion
 * names the wheelchair seat by id, and a generated block's ids do not exist until `regenerateBlock`
 * has run. Drawing them here is the only way to know both ends.
 *
 * The direction matters and is easy to get backwards — `seatmap-validate.ts` requires that the
 * ORDINARY seat carries `companionSeatId` pointing AT the accessible one, that the target really is
 * `isAccessible`, and that no two seats claim the same wheelchair space. Pointing the other way is
 * `companion_wrong_target`, which blocks publish.
 *
 * The placeholder ids are remapped to real rows on save (`layouts.repo.ts` resolves companions in a
 * second pass, after every seat exists), so the pair survives the round trip.
 */
function accessibleBay(label: string, startNumber: number, gap: number): SeatsFrom {
  return (mint) => {
    const wheelchair = mint();
    return [
      {
        seatId: wheelchair,
        rowLabel: label,
        seatNumber: startNumber,
        dx: 0,
        dy: 0,
        rotation: 0,
        isAccessible: true,
      },
      {
        seatId: mint(),
        rowLabel: label,
        seatNumber: startNumber + 1,
        dx: gap,
        dy: 0,
        rotation: 0,
        companionSeatId: wheelchair,
      },
    ];
  };
}

interface BlockSpec {
  kind: DocumentBlock["kind"];
  title: string;
  x: number;
  y: number;
  rotation?: number;
  width?: number;
  height?: number;
  section?: number | null;
  category?: number | null;
  rows?: number;
  perRow?: number;
  seatSpacing?: number;
  rowSpacing?: number;
  radius?: number;
  arcAngle?: number;
  /** Curved blocks: lay the rows out as concentric arcs about one focus (0044). */
  concentric?: boolean;
  rowLabelPrefix?: string;
  rowLabelSuffix?: string;
  startRowIndex?: number;
  startSeatNumber?: number;
  label?: string | null;
  capacity?: number;
  tableShape?: "round" | "rect";
  tableSeatCount?: number;
  /**
   * Explicit seats, for a block the projection passes through rather than generates.
   *
   * A function of the document's own id minter rather than a literal array: every seat in one
   * document needs a distinct placeholder, or the server's `docIdToRealId` map collapses several
   * seats onto one row and a companion pointer lands on whichever won.
   */
  seatsFrom?: SeatsFrom;
}

/**
 * One block, with the fields the projection needs and nothing else.
 *
 * `seats` is deliberately absent: `regenerateBlock` derives them from `params` at use time, which is
 * the same function the editor runs when a block's row count changes. Baking seat offsets into the
 * literal would freeze them at whatever the projection did the day this file was written.
 */
type SeatsFrom = (mint: () => number) => DocumentSeat[];

function block(index: number, s: BlockSpec, mintSeatId: () => number): DocumentBlock {
  const seatBearing = s.rows !== undefined || s.perRow !== undefined;
  // ROUNDED HERE, once, rather than at every call site. The geometry below is derived — a rotated
  // wing's reach comes out of `cos`/`sin`, a stage's width is a fraction of the stalls — and
  // `documentSchema` types every coordinate as `z.number().int()`. A fractional x is not a rendering
  // wobble, it is a 400 from the save, which is exactly how the first sized build failed.
  return {
    key: `b${index}`,
    kind: s.kind,
    title: s.title,
    x: Math.round(s.x),
    y: Math.round(s.y),
    rotation: s.rotation ?? 0,
    width: Math.round(s.width ?? (s.perRow ? s.perRow * (s.seatSpacing ?? PITCH) : 1200)),
    height: Math.round(s.height ?? (s.rows ? s.rows * (s.rowSpacing ?? PITCH) : 400)),
    sectionId: s.section ?? null,
    categoryId: s.category ?? null,
    ...(seatBearing
      ? {
          params: {
            rowsCount: s.rows ?? 1,
            seatsPerRow: s.perRow ?? 1,
            seatSpacing: s.seatSpacing ?? PITCH,
            rowSpacing: s.rowSpacing ?? PITCH,
            ...(s.radius !== undefined ? { radius: s.radius } : {}),
            ...(s.arcAngle !== undefined ? { arcAngle: s.arcAngle } : {}),
            ...(s.concentric !== undefined ? { concentric: s.concentric } : {}),
            rowLabelScheme: "alpha-asc" as const,
            seatLabelScheme: "num-asc" as const,
            ...(s.rowLabelPrefix ? { rowLabelPrefix: s.rowLabelPrefix } : {}),
            ...(s.rowLabelSuffix ? { rowLabelSuffix: s.rowLabelSuffix } : {}),
            ...(s.startRowIndex !== undefined ? { startRowIndex: s.startRowIndex } : {}),
            ...(s.startSeatNumber !== undefined ? { startSeatNumber: s.startSeatNumber } : {}),
          },
        }
      : {}),
    ...(s.label !== undefined ? { label: s.label } : {}),
    ...(s.capacity !== undefined ? { capacity: s.capacity } : {}),
    ...(s.tableShape !== undefined ? { tableShape: s.tableShape } : {}),
    ...(s.tableSeatCount !== undefined ? { tableSeatCount: s.tableSeatCount } : {}),
    ...(s.seatsFrom ? { seats: s.seatsFrom(mintSeatId) } : {}),
  };
}

/**
 * Placeholder seat ids, negative and monotonic within one build.
 *
 * Reset per `document()` call so two uses of the same starter produce byte-identical documents —
 * a module-level counter would make the second one differ from the first for no reason a reader
 * could see.
 */
function makeMint(): () => number {
  let n = 0;
  return () => {
    n -= 1;
    return n;
  };
}

function document(
  sections: { id: number; name: string; floorId?: number | null }[],
  categories: (keyof typeof CATEGORY)[],
  specs: BlockSpec[],
  /** Levels this starter is built on (0044). Omitted by every flat starter, which is most of them. */
  floors: { id: number; name: string; displayOrder: number }[] = [],
): ChartDocument {
  const mintSeatId = makeMint();
  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    gridSize: 50,
    floors,
    sections: sections.map((s) => ({
      ...s,
      floorId: s.floorId ?? null,
      seatShape: "circle",
      seatSizeMultiplier: 1,
    })),
    categories: categories.map((k) => ({
      id: CATEGORY[k],
      name: { premium: "VIP", standard: "Thường", economy: "Tiết kiệm", standing: "Đứng" }[k],
      color: CAT_COLOR[k],
    })),
    // `regenerateBlock` is what turns `params` into seats — the same function the editor runs when a
    // block's row count changes. Without it a starter is a set of empty outlines: the projection only
    // ever COPIES `block.seats`, it never derives them. Blocks that carry explicit seats (the table
    // rings) have no `params`, so it returns them untouched.
    blocks: specs.map((s, i) => regenerateBlock(block(i + 1, s, mintSeatId), mintSeatId)),
    rows: [],
  };
}
/** One offered size of a starter. */
export interface StarterSize {
  id: string;
  label: string;
  /** What the projection produces at this size — shown before anything is created. */
  seatCount: number;
}

export interface Starter {
  id: string;
  name: string;
  /** The structural family, so the picker can say what KIND of room this is. */
  shape: string;
  summary: string;
  /**
   * Offered sizes, largest question first. The first entry is the default.
   *
   * A starter with ONE size covers one room, which is most of the way to being useless — a theatre
   * template that is always 504 seats is a chart, not a template. What makes sizing possible at all
   * is that the blocks are already parametric: `regenerateBlock` rebuilds a block's seats from its
   * row and column counts, so a size only has to choose those numbers.
   *
   * What it is NOT is "a form", which is what this looked like from the outside. Changing the row
   * count changes a block's EXTENT, so every neighbour has to move or the two overlap — and
   * overlapping seats are a blocking publish issue. So each `build` below derives its positions from
   * the counts rather than hard-coding them, and the tests check every size of every starter.
   */
  sizes: StarterSize[];
  build: (sizeId?: string) => ChartDocument;
  /**
   * Where the event happens, when a stage cannot say it (0043).
   *
   * Only the arena needs one: its four stands face a pitch, and `focalPoint()` would otherwise infer
   * the centroid of the seating. That inference is very nearly right for a symmetric bowl and drifts
   * as soon as one stand is bigger than another — the point of stating it is that the ranking stops
   * depending on the shape of the seating.
   *
   * Everything else here has a stage, and a stage IS the answer, so leaving this undefined is the
   * honest choice rather than a gap.
   */
  focalPoint?: (sizeId?: string) => { x: number; y: number };
}

/*
 * TWO ORIGIN CONVENTIONS LIVE IN ONE DOCUMENT, and mixing them is what made the first attempt at
 * sizing produce overlapping blocks:
 *
 *   seat-bearing block — `x`/`y` is the TOP-LEFT of the seat grid. `seatOffsets` emits
 *                        `dx = column * spacing`, so seats run right and down FROM the origin.
 *   decoration element — `x`/`y` is the CENTRE. `SeatCanvas` draws `x - width / 2`.
 *
 * So a stage and a stalls block given the same `x` do not line up. `atCentreX`/`atCentreY` convert
 * from the centre — which is how a room is actually described — into the top-left the projection
 * wants, and every seat-bearing position below goes through them.
 */
const gridW = (perRow: number) => (perRow - 1) * PITCH;
const gridH = (rows: number) => (rows - 1) * PITCH;
const atCentreX = (cx: number, perRow: number) => Math.round(cx - gridW(perRow) / 2);
const atCentreY = (cy: number, rows: number) => Math.round(cy - gridH(rows) / 2);

/**
 * Where to put a curved stand so its focus lands on the pitch, and how far to turn it.
 *
 * A curved block's origin is the middle of its FRONT row, and with `concentric` its focus sits at
 * `(0, radius)` in the block's own frame. Rotating by θ carries that focus to `(-R sinθ, R cosθ)`, so
 * the origin that puts the focus on `centre` is `centre + (R sinθ, -R cosθ)`.
 *
 * Bearings are clock-style: 0° is due north of the pitch, 90° east. That is how a stadium's stands
 * are actually named, and it keeps the eight-section ring below readable as a list of directions
 * rather than as sixteen hand-placed coordinates.
 */
function standAt(
  centre: { x: number; y: number },
  bearingDeg: number,
  radius: number,
): { x: number; y: number; rotation: number } {
  const t = (bearingDeg * Math.PI) / 180;
  return {
    x: Math.round(centre.x + radius * Math.sin(t)),
    y: Math.round(centre.y - radius * Math.cos(t)),
    rotation: normaliseBearing(bearingDeg),
  };
}

const normaliseBearing = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/** Resolve a requested size to a real one, falling back to the default rather than throwing. */
function pick<T extends { id: string }>(options: T[], id: string | undefined): T {
  return options.find((o) => o.id === id) ?? options[0];
}

// ---- Theatre ---------------------------------------------------------------------------------

const THEATRE_SIZES = [
  { id: "m", label: "Vừa · 18 hàng", rows: 18, perRow: 20, wingRows: 10, balcony: 24 },
  { id: "s", label: "Nhỏ · 12 hàng", rows: 12, perRow: 14, wingRows: 7, balcony: 16 },
  { id: "l", label: "Lớn · 24 hàng", rows: 24, perRow: 28, wingRows: 14, balcony: 34 },
];

const WING_COLS = 6;
const STAGE_Y = 3000;
const STAGE_H = 1600;

function theatre(sizeId?: string): ChartDocument {
  const z = pick(THEATRE_SIZES, sizeId);
  const stallsW = gridW(z.perRow);
  const stallsH = gridH(z.rows);
  const wingW = gridW(WING_COLS);
  const wingH = gridH(z.wingRows);
  // A wing is rotated, so its horizontal reach is wider than its grid: the rotated bounding half-width
  // is what must clear the aisle, or a 15° lean puts its back row inside the stalls.
  const lean = (15 * Math.PI) / 180;
  const wingReach = wingW * Math.cos(lean) + wingH * Math.sin(lean);
  const aisle = 1400;
  // Everything hangs off the stalls: its top edge sits a fixed gap below the stage, and every
  // neighbour is placed relative to its measured extent rather than to a remembered number.
  const stallsTop = STAGE_Y + STAGE_H / 2 + 2200;
  const stallsLeft = atCentreX(15000, z.perRow);
  const wingLeftX = stallsLeft - aisle - wingReach;
  const wingRightX = stallsLeft + stallsW + aisle;
  const bayY = stallsTop + stallsH + 1200;
  const balconyY = bayY + 2200;

  return document(
    [
      { id: SECTION.stalls, name: "Khán đài", floorId: FLOOR.ground },
      { id: SECTION.left, name: "Cánh trái", floorId: FLOOR.ground },
      { id: SECTION.right, name: "Cánh phải", floorId: FLOOR.ground },
      // The whole point of 0044, and the symptom NOTE 6 named: a balcony is a SECOND LEVEL, not a
      // curved row drawn behind the stalls on the same plane.
      { id: SECTION.balcony, name: "Ban công", floorId: FLOOR.balcony },
    ],
    ["premium", "standard", "economy"],
    [
      {
        kind: "stage",
        title: "Sân khấu",
        x: 15000,
        y: STAGE_Y,
        width: Math.max(6000, stallsW * 0.75),
        height: STAGE_H,
        label: "SÂN KHẤU",
      },
      {
        kind: "seating-block",
        title: "Khán đài",
        x: stallsLeft,
        y: stallsTop,
        section: SECTION.stalls,
        category: CATEGORY.premium,
        rows: z.rows,
        perRow: z.perRow,
      },
      {
        kind: "seating-block",
        title: "Cánh trái",
        x: wingLeftX,
        y: stallsTop + 400,
        rotation: 15,
        section: SECTION.left,
        category: CATEGORY.standard,
        rows: z.wingRows,
        perRow: WING_COLS,
        rowLabelSuffix: "-T",
      },
      {
        kind: "seating-block",
        title: "Cánh phải",
        x: wingRightX,
        y: stallsTop + 400,
        rotation: 345,
        section: SECTION.right,
        category: CATEGORY.standard,
        rows: z.wingRows,
        perRow: WING_COLS,
        rowLabelSuffix: "-P",
      },
      {
        kind: "aisle",
        title: "Lối đi trái",
        x: stallsLeft - aisle / 2,
        y: stallsTop + stallsH / 2,
        width: 500,
        height: stallsH,
        label: null,
      },
      {
        kind: "aisle",
        title: "Lối đi phải",
        x: stallsLeft + stallsW + aisle / 2,
        y: stallsTop + stallsH / 2,
        width: 500,
        height: stallsH,
        label: null,
      },
      // Wheelchair spaces at the BACK of the stalls beside the exits — level access and a clear path
      // out. Each carries its companion seat, which is what `accessible_without_companion` asks for.
      {
        kind: "seating-block",
        title: "Chỗ xe lăn trái",
        x: 15000 - stallsW / 2 + 400,
        y: bayY,
        width: 700,
        height: 300,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        seatsFrom: accessibleBay("WC-T", 1, 400),
      },
      {
        kind: "seating-block",
        title: "Chỗ xe lăn phải",
        x: 15000 + stallsW / 2 - 800,
        y: bayY,
        width: 700,
        height: 300,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        seatsFrom: accessibleBay("WC-P", 1, 400),
      },
      {
        kind: "exit",
        title: "Lối thoát trái",
        x: 15000 - stallsW / 2 - aisle - wingW - 900,
        y: bayY,
        width: 700,
        height: 700,
        label: "EXIT",
      },
      {
        kind: "exit",
        title: "Lối thoát phải",
        x: 15000 + stallsW / 2 + aisle + wingW + 900,
        y: bayY,
        width: 700,
        height: 700,
        label: "EXIT",
      },
      {
        kind: "curved-row",
        title: "Ban công",
        x: 15000,
        y: balconyY,
        section: SECTION.balcony,
        category: CATEGORY.economy,
        rows: 1,
        perRow: z.balcony,
        radius: 6000,
        arcAngle: 70,
        rowLabelPrefix: "BC-",
      },
    ],
    [
      { id: FLOOR.ground, name: "Tầng trệt", displayOrder: 0 },
      { id: FLOOR.balcony, name: "Ban công", displayOrder: 1 },
    ],
  );
}

// ---- Cinema ----------------------------------------------------------------------------------

const CINEMA_SIZES = [
  { id: "m", label: "Vừa · 12 hàng", rows: 12, half: 8 },
  { id: "s", label: "Nhỏ · 8 hàng", rows: 8, half: 6 },
  { id: "l", label: "Lớn · 16 hàng", rows: 16, half: 11 },
];

function cinema(sizeId?: string): ChartDocument {
  const z = pick(CINEMA_SIZES, sizeId);
  const halfW = gridW(z.half);
  const blockH = gridH(z.rows);
  const aisle = 1200;
  const top = 5200;
  const leftX = 15000 - aisle / 2 - halfW;
  const rightX = 15000 + aisle / 2;

  return document(
    [{ id: SECTION.stalls, name: "Phòng chiếu" }],
    ["standard", "premium"],
    [
      {
        kind: "stage",
        title: "Màn hình",
        x: 15000,
        y: 3200,
        width: halfW * 2 + aisle,
        height: 900,
        label: "MÀN HÌNH",
      },
      // Seat numbers run straight through the aisle: the right block starts where the left ends, so a
      // row reads 1…16 across the room rather than restarting at the gap.
      {
        kind: "seating-block",
        title: "Dãy trái",
        x: leftX,
        y: top,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        rows: z.rows,
        perRow: z.half,
        startSeatNumber: 1,
      },
      {
        kind: "seating-block",
        title: "Dãy phải",
        x: rightX,
        y: top,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        rows: z.rows,
        perRow: z.half,
        startSeatNumber: z.half + 1,
      },
      {
        kind: "aisle",
        title: "Lối đi giữa",
        x: 15000,
        y: top + blockH / 2,
        width: aisle,
        height: blockH,
        label: null,
      },
      {
        kind: "seating-block",
        title: "Chỗ xe lăn",
        x: leftX - 1800,
        y: top + blockH,
        width: 700,
        height: 300,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        seatsFrom: accessibleBay("WC", 1, 400),
      },
      {
        kind: "exit",
        title: "Lối thoát",
        x: leftX - 3200,
        y: top + blockH,
        width: 700,
        height: 700,
        label: "EXIT",
      },
    ],
  );
}

// ---- Conference ------------------------------------------------------------------------------

const CONF_SIZES = [
  { id: "m", label: "Vừa · 10 hàng", rows: 10, perBlock: 10 },
  { id: "s", label: "Nhỏ · 6 hàng", rows: 6, perBlock: 8 },
  { id: "l", label: "Lớn · 14 hàng", rows: 14, perBlock: 12 },
];

function conference(sizeId?: string): ChartDocument {
  const z = pick(CONF_SIZES, sizeId);
  const blockW = gridW(z.perBlock);
  const blockH = gridH(z.rows);
  const aisle = 1200;
  const top = 5000;
  const step = blockW + aisle;

  return document(
    [{ id: SECTION.stalls, name: "Hội trường" }],
    ["standard"],
    [
      {
        kind: "stage",
        title: "Sân khấu",
        x: 15000,
        y: 3000,
        width: step * 3 * 0.8,
        height: 1400,
        label: "SÂN KHẤU",
      },
      ...(["A", "B", "C"] as const).map<BlockSpec>((tag, i) => ({
        kind: "seating-block" as const,
        title: `Khu ${tag}`,
        x: atCentreX(15000 + (i - 1) * step, z.perBlock),
        y: top,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        rows: z.rows,
        perRow: z.perBlock,
        rowLabelSuffix: `-${tag}`,
      })),
      {
        kind: "aisle",
        title: "Lối đi trái",
        x: 15000 - step / 2,
        y: top + blockH / 2,
        width: aisle,
        height: blockH,
        label: null,
      },
      {
        kind: "aisle",
        title: "Lối đi phải",
        x: 15000 + step / 2,
        y: top + blockH / 2,
        width: aisle,
        height: blockH,
        label: null,
      },
      {
        kind: "seating-block",
        title: "Chỗ xe lăn trái",
        x: atCentreX(15000 - step, z.perBlock) - 2000,
        y: top + blockH,
        width: 700,
        height: 300,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        seatsFrom: accessibleBay("WC-T", 1, 400),
      },
      {
        kind: "seating-block",
        title: "Chỗ xe lăn phải",
        x: atCentreX(15000 + step, z.perBlock) + blockW + 1200,
        y: top + blockH,
        width: 700,
        height: 300,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        seatsFrom: accessibleBay("WC-P", 1, 400),
      },
      {
        kind: "bar",
        title: "Bàn tiếp đón",
        x: 15000,
        y: top + blockH + 2000,
        width: 3000,
        height: 700,
        label: "TIẾP ĐÓN",
      },
    ],
  );
}

// ---- Banquet ---------------------------------------------------------------------------------

const BANQUET_SIZES = [
  { id: "m", label: "Vừa · 12 bàn", perRow: 6, tableRows: 2, seats: 10 },
  { id: "s", label: "Nhỏ · 8 bàn", perRow: 4, tableRows: 2, seats: 8 },
  { id: "l", label: "Lớn · 21 bàn", perRow: 7, tableRows: 3, seats: 10 },
];

function banquet(sizeId?: string): ChartDocument {
  const z = pick(BANQUET_SIZES, sizeId);
  const gap = 2400;
  const rowGap = 3000;
  const firstY = 11600;
  const firstX = 15000 - ((z.perRow - 1) * gap) / 2;

  const tables: BlockSpec[] = [];
  for (let r = 0; r < z.tableRows; r += 1) {
    for (let c = 0; c < z.perRow; c += 1) {
      const n = r * z.perRow + c + 1;
      tables.push({
        kind: "table",
        title: `Bàn ${n}`,
        x: firstX + c * gap,
        y: firstY + r * rowGap,
        section: SECTION.tables,
        category: r === 0 ? CATEGORY.premium : CATEGORY.standard,
        width: 1400,
        height: 1400,
        tableShape: "round",
        tableSeatCount: z.seats,
      });
    }
  }

  return document(
    [{ id: SECTION.tables, name: "Khu bàn tiệc" }],
    ["premium", "standard"],
    [
      {
        kind: "stage",
        title: "Sân khấu",
        x: 15000,
        y: 3200,
        width: 6000,
        height: 1200,
        label: "SÂN KHẤU",
      },
      {
        // An `aisle` — open walkable floor. Not a `shape`, for the reason given on the arena's
        // pitch, and not a second `stage`, because `focalPoint()` takes the FIRST stage it finds and
        // a dance floor is not what the room faces.
        kind: "aisle",
        title: "Sàn nhảy",
        x: 15000,
        y: 7600,
        width: 4200,
        height: 3000,
        label: "SÀN NHẢY",
      },
      ...tables,
    ],
  );
}

// ---- Arena -----------------------------------------------------------------------------------

const ARENA_SIZES = [
  { id: "m", label: "Vừa · 8 hàng mỗi khán đài", rows: 8, perRow: 24 },
  { id: "s", label: "Nhỏ · 5 hàng", rows: 5, perRow: 18 },
  { id: "l", label: "Lớn · 12 hàng", rows: 12, perRow: 32 },
];

function arena(sizeId?: string): ChartDocument {
  const z = pick(ARENA_SIZES, sizeId);
  const standDepth = gridH(z.rows);
  const standWidth = gridW(z.perRow);
  /*
   * The pitch is sized FROM the stands, and is narrower than they are.
   *
   * It used to be `Math.max(7000, standWidth * 0.8)` with a fixed 5,400 depth — and since a 24-seat
   * stand is only 3,450 wide, the floor always won and the pitch came out bigger than all four stands
   * put together. A stadium reads as stands around a pitch; that read one as a pitch with four small
   * blocks parked near it.
   */
  const pitchW = Math.round(standWidth * 0.9);
  const pitchH = Math.round(standWidth * 0.55);
  const gap = 900;
  const offY = pitchH / 2 + gap + standDepth / 2;
  const offX = pitchW / 2 + gap + standDepth / 2;

  return document(
    [
      { id: SECTION.stalls, name: "Khán đài Bắc" },
      { id: SECTION.left, name: "Khán đài Tây" },
      { id: SECTION.right, name: "Khán đài Đông" },
      { id: SECTION.balcony, name: "Khán đài Nam" },
    ],
    ["premium", "standard"],
    [
      {
        // A `stage`, not a `shape`. `shape` projects to `boundary`, which MEANS the hall outline —
        // the validator takes the first one as authoritative and reports every seat outside it, so a
        // pitch drawn that way claimed to be the whole building and put all four stands outside it.
        // A pitch is the thing every stand faces, which is what a stage is; it also draws from its
        // box and carries its own label, where a shape does neither.
        kind: "stage",
        title: "Sân thi đấu",
        x: 15000,
        y: 12000,
        width: pitchW,
        height: pitchH,
        label: "SÂN",
      },
      // The opposite stand is rotated 180° and the sides 90°/270°, so every row faces the pitch
      // rather than all four facing the same way.
      {
        kind: "seating-block",
        title: "Khán đài Bắc",
        x: atCentreX(15000, z.perRow),
        y: 12000 - offY - standDepth,
        section: SECTION.stalls,
        category: CATEGORY.premium,
        rows: z.rows,
        perRow: z.perRow,
        rowLabelSuffix: "-B",
      },
      {
        kind: "seating-block",
        title: "Khán đài Nam",
        x: atCentreX(15000, z.perRow) + standWidth,
        y: 12000 + offY + standDepth,
        rotation: 180,
        section: SECTION.balcony,
        category: CATEGORY.premium,
        rows: z.rows,
        perRow: z.perRow,
        rowLabelSuffix: "-N",
      },
      {
        kind: "seating-block",
        title: "Khán đài Tây",
        x: 15000 - offX - standDepth,
        y: atCentreY(12000, z.perRow) + standWidth,
        rotation: 270,
        section: SECTION.left,
        category: CATEGORY.standard,
        rows: z.rows,
        perRow: z.perRow,
        rowLabelSuffix: "-T",
      },
      {
        kind: "seating-block",
        title: "Khán đài Đông",
        x: 15000 + offX + standDepth,
        y: atCentreY(12000, z.perRow),
        rotation: 90,
        section: SECTION.right,
        category: CATEGORY.standard,
        rows: z.rows,
        perRow: z.perRow,
        rowLabelSuffix: "-D",
      },
      {
        kind: "seating-block",
        title: "Chỗ xe lăn",
        // Just outside the stand's left edge, not 2,000 units away: a section's dashed hull spans
        // everything in it, so a bay parked out in the open stretched "Khán đài Bắc" across a large
        // empty rectangle and made the stand look off-centre when it was not.
        x: atCentreX(15000, z.perRow) - 900,
        y: 12000 - offY - standDepth,
        width: 700,
        height: 300,
        section: SECTION.stalls,
        category: CATEGORY.standard,
        seatsFrom: accessibleBay("WC-B", 1, 400),
      },
    ],
  );
}

// ---- Club ------------------------------------------------------------------------------------

const CLUB_SIZES = [
  { id: "m", label: "Vừa · 6 bàn · 300 chỗ đứng", perSide: 3, seats: 4, standing: 300 },
  { id: "s", label: "Nhỏ · 4 bàn · 150 chỗ đứng", perSide: 2, seats: 4, standing: 150 },
  { id: "l", label: "Lớn · 10 bàn · 600 chỗ đứng", perSide: 5, seats: 6, standing: 600 },
];

function club(sizeId?: string): ChartDocument {
  const z = pick(CLUB_SIZES, sizeId);
  const firstY = 7400;
  const gap = 2000;
  const side = (tag: "T" | "P", x: number, cat: number): BlockSpec[] =>
    Array.from({ length: z.perSide }, (_, i) => ({
      kind: "table" as const,
      title: `Bàn ${tag}${i + 1}`,
      x,
      y: firstY + i * gap,
      section: SECTION.tables,
      category: cat,
      width: 1100,
      height: 1100,
      tableShape: "round" as const,
      tableSeatCount: z.seats,
    }));

  const floorH = Math.max(4400, z.perSide * gap);
  return document(
    [
      { id: SECTION.floor, name: "Sàn đứng" },
      { id: SECTION.tables, name: "Bàn quanh sàn" },
    ],
    ["standing", "premium"],
    [
      {
        kind: "stage",
        title: "Sân khấu",
        x: 15000,
        y: 4000,
        width: 7000,
        height: 1600,
        label: "SÂN KHẤU",
      },
      {
        kind: "ga-zone",
        title: "Khu đứng",
        x: 15000,
        y: firstY + floorH / 2 - 1000,
        width: 7000,
        height: floorH,
        section: SECTION.floor,
        category: CATEGORY.standing,
        capacity: z.standing,
        label: "KHU ĐỨNG",
      },
      ...side("T", 10200, CATEGORY.premium),
      ...side("P", 19800, CATEGORY.premium),
      {
        kind: "bar",
        title: "Quầy bar",
        x: 15000,
        y: firstY + floorH + 600,
        width: 5000,
        height: 800,
        label: "QUẦY BAR",
      },
    ],
  );
}

// ---- Stadium bowl -----------------------------------------------------------------------------

const BOWL_SIZES = [
  { id: "m", label: "Vừa · 8 khu × 8 hàng", rows: 8, perRow: 18, upper: 0 },
  { id: "s", label: "Nhỏ · 8 khu × 5 hàng", rows: 5, perRow: 14, upper: 0 },
  // Sized against `LAYOUT_MAX_SEATS`, not against a real stadium: 8×8×18 lower plus 8×5×20 upper is
  // 1,952, and the ceiling is 2,000. A genuine bowl is ten times that — see the note at the foot of
  // this file about the seat ceiling being the thing that now limits a stadium, not the geometry.
  { id: "l", label: "Lớn · 2 tầng khán đài", rows: 8, perRow: 18, upper: 5 },
  /*
   * The physically honest two-tier bowl: the upper deck STACKED on the lower one, sharing its
   * footprint, which is where an upper deck actually is.
   *
   * Kept as its own size rather than replacing the concentric one, because both are real stadium
   * designs and they are read differently. A stacked chart is unreadable with both decks drawn at
   * once — every upper seat covers a lower one — so it depends on the viewer's floor controls:
   * "Tách lớp" pulls the levels apart to see the venue, a floor isolates one to choose a seat.
   * The concentric size needs neither and stays the safer default.
   *
   * This size is only publishable because the overlap rule is floor-aware (0044). Before that, every
   * seat of the upper deck reported `overlapping_seats` against the one beneath it.
   */
  { id: "xl", label: "Lớn · 2 tầng xếp chồng", rows: 8, perRow: 18, upper: 5, stacked: true },
];

/** Eight sections around the pitch, named the way a stadium names them. */
const BOWL_SECTIONS = [
  { bearing: 0, name: "Khán đài Bắc", tag: "B" },
  { bearing: 45, name: "Góc Đông Bắc", tag: "DB" },
  { bearing: 90, name: "Khán đài Đông", tag: "D" },
  { bearing: 135, name: "Góc Đông Nam", tag: "DN" },
  { bearing: 180, name: "Khán đài Nam", tag: "N" },
  { bearing: 225, name: "Góc Tây Nam", tag: "TN" },
  { bearing: 270, name: "Khán đài Tây", tag: "T" },
  { bearing: 315, name: "Góc Tây Bắc", tag: "TB" },
] as const;

/**
 * A stadium as a RING of curved stands, the shape seats.io's stadium charts take.
 *
 * The rectangular arena starter puts four straight blocks around a pitch, which is an indoor court
 * and not a stadium: a real bowl has no corners standing empty and no stand facing a direction the
 * pitch is not in. Eight concentric arcs on one focus give the wrap, and every section is its own
 * `sections` row so a buyer's ticket reads "Khán đài Bắc" rather than a coordinate.
 *
 * Every stand shares ONE focus — the pitch centre — which is also the chart's stated focal point, so
 * "chọn giúp tôi" ranks outward from the middle of the pitch in every direction at once.
 */
function bowl(sizeId?: string): ChartDocument {
  const z = pick(BOWL_SIZES, sizeId);
  const centre = { x: 15000, y: 15000 };
  const pitchW = 8200;
  const pitchH = 5200;
  // Clear of the pitch's corner, so no stand's front row cuts across the playing area.
  const inner = Math.round(Math.hypot(pitchW / 2, pitchH / 2)) + 900;
  const lowerDepth = z.rows * PITCH;
  // Stacked: the upper deck starts where the lower one does, one storey up — same footprint, so the
  // two only become legible through the floor controls. Concentric: set back beyond the lower ring.
  const upperInner = z.stacked ? inner : inner + lowerDepth + 1400;

  // 38° of seats with 7° of gap between neighbours — the gap is the vomitory every real bowl has.
  const SWEEP = 38;

  const ring = (
    radius: number,
    rows: number,
    perRow: number,
    suffix: string,
    category: number,
    sectionOf: Record<string, number> = SECTION_BY_TAG,
  ): BlockSpec[] =>
    BOWL_SECTIONS.map((sec) => {
      const at = standAt(centre, sec.bearing, radius);
      return {
        kind: "curved-row" as const,
        title: `${sec.name}${suffix ? ` ${suffix}` : ""}`,
        x: at.x,
        y: at.y,
        rotation: at.rotation,
        width: 2000,
        height: rows * PITCH,
        section: sectionOf[sec.tag],
        category,
        rows,
        perRow,
        radius,
        arcAngle: SWEEP,
        concentric: true,
        rowLabelSuffix: `-${sec.tag}${suffix}`,
      };
    });

  /*
   * DRAWN AS CONCENTRIC RINGS, not stacked on the same footprint.
   *
   * A second deck physically sits ON the first, and drawing it there is what a section drawing would
   * do — but this is a PLAN, and two decks on one footprint make a plan unreadable: every upper seat
   * would hide a lower one and "Mọi tầng" would show a single ring with the wrong number of seats.
   * Every stadium map worth reading — seats.io's, a club's own ticket page — puts the upper tier as
   * an outer ring, so the whole bowl is legible at once and the picker narrows it. The floors are
   * what make the two decks separately selectable; the rings are what make them separately VISIBLE.
   *
   * Levels still matter beyond the picker: the overlap rule is floor-aware (0044), so a chart that
   * DOES stack a deck directly above another is publishable now. This one simply does not need to.
   */
  const upper = z.upper > 0;
  return document(
    [
      ...BOWL_SECTIONS.map((sec) => ({
        id: SECTION_BY_TAG[sec.tag],
        name: sec.name,
        floorId: upper ? FLOOR.tier1 : null,
      })),
      ...(upper
        ? BOWL_SECTIONS.map((sec) => ({
            id: UPPER_SECTION_BY_TAG[sec.tag],
            name: `${sec.name} T2`,
            floorId: FLOOR.tier2,
          }))
        : []),
    ],
    ["premium", "standard", "economy"],
    [
      {
        kind: "stage",
        title: "Sân thi đấu",
        x: centre.x,
        y: centre.y,
        width: pitchW,
        height: pitchH,
        label: "SÂN",
      },
      ...ring(inner, z.rows, z.perRow, "", CATEGORY.premium),
      ...(upper
        ? ring(upperInner, z.upper, z.perRow + 2, "T2", CATEGORY.economy, UPPER_SECTION_BY_TAG)
        : []),
    ],
    // A single-deck bowl declares no floors at all. Only the two-tier size is a levelled venue, and
    // a chart with one level must not grow a picker that does nothing.
    upper
      ? [
          { id: FLOOR.tier1, name: "Tầng 1", displayOrder: 0 },
          { id: FLOOR.tier2, name: "Tầng 2", displayOrder: 1 },
        ]
      : [],
  );
}

/**
 * The catalogue.
 *
 * `seatCount` per size is written down rather than computed, because computing it means running the
 * projection for every size of every starter on each render of the picker. A test asserts the two
 * agree — a wrong number here is a bug, and that is the right place to catch it.
 */
export const STARTERS: Starter[] = [
  {
    id: "theatre",
    name: "Nhà hát cổ điển",
    shape: "Sân khấu hộp · khán đài chính + hai cánh + ban công",
    summary:
      "Sân khấu ở đầu phòng, khối ghế chính ở giữa, hai cánh nghiêng vào trong và một ban công cong phía sau. Có sẵn hai chỗ xe lăn kèm ghế đi cùng.",
    sizes: THEATRE_SIZES.map((z) => ({
      id: z.id,
      label: z.label,
      seatCount: z.rows * z.perRow + 2 * (z.wingRows * WING_COLS) + z.balcony + 4,
    })),
    build: theatre,
  },
  {
    id: "cinema",
    name: "Rạp chiếu phim",
    shape: "Màn hình · hai khối ghế, lối đi giữa",
    summary:
      "Màn chiếu ở đầu phòng và hai khối ghế đối xứng chừa lối đi ở giữa — số ghế đánh liên tục qua lối đi. Kèm một chỗ xe lăn ở hàng cuối.",
    sizes: CINEMA_SIZES.map((z) => ({
      id: z.id,
      label: z.label,
      seatCount: 2 * (z.rows * z.half) + 2,
    })),
    build: cinema,
  },
  {
    id: "conference",
    name: "Hội trường",
    shape: "Sân khấu thấp · hàng ghế thẳng, ba lối đi",
    summary:
      "Bố cục hội nghị: ba khối ghế chia bởi hai lối đi dọc, sân khấu thấp và bàn tiếp đón. Hai chỗ xe lăn ở cuối phòng.",
    sizes: CONF_SIZES.map((z) => ({
      id: z.id,
      label: z.label,
      seatCount: 3 * (z.rows * z.perBlock) + 4,
    })),
    build: conference,
  },
  {
    id: "banquet",
    name: "Tiệc cưới / Gala",
    shape: "Bàn tròn quanh sàn nhảy",
    summary:
      "Bàn tròn vây quanh sàn nhảy, sân khấu nhỏ ở đầu phòng. Bán theo từng ghế — xem ghi chú cuối tệp về việc bán trọn bàn.",
    sizes: BANQUET_SIZES.map((z) => ({
      id: z.id,
      label: z.label,
      seatCount: z.perRow * z.tableRows * z.seats,
    })),
    build: banquet,
  },
  {
    id: "arena",
    name: "Nhà thi đấu trong nhà",
    shape: "Sân ở giữa · bốn khán đài thẳng",
    summary:
      "Sân ở giữa với bốn khán đài thẳng quay vào trong — bố cục nhà thi đấu, không phải sân vận động. Muốn khán đài cong ôm quanh sân thì dùng mẫu “Sân vận động”.",
    sizes: ARENA_SIZES.map((z) => ({
      id: z.id,
      label: z.label,
      seatCount: 4 * (z.rows * z.perRow) + 2,
    })),
    build: arena,
    // The centre of the pitch — the one block every stand faces, and the only starter whose focal
    // point a stage cannot express.
    focalPoint: () => ({ x: 15000, y: 12000 }),
  },
  {
    id: "stadium",
    name: "Sân vận động (khán đài vòng)",
    shape: "Sân ở giữa · tám khu cong bao quanh · cỡ Lớn có 2 tầng",
    summary:
      "Vòng khán đài kiểu sân vận động: tám khu cong chung một tâm là sân, kể cả bốn góc. Mỗi khu là một khán đài riêng và hàng ghế lùi dần ra xa sân. Cỡ Lớn thêm tầng 2 vẽ thành vòng ngoài, có bộ chọn tầng riêng cho cả người thiết kế lẫn người mua.",
    sizes: BOWL_SIZES.map((z) => ({
      id: z.id,
      label: z.label,
      seatCount: 8 * (z.rows * z.perRow) + (z.upper > 0 ? 8 * (z.upper * (z.perRow + 2)) : 0),
    })),
    build: bowl,
    // Every stand curves about the pitch, so the pitch centre is the focus in the geometry as well as
    // in the ranking.
    focalPoint: () => ({ x: 15000, y: 15000 }),
  },
  {
    id: "club",
    name: "Phòng trà / Live club",
    shape: "Sàn đứng + bàn quanh rìa",
    summary:
      "Sân khấu thấp, khu đứng trước sân khấu bán theo số lượng, và các bàn nhỏ dọc hai bên bán theo ghế.",
    sizes: CLUB_SIZES.map((z) => ({
      id: z.id,
      label: z.label,
      seatCount: 2 * z.perSide * z.seats,
    })),
    build: club,
  },
];
export const starterById = (id: string): Starter | undefined => STARTERS.find((s) => s.id === id);

// ---------------------------------------------------------------------------------------------
// WHAT THE STADIUM BOWL NEEDED, AND WHY IT WAS A PRIMITIVE CHANGE
//
// A ring of stands wants two things at once from a curved block: the front row nearest the pitch, and
// the arc's ends bending toward the pitch. The original `curved-row` could give one or the other and
// never both, because the row offset and the arc direction were coupled — each row got its own circle
// AND a `rowSpacing` shift in the block's +y, so the rows drifted toward the centre of curvature.
// Measured both ways before changing anything:
//
//   rotation 0    ends bend toward the pitch ✓   rows recede toward the pitch ✗
//   rotation 180  ends bend away ✗               rows recede away ✓
//
// `params.concentric` (0044) decouples them: every row is an arc about the SAME focus at
// `(0, radius)`, so ends bend in and rows recede out together. Off by default, because turning it on
// moves every seat of a curved block and doing that to charts already drawn would relocate rows under
// tickets that are already sold.
//
// The bowl then places eight sections by BEARING rather than by hand — `standAt` solves for the origin
// that puts a stand's focus on the pitch — so the ring is a list of directions instead of sixteen
// coordinates, and the corners are ordinary members of it rather than special cases.
//
// The ceiling has since been raised to 10,000 (0044), measured rather than guessed: a saved document
// is ~78 bytes a seat, so 10,000 is 0.78 MB and the binding limit turned out to be the JSON body cap
// rather than anything in the geometry or the writes. The large bowl stays at 1,952 all the same —
// these are STARTERS, and a template that opens with ten thousand seats is a chart to delete from,
// not a chart to start from. Raise a bowl by editing its blocks, which is what the sizes are for.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// A TRAP WORTH NAMING, since it cost the arena its pitch
//
// A `shape` block projects to element kind `boundary`, and TWO things follow that are easy to miss:
//
//   * `SeatCanvas` draws a boundary as a polyline over `el.points` and ignores `width`/`height`
//     entirely, because a polygon's real extent is its vertices. A shape authored with a box and no
//     points is a block that exists, validates, saves — and renders as nothing at all.
//   * `boundary` MEANS the hall outline. `validateLayout` takes the first one as authoritative and
//     reports every seat outside it, so an inner feature drawn as a shape claims to be the building
//     and puts the whole audience outside itself.
//
// So an inner area is not a shape. The arena's pitch is a `stage` — it is what every stand faces,
// which is what a stage is — and the banquet's dance floor is an `aisle`, open walkable floor. Both
// draw from their box and carry their own label, where a shape does neither (the projection strips a
// shape's label so that rescaling a polygon cannot strand text at the wrong size).
//
// The starter tests now assert that every boundary a starter emits actually has points, because
// nothing else in the suite looks at whether a chart RENDERS: the capacity, overlap and publish
// checks all pass happily on a chart whose decoration is invisible.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// NOTES — what these starters cannot express yet, and what each would take
//
// Written from actually building them. Each item is a limitation hit while authoring, not a wish.
//
// 1. TABLES CANNOT BE CREATED FROM A DOCUMENT.  ——  DONE.
//    Three parts, all of which had to land together:
//      * the seat geometry moved to `shared/catalog/seatmap-tables.ts`, so the table endpoints and
//        the document projection lay a table out with ONE implementation — a table drawn either way
//        now lands in the same place;
//      * `seatOffsets` gained a table branch and `regenerateBlock` builds a table's seats from
//        `tableSeatCount` (a table has no rows or columns, so requiring `params` would mean inventing
//        a row count for something that has none); and
//      * `saveLayout` creates the `layout_tables` rows a document's `table` blocks describe, keyed by
//        BLOCK KEY because a block the document has never saved has no id to map from, and writes the
//        new ids back onto the blocks so a second save recognises them instead of inserting a
//        duplicate set.
//    Deliberately still NOT deleting tables a document has dropped: those rows are pointed at by
//    `seats.table_id` and copied onto `showtime_seats`, so removal is an inventory operation with its
//    own endpoint and its own refusals for sold and held seats.
//    Whole-table booking is now reachable — `bookingMode` is carried on the block — though none of the
//    starters set it, because per-seat is the safer default for a template.
//
// 2. NO FULL-SIZE PREVIEW BEFORE CREATING.  ——  DONE.
//    "Xem trước" on a starter card opens the same `PreviewOverlay` the editor uses, fed by
//    `previewPropsFor` in `SeatMapLibrary.tsx`. No round trip and no new rendering: `projectDocument`
//    is pure and the overlay already took seats and elements as props.
//
// 3. CAPACITY IS FIXED PER STARTER.  ——  DONE, and it was not what it looked like.
//    Each starter now offers three sizes and `build(sizeId)` picks one. The estimate that this was
//    "a form, not geometry" was wrong: changing a row count changes a block's EXTENT, so every
//    neighbour has to move or the two overlap, and overlapping seats block publishing. Two further
//    traps surfaced while fixing it, both worth remembering:
//      * a seat-bearing block's `x`/`y` is the TOP-LEFT of its seat grid, while a decoration
//        element's is its CENTRE (see `atCentreX`), and
//      * derived positions come out fractional (`cos`/`sin`, fractions of a width) while
//        `documentSchema` types every coordinate `int`, so `block()` rounds at the choke point.
//    The tests now project EVERY size of every starter, which is what caught both.
//
// 4. NO ACCESSIBLE SEATS OR COMPANION PAIRS.  ——  DONE.
//    Theatre, cinema, conference and arena each ship wheelchair spaces with their companion seats,
//    placed at the back beside an exit. `accessibleBay` explains the pointer direction, which is easy
//    to get backwards: the ORDINARY seat names the accessible one, never the reverse.
//    Not added to banquet or club: a round table has no "beside the aisle", and where a wheelchair
//    space belongs at a table is a room decision rather than a template one.
//
// 5. NO FOCAL POINT.  ——  DONE, as a chart-level setting rather than a block kind.
//    A focal point is a PROPERTY of the chart, not an object competing with the decoration, so it
//    became two nullable columns on `venue_layouts` (0043) rather than a new `ElementKind` needing a
//    palette entry, a renderer branch and a database enum change. It follows `orphan_rule` exactly —
//    stored on the layout, snapshotted onto the showtime at apply time, read by the buyer — because
//    that is the same shape of thing: a chart-level rule governing best-available.
//    Null keeps the old inference (a stage's centre, else the centroid of the seating), so no chart
//    drawn before this ranks differently. The arena states its pitch; nothing else needs to, because
//    a stage already IS the answer.
//    `focal_point_unset` now stays quiet on a chart that states its own answer — the warning exists to
//    say the ranking is being inferred, and there it is not.
//
// 6. MULTI-FLOOR / TIERS ARE FLAT.  ——  DONE, and it cost far less than this note estimated.
//    A floor hangs off a SECTION (0044), not off a seat. A section is a named part of a room and a
//    part of a room cannot straddle two levels, so the seat's floor is never independently chosen —
//    and `seat_without_section` already refuses to publish a seat with no section, so every
//    publishable seat reaches a level this way. Decoration reaches one too, through
//    `layout_elements.section_id`.
//    That choice is what collapsed the estimate. This note predicted columns on `seats` AND
//    `showtime_seats` plus a migration of every showtime already selling. None were needed: the
//    buyer learns a seat's section by NAME through the snapshot's `sectionStyles`, so the floor
//    rides that existing key. The buyer's side cost one lookup and no schema change at all.
//    Null is the single implicit floor — every chart drawn before this keeps drawing exactly as it
//    did, and neither picker appears until a chart actually has levels. Same contract as 0043.
//    The renderer change the note warned about is real but small: `SeatLayout` derives the visible
//    floor rather than storing it, filters seats and decoration by it, and hands the FILTERED list
//    to `bestSeats` — so "chọn giúp tôi" cannot offer a balcony seat to someone looking at the
//    stalls, and `bestAvailable` itself needed no floor argument at all. Decoration with no section
//    stays drawn on every level, which is right for a hall outline and wrong for nothing.
//    The theatre starter now ships "Tầng trệt" and "Ban công" as real levels, which is the symptom
//    this note opened with.
// ---------------------------------------------------------------------------------------------
