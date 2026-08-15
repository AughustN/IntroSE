/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LayoutCategory,
  LayoutElement,
  LayoutSeat,
  LayoutSection,
  SeatType,
} from "@/shared/catalog/seatmap";
import {
  LAYOUT_MAX_SEATS,
  clampCoord,
  normaliseRotation,
} from "@/shared/catalog/seatmap-validate";

/**
 * The canvas operations (FR-009). Pure functions over a seat list so each one is a single undoable
 * commit and so they can be unit-tested without a DOM.
 *
 * Snapping is an INPUT aid only — every one of these returns a free coordinate, and the stored model
 * never knows whether the grid was on (FR-011).
 */

export const GRID = 50;

/** Default centre-to-centre spacing when a tool lays seats out: 1.5 nominal diameters, the gap a
 *  real theatre row uses and comfortably clear of the overlap threshold (one diameter). */
export const SEAT_PITCH = 150;

// ---- Client-side identity ---------------------------------------------------------------------

/**
 * Ids for things the editor has drawn but the database has never seen.
 *
 * Negative on purpose. Selection, undo and the section a seat points at all need a stable handle the
 * moment a seat appears, long before a save exists to hand out a real one; and negative can never
 * collide with a BIGSERIAL, so `id > 0` is a total test for "already persisted" on both sides of the
 * wire (see `resolveSection` in layouts.repo.ts).
 */
let tempCounter = 0;
export const mintId = (): number => {
  tempCounter -= 1;
  return tempCounter;
};

/**
 * Ids for a preview that is about to be thrown away.
 *
 * A drawing tool re-runs its maker on every pointer move to show what it would create; minting real
 * placeholders for those would be a side effect during render, and the seats never reach the draft
 * anyway. Distinct ids still matter — `arcSeats` keys its result by id, so a preview arc built from
 * a single shared id would collapse every seat onto one point.
 */
export const previewIds = (): (() => number) => {
  let n = 0;
  return () => {
    n += 1;
    return n;
  };
};

// ---- Labels -----------------------------------------------------------------------------------

/** A → B → … → Z → AA, the way rows are lettered on a real seating chart. */
export function rowLabelAt(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** The first row letter not already used in this section, so a second row tool run continues the
 *  alphabet instead of colliding with the first (which validation would flag as a duplicate). */
export function nextRowLabel(seats: LayoutSeat[], sectionId: number | null): string {
  const used = new Set(
    seats.filter((s) => s.sectionId === sectionId).map((s) => s.rowLabel.toUpperCase()),
  );
  for (let i = 0; i < 1000; i += 1) {
    const label = rowLabelAt(i);
    if (!used.has(label)) return label;
  }
  return "A";
}

/**
 * Black or white, whichever stays readable on `hex`.
 *
 * Seats are filled with their price class's colour, and a class may be anything from pale peach to deep
 * burgundy. A fixed ink was legible on some and invisible on others — the seat NUMBER, the one thing on
 * a seat that has to be read, would disappear on exactly the classes an organizer picked to stand out.
 *
 * Uses WCAG relative luminance, and its crossover point (0.179) rather than a naive midpoint: the eye is
 * far more sensitive to green than to blue, so averaging the channels picks the wrong ink for saturated
 * colours — a mid blue is much darker than a mid green of the same nominal brightness.
 */
export function readableInk(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return luminance > 0.179 ? "#17100f" : "#ffffff";
}

export const snap = (v: number, enabled: boolean): number => (enabled ? Math.round(v / GRID) * GRID : Math.round(v));

const isSelected = (s: LayoutSeat, ids: Set<number>) => s.id !== undefined && ids.has(s.id);

/** Move a selection by a delta, clamped into the space (FR-014). */
export function moveSeats(
  seats: LayoutSeat[],
  ids: Set<number>,
  dx: number,
  dy: number,
  grid: boolean,
): LayoutSeat[] {
  return seats.map((s) =>
    isSelected(s, ids)
      ? { ...s, x: clampCoord(snap(s.x + dx, grid)), y: clampCoord(snap(s.y + dy, grid)) }
      : s,
  );
}

/**
 * Move ONE non-sellable element by a delta, clamped into the space.
 *
 * Elements are identified by their index, not by `id`: an element the organizer just dropped from the
 * palette has no id until the layout is saved, and it is precisely the just-dropped one they want to
 * drag into place.
 */
export function moveElement(
  elements: LayoutElement[],
  index: number,
  dx: number,
  dy: number,
  grid: boolean,
): LayoutElement[] {
  return elements.map((el, i) =>
    i === index
      ? { ...el, x: clampCoord(snap(el.x + dx, grid)), y: clampCoord(snap(el.y + dy, grid)) }
      : el,
  );
}

export function deleteElement(elements: LayoutElement[], index: number): LayoutElement[] {
  return elements.filter((_, i) => i !== index);
}

export type AlignEdge = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";

export function alignSeats(seats: LayoutSeat[], ids: Set<number>, edge: AlignEdge): LayoutSeat[] {
  const sel = seats.filter((s) => isSelected(s, ids));
  if (sel.length < 2) return seats;
  const xs = sel.map((s) => s.x);
  const ys = sel.map((s) => s.y);
  const target = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    centerX: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    centerY: Math.round(ys.reduce((a, b) => a + b, 0) / ys.length),
  }[edge];
  const horizontal = edge === "left" || edge === "right" || edge === "centerX";
  return seats.map((s) =>
    isSelected(s, ids)
      ? horizontal
        ? { ...s, x: clampCoord(target) }
        : { ...s, y: clampCoord(target) }
      : s,
  );
}

/** Even out the gaps along the selection's dominant axis. */
export function distributeSeats(seats: LayoutSeat[], ids: Set<number>): LayoutSeat[] {
  const sel = seats.filter((s) => isSelected(s, ids));
  if (sel.length < 3) return seats;
  const spanX = Math.max(...sel.map((s) => s.x)) - Math.min(...sel.map((s) => s.x));
  const spanY = Math.max(...sel.map((s) => s.y)) - Math.min(...sel.map((s) => s.y));
  const axis: "x" | "y" = spanX >= spanY ? "x" : "y";

  const ordered = [...sel].sort((a, b) => a[axis] - b[axis]);
  const start = ordered[0][axis];
  const end = ordered[ordered.length - 1][axis];
  const stepSize = (end - start) / (ordered.length - 1);

  const moved = new Map<number, number>();
  ordered.forEach((s, i) => moved.set(s.id as number, clampCoord(start + i * stepSize)));
  return seats.map((s) =>
    isSelected(s, ids) && moved.has(s.id as number)
      ? { ...s, [axis]: moved.get(s.id as number)! }
      : s,
  );
}

/** Rotate seats in place — cosmetic, it never changes a seat's footprint (FR-008). */
export function rotateSeats(seats: LayoutSeat[], ids: Set<number>, degrees: number): LayoutSeat[] {
  return seats.map((s) =>
    isSelected(s, ids) ? { ...s, rotation: normaliseRotation(s.rotation + degrees) } : s,
  );
}

/**
 * Curve a row along an arc (FR-009), keeping the seats in their existing order and their labels
 * untouched. `bow` is how far the middle of the row bulges, in layout units; negative bows the other
 * way. Each seat is also turned to face the arc's centre, which is what makes a curved tier read
 * correctly.
 *
 * Fewer than two seats is a no-op rather than an error — an arc needs an order to follow.
 */
export function arcSeats(seats: LayoutSeat[], ids: Set<number>, bow: number): LayoutSeat[] {
  const sel = seats.filter((s) => isSelected(s, ids)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (sel.length < 2 || bow === 0) return seats;

  const first = sel[0];
  const last = sel[sel.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return seats;

  // Unit vectors along the row and perpendicular to it.
  const ux = dx / chord;
  const uy = dy / chord;
  const px = -uy;
  const py = ux;

  const next = new Map<number, { x: number; y: number; rotation: number }>();
  sel.forEach((s, i) => {
    const t = i / (sel.length - 1); // 0..1 along the row
    // A parabola is close enough to a circular arc at these spans and needs no centre solve.
    const offset = bow * 4 * t * (1 - t);
    const baseX = first.x + dx * t;
    const baseY = first.y + dy * t;
    const x = clampCoord(baseX + px * offset);
    const y = clampCoord(baseY + py * offset);
    // Face the bow: the tangent's slope tells us how much this seat turns.
    const slope = bow * 4 * (1 - 2 * t);
    const angle = (Math.atan2(uy * chord + py * slope, ux * chord + px * slope) * 180) / Math.PI;
    next.set(s.id as number, { x, y, rotation: normaliseRotation(angle) });
  });

  return seats.map((s) => {
    const n = s.id === undefined ? undefined : next.get(s.id);
    return n ? { ...s, ...n } : s;
  });
}

export function deleteSeats(seats: LayoutSeat[], ids: Set<number>): LayoutSeat[] {
  return seats.filter((s) => !isSelected(s, ids));
}

// ---- Creation tools (FR-010) ------------------------------------------------------------------
//
// Every one of these takes the rectangle or line the organizer just dragged and returns seats. The
// count comes from the SIZE of the gesture rather than from a number typed into a form: drag a
// longer row, get more seats. That is the whole reason the old Section/Row/Count form could not be
// the primary way to build a map — it made you guess the number, then fix the geometry afterwards.

export interface SeatFactory {
  sectionId: number | null;
  /** The price class new seats land in — the active category, alongside the active section. */
  categoryId: number | null;
  seatType: SeatType;
  /** Centre-to-centre spacing. */
  pitch: number;
  /** Where numbering starts within each row. */
  startNumber: number;
  /** First row letter; later rows continue the alphabet. */
  rowLabel: string;
  /**
   * Most seats this ONE gesture may create. Defaults to the whole layout ceiling.
   *
   * The per-row and per-column caps below bound each axis but never their product, so dragging the
   * grid tool across the canvas produced 8,464 seats — four times the ceiling. The server then refused
   * the save with `409 seat_limit_reached` and the entire gesture was lost, after the editor had
   * already rendered and validated all of them. Clipping at draw time fails the right way instead.
   */
  budget?: number;
}

/** How many seats fit along a span at this pitch — at least one, so a tiny drag still makes a seat. */
const fit = (span: number, pitch: number, cap: number): number =>
  Math.max(1, Math.min(cap, Math.round(Math.abs(span) / pitch) + 1));

/** Caps on ONE gesture. Exported so a test can pin them, and because the editor reports them. */
export /** What one gesture is allowed to create: whatever the caller budgeted, bounded by the ceiling. */
const budgetOf = (f: SeatFactory): number =>
  Math.max(0, Math.min(f.budget ?? LAYOUT_MAX_SEATS, LAYOUT_MAX_SEATS));

export const MAX_PER_ROW = 200;
export const MAX_ROWS = 100;

/** A straight run of seats between two points. */
export function makeRow(
  from: { x: number; y: number },
  to: { x: number; y: number },
  f: SeatFactory,
  grid: boolean,
  nextId: () => number = mintId,
): LayoutSeat[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const count = Math.min(fit(length, f.pitch, MAX_PER_ROW), budgetOf(f));
  const rotation = normaliseRotation((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    return {
      id: nextId(),
      sectionId: f.sectionId,
      categoryId: f.categoryId,
      rowLabel: f.rowLabel,
      seatNumber: f.startNumber + i,
      seatType: f.seatType,
      x: clampCoord(snap(from.x + (to.x - from.x) * t, grid)),
      y: clampCoord(snap(from.y + (to.y - from.y) * t, grid)),
      // A row dragged at an angle should have its seats facing along it, not stubbornly upright.
      rotation: Math.abs(rotation) < 1 || Math.abs(rotation - 180) < 1 ? 0 : rotation,
    };
  });
}

/** A rectangular block: rows down, seats across, lettered and numbered as it goes. */
export function makeGrid(
  rect: Rect,
  f: SeatFactory,
  grid: boolean,
  nextId: () => number = mintId,
): LayoutSeat[] {
  const x0 = Math.min(rect.x1, rect.x2);
  const y0 = Math.min(rect.y1, rect.y2);
  const cols = fit(rect.x2 - rect.x1, f.pitch, MAX_PER_ROW);
  const rows = fit(rect.y2 - rect.y1, f.pitch, MAX_ROWS);
  const budget = budgetOf(f);
  const firstRow = labelIndex(f.rowLabel);
  const out: LayoutSeat[] = [];
  for (let r = 0; r < rows && out.length < budget; r += 1) {
    for (let c = 0; c < cols && out.length < budget; c += 1) {
      out.push({
        id: nextId(),
        sectionId: f.sectionId,
        categoryId: f.categoryId,
        rowLabel: rowLabelAt(firstRow + r),
        seatNumber: f.startNumber + c,
        seatType: f.seatType,
        x: clampCoord(snap(x0 + c * f.pitch, grid)),
        y: clampCoord(snap(y0 + r * f.pitch, grid)),
        rotation: 0,
      });
    }
  }
  return out;
}

/** A curved row — the same gesture as `makeRow`, bowed by `bow` layout units at its middle. */
export function makeArc(
  from: { x: number; y: number },
  to: { x: number; y: number },
  bow: number,
  f: SeatFactory,
  grid: boolean,
  nextId: () => number = mintId,
): LayoutSeat[] {
  // Built as a straight row, then bent by the same code the Curve button uses, so a drawn arc and a
  // curved-afterwards row land in exactly the same place.
  const straight = makeRow(from, to, f, grid, nextId);
  const ids = new Set(straight.map((s) => s.id as number));
  return arcSeats(straight, ids, bow);
}

/** Inverse of `rowLabelAt`; unparseable labels start the alphabet over rather than throwing. */
function labelIndex(label: string): number {
  const upper = label.toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) return 0;
  let n = 0;
  for (const ch of upper) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---- Selection-wide edits ---------------------------------------------------------------------

/** Move a selection into a section (or out of every section, with `null`). */
export function assignSection(
  seats: LayoutSeat[],
  ids: Set<number>,
  sectionId: number | null,
): LayoutSeat[] {
  return seats.map((s) => (isSelected(s, ids) ? { ...s, sectionId } : s));
}


/**
 * Re-letter and renumber a selection as one row, in the order it reads on the map.
 *
 * Left to right, then top to bottom — the order a person numbers seats by hand, and the order that
 * makes the result predictable after a marquee that caught two half-rows.
 */
export function renumberSeats(
  seats: LayoutSeat[],
  ids: Set<number>,
  opts: { rowLabel?: string; startNumber: number; reverse?: boolean },
): LayoutSeat[] {
  const sel = seats.filter((s) => isSelected(s, ids)).sort((a, b) => a.y - b.y || a.x - b.x);
  if (opts.reverse) sel.reverse();
  const next = new Map<number, { rowLabel?: string; seatNumber: number }>();
  sel.forEach((s, i) =>
    next.set(s.id as number, { rowLabel: opts.rowLabel, seatNumber: opts.startNumber + i }),
  );
  return seats.map((s) => {
    const n = s.id === undefined ? undefined : next.get(s.id);
    if (!n) return s;
    return { ...s, seatNumber: n.seatNumber, rowLabel: n.rowLabel ?? s.rowLabel };
  });
}

/** Mirror a selection across its own vertical centre line — the fast way to build the other half of
 *  a symmetrical house without drawing it twice. Labels are untouched; renumber after if you want. */
export function mirrorSeats(seats: LayoutSeat[], ids: Set<number>): LayoutSeat[] {
  const sel = seats.filter((s) => isSelected(s, ids));
  if (sel.length < 2) return seats;
  const xs = sel.map((s) => s.x);
  const axis = (Math.min(...xs) + Math.max(...xs)) / 2;
  return seats.map((s) =>
    isSelected(s, ids)
      ? { ...s, x: clampCoord(2 * axis - s.x), rotation: normaliseRotation(-s.rotation) }
      : s,
  );
}

/** Duplicate a selection, offset so the copy is visible and immediately draggable. */
/**
 * Fresh row letters for a copy — one per distinct source row, per section.
 *
 * Without this, duplicating or pasting kept the originals' `rowLabel` AND `seatNumber`, so the copy
 * collided with its own source on (section, row, number). That is `duplicate_label` in the shared
 * validator, which BLOCKS publishing — meaning every Ctrl+D left the layout unpublishable until the
 * organizer noticed and renumbered by hand. `makeRow` already avoids this via `nextRowLabel`; copies
 * simply never did.
 *
 * One new letter per source row rather than one for the whole selection, so duplicating a block keeps
 * its shape instead of collapsing every row into one.
 */
function freshRowLabels(
  existing: LayoutSeat[],
  selection: readonly { sectionId: number | null; rowLabel: string }[],
): Map<string, string> {
  const key = (sectionId: number | null, rowLabel: string) =>
    `${sectionId ?? "none"}|${rowLabel.toUpperCase()}`;
  const used = new Set(existing.map((s) => key(s.sectionId, s.rowLabel)));
  const out = new Map<string, string>();

  for (const s of selection) {
    const from = key(s.sectionId, s.rowLabel);
    if (out.has(from)) continue;
    for (let i = 0; i < 1000; i += 1) {
      const label = rowLabelAt(i);
      const candidate = key(s.sectionId, label);
      if (!used.has(candidate)) {
        used.add(candidate);
        out.set(from, label);
        break;
      }
    }
  }
  return out;
}

export function duplicateSeats(
  seats: LayoutSeat[],
  ids: Set<number>,
  dx: number,
  dy: number,
): { seats: LayoutSeat[]; newIds: Set<number> } {
  const newIds = new Set<number>();
  const selection = seats.filter((s) => isSelected(s, ids));
  const relabel = freshRowLabels(seats, selection);
  const copies = selection.map((s) => {
    const id = mintId();
    newIds.add(id);
    return {
      ...s,
      id,
      rowLabel: relabel.get(`${s.sectionId ?? "none"}|${s.rowLabel.toUpperCase()}`) ?? s.rowLabel,
      x: clampCoord(s.x + dx),
      y: clampCoord(s.y + dy),
    };
  });
  return { seats: [...seats, ...copies], newIds };
}

/**
 * Copy / cut / paste.
 *
 * The clipboard holds seats stripped of identity — no `id`, so a paste always mints fresh
 * placeholders and can never collide with the seats it was copied from, and positions are stored
 * RELATIVE to the selection's top-left corner so a paste lands where it is asked to rather than where
 * the original happened to be. That also makes the payload safe to keep across layouts.
 */
export interface SeatClipboard {
  /** Seats with `x`/`y` relative to the copied selection's top-left corner. */
  seats: Omit<LayoutSeat, "id">[];
}

export function copySeats(seats: LayoutSeat[], ids: Set<number>): SeatClipboard | null {
  const sel = seats.filter((s) => isSelected(s, ids));
  if (sel.length === 0) return null;
  const originX = Math.min(...sel.map((s) => s.x));
  const originY = Math.min(...sel.map((s) => s.y));
  return {
    seats: sel.map(({ id: _id, ...rest }) => ({ ...rest, x: rest.x - originX, y: rest.y - originY })),
  };
}

/** Paste at (x, y), which becomes the pasted block's top-left corner. Returns the new ids so the
 *  caller can select what it just created — pasting and then not knowing what you pasted is useless. */
export function pasteSeats(
  seats: LayoutSeat[],
  clipboard: SeatClipboard,
  x: number,
  y: number,
): { seats: LayoutSeat[]; newIds: Set<number> } {
  const newIds = new Set<number>();
  // Against the CURRENT map, not the one the copy was taken from — so pasting the same clipboard
  // twice lands on two different rows instead of colliding with the first paste.
  const relabel = freshRowLabels(seats, clipboard.seats);
  const copies = clipboard.seats.map((s) => {
    const id = mintId();
    newIds.add(id);
    return {
      ...s,
      id,
      rowLabel: relabel.get(`${s.sectionId ?? "none"}|${s.rowLabel.toUpperCase()}`) ?? s.rowLabel,
      x: clampCoord(s.x + x),
      y: clampCoord(s.y + y),
    };
  });
  return { seats: [...seats, ...copies], newIds };
}

// ---- Sections, categories and elements ---------------------------------------------------------

export function addSection(name: string): LayoutSection {
  return { id: mintId(), name, description: null };
}

/** Palette for a new category. Same five colours the server defaults sections to, so a chart drawn
 *  entirely in the editor and one backfilled from sections look like the same product. */
export const CATEGORY_COLORS = ["#4C9A6B", "#3E7CB1", "#C9762F", "#9B4D8E", "#B3453C"] as const;

export function addCategory(name: string, existing: number): LayoutCategory {
  return { id: mintId(), name, color: CATEGORY_COLORS[existing % CATEGORY_COLORS.length] };
}

/** Flag or unflag a selection as wheelchair-accessible (§9). */
export function setAccessible(
  seats: LayoutSeat[],
  ids: Set<number>,
  isAccessible: boolean,
): LayoutSeat[] {
  return seats.map((s) => (isSelected(s, ids) ? { ...s, isAccessible } : s));
}

export function assignCategory(
  seats: LayoutSeat[],
  ids: Set<number>,
  categoryId: number | null,
): LayoutSeat[] {
  return seats.map((s) => (isSelected(s, ids) ? { ...s, categoryId } : s));
}

/** Drop a category and leave its seats unclassified, for the same reason `removeSection` orphans
 *  rather than deletes: an unclassified seat is a visible, fixable validation issue; a deleted block
 *  of work is not recoverable once saved. */
export function removeCategory(
  categories: LayoutCategory[],
  seats: LayoutSeat[],
  categoryId: number,
): { categories: LayoutCategory[]; seats: LayoutSeat[] } {
  return {
    categories: categories.filter((c) => c.id !== categoryId),
    seats: seats.map((s) => (s.categoryId === categoryId ? { ...s, categoryId: null } : s)),
  };
}

/** Drop a section and orphan its seats rather than deleting them — losing a block's worth of work to
 *  a mis-click is not recoverable once saved, whereas a sectionless seat is a visible, fixable
 *  validation issue (FR-030). */
export function removeSection(
  sections: LayoutSection[],
  seats: LayoutSeat[],
  sectionId: number,
): { sections: LayoutSection[]; seats: LayoutSeat[] } {
  return {
    sections: sections.filter((s) => s.id !== sectionId),
    seats: seats.map((s) => (s.sectionId === sectionId ? { ...s, sectionId: null } : s)),
  };
}


export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Seats whose centre falls inside a marquee rectangle.
 *
 * Typed on the least a seat has to have, so the same marquee works over a layout being drafted and
 * over a showtime's live inventory — two different seat shapes, one selection rule.
 */
export function seatsInRect(
  seats: { id?: number; x: number; y: number }[],
  rect: { x1: number; y1: number; x2: number; y2: number },
): number[] {
  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);
  return seats
    .filter((s) => s.id !== undefined && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
    .map((s) => s.id as number);
}

/** A row's letter, and where on the map to draw it. */
export interface RowMarker {
  key: string;
  label: string;
  x: number;
  y: number;
}

/** The minimum a seat needs for its row to be lettered. */
interface RowMarkerSeat {
  row: string;
  number: number;
  x: number;
  y: number;
  section: string | null;
}

/**
 * Where to draw each row's letter: just past the end of the row, continuing the row's own direction.
 *
 * A seat map without row letters can only be read seat by seat — the number inside a seat says which
 * seat, never which row, so "K12" was legible on a ticket and nowhere on the chart it refers to.
 *
 * The direction comes from the row's LAST LEG rather than from world axes or from the chord back to
 * the first seat. That is what makes one rule serve every kind of row this editor can draw: a straight
 * row extends along itself, a rotated block's rows extend along the block, and a curved row leaves on
 * the tangent it ends at instead of cutting back toward its own start.
 *
 * Grouped by section AND label, because two blocks can each hold a row "A" — legitimately, since a
 * duplicate label is only a duplicate within one section. Grouping on the label alone would merge
 * them and put a single letter in the gap between two blocks, belonging to neither.
 */
export function rowMarkers(seats: RowMarkerSeat[], gap: number): RowMarker[] {
  const rows = new Map<string, RowMarkerSeat[]>();
  for (const s of seats) {
    if (!s.row) continue; // an unlabelled seat has no row to letter
    const key = `${s.section ?? ""}|${s.row}`;
    const group = rows.get(key);
    if (group) group.push(s);
    else rows.set(key, [s]);
  }

  const markers: RowMarker[] = [];
  for (const [key, group] of rows) {
    // By seat NUMBER, not array order: the projection's emission order is not part of its contract,
    // and the end of the row is the highest number in it.
    const ordered = [...group].sort((a, b) => a.number - b.number);
    const last = ordered[ordered.length - 1];
    const prev = ordered.length > 1 ? ordered[ordered.length - 2] : null;

    let dx = 1;
    let dy = 0;
    if (prev) {
      const len = Math.hypot(last.x - prev.x, last.y - prev.y);
      // Two seats stacked exactly on top of each other say nothing about direction; fall back to
      // rightward rather than dividing by zero and placing the letter at NaN.
      if (len > 0) {
        dx = (last.x - prev.x) / len;
        dy = (last.y - prev.y) / len;
      }
    }
    markers.push({ key, label: last.row, x: last.x + dx * gap, y: last.y + dy * gap });
  }
  return markers;
}
