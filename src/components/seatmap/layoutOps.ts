/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayoutElement, LayoutSeat } from "@/shared/catalog/seatmap";
import { clampCoord, normaliseRotation } from "@/shared/catalog/seatmap-validate";

/**
 * The canvas operations (FR-009). Pure functions over a seat list so each one is a single undoable
 * commit and so they can be unit-tested without a DOM.
 *
 * Snapping is an INPUT aid only — every one of these returns a free coordinate, and the stored model
 * never knows whether the grid was on (FR-011).
 */

export const GRID = 50;

export const snap = (v: number, enabled: boolean): number =>
  enabled ? Math.round(v / GRID) * GRID : Math.round(v);

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

/** Seats whose centre falls inside a marquee rectangle. */
export function seatsInRect(
  seats: LayoutSeat[],
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
