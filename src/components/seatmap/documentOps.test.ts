import { describe, expect, it } from "vitest";
import { CHART_DOCUMENT_SCHEMA, emptyDocument } from "@/shared/catalog/seatmap-document";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import { LAYOUT_MAX_SEATS, validateLayout } from "@/shared/catalog/seatmap-validate";
import {
  addBlock,
  addCategory,
  addSection,
  alignBlocks,
  assignCategory,
  assignSection,
  duplicateBlocks,
  moveBlocks,
  remainingBudget,
  removeBlocks,
  removeCategory,
  removeSection,
  rotateBlocks,
  seatCount,
  selectionBounds,
  setBlockParams,
  setLocked,
  updateBlock,
} from "./documentOps";

// Block-level editing. The property these circle is the one the whole feature rests on: re-shaping a
// block is an EDIT — parameters change, labels and therefore database rows survive — where the old
// seat-level editor could only delete and redraw.

const start = () => {
  const base = emptyDocument();
  const withSection = addSection(base, "Khu A");
  const withCategory = addCategory(withSection.doc, "VIP");
  return {
    doc: withCategory.doc,
    sectionId: withSection.id,
    categoryId: withCategory.id,
  };
};

const labelsOf = (doc: ReturnType<typeof emptyDocument>, key: string) =>
  (doc.blocks.find((b) => b.key === key)?.seats ?? []).map((s) => `${s.rowLabel}${s.seatNumber}`);

const idMap = (doc: ReturnType<typeof emptyDocument>, key: string) =>
  new Map(
    (doc.blocks.find((b) => b.key === key)?.seats ?? []).map((s) => [
      `${s.rowLabel}${s.seatNumber}`,
      s.seatId,
    ]),
  );

describe("adding blocks", () => {
  it("generates seats for a seat-bearing kind and none for decoration", () => {
    const { doc, sectionId, categoryId } = start();
    const withBlock = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    expect(seatCount(withBlock.doc)).toBe(50); // 5 × 10 default

    const withStage = addBlock(withBlock.doc, "stage", { x: 5000, y: 500 });
    expect(seatCount(withStage.doc)).toBe(50); // unchanged — a stage is never inventory
    expect(withStage.doc.blocks).toHaveLength(2);
  });

  it("lands each block where it is asked, so two do not stack", () => {
    const { doc } = start();
    const a = addBlock(doc, "seating-block", { x: 1000, y: 1000 });
    const b = addBlock(a.doc, "seating-block", { x: 4000, y: 2000 });
    const [first, second] = b.doc.blocks;
    expect({ x: first.x, y: first.y }).not.toEqual({ x: second.x, y: second.y });
    expect({ x: second.x, y: second.y }).toEqual({ x: 4000, y: 2000 });
  });

  it("gives every block a distinct, deterministic key", () => {
    const { doc } = start();
    const a = addBlock(doc, "seating-block", { x: 0, y: 0 });
    const b = addBlock(a.doc, "single-row", { x: 0, y: 500 });
    expect(a.key).toBe("b1");
    expect(b.key).toBe("b2");
  });

  it("clips a new block to the remaining budget", () => {
    let doc = emptyDocument();
    // Fill most of the ceiling first.
    doc = setBlockParams(addBlock(doc, "seating-block", { x: 0, y: 0 }).doc, "b1", {
      rowsCount: 100,
      seatsPerRow: 200,
    });
    expect(seatCount(doc)).toBe(LAYOUT_MAX_SEATS);
    expect(remainingBudget(doc)).toBe(0);

    const another = addBlock(doc, "seating-block", { x: 5000, y: 5000 });
    expect(seatCount(another.doc)).toBe(LAYOUT_MAX_SEATS); // nothing added
  });
});

describe("re-shaping a block keeps the seats it still has", () => {
  it("GROWS without disturbing existing labels or ids", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(doc, "single-row", { x: 1000, y: 1000 }, { sectionId, categoryId });
    // Pretend a save happened, so the seats hold real ids.
    const persisted = updateBlock(made.doc, made.key, {
      seats: made.doc.blocks[0].seats!.map((s, i) => ({ ...s, seatId: 900 + i })),
    });
    const before = idMap(persisted, made.key);

    const grown = setBlockParams(persisted, made.key, { seatsPerRow: 14 });
    expect(labelsOf(grown, made.key)).toHaveLength(14);
    const after = idMap(grown, made.key);
    for (const [label, id] of before) expect(after.get(label)).toBe(id);
    expect(after.get("A14")).toBeLessThan(0); // the new one is a placeholder
  });

  it("SHRINKS by dropping the tail, keeping the rest", () => {
    const { doc } = start();
    const made = addBlock(doc, "single-row", { x: 1000, y: 1000 });
    const persisted = updateBlock(made.doc, made.key, {
      seats: made.doc.blocks[0].seats!.map((s, i) => ({ ...s, seatId: 900 + i })),
    });
    const shrunk = setBlockParams(persisted, made.key, { seatsPerRow: 6 });
    expect(labelsOf(shrunk, made.key)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
    expect(shrunk.blocks[0].seats!.every((s) => s.seatId > 0)).toBe(true);
  });

  it("measures a growing block against the REST of the chart, not against itself", () => {
    const { doc } = start();
    const first = addBlock(doc, "seating-block", { x: 0, y: 0 }); // 50 seats
    const second = addBlock(first.doc, "seating-block", { x: 3000, y: 0 }); // 50 more
    // Growing the second to 2000 must leave room for the first's 50.
    const grown = setBlockParams(second.doc, second.key, { rowsCount: 100, seatsPerRow: 200 });
    expect(seatCount(grown)).toBe(LAYOUT_MAX_SEATS);
  });

  it("changing a label scheme relabels, which the publish gate can then report", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(doc, "single-row", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const renamed = setBlockParams(made.doc, made.key, { rowLabelScheme: "num-asc" });
    expect(labelsOf(renamed, made.key)[0]).toBe("11");
  });
});

describe("moving, rotating, duplicating and aligning", () => {
  const twoBlocks = () => {
    const { doc, sectionId, categoryId } = start();
    const a = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const b = addBlock(a.doc, "seating-block", { x: 4000, y: 2500 }, { sectionId, categoryId });
    return { doc: b.doc, keys: new Set([a.key, b.key]) };
  };

  it("moves a selection and clamps it into the space", () => {
    const { doc, keys } = twoBlocks();
    const moved = moveBlocks(doc, keys, 500, 500, false);
    expect(moved.blocks[0].x).toBe(1500);
    const far = moveBlocks(doc, keys, 99999, 99999, false);
    for (const b of far.blocks) {
      expect(b.x).toBeLessThanOrEqual(10000);
      expect(b.y).toBeLessThanOrEqual(10000);
    }
  });

  it("normalises rotation into 0–359, which is what the column allows", () => {
    const { doc, keys } = twoBlocks();
    expect(rotateBlocks(doc, keys, -90).blocks[0].rotation).toBe(270);
    expect(rotateBlocks(doc, keys, 725).blocks[0].rotation).toBe(5);
  });

  it("duplicates with fresh keys and fresh seat ids", () => {
    const { doc } = twoBlocks();
    const persisted = updateBlock(doc, "b1", {
      seats: doc.blocks[0].seats!.map((s, i) => ({ ...s, seatId: 700 + i })),
    });
    const dup = duplicateBlocks(persisted, new Set(["b1"]), 300, 300);
    expect(dup.doc.blocks).toHaveLength(3);
    expect(dup.keys.size).toBe(1);
    const copy = dup.doc.blocks.find((b) => dup.keys.has(b.key))!;
    // A copy owns no database row yet, so every seat is a placeholder.
    expect(copy.seats!.every((s) => s.seatId < 0)).toBe(true);
    expect(copy.x).toBe(persisted.blocks[0].x + 300);
  });

  it("aligns two or more blocks, and does nothing to one", () => {
    const { doc, keys } = twoBlocks();
    expect(alignBlocks(doc, keys, "left").blocks.map((b) => b.x)).toEqual([1000, 1000]);
    expect(alignBlocks(doc, keys, "top").blocks.map((b) => b.y)).toEqual([1000, 1000]);
    expect(alignBlocks(doc, new Set(["b1"]), "left")).toBe(doc);
  });

  it("reports the selection bounds, or null for an empty selection", () => {
    const { doc, keys } = twoBlocks();
    const box = selectionBounds(doc, keys)!;
    expect(box.x).toBe(1000);
    expect(box.w).toBeGreaterThan(0);
    expect(selectionBounds(doc, new Set())).toBeNull();
  });
});

describe("sections and categories orphan rather than destroy", () => {
  it("removing a section leaves its blocks sectionless, with every seat intact", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(doc, "seating-block", { x: 0, y: 0 }, { sectionId, categoryId });
    const before = seatCount(made.doc);

    const dropped = removeSection(made.doc, sectionId);
    expect(dropped.sections).toHaveLength(0);
    expect(seatCount(dropped)).toBe(before);
    expect(dropped.blocks[0].sectionId).toBeNull();
  });

  it("removing a category leaves its blocks unclassified, with every seat intact", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(doc, "seating-block", { x: 0, y: 0 }, { sectionId, categoryId });
    const dropped = removeCategory(made.doc, categoryId);
    expect(dropped.categories).toHaveLength(0);
    expect(seatCount(dropped)).toBe(50);
    expect(dropped.blocks[0].categoryId).toBeNull();
  });

  it("assigns a whole block at once", () => {
    const { doc } = start();
    const made = addBlock(doc, "seating-block", { x: 0, y: 0 });
    const withSection = assignSection(made.doc, new Set([made.key]), 5);
    const withBoth = assignCategory(withSection, new Set([made.key]), 6);
    expect(withBoth.blocks[0].sectionId).toBe(5);
    expect(withBoth.blocks[0].categoryId).toBe(6);
  });
});

describe("what the editor builds is publishable", () => {
  it("a section, a category and one block project with no validation issues", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const p = projectDocument(made.doc);

    const issues = validateLayout({
      seats: p.seats.map((s, i) => ({
        id: s.id ?? -(i + 1),
        sectionId: s.sectionId,
        categoryId: s.categoryId,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        x: s.x,
        y: s.y,
      })),
      sections: p.sections.map((s) => ({ id: s.id as number, name: s.name })),
      categories: p.categories.map((c) => ({ id: c.id as number, name: c.name })),
      elements: p.elements.map((e) => ({ kind: e.kind, x: e.x, y: e.y, points: e.points })),
    });
    expect(issues).toEqual([]);
    expect(made.doc.schemaVersion).toBe(CHART_DOCUMENT_SCHEMA);
  });

  it("a block with no section is reported rather than silently unpublishable", () => {
    const { doc } = start();
    const made = addBlock(doc, "seating-block", { x: 1000, y: 1000 }); // no section, no category
    const p = projectDocument(made.doc);
    const issues = validateLayout({
      seats: p.seats.map((s, i) => ({
        id: s.id ?? -(i + 1),
        sectionId: s.sectionId,
        categoryId: s.categoryId,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        x: s.x,
        y: s.y,
      })),
      sections: [],
      categories: [],
    });
    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toContain("seat_without_section");
    expect(codes).toContain("seat_without_category");
  });
});

describe("a table block, which the document only mirrors", () => {
  // `layout_tables` is written by the table endpoints alone; the projection carries a table's SEATS but
  // never its row. So an edit made here would move the seats on the next save and leave the table
  // behind — the seats would end up detached from the table that owns them. Every op must decline.
  const withTable = () => {
    const { doc, sectionId, categoryId } = start();
    const table = {
      key: "t-table",
      kind: "table" as const,
      title: "Bàn 1",
      x: 5000,
      y: 5000,
      rotation: 0,
      width: 600,
      height: 600,
      sectionId,
      categoryId,
      tableId: 9,
      tableShape: "round" as const,
      tableSeatCount: 2,
      seats: [
        { seatId: 21, rowLabel: "Bàn 1", seatNumber: 1, dx: 400, dy: 0, rotation: 0 },
        { seatId: 22, rowLabel: "Bàn 1", seatNumber: 2, dx: -400, dy: 0, rotation: 0 },
      ],
    };
    return { doc: { ...doc, blocks: [...doc.blocks, table] }, sectionId, categoryId };
  };
  const keys = new Set(["t-table"]);
  const tableOf = (d: ReturnType<typeof emptyDocument>) => d.blocks.find((b) => b.key === "t-table");

  it("is left byte-identical by move, nudge, rotate and align", () => {
    const { doc } = withTable();
    const before = JSON.stringify(tableOf(doc));

    expect(JSON.stringify(tableOf(moveBlocks(doc, keys, 2000, 0, false)))).toEqual(before);
    expect(JSON.stringify(tableOf(rotateBlocks(doc, keys, 90)))).toEqual(before);
    expect(JSON.stringify(tableOf(alignBlocks(doc, new Set([...keys, doc.blocks[0].key]), "left")))).toEqual(before);
  });

  it("survives a delete, so a canvas Delete cannot orphan its seats", () => {
    const { doc } = withTable();
    expect(tableOf(removeBlocks(doc, keys))).toBeDefined();
  });

  it("is not duplicated — a copy would own seats no table row accounts for", () => {
    const { doc } = withTable();
    const { doc: after, keys: made } = duplicateBlocks(doc, keys, 500, 500);
    expect(made.size).toBe(0);
    expect(after.blocks).toHaveLength(doc.blocks.length);
  });

  it("still lets the blocks BESIDE it move", () => {
    const { doc, sectionId, categoryId } = withTable();
    const added = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const moved = moveBlocks(added.doc, new Set([added.key, "t-table"]), 300, 0, false);
    expect(moved.blocks.find((b) => b.key === added.key)!.x).toBe(1300);
    expect(tableOf(moved)!.x).toBe(5000);
  });
});

describe("a locked block", () => {
  // Locking is an AUTHORING guard, not a permission: it stops a finished stage being dragged while
  // the organizer works around it. The projection ignores it, so a locked block still sells.
  const lockedDoc = () => {
    const { doc, sectionId, categoryId } = start();
    const added = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    return { doc: setLocked(added.doc, new Set([added.key]), true), key: added.key, sectionId, categoryId };
  };

  it("ignores move, rotate, align and delete", () => {
    const { doc, key } = lockedDoc();
    const keys = new Set([key]);
    const before = JSON.stringify(doc.blocks.find((b) => b.key === key));
    const at = (d: ReturnType<typeof emptyDocument>) => JSON.stringify(d.blocks.find((b) => b.key === key));

    expect(at(moveBlocks(doc, keys, 500, 500, false))).toEqual(before);
    expect(at(rotateBlocks(doc, keys, 90))).toEqual(before);
    expect(removeBlocks(doc, keys).blocks.find((b) => b.key === key)).toBeDefined();
  });

  it("can always be unlocked — otherwise the lock would be permanent", () => {
    const { doc, key } = lockedDoc();
    const open = setLocked(doc, new Set([key]), false);
    expect(moveBlocks(open, new Set([key]), 500, 0, false).blocks.find((b) => b.key === key)!.x).toBe(1500);
  });

  it("still projects its seats — locking is not blocking", () => {
    const { doc, key } = lockedDoc();
    const seats = projectDocument(doc).seats;
    expect(seats.length).toBeGreaterThan(0);
    expect(doc.blocks.find((b) => b.key === key)!.locked).toBe(true);
  });
});

describe("adding a second block to a section", () => {
  // `seats` is UNIQUE on (section_id, row_label, seat_number). Every block used to letter from A, so a
  // second block in the same section produced A1..A10 twice and the SAVE was refused by the database —
  // reported as "a name is duplicated", which named nothing the organizer could fix.
  it("continues the lettering instead of restarting at A", () => {
    const { doc, sectionId, categoryId } = start();
    const first = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const second = addBlock(first.doc, "seating-block", { x: 4000, y: 1000 }, { sectionId, categoryId });

    const labelsOfBlock = (d: ReturnType<typeof emptyDocument>, key: string) =>
      new Set((d.blocks.find((b) => b.key === key)?.seats ?? []).map((s) => `${s.rowLabel}${s.seatNumber}`));

    const a = labelsOfBlock(second.doc, first.key);
    const b = labelsOfBlock(second.doc, second.key);
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThan(0);
    for (const label of b) expect(a.has(label)).toBe(false);
  });

  it("does not shift a block added to a DIFFERENT section", () => {
    const { doc, categoryId } = start();
    const other = addSection(doc, "Khu B");
    const first = addBlock(other.doc, "seating-block", { x: 1000, y: 1000 }, { sectionId: 1, categoryId });
    const second = addBlock(first.doc, "seating-block", { x: 4000, y: 1000 }, { sectionId: other.id, categoryId });

    // A separate section has its own label space, so the second block may start at A again.
    const rowsOf = (key: string) =>
      (second.doc.blocks.find((b) => b.key === key)?.seats ?? []).map((s) => s.rowLabel);
    expect(rowsOf(second.key)).toContain("A");
  });
});
