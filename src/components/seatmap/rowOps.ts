/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChartDocument, DocumentBlock, DocumentSeat } from "@/shared/catalog/seatmap-document";
import { isSeatBearing } from "@/shared/catalog/seatmap-document";
import { mintId } from "./layoutOps";

/**
 * Operations on a ROW (§9).
 *
 * Rows became addressable in 0032, and these are what that made possible: renaming, reversing,
 * deleting, duplicating and reordering a row without touching the seats in the rows around it.
 *
 * Two rules run through all of it.
 *
 * IDENTITY. A seat keeps its `seatId` through everything here except duplication, which is creating
 * new seats and mints new ids for them (§42 Rules 1, 3, 4, 6). Nothing renumbers a neighbouring row
 * as a side effect; that is the explicit `renumberSection` command's job (§42 Rule 5).
 *
 * PARAMETRIC BLOCKS. A block with `params` describes its rows as a generated sequence — "5 rows,
 * lettered A-ascending". Deleting or inserting in the MIDDLE of that produces rows the sequence
 * cannot express (§9's own example: A, B, C, D with B deleted is A, C, D), so the block stops being
 * parametric and becomes a free group of seats. That is not a downgrade hidden from the organizer —
 * it is the same state every chart adopted from before the document model is in, and the alternative
 * is regenerating the block, which would recreate the row that was just deleted.
 */

/** Where a row is: the block holding it, and what its seats are currently called. */
export interface RowRef {
  blockKey: string;
  label: string;
}

const editable = (b: DocumentBlock): boolean =>
  isSeatBearing(b.kind) && b.kind !== "table" && !b.locked;

/** The labels a block's seats currently carry, in the order the seats appear. */
export function rowLabelsOf(block: DocumentBlock): string[] {
  const seen: string[] = [];
  for (const s of block.seats ?? []) if (!seen.includes(s.rowLabel)) seen.push(s.rowLabel);
  return seen;
}

/** Replace one block, and drop the row-generation parameters if the change makes them a lie. */
function rewrite(
  doc: ChartDocument,
  blockKey: string,
  fn: (b: DocumentBlock) => DocumentBlock,
): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.key === blockKey && editable(b) ? fn(b) : b)),
  };
}

/**
 * Rename a row, everywhere it appears.
 *
 * Document-wide by row id rather than per block, because a row can legitimately span two blocks that
 * share a section — and renaming half of it would split one row into two.
 */
export function renameRow(doc: ChartDocument, rowId: number, label: string): ChartDocument {
  const next = label.trim().slice(0, MAX_ROW_LABEL);
  if (!next) return doc;
  return {
    ...doc,
    rows: doc.rows?.map((r) => (r.id === rowId ? { ...r, label: next } : r)),
    blocks: doc.blocks.map((b) =>
      editable(b)
        ? { ...b, seats: b.seats?.map((s) => (s.rowId === rowId ? { ...s, rowLabel: next } : s)) }
        : b,
    ),
  };
}

/**
 * Reverse the numbering of one row: seat 1 becomes seat N.
 *
 * The seats do NOT move — this is a relabelling, so the seat physically nearest the aisle keeps its
 * id and gets a different number. That is what makes it safe on a chart that has already sold: the
 * showtime holds its own snapshot of the old numbers, and nothing about which seat is which changes.
 */
export function reverseRow(doc: ChartDocument, ref: RowRef): ChartDocument {
  return rewrite(doc, ref.blockKey, (b) => {
    const inRow = (b.seats ?? []).filter((s) => s.rowLabel === ref.label);
    if (inRow.length < 2) return b;
    const numbers = inRow.map((s) => s.seatNumber);
    const flipped = [...numbers].reverse();
    const byOldNumber = new Map(numbers.map((n, i) => [n, flipped[i]]));
    return {
      ...b,
      // The sequence no longer describes these numbers, so the block stops claiming it does.
      params: undefined,
      seats: b.seats?.map((s) =>
        s.rowLabel === ref.label ? { ...s, seatNumber: byOldNumber.get(s.seatNumber) ?? s.seatNumber } : s,
      ),
    };
  });
}

/**
 * Delete one row's seats.
 *
 * The rows around it keep their labels (§9: A, B, C, D with B deleted is A, C, D — never A, B, C).
 * Closing that gap is the explicit `renumberSection`, or the auto-renumber preference if the
 * organizer has left it on.
 */
export function deleteRow(doc: ChartDocument, ref: RowRef): ChartDocument {
  const block = doc.blocks.find((b) => b.key === ref.blockKey);
  const goingIds = new Set(
    (block?.seats ?? []).filter((s) => s.rowLabel === ref.label).map((s) => s.rowId).filter((id): id is number => id != null),
  );

  const withoutSeats = rewrite(doc, ref.blockKey, (b) => {
    const kept = (b.seats ?? []).filter((s) => s.rowLabel !== ref.label);
    const wasLast = rowLabelsOf(b).at(-1) === ref.label;
    return {
      ...b,
      // Removing the LAST row is still a sequence, one shorter. Removing one from the middle is not.
      params: wasLast && b.params ? { ...b.params, rowsCount: Math.max(1, (b.params.rowsCount ?? 1) - 1) } : undefined,
      seats: kept,
    };
  });

  // Drop the row itself only if nothing else still occupies it — two blocks may share one row.
  const stillUsed = new Set<number>();
  for (const b of withoutSeats.blocks) for (const s of b.seats ?? []) if (s.rowId != null) stillUsed.add(s.rowId);
  return {
    ...withoutSeats,
    rows: withoutSeats.rows?.filter((r) => !goingIds.has(r.id) || stillUsed.has(r.id)),
  };
}

/**
 * How long a row label may be — `seats.row_label` is `z.string().trim().min(1).max(8)` on the route
 * (`server/src/modules/seatmap/document.schema.ts`). A label built past it is not merely ugly, it is
 * a save the server will refuse.
 */
const MAX_ROW_LABEL = 8;

/** A label that fits, keeping the suffix and shortening the base — never the other way round. */
const withSuffix = (base: string, suffix: string) =>
  base.slice(0, Math.max(0, MAX_ROW_LABEL - suffix.length)) + suffix;

/**
 * Copy a row, offset by one row's spacing, with FRESH seat ids (§42 Rule 4).
 *
 * The copy takes a label that is free in the block, so it can be saved without tripping the seat
 * uniqueness — a duplicate that could not be saved would be a worse answer than refusing to make one.
 */
export function duplicateRow(doc: ChartDocument, ref: RowRef, dy = 150): ChartDocument {
  return rewrite(doc, ref.blockKey, (b) => {
    const source = (b.seats ?? []).filter((s) => s.rowLabel === ref.label);
    if (source.length === 0) return b;

    const used = new Set(rowLabelsOf(b));
    /*
     * Each candidate keeps its suffix and gives up characters from the BASE instead.
     *
     * The old form was `${ref.label}${n++}`.slice(0, MAX) — which, for a source label already at the
     * 8-character limit, sliced the counter straight back off. Every candidate was then identical to
     * the source label, `used` had it, and the loop spun forever: duplicating a row named `GHEA1234`
     * hung the tab. Truncating the base instead means the counter always survives, so each pass
     * produces a label nobody has yet and the loop is guaranteed to end.
     */
    let label = withSuffix(ref.label, "'");
    for (let n = 2; used.has(label); n += 1) label = withSuffix(ref.label, String(n));

    const copies: DocumentSeat[] = source.map((s) => ({
      ...s,
      seatId: mintId(),
      // A copied row is a NEW row: it has no id until the save gives it one.
      rowId: undefined,
      rowLabel: label,
      dy: s.dy + dy,
    }));
    return { ...b, params: undefined, seats: [...(b.seats ?? []), ...copies] };
  });
}

/**
 * Reorder a row within its section.
 *
 * Writes `displayOrder` and nothing else — never a label, never an id (§45). What the row is called
 * and where it sits in a list are different questions, and this only answers the second.
 */
export function moveRow(doc: ChartDocument, rowId: number, toIndex: number): ChartDocument {
  const row = doc.rows?.find((r) => r.id === rowId);
  if (!row || !doc.rows) return doc;

  const siblings = doc.rows
    .filter((r) => r.sectionId === row.sectionId)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const from = siblings.findIndex((r) => r.id === rowId);
  if (from < 0) return doc;

  const reordered = [...siblings];
  reordered.splice(from, 1);
  reordered.splice(Math.max(0, Math.min(reordered.length, toIndex)), 0, row);

  const order = new Map(reordered.map((r, i) => [r.id, i]));
  return {
    ...doc,
    rows: doc.rows.map((r) => (order.has(r.id) ? { ...r, displayOrder: order.get(r.id)! } : r)),
  };
}
