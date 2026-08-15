/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChartDocument, DocumentBlock } from "@/shared/catalog/seatmap-document";

/**
 * What changed between two versions of a chart (§31).
 *
 * The revision list already answers "when" and "how many seats"; it could not answer the question an
 * organizer actually has before restoring — "what will I get back". A seat count is a poor proxy: a
 * version with the same total can have had a block moved across the venue, a section renamed, or one
 * block deleted and another added.
 *
 * Blocks are matched by KEY, which is stable across saves for the same block, so a moved block reads
 * as moved rather than as one deleted and one added. Seats are compared only in aggregate: a diff
 * that named 2,000 individually would bury the six facts worth reading.
 */

export interface BlockChange {
  key: string;
  title: string;
  /** What is different, in the order it is worth reading. Empty for `added` and `removed`. */
  changes: ("moved" | "resized" | "rotated" | "renamed" | "recounted" | "reclassed")[];
}

export interface DocumentDiff {
  added: BlockChange[];
  removed: BlockChange[];
  changed: BlockChange[];
  seatDelta: number;
  sectionsAdded: string[];
  sectionsRemoved: string[];
  /** True when nothing at all differs — a restore would be a no-op. */
  identical: boolean;
}

const seatsIn = (doc: ChartDocument): number =>
  doc.blocks.reduce((n, b) => n + (b.seats?.length ?? 0), 0);

function whatChanged(before: DocumentBlock, after: DocumentBlock): BlockChange["changes"] {
  const changes: BlockChange["changes"] = [];
  if (before.x !== after.x || before.y !== after.y) changes.push("moved");
  if (before.width !== after.width || before.height !== after.height) changes.push("resized");
  if (before.rotation !== after.rotation) changes.push("rotated");
  if (before.title !== after.title) changes.push("renamed");
  if ((before.seats?.length ?? 0) !== (after.seats?.length ?? 0)) changes.push("recounted");
  if (before.sectionId !== after.sectionId || before.categoryId !== after.categoryId) {
    changes.push("reclassed");
  }
  return changes;
}

/** `before` → `after`, as a list of the things a person would say out loud. */
export function compareDocuments(before: ChartDocument, after: ChartDocument): DocumentDiff {
  const beforeBlocks = new Map(before.blocks.map((b) => [b.key, b]));
  const afterBlocks = new Map(after.blocks.map((b) => [b.key, b]));

  const added: BlockChange[] = [];
  const removed: BlockChange[] = [];
  const changed: BlockChange[] = [];

  for (const [key, b] of afterBlocks) {
    const was = beforeBlocks.get(key);
    if (!was) {
      added.push({ key, title: b.title, changes: [] });
      continue;
    }
    const changes = whatChanged(was, b);
    if (changes.length > 0) changed.push({ key, title: b.title, changes });
  }
  for (const [key, b] of beforeBlocks) {
    if (!afterBlocks.has(key)) removed.push({ key, title: b.title, changes: [] });
  }

  const beforeSections = new Set(before.sections.map((s) => s.name));
  const afterSections = new Set(after.sections.map((s) => s.name));

  const diff: DocumentDiff = {
    added,
    removed,
    changed,
    seatDelta: seatsIn(after) - seatsIn(before),
    sectionsAdded: [...afterSections].filter((n) => !beforeSections.has(n)),
    sectionsRemoved: [...beforeSections].filter((n) => !afterSections.has(n)),
    identical: false,
  };
  diff.identical =
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    diff.seatDelta === 0 &&
    diff.sectionsAdded.length === 0 &&
    diff.sectionsRemoved.length === 0;
  return diff;
}

/** Vietnamese for a change kind, for the one place this is shown. */
export const CHANGE_LABEL: Record<BlockChange["changes"][number], string> = {
  moved: "đã dời",
  resized: "đổi kích thước",
  rotated: "đã xoay",
  renamed: "đổi tên",
  recounted: "đổi số ghế",
  reclassed: "đổi khu / hạng ghế",
};
