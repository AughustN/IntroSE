/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Compared the way the server's uniqueness is felt by a person: trimmed, case-folded. */
const key = (name: string) => name.trim().toLocaleLowerCase("vi-VN");

/** The server's ceiling, with room left for the " 99" a collision can add. */
const MAX = 80;
const ROOM = MAX - 4;

/**
 * A chart name no chart at the target venue already holds.
 *
 * The three copy paths — duplicate, copy-from-template, copy-from-chart — each built a FIXED name:
 * "X (bản sao)", "X (từ mẫu)". A second copy of the same chart therefore hit `UNIQUE (layout_id,
 * name)` and came back `layout_name_taken`, from forms that offer no name field. The organizer was
 * told the name was taken and given nothing to change; the only way through was renaming the
 * original first.
 *
 * Numbered rather than prompting, because the name is not the decision being made — copying is. The
 * row's own Rename is there for anyone who cares which.
 */
export function freeLayoutName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(key));
  const trimmed = base.length > ROOM ? base.slice(0, ROOM).trimEnd() : base;
  if (!used.has(key(trimmed))) return trimmed;
  for (let n = 2; n < 100; n += 1) {
    const next = `${trimmed} ${n}`;
    if (!used.has(key(next))) return next;
  }
  // A venue with 99 copies of one name is not a case worth a cleverer answer than a distinct one.
  return `${trimmed} ${Date.now() % 10000}`;
}
