// Projecting the authoring document onto the sellable rows, shared by server and web (Principle VI).
//
// One function, two callers, and that is the design rather than a convenience:
//
//   * the SERVER calls it inside `saveLayout` to derive the rows it persists;
//   * the EDITOR calls it to preview what will be sold and to run the same `validateLayout` the
//     publish gate runs.
//
// A second implementation on either side would let the picture the organizer approves differ from the
// seats a buyer is offered — the exact drift the shared-contract rule exists to prevent.
//
// Everything here is pure and DOM-free, so it is unit-testable with no database (`npm run test:web`).

import type {
  BlockParams,
  ChartDocument,
  DocumentBlock,
  DocumentRow,
  DocumentSeat,
  RowLabelScheme,
  SeatLabelScheme,
} from './seatmap-document.js';
import { isSeatBearing } from './seatmap-document.js';
import type {
  ElementKind,
  LayoutCategory,
  LayoutRow,
  LayoutElement,
  LayoutSeat,
  LayoutSection,
} from './seatmap.js';
import { LAYOUT_MAX_SEATS, clampCoord, normaliseRotation } from './seatmap-validate.js';

export interface ProjectedLayout {
  sections: LayoutSection[];
  categories: LayoutCategory[];
  /**
   * The chart's rows (0032), one per distinct `(sectionId, rowLabel)` plus any the document declares
   * that hold no seats yet. A negative `id` is a placeholder the writer resolves, exactly as it does
   * for a section or a category the editor has just created.
   */
  rows: LayoutRow[];
  /** ABSOLUTE positions in layout units, clamped into the space. */
  seats: LayoutSeat[];
  elements: LayoutElement[];
  /**
   * Which document seat produced `seats[i]`, so the writer can stitch the real database id back into
   * the document after an INSERT. Parallel to `seats`, same length.
   */
  seatOrigin: { blockKey: string; index: number }[];
  /**
   * Which block produced `elements[i]`. Without this the editor can render decoration but cannot say
   * which block a click landed on — which is exactly how a stage ends up impossible to select.
   */
  elementOrigin: string[];
}

/** Block kinds that become decoration rows, and the `layout_elements.kind` each maps to. */
const BLOCK_TO_ELEMENT: Record<string, ElementKind> = {
  stage: 'stage',
  aisle: 'aisle',
  door: 'door',
  bar: 'bar',
  text: 'label',
  shape: 'boundary',
  'ga-zone': 'area',
  exit: 'exit',
  restroom: 'restroom',
  food_drink: 'food_drink',
  smoking: 'smoking',
  first_aid: 'first_aid',
  lift_stairs: 'lift_stairs',
  wheelchair: 'wheelchair',
};

// ---- Labels ------------------------------------------------------------------------------------

/** A → B → … → Z → AA, matching `layoutOps.rowLabelAt` so both editors letter rows identically. */
export function letterAt(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * The label for row `r` of `rows`, under a scheme.
 *
 * `-desc` counts from the far end, which is how a real chart is lettered when row A is nearest the
 * stage but the block was drawn from the back.
 */
export function rowLabelFor(
  r: number,
  rows: number,
  scheme: RowLabelScheme = 'alpha-asc',
  prefix = '',
  startIndex = 0,
  suffix = '',
): string {
  const i = scheme === 'alpha-desc' || scheme === 'num-desc' ? rows - 1 - r : r;
  const body = scheme === 'num-asc' || scheme === 'num-desc' ? String(startIndex + i + 1) : letterAt(startIndex + i);
  // `seats.row_label` is capped at 8 characters by the route schema, so a long prefix or suffix is
  // truncated here rather than rejected at save time after the organizer has drawn the block.
  return `${prefix}${body}${suffix}`.slice(0, 8);
}

/** The number for seat `c` of `perRow`, under a scheme. */
/** Inverse of `letterAt`: "A" → 0, "Z" → 25, "AA" → 26. Null when the label is not pure letters. */
export function letterIndex(label: string): number | null {
  if (!/^[A-Z]+$/.test(label)) return null;
  let n = 0;
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Where a block's existing labelling starts, so making it parametric CONTINUES it rather than
 * restarting from A1.
 *
 * Adopting a chart drawn before the document model produces a block with no parameters and whatever
 * labels the rows already carry — commonly not starting at 1. Regenerating such a block from the
 * defaults renumbered it: a row numbered 11..100 became 1..90, so only the overlap kept its database
 * rows and, worse, every surviving id shifted along the row. The seat a ticket was sold for ended up
 * ten places from where the buyer chose it.
 *
 * Only inferred for labelling this function can read back exactly — pure letters, or plain numbers.
 * Anything else (a prefix, hand-edited labels) is left alone: guessing wrong would relabel a chart
 * silently, and doing nothing merely leaves the organizer to set the start themselves.
 */
export function inferStartLabels(block: DocumentBlock): Partial<BlockParams> {
  const seats = block.seats ?? [];
  if (seats.length === 0) return {};

  const out: Partial<BlockParams> = {};

  // Seat numbers: the lowest in use, so an ascending scheme regenerates onto the same numbers.
  const lowest = Math.min(...seats.map((s) => s.seatNumber));
  if (Number.isFinite(lowest) && lowest >= 1) out.startSeatNumber = lowest;

  // Rows: the topmost row's label decides where the lettering starts.
  const topmost = seats.reduce((a, b) => (b.dy < a.dy ? b : a), seats[0]).rowLabel;
  const asLetters = letterIndex(topmost);
  if (asLetters !== null) {
    out.startRowIndex = asLetters;
  } else if (/^[0-9]+$/.test(topmost)) {
    out.rowLabelScheme = 'num-asc';
    out.startRowIndex = Math.max(0, Number(topmost) - 1);
  }
  return out;
}

export function seatNumberFor(
  c: number,
  perRow: number,
  scheme: SeatLabelScheme = 'num-asc',
  start = 1,
  /** How far apart consecutive seats number (§13). 1 is what every stored chart has. */
  step = 1,
): number {
  const by = Math.max(1, Math.floor(step));
  switch (scheme) {
    case 'num-desc':
      return start + (perRow - 1 - c) * by;
    // Odd/even numbering is how a centre-aisle row is labelled: 1,3,5 to the left, 2,4,6 to the right.
    // The step is deliberately NOT applied here: these schemes already ARE a step of two, and
    // multiplying them again would produce 1,5,9 for a request that says "odd".
    case 'even':
      return start * 2 + c * 2;
    case 'odd':
      return start * 2 - 1 + c * 2;
    default:
      return start + c * by;
  }
}

/**
 * A seat number as the organizer wants it READ: zero-padded, per §13.
 *
 * Padding is presentation and lives here rather than in the stored value, because `seats.seat_number`
 * is `INT NOT NULL` — the column cannot hold "01", and widening it to text would make every ordering,
 * comparison and gap-check in the system string-based. A chart numbered 1..10 would then sort
 * 1, 10, 2. So the integer stays the number and this is how it is shown.
 */
export function seatDisplay(seatNumber: number, padding = 0): string {
  const digits = Math.max(0, Math.floor(padding));
  return String(seatNumber).padStart(digits, '0');
}

// ---- Regeneration ------------------------------------------------------------------------------

/** Positions for a block's seats, in block-relative units, before rotation. */
function seatOffsets(block: DocumentBlock, rows: number, perRow: number): { dx: number; dy: number }[] {
  const p = block.params ?? {};
  const seatSpacing = p.seatSpacing ?? 150;
  const rowSpacing = p.rowSpacing ?? 150;
  const out: { dx: number; dy: number }[] = [];

  if (block.kind === 'curved-row') {
    // Rows on concentric arcs, centred on the block's midline and bulging away from the origin, so a
    // curved tier faces the stage the way the organizer drew it.
    const radius = p.radius ?? 1200;
    const sweep = ((p.arcAngle ?? 90) * Math.PI) / 180;
    for (let r = 0; r < rows; r += 1) {
      const rr = radius + r * rowSpacing;
      for (let c = 0; c < perRow; c += 1) {
        const t = perRow === 1 ? 0.5 : c / (perRow - 1);
        const a = -sweep / 2 + t * sweep;
        out.push({ dx: Math.round(rr * Math.sin(a)), dy: Math.round(rr * (1 - Math.cos(a)) + r * rowSpacing) });
      }
    }
    return out;
  }

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < perRow; c += 1) out.push({ dx: c * seatSpacing, dy: r * rowSpacing });
  }
  return out;
}

/**
 * Rebuild a parametric block's seats from its parameters, KEEPING the database identity of every seat
 * whose label is unchanged.
 *
 * This carry-over rule is the difference between a working feature and one that detaches paid tickets.
 * The reference editor matched an old seat to a new one by flat index (`r * cols + c`), so changing
 * "seats per row" from 10 to 11 shifted every seat by one and reshuffled every identity — which,
 * projected, is a delete-and-reinsert of the whole block. Here the key is
 * `${rowLabel}|${seatNumber}` — the very tuple `UNIQUE (section_id, row_label, seat_number)` treats as
 * identity — so:
 *
 *   * 10 → 11 seats per row: A1–A10 keep their rows, A11 is minted;
 *   * 10 → 9: A10's row is dropped (and refused by the server if a showtime has bound it);
 *   * changing a label scheme: correctly a relabel of every seat, which `apply.ts` classifies as
 *     `relabel` and refuses for sold seats at re-apply. Truthful rather than silent.
 *
 * A block with no `params` is returned untouched: it was never built from parameters, and inventing
 * some in order to "regenerate" it would relabel seats nobody asked to change.
 */
export function regenerateBlock(
  block: DocumentBlock,
  mint: () => number,
  budget = LAYOUT_MAX_SEATS,
): DocumentBlock {
  if (!block.params || !isSeatBearing(block.kind)) return block;
  const p = block.params;

  const rows = block.kind === 'single-row' ? 1 : Math.max(1, Math.floor(p.rowsCount ?? 1));
  const perRow = Math.max(1, Math.floor(p.seatsPerRow ?? 1));
  const offsets = seatOffsets(block, rows, perRow);

  // Clipped to what is left of the layout ceiling. The reference inspector had no cap at all, so
  // `rowsCount: 100 × seatsPerRow: 200` built 20,000 seats and the save was refused afterwards, losing
  // the work. Failing at edit time is the honest place to fail.
  const limit = Math.max(0, Math.min(offsets.length, budget));

  const existing = new Map<string, DocumentSeat>();
  for (const s of block.seats ?? []) existing.set(`${s.rowLabel}|${s.seatNumber}`, s);

  const seats: DocumentSeat[] = [];
  for (let i = 0; i < limit; i += 1) {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    const rowLabel = rowLabelFor(
      r, rows, p.rowLabelScheme, p.rowLabelPrefix ?? '', p.startRowIndex ?? 0, p.rowLabelSuffix ?? '',
    );
    const seatNumber = seatNumberFor(
      c, perRow, p.seatLabelScheme, p.startSeatNumber ?? 1, p.seatNumberStep ?? 1,
    );
    const kept = existing.get(`${rowLabel}|${seatNumber}`);
    seats.push({
      // Identity survives iff the label survives.
      seatId: kept?.seatId ?? mint(),
      rowLabel,
      seatNumber,
      dx: offsets[i].dx,
      dy: offsets[i].dy,
      rotation: kept?.rotation ?? 0,
      categoryId: kept?.categoryId,
      sectionId: kept?.sectionId,
      isAccessible: kept?.isAccessible,
      seatType: kept?.seatType,
    });
  }
  return { ...block, seats };
}

// ---- Projection --------------------------------------------------------------------------------

/**
 * Derive the sellable rows from the document.
 *
 * A table's seats are PASSED THROUGH rather than recomputed. Their geometry belongs to
 * `tables.distributeSeats` on the server — a table's seats must sit outside its edge — so this module
 * never derives it; but the seats must still appear in the projection, because `saveLayout` deletes
 * every seat the projection does not name. Skipping them silently wiped a table's seats on the first
 * save, and refused the save outright with `seat_in_use` once a showtime had bound them.
 *
 * The same applies to a `ga-zone`'s standing positions: the zone contributes its outline element here,
 * and any standing seats already generated for it are carried through with the block that owns them.
 *
 * Neither creates or deletes a `layout_tables` row — tables keep their own endpoints, and a layout
 * edited through those has its document nulled and re-adopted on the next read.
 */
export function projectDocument(doc: ChartDocument): ProjectedLayout {
  const sections: LayoutSection[] = doc.sections.map((s) => ({
    id: s.id,
    name: s.name,
    seatShape: s.seatShape,
    seatSizeMultiplier: s.seatSizeMultiplier,
  }));
  const categories: LayoutCategory[] = doc.categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
  }));

  /*
   * Rows.
   *
   * Seeded from what the document declares, so a stored row keeps its id — which is the entire reason
   * the table exists: a rename must change what the row is CALLED without changing which row it IS.
   * Anything a seat refers to that is not declared is minted here, which is what makes every chart
   * written before 0032 project without its blob being migrated.
   *
   * Keyed on section AND label, because two sections may each hold a row "A" and they are not the
   * same row — the same scoping `uq_seat_label` uses.
   */
  const rows: LayoutRow[] = (doc.rows ?? []).map((r) => ({
    id: r.id,
    sectionId: r.sectionId,
    label: r.label,
    displayOrder: r.displayOrder,
  }));
  const rowKey = (sectionId: number | null, label: string) => `${sectionId ?? 'none'}|${label}`;
  const rowIdByKey = new Map(rows.map((r) => [rowKey(r.sectionId, r.label), r.id]));
  let nextRowPlaceholder = -1;

  const rowIdFor = (sectionId: number | null, label: string): number => {
    const key = rowKey(sectionId, label);
    const known = rowIdByKey.get(key);
    if (known !== undefined) return known;
    const id = nextRowPlaceholder;
    nextRowPlaceholder -= 1;
    rows.push({ id, sectionId, label, displayOrder: rows.length });
    rowIdByKey.set(key, id);
    return id;
  };

  const seats: LayoutSeat[] = [];
  const seatOrigin: { blockKey: string; index: number }[] = [];
  const elements: LayoutElement[] = [];
  const elementOrigin: string[] = [];

  for (const block of doc.blocks) {
    if (!isSeatBearing(block.kind)) {
      const kind = BLOCK_TO_ELEMENT[block.kind];
      if (!kind) continue;
      elements.push({
        kind,
        x: clampCoord(block.x),
        y: clampCoord(block.y),
        width: Math.max(1, Math.round(block.width)),
        height: Math.max(1, Math.round(block.height)),
        rotation: normaliseRotation(block.rotation),
        label: block.label ?? null,
        points: block.points ?? null,
        capacity: block.kind === 'ga-zone' ? (block.capacity ?? null) : null,
        color: block.color ?? null,
        geometry: block.geometry ?? null,
        sectionId: block.sectionId,
      });
      elementOrigin.push(block.key);
      continue;
    }

    // A ga-zone draws its outline here; its standing positions come from the standing-area endpoint.
    // Any it already owns fall through to the seat loop below, so a save never drops them.
    if (block.kind === 'ga-zone') {
      elements.push({
        kind: 'area',
        x: clampCoord(block.x),
        y: clampCoord(block.y),
        width: Math.max(1, Math.round(block.width)),
        height: Math.max(1, Math.round(block.height)),
        rotation: normaliseRotation(block.rotation),
        label: block.label ?? block.title,
        points: block.points ?? null,
        capacity: block.capacity ?? null,
        color: block.color ?? null,
        geometry: block.geometry ?? null,
        sectionId: block.sectionId,
        // What makes it a CAPACITY zone rather than a drawing: the price class its capacity is sold
        // under. Without one the publish gate reports `zone_without_category`.
        categoryId: block.categoryId,
      });
      elementOrigin.push(block.key);
      // NOTE: no `continue` — fall through so the zone's existing standing seats are projected too.
    }

    // Rotation is about the block's ORIGIN, matching the transform `DocumentCanvas` draws with
    // (`translate(x,y) rotate(r)`). Keeping the two the same is what makes the preview trustworthy.
    const rad = (normaliseRotation(block.rotation) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    for (const [index, s] of (block.seats ?? []).entries()) {
      seats.push({
        id: s.seatId > 0 ? s.seatId : undefined,
        sectionId: s.sectionId ?? block.sectionId,
        categoryId: s.categoryId ?? block.categoryId,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        seatType: s.seatType ?? 'single',
        x: clampCoord(block.x + s.dx * cos - s.dy * sin),
        y: clampCoord(block.y + s.dx * sin + s.dy * cos),
        rotation: normaliseRotation(s.rotation + block.rotation),
        isAccessible: s.isAccessible ?? false,
        rowId: rowIdFor(s.sectionId ?? block.sectionId, s.rowLabel),
      });
      seatOrigin.push({ blockKey: block.key, index });
    }
  }

  return { sections, categories, rows, seats, elements, seatOrigin, elementOrigin };
}

/**
 * Write real row ids back into the document after a save (0032).
 *
 * The counterpart of `stitchSeatIds`, and needed for the same reason with a sharper edge. The editor
 * does not build rows — the projection derives them and mints a negative placeholder for each — so
 * without this the stored document would hold those placeholders, the NEXT save would present them as
 * new rows again, and the INSERT would collide with `layout_rows_label_idx`. Not a silent drift but a
 * hard 23505 on the second save of every chart.
 *
 * Seats are addressed through `seatOrigin`, exactly as `stitchSeatIds` addresses them, so a seat the
 * projection skipped keeps whatever it had rather than being handed a row it is not in.
 */
export function stitchRows(
  doc: ChartDocument,
  projected: Pick<ProjectedLayout, 'rows' | 'seats' | 'seatOrigin'>,
  resolve: (placeholderOrRealId: number) => number,
): ChartDocument {
  const rows: DocumentRow[] = projected.rows.map((r) => ({
    id: resolve(r.id),
    label: r.label,
    sectionId: r.sectionId,
    displayOrder: r.displayOrder,
  }));

  const rowIdByBlock = new Map<string, Map<number, number>>();
  projected.seatOrigin.forEach((origin, i) => {
    const rowId = projected.seats[i]?.rowId;
    if (rowId === null || rowId === undefined) return;
    const forBlock = rowIdByBlock.get(origin.blockKey) ?? new Map<number, number>();
    forBlock.set(origin.index, resolve(rowId));
    rowIdByBlock.set(origin.blockKey, forBlock);
  });

  return {
    ...doc,
    rows,
    blocks: doc.blocks.map((b) => {
      const forBlock = rowIdByBlock.get(b.key);
      if (!forBlock || !b.seats) return b;
      return {
        ...b,
        seats: b.seats.map((s, i) => (forBlock.has(i) ? { ...s, rowId: forBlock.get(i)! } : s)),
      };
    }),
  };
}

/**
 * Write real database ids back into the document after a save.
 *
 * `saved[i]` is the id the database gave `projected.seats[i]`, and `seatOrigin[i]` says which document
 * seat that was — so the stored document ends up holding only positive ids. That is what makes
 * "negative means never persisted" a true invariant on the server side, and it means reloading hands
 * the editor a document that projects to exactly the rows in the database.
 */
export function stitchSeatIds(
  doc: ChartDocument,
  seatOrigin: { blockKey: string; index: number }[],
  saved: number[],
): ChartDocument {
  const byBlock = new Map<string, Map<number, number>>();
  seatOrigin.forEach((origin, i) => {
    const id = saved[i];
    if (id === undefined) return;
    const bucket = byBlock.get(origin.blockKey) ?? new Map<number, number>();
    bucket.set(origin.index, id);
    byBlock.set(origin.blockKey, bucket);
  });

  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      const ids = byBlock.get(b.key);
      if (!ids || !b.seats) return b;
      return { ...b, seats: b.seats.map((s, i) => ({ ...s, seatId: ids.get(i) ?? s.seatId })) };
    }),
  };
}
