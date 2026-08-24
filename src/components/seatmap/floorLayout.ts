/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The exploded-floor transform (0044).
 *
 * A second deck physically sits ON the first, so an honest chart STORES it there — stacked, sharing
 * the plan's footprint. That is unreadable as a picture: every upper seat hides a lower one.
 *
 * Pulling the levels apart is therefore a RENDER transform and never stored data. The coordinates in
 * the database stay truthful, an organizer never has to draw a lie to get a legible map, and turning
 * the view off restores the real geometry exactly.
 *
 * Pure and separate from `SeatLayout.tsx` so the arithmetic is pinned by tests rather than by
 * reading a 600-line component — the same reason `editorHint.ts` lives apart from the editor.
 */

/** Anything with an x and the floor it belongs to. Seats and decoration both qualify. */
export interface Placed {
  x: number;
  floor?: string | null;
}

/** Gap between exploded levels, as a fraction of the widest one. */
export const SPLIT_GUTTER = 0.14;

/**
 * How far each floor moves along x so the levels stand side by side.
 *
 * Laid out left to right in the order given — the organizer's own floor order, so the ground floor
 * reads first. Each level is shifted so its own bounding box clears the previous one.
 *
 * PER-FLOOR boxes rather than one shared box, so this reads correctly whether the levels are stacked
 * (identical footprints) or drawn as concentric rings (very different ones): a concentric bowl gets
 * the gap its own geometry needs instead of a gap sized for the whole chart.
 *
 * The first floor present always maps to 0, so a chart never drifts away from where it was drawn,
 * and a floor holding nothing is skipped rather than reserving empty space.
 */
export function floorShifts(
  items: readonly Placed[],
  floorsInOrder: readonly { name: string }[],
  gutter = SPLIT_GUTTER,
): Map<string, number> {
  const shift = new Map<string, number>();

  const boxes = floorsInOrder.map((f) => {
    const xs = items.filter((i) => (i.floor ?? null) === f.name).map((i) => i.x);
    return { name: f.name, box: xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null };
  });
  const widest = Math.max(1, ...boxes.map((e) => (e.box ? e.box.max - e.box.min : 0)));

  let cursor: number | null = null;
  for (const { name, box } of boxes) {
    if (!box) continue;
    if (cursor === null) {
      shift.set(name, 0);
      cursor = box.max;
      continue;
    }
    const dx: number = cursor + widest * gutter - box.min;
    shift.set(name, dx);
    cursor = box.max + dx;
  }
  return shift;
}

/** Anything the editor draws that can belong to a section. */
export interface Sectioned {
  key: string;
  sectionId?: number | null;
}

/**
 * Blocks that belong to a level the organizer is NOT editing.
 *
 * Returned so the canvas can GHOST them — dim, inert, still on screen. Hiding them was the first
 * version's mistake: placing a balcony over the stalls means aligning against the stalls, and you
 * cannot align against something that is not drawn.
 *
 * A block with NO section is never ghosted. Structural drawing — a hall outline, a boundary — carries
 * no section, and it is not a thing the second storey stops having; fading it would make every level
 * look like it was missing its walls.
 *
 * `null` for the active floor means "every level is editable", which is what a flat chart always is
 * and what a levelled chart is until the organizer narrows it.
 */
export function ghostedBlockKeys(
  blocks: readonly Sectioned[],
  floorOfSection: ReadonlyMap<number, number | null>,
  activeFloor: number | null,
): Set<string> {
  const ghost = new Set<string>();
  if (activeFloor === null) return ghost;
  for (const b of blocks) {
    if (b.sectionId === null || b.sectionId === undefined) continue;
    if ((floorOfSection.get(b.sectionId) ?? null) !== activeFloor) ghost.add(b.key);
  }
  return ghost;
}
