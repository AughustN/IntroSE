/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BlockParams, ChartDocument, DocumentBlock } from "@/shared/catalog/seatmap-document";
import { isSeatBearing } from "@/shared/catalog/seatmap-document";
import { rowLabelFor, seatNumberFor } from "@/shared/catalog/seatmap-project";
import { repackRowLabels } from "./documentOps";

/**
 * Numbering, as an operation the organizer performs rather than a side effect of everything else.
 *
 * §13 and §15 of the specification are emphatic that numbering is explicit: "Do not automatically
 * renumber the entire seat map after every operation", and renumbering must be a named command with a
 * name in the undo history. That is what this module is.
 *
 * Everything here is POSITIONAL, which is the property the whole feature rests on. `regenerateBlock`
 * matches existing seats by `rowLabel|seatNumber` — "identity survives iff the label survives" — so
 * regenerating a block whose numbering has changed finds no match for anything, mints a fresh id for
 * every seat, and the save then deletes the originals (or is refused once a showtime has bound them).
 * Renumbering has to move the LABEL and leave the seat alone (§12, §42 Rules 1 and 6).
 *
 * The fields below are the numbering ones only. Anything that changes a block's SHAPE — `rowsCount`,
 * `seatsPerRow`, spacing, radius — goes through `setBlockParams`, where regenerating is correct
 * because the seats themselves are different seats.
 */

/** The parameters that change what seats are CALLED, never how many there are or where they sit. */
export type NumberingPatch = Pick<
  BlockParams,
  | "rowLabelScheme"
  | "rowLabelPrefix"
  | "rowLabelSuffix"
  | "startRowIndex"
  | "seatLabelScheme"
  | "startSeatNumber"
  | "seatNumberStep"
  | "seatNumberPadding"
>;

const renumberable = (b: DocumentBlock): boolean =>
  !!b.params && isSeatBearing(b.kind) && b.kind !== "table" && !b.locked;

/**
 * Re-label one block under new numbering, keeping every seat.
 *
 * Both maps are built from the block's own geometry rather than from the seats' current values: row
 * `r` under the old parameters becomes row `r` under the new ones, and column `c` likewise. A seat
 * whose label is not one this block would have generated — hand-edited — is left exactly as it is,
 * rather than being guessed at.
 */
export function applyNumbering(block: DocumentBlock, patch: NumberingPatch): DocumentBlock {
  const p = block.params;
  if (!p) return block;
  const next: BlockParams = { ...p, ...patch };

  const rows = block.kind === "single-row" ? 1 : Math.max(1, Math.floor(next.rowsCount ?? 1));
  const perRow = Math.max(1, Math.floor(next.seatsPerRow ?? 1));

  const rowRename = new Map<string, string>();
  for (let r = 0; r < rows; r += 1) {
    rowRename.set(
      rowLabelFor(r, rows, p.rowLabelScheme, p.rowLabelPrefix ?? "", p.startRowIndex ?? 0, p.rowLabelSuffix ?? ""),
      rowLabelFor(
        r,
        rows,
        next.rowLabelScheme,
        next.rowLabelPrefix ?? "",
        next.startRowIndex ?? 0,
        next.rowLabelSuffix ?? "",
      ),
    );
  }

  const seatRenumber = new Map<number, number>();
  for (let c = 0; c < perRow; c += 1) {
    seatRenumber.set(
      seatNumberFor(c, perRow, p.seatLabelScheme, p.startSeatNumber ?? 1, p.seatNumberStep ?? 1),
      seatNumberFor(c, perRow, next.seatLabelScheme, next.startSeatNumber ?? 1, next.seatNumberStep ?? 1),
    );
  }

  return {
    ...block,
    params: next,
    seats: block.seats?.map((s) => ({
      ...s,
      rowLabel: rowRename.get(s.rowLabel) ?? s.rowLabel,
      seatNumber: seatRenumber.get(s.seatNumber) ?? s.seatNumber,
    })),
  };
}

/** Apply numbering to a selection. Locked, table and non-parametric blocks are skipped. */
function overSelection(
  doc: ChartDocument,
  keys: Set<string>,
  patch: NumberingPatch,
): ChartDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (keys.has(b.key) && renumberable(b) ? applyNumbering(b, patch) : b)),
  };
}

/** §13 "Number Seats" — start, step and direction for the selected blocks' seats. */
export function numberSeats(
  doc: ChartDocument,
  keys: Set<string>,
  patch: Pick<NumberingPatch, "seatLabelScheme" | "startSeatNumber" | "seatNumberStep" | "seatNumberPadding">,
): ChartDocument {
  return overSelection(doc, keys, patch);
}

/** §14 "Number Rows" — scheme, prefix, suffix and starting index for the selected blocks' rows. */
export function numberRows(
  doc: ChartDocument,
  keys: Set<string>,
  patch: Pick<NumberingPatch, "rowLabelScheme" | "rowLabelPrefix" | "rowLabelSuffix" | "startRowIndex">,
): ChartDocument {
  return overSelection(doc, keys, patch);
}

/**
 * §13 "Renumber Section" — close the gaps in one section's row lettering, on demand.
 *
 * The explicit form of what `repackRowLabels` does automatically. With the auto-renumber preference
 * off, this is the ONLY thing that re-letters a chart, which is what §15 and §42 Rule 5 ask for.
 *
 * Scoped by re-packing the whole document and then keeping only the target section's changes, rather
 * than by re-implementing the collision walk: one implementation of "what should this section's rows
 * be called" means the automatic and the explicit paths can never disagree.
 */
export function renumberSection(doc: ChartDocument, sectionId: number | null): ChartDocument {
  const packed = repackRowLabels(doc);
  const inSection = (b: DocumentBlock) => b.sectionId === sectionId;

  return {
    ...doc,
    blocks: doc.blocks.map((b) => (inSection(b) ? (packed.blocks.find((x) => x.key === b.key) ?? b) : b)),
    rows: doc.rows?.map((r) => (r.sectionId === sectionId ? (packed.rows?.find((x) => x.id === r.id) ?? r) : r)),
  };
}

/** §13 "Renumber Selected Sections" — every section the selection touches, each packed from the top. */
export function renumberSelection(doc: ChartDocument, keys: Set<string>): ChartDocument {
  const sections = new Set(doc.blocks.filter((b) => keys.has(b.key)).map((b) => b.sectionId));
  let out = doc;
  for (const sectionId of sections) out = renumberSection(out, sectionId);
  return out;
}
