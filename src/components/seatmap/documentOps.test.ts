import { describe, expect, it } from "vitest";
import { CHART_DOCUMENT_SCHEMA, emptyDocument } from "@/shared/catalog/seatmap-document";
import { letterIndex, projectDocument } from "@/shared/catalog/seatmap-project";
import {
  LAYOUT_MAX_SEATS,
  LAYOUT_MAX,
  LAYOUT_MIN,
  blockingIssues,
  validateLayout,
} from "@/shared/catalog/seatmap-validate";
import {
  addBlock,
  addCategory,
  addSection,
  alignBlocks,
  angleFromPointer,
  assignCategory,
  assignBlocksToSection,
  assignSeatsToSection,
  assignSection,
  distributeBlocks,
  duplicateBlocks,
  flipBlocks,
  EDITABLE_SEAT_TYPES,
  formatBlockDrag,
  geometryPoints,
  groupBlocks,
  hasPlaceholderIds,
  parseBlockDrag,
  moveBlocks,
  nextBlockContext,
  occupiedBounds,
  copyBlocks,
  pasteBlocks,
  remainingBudget,
  removeBlocks,
  removeCategory,
  repackRowLabels,
  removeSection,
  resizedBox,
  rotateBlocks,
  seatCount,
  selectionAfterPress,
  selectionBounds,
  setBlockColor,
  setRotation,
  setSeatType,
  setBlockParams,
  setHidden,
  scaleShapePoints,
  shapeBounds,
  snapToObjects,
  spacingMarks,
  setLocked,
  updateBlock,
  ungroupBlocks,
  updateSeats,
  withGroups,
} from "./documentOps";
import { assignRowToSection } from "./rowOps";

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
    const withBlock = addBlock(
      doc,
      "seating-block",
      { x: 1000, y: 1000 },
      { sectionId, categoryId },
    );
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
    const far = moveBlocks(doc, keys, LAYOUT_MAX * 10, LAYOUT_MAX * 10, false);
    for (const b of far.blocks) {
      expect(b.x).toBeLessThanOrEqual(LAYOUT_MAX);
      expect(b.y).toBeLessThanOrEqual(LAYOUT_MAX);
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

  it("reports occupied bounds for rotated decorations and polygon points", () => {
    const stage = addBlock(emptyDocument(), "stage", { x: 1000, y: 2000 });
    const rotatedStage = updateBlock(stage.doc, stage.key, {
      width: 400,
      height: 200,
      rotation: 90,
    });
    expect(occupiedBounds(rotatedStage, new Set([stage.key]))).toEqual({
      x: 900,
      y: 1800,
      w: 200,
      h: 400,
    });

    const shape = addBlock(emptyDocument(), "shape", { x: 1000, y: 2000 });
    const rotatedShape = updateBlock(shape.doc, shape.key, {
      rotation: 90,
      points: [
        { x: 900, y: 2000 },
        { x: 1100, y: 2000 },
      ],
    });
    expect(occupiedBounds(rotatedShape, new Set([shape.key]))).toEqual({
      x: 1000,
      y: 1900,
      w: 1,
      h: 200,
    });
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

  it("moves an individual seat into another section without creating a duplicate label", () => {
    let doc = emptyDocument();
    const source = addSection(doc, "Khu A");
    doc = source.doc;
    const target = addSection(doc, "Khu B");
    doc = target.doc;
    const category = addCategory(doc, "Thường");
    doc = category.doc;
    const occupied = addBlock(
      doc,
      "individual-seat",
      { x: 1000, y: 1000 },
      {
        sectionId: target.id,
        categoryId: category.id,
      },
    );
    const moving = addBlock(
      occupied.doc,
      "individual-seat",
      { x: 2000, y: 1000 },
      {
        sectionId: source.id,
        categoryId: category.id,
      },
    );

    const changed = assignSeatsToSection(
      moving.doc,
      [{ blockKey: moving.key, index: 0 }],
      target.id,
    );
    const seat = changed.blocks.find((block) => block.key === moving.key)!.seats![0];

    expect(seat.sectionId).toBe(target.id);
    expect(`${seat.rowLabel}${seat.seatNumber}`).toBe("B1");
    expect(seat.rowId).toBeNull();
  });

  it("gives a formerly loose seat its first meaningful label from the destination section", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(
      doc,
      "individual-seat",
      { x: 1000, y: 1000 },
      {
        sectionId: null,
        categoryId,
      },
    );
    const internallyLabelled = updateSeats(made.doc, [{ blockKey: made.key, index: 0 }], {
      rowLabel: "E",
    });

    const changed = assignSeatsToSection(
      internallyLabelled,
      [{ blockKey: made.key, index: 0 }],
      sectionId,
    );

    expect(changed.blocks[0].seats![0].rowLabel).toBe("A");
  });

  it("moves a whole row, keeps it together, and relabels it around the target section", () => {
    let doc = emptyDocument();
    const source = addSection(doc, "Khu A");
    doc = source.doc;
    const target = addSection(doc, "Khu B");
    doc = target.doc;
    const category = addCategory(doc, "Thường");
    doc = category.doc;
    const occupied = addBlock(
      doc,
      "single-row",
      { x: 1000, y: 1000 },
      {
        sectionId: target.id,
        categoryId: category.id,
      },
    );
    const moving = addBlock(
      occupied.doc,
      "single-row",
      { x: 1000, y: 2500 },
      {
        sectionId: source.id,
        categoryId: category.id,
      },
    );

    const changed = assignRowToSection(moving.doc, { blockKey: moving.key, label: "A" }, target.id);
    const seats = changed.blocks.find((block) => block.key === moving.key)!.seats!;

    expect(new Set(seats.map((seat) => seat.sectionId))).toEqual(new Set([target.id]));
    expect(new Set(seats.map((seat) => seat.rowLabel))).toEqual(new Set(["B"]));
    expect(seats.map((seat) => seat.seatNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("clears per-seat section overrides when their section is removed", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(
      doc,
      "single-row",
      { x: 1000, y: 1000 },
      {
        sectionId: null,
        categoryId,
      },
    );
    const overridden = updateSeats(made.doc, [{ blockKey: made.key, index: 0 }], { sectionId });

    const dropped = removeSection(overridden, sectionId);
    expect(dropped.blocks[0].seats![0].sectionId).toBeNull();
  });

  it("keeps explicit no-section seats out of their block's section", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(doc, "single-row", { x: 1000, y: 1000 }, { sectionId, categoryId });

    const changed = assignSeatsToSection(made.doc, [{ blockKey: made.key, index: 0 }], null);

    expect(projectDocument(changed).seats[0].sectionId).toBeNull();
  });

  it("keeps an explicitly orphaned override from inheriting a surviving block section", () => {
    let doc = emptyDocument();
    const removed = addSection(doc, "Khu A");
    doc = removed.doc;
    const surviving = addSection(doc, "Khu B");
    doc = surviving.doc;
    const category = addCategory(doc, "Thường");
    const made = addBlock(
      category.doc,
      "single-row",
      { x: 1000, y: 1000 },
      {
        sectionId: surviving.id,
        categoryId: category.id,
      },
    );
    const overridden = updateSeats(made.doc, [{ blockKey: made.key, index: 0 }], {
      sectionId: removed.id,
    });

    const dropped = removeSection(overridden, removed.id);
    expect(projectDocument(dropped).seats[0].sectionId).toBeNull();
  });

  it("reserves labels held by selected seats already in the destination", () => {
    let doc = emptyDocument();
    const source = addSection(doc, "Khu A");
    doc = source.doc;
    const target = addSection(doc, "Khu B");
    doc = target.doc;
    const category = addCategory(doc, "Thường");
    const there = addBlock(
      category.doc,
      "individual-seat",
      { x: 1000, y: 1000 },
      {
        sectionId: target.id,
        categoryId: category.id,
      },
    );
    const moving = addBlock(
      there.doc,
      "individual-seat",
      { x: 2000, y: 1000 },
      {
        sectionId: source.id,
        categoryId: category.id,
      },
    );

    const changed = assignSeatsToSection(
      moving.doc,
      [
        { blockKey: there.key, index: 0 },
        { blockKey: moving.key, index: 0 },
      ],
      target.id,
    );
    expect(projectDocument(changed).seats.map((seat) => seat.rowLabel)).toEqual(["A", "B"]);
  });

  it("moves non-parametric blocks without duplicate labels even when auto-numbering is not involved", () => {
    let doc = emptyDocument();
    const source = addSection(doc, "Khu A");
    doc = source.doc;
    const target = addSection(doc, "Khu B");
    doc = target.doc;
    const category = addCategory(doc, "Thường");
    const there = addBlock(
      category.doc,
      "individual-seat",
      { x: 1000, y: 1000 },
      {
        sectionId: target.id,
        categoryId: category.id,
      },
    );
    const moving = addBlock(
      there.doc,
      "individual-seat",
      { x: 2000, y: 1000 },
      {
        sectionId: source.id,
        categoryId: category.id,
      },
    );
    const adopted = updateBlock(moving.doc, moving.key, { params: undefined });

    const changed = assignBlocksToSection(adopted, new Set([moving.key]), target.id);
    expect(projectDocument(changed).seats.map((seat) => seat.rowLabel)).toEqual(["A", "B"]);
  });

  it("does not reassign a locked block or its seats", () => {
    const { doc, sectionId, categoryId } = start();
    const made = addBlock(doc, "single-row", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const locked = updateBlock(made.doc, made.key, { locked: true });

    expect(assignBlocksToSection(locked, new Set([made.key]), null)).toEqual(locked);
    expect(assignSeatsToSection(locked, [{ blockKey: made.key, index: 0 }], null)).toEqual(locked);
  });
});

describe("what the editor builds is publishable", () => {
  it("a section, a category and one block project with nothing that BLOCKS publishing", () => {
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
    // Blocking only: a chart with no stage raises the advisory `focal_point_unset`, which does not
    // stop a publish. What `addBlock` has to guarantee is that its output is publishable.
    expect(blockingIssues(issues)).toEqual([]);
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
  const tableOf = (d: ReturnType<typeof emptyDocument>) =>
    d.blocks.find((b) => b.key === "t-table");

  it("is left byte-identical by move, nudge, rotate and align", () => {
    const { doc } = withTable();
    const before = JSON.stringify(tableOf(doc));

    expect(JSON.stringify(tableOf(moveBlocks(doc, keys, 2000, 0, false)))).toEqual(before);
    expect(JSON.stringify(tableOf(rotateBlocks(doc, keys, 90)))).toEqual(before);
    expect(
      JSON.stringify(tableOf(alignBlocks(doc, new Set([...keys, doc.blocks[0].key]), "left"))),
    ).toEqual(before);
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
    return {
      doc: setLocked(added.doc, new Set([added.key]), true),
      key: added.key,
      sectionId,
      categoryId,
    };
  };

  it("ignores move, rotate, align and delete", () => {
    const { doc, key } = lockedDoc();
    const keys = new Set([key]);
    const before = JSON.stringify(doc.blocks.find((b) => b.key === key));
    const at = (d: ReturnType<typeof emptyDocument>) =>
      JSON.stringify(d.blocks.find((b) => b.key === key));

    expect(at(moveBlocks(doc, keys, 500, 500, false))).toEqual(before);
    expect(at(rotateBlocks(doc, keys, 90))).toEqual(before);
    expect(removeBlocks(doc, keys).blocks.find((b) => b.key === key)).toBeDefined();
  });

  it("can always be unlocked — otherwise the lock would be permanent", () => {
    const { doc, key } = lockedDoc();
    const open = setLocked(doc, new Set([key]), false);
    expect(
      moveBlocks(open, new Set([key]), 500, 0, false).blocks.find((b) => b.key === key)!.x,
    ).toBe(1500);
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
    const second = addBlock(
      first.doc,
      "seating-block",
      { x: 4000, y: 1000 },
      { sectionId, categoryId },
    );

    const labelsOfBlock = (d: ReturnType<typeof emptyDocument>, key: string) =>
      new Set(
        (d.blocks.find((b) => b.key === key)?.seats ?? []).map(
          (s) => `${s.rowLabel}${s.seatNumber}`,
        ),
      );

    const a = labelsOfBlock(second.doc, first.key);
    const b = labelsOfBlock(second.doc, second.key);
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThan(0);
    for (const label of b) expect(a.has(label)).toBe(false);
  });

  it("does not shift a block added to a DIFFERENT section", () => {
    const { doc, categoryId } = start();
    const other = addSection(doc, "Khu B");
    const first = addBlock(
      other.doc,
      "seating-block",
      { x: 1000, y: 1000 },
      { sectionId: 1, categoryId },
    );
    const second = addBlock(
      first.doc,
      "seating-block",
      { x: 4000, y: 1000 },
      { sectionId: other.id, categoryId },
    );

    // A separate section has its own label space, so the second block may start at A again.
    const rowsOf = (key: string) =>
      (second.doc.blocks.find((b) => b.key === key)?.seats ?? []).map((s) => s.rowLabel);
    expect(rowsOf(second.key)).toContain("A");
  });
});

describe("dragging a block that reaches the edge of the map", () => {
  /*
   * The projection clamps every seat into the wall independently, so a block dragged past the
   * edge used not to stop — each seat beyond the boundary landed on exactly LAYOUT_MAX and they
   * stacked on one point. Reported as "the seats overlap each other after I move the block", and it took
   * only one drag on a chart whose block was already flush against the right wall.
   */
  /*
   * The row is positioned RELATIVE to `LAYOUT_MAX`, not at a literal coordinate: every test below
   * is about what happens at the wall, so the fixture has to keep touching the wall wherever it is.
   * Written with literals it silently stopped testing anything the day the space was widened — the
   * block simply sat in open floor and every "stops flush" assertion measured a drag that never met
   * an edge.
   */
  const SPAN = 8500;
  /** Left edge such that the row's right-hand seat lands exactly on the boundary. */
  const FLUSH_X = LAYOUT_MAX - SPAN;

  const wideRow = () => {
    const seats = Array.from({ length: 90 }, (_, i) => ({
      seatId: -(i + 1),
      rowLabel: "A",
      seatNumber: i + 1,
      dx: Math.round((SPAN * i) / 89),
      dy: 0,
      rotation: 0,
    }));
    const base = emptyDocument();
    return {
      ...base,
      sections: [{ id: 1, name: "Khu A" }],
      blocks: [
        {
          key: "b-1",
          kind: "seating-block" as const,
          title: "Khu A",
          x: FLUSH_X,
          y: 5740,
          rotation: 0,
          width: SPAN,
          height: 1,
          sectionId: 1,
          categoryId: null,
          seats,
        },
      ],
    };
  };

  const xs = (d: ReturnType<typeof emptyDocument>) => projectDocument(d).seats.map((s) => s.x);

  it("never stacks two seats on one point", () => {
    const doc = wideRow();
    expect(new Set(xs(doc)).size).toBe(90);

    // The block's right edge already sits on LAYOUT_MAX, so this used to lose 7 seats to one point.
    const moved = moveBlocks(doc, new Set(["b-1"]), 600, 0, false);
    const after = xs(moved);
    expect(new Set(after).size).toBe(after.length);
    expect(Math.max(...after)).toBeLessThanOrEqual(LAYOUT_MAX);
  });

  it("stops flush at the wall and keeps the row's spacing", () => {
    const doc = wideRow();
    const before = xs(doc);
    const gaps = before.slice(1).map((x, i) => x - before[i]);

    const moved = moveBlocks(doc, new Set(["b-1"]), 5000, 0, false);
    const after = xs(moved);
    expect(Math.max(...after)).toBe(LAYOUT_MAX);
    // Rigid body: every gap survives the move, so the block slid rather than compressed.
    expect(after.slice(1).map((x, i) => x - after[i])).toEqual(gaps);
  });

  it("still moves normally when there is room", () => {
    const doc = wideRow();
    // Leftward has FLUSH_X units of room, so 400 applies in full.
    const moved = moveBlocks(doc, new Set(["b-1"]), -400, 0, false);
    expect(moved.blocks[0].x).toBe(FLUSH_X - 400);
    expect(new Set(xs(moved)).size).toBe(90);
  });

  it("never drags a block backwards, even if it already overhangs", () => {
    const doc = wideRow();
    // Push it out of bounds the way legacy geometry or a rotation could — 500 past the wall.
    const over = { ...doc, blocks: [{ ...doc.blocks[0], x: FLUSH_X + 500 }] };
    const before = over.blocks[0].x;
    // A rightward drag has no room, so it does nothing — it must not yank the block left to "fix" it.
    expect(moveBlocks(over, new Set(["b-1"]), 800, 0, false).blocks[0].x).toBe(before);
    // Leftward still works, because there is room that way.
    expect(moveBlocks(over, new Set(["b-1"]), -300, 0, false).blocks[0].x).toBe(before - 300);
  });

  it("refuses to move a block wider than the map rather than squashing it", () => {
    const doc = wideRow();
    // Stretched past the width of the map however wide the map is — the multiplier is derived so the
    // case stays "wider than the map" rather than "wider than 10,000".
    const stretch = Math.ceil((LAYOUT_MAX - LAYOUT_MIN + 1000) / SPAN);
    const tooWide = {
      ...doc,
      blocks: [
        {
          ...doc.blocks[0],
          x: 0,
          seats: doc.blocks[0].seats!.map((s) => ({ ...s, dx: s.dx * stretch })),
        },
      ],
    };
    // A row that cannot sit inside the map at all. Moving is a no-op on that axis.
    expect(moveBlocks(tooWide, new Set(["b-1"]), 500, 0, false).blocks[0].x).toBe(0);
  });
});

describe("a block moves as one body", () => {
  /*
   * The property the whole block model rests on: a seat is stored as an OFFSET from its block, so the
   * block is the thing that moves and every seat follows by construction. Asserted rather than assumed,
   * and asserted again after the block has GROWN, because seats added later must join the same body
   * rather than becoming strays that lag behind the next drag.
   */
  const built = () => {
    const { doc, sectionId, categoryId } = start();
    const added = addBlock(doc, "seating-block", { x: 2000, y: 2000 }, { sectionId, categoryId });
    return { doc: added.doc, key: added.key };
  };

  const positions = (d: ReturnType<typeof emptyDocument>) => {
    const p = projectDocument(d);
    return p.seats.map((s) => ({ x: s.x, y: s.y }));
  };

  it("moves every seat by exactly the same delta", () => {
    const { doc, key } = built();
    const before = positions(doc);
    const after = positions(moveBlocks(doc, new Set([key]), 300, 150, false));

    expect(after).toHaveLength(before.length);
    const deltas = after.map((p, i) => `${p.x - before[i].x},${p.y - before[i].y}`);
    // One distinct delta across the whole block — no seat left behind, none moved further.
    expect(new Set(deltas)).toEqual(new Set(["300,150"]));
  });

  it("keeps seats added LATER inside the same body", () => {
    const { doc, key } = built();
    const grown = setBlockParams(doc, key, { rowsCount: 7, seatsPerRow: 12 });
    expect(grown.blocks.find((b) => b.key === key)!.seats!.length).toBe(84);

    const before = positions(grown);
    const after = positions(moveBlocks(grown, new Set([key]), -250, 400, false));
    const deltas = after.map((p, i) => `${p.x - before[i].x},${p.y - before[i].y}`);
    expect(new Set(deltas)).toEqual(new Set(["-250,400"]));
  });

  it("preserves the spacing between seats, so the block never distorts", () => {
    const { doc, key } = built();
    const gap = (d: ReturnType<typeof emptyDocument>) => {
      const p = positions(d);
      return p
        .slice(1)
        .map((q, i) => `${q.x - p[i].x},${q.y - p[i].y}`)
        .join("|");
    };
    expect(gap(moveBlocks(doc, new Set([key]), 700, -300, false))).toBe(gap(doc));
  });

  it("moves ONLY the selected block", () => {
    const { doc, sectionId, categoryId } = start();
    const a = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const b = addBlock(a.doc, "seating-block", { x: 6000, y: 1000 }, { sectionId, categoryId });
    const seatsOf = (d: ReturnType<typeof emptyDocument>, k: string) =>
      d.blocks
        .find((x) => x.key === k)!
        .seats!.map((s) => `${s.dx},${s.dy}`)
        .join("|");

    const moved = moveBlocks(b.doc, new Set([a.key]), 500, 0, false);
    expect(moved.blocks.find((x) => x.key === a.key)!.x).toBe(1500);
    expect(moved.blocks.find((x) => x.key === b.key)!.x).toBe(6000);
    // Offsets are untouched on both: the body moved, the seats did not move within it.
    expect(seatsOf(moved, a.key)).toBe(seatsOf(b.doc, a.key));
    expect(seatsOf(moved, b.key)).toBe(seatsOf(b.doc, b.key));
  });
});

describe("pressing a block to start a drag", () => {
  /*
   * Reported as "I marquee-drag a rectangle to choose the seats, but it moves one part not the other".
   * The marquee selected every block correctly — and then the press that BEGAN the drag replaced the
   * selection with the one block under the pointer, so the drag moved that block and silently threw the
   * rest of the selection away.
   */
  it("KEEPS a multi-block selection when pressing inside it", () => {
    const marqueed = new Set(["b1", "b2", "b3"]);
    // The press that starts the drag. Everything the marquee caught must still be selected.
    expect(selectionAfterPress(marqueed, "b2", false)).toEqual(marqueed);
  });

  it("replaces the selection when pressing something outside it", () => {
    expect(selectionAfterPress(new Set(["b1", "b2"]), "b9", false)).toEqual(new Set(["b9"]));
  });

  it("shift-press toggles one block without disturbing the rest", () => {
    expect(selectionAfterPress(new Set(["b1", "b2"]), "b3", true)).toEqual(
      new Set(["b1", "b2", "b3"]),
    );
    expect(selectionAfterPress(new Set(["b1", "b2"]), "b2", true)).toEqual(new Set(["b1"]));
  });

  it("starts a selection from nothing", () => {
    expect(selectionAfterPress(new Set(), "b1", false)).toEqual(new Set(["b1"]));
    expect(selectionAfterPress(new Set(), "b1", true)).toEqual(new Set(["b1"]));
  });

  it("moves the WHOLE marquee selection, not just the pressed block", () => {
    // End to end through the real ops: marquee three blocks, press one, drag.
    const { doc, sectionId, categoryId } = start();
    const a = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const b = addBlock(a.doc, "seating-block", { x: 4000, y: 1000 }, { sectionId, categoryId });
    const c = addBlock(b.doc, "seating-block", { x: 7000, y: 1000 }, { sectionId, categoryId });

    const marqueed = new Set([a.key, b.key, c.key]);
    const afterPress = selectionAfterPress(marqueed, b.key, false);
    const moved = moveBlocks(c.doc, afterPress, 0, 500, false);

    for (const k of [a.key, b.key, c.key]) {
      expect(moved.blocks.find((x) => x.key === k)!.y).toBe(1500);
    }
  });
});

describe("two blocks sharing one section's row labels", () => {
  /*
   * Reported as: adding seats to a section that already has some gives
   * "Hai ghế trùng nhãn trong cùng một khu vực."
   *
   * `seats` is UNIQUE on (section, row, number) and two blocks in a section share one label namespace.
   * Creation already stepped past the rows in use; REGENERATION did not, so growing a block ran it
   * straight into its neighbour — five rows became ten, and the block beside it already held F..J.
   */
  const twoBlocks = () => {
    const { doc, sectionId, categoryId } = start();
    const a = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const b = addBlock(a.doc, "seating-block", { x: 5000, y: 1000 }, { sectionId, categoryId });
    return { doc: b.doc, a: a.key, b: b.key, sectionId };
  };
  const rowsOf = (d: ReturnType<typeof emptyDocument>, k: string) => [
    ...new Set((d.blocks.find((x) => x.key === k)?.seats ?? []).map((s) => s.rowLabel)),
  ];
  const labels = (d: ReturnType<typeof emptyDocument>) =>
    d.blocks.flatMap((b) =>
      (b.seats ?? []).map((s) => `${b.sectionId}|${s.rowLabel}${s.seatNumber}`),
    );

  it("gives a new block its own rows", () => {
    const { doc, a, b } = twoBlocks();
    expect(rowsOf(doc, a)).toEqual(["A", "B", "C", "D", "E"]);
    expect(rowsOf(doc, b)).toEqual(["F", "G", "H", "I", "J"]);
  });

  it("moves a GROWN block clear of its neighbour instead of colliding", () => {
    const { doc, a, b } = twoBlocks();
    const grown = setBlockParams(doc, a, { rowsCount: 10 });
    // Ten rows that avoid B's F..J entirely, and no label used twice anywhere.
    expect(rowsOf(grown, a)).toHaveLength(10);
    expect(rowsOf(grown, a).some((r) => rowsOf(grown, b).includes(r))).toBe(false);
    expect(new Set(labels(grown)).size).toBe(labels(grown).length);
  });

  it("does NOT relabel a block whose seats are already saved", () => {
    // A saved seat may have been sold; moving its label would move the ticket. The collision is left
    // for the publish gate to report, because which block gives way is the organizer's decision.
    const { doc, a } = twoBlocks();
    const saved = {
      ...doc,
      blocks: doc.blocks.map((x) =>
        x.key === a ? { ...x, seats: x.seats!.map((s, i) => ({ ...s, seatId: 500 + i })) } : x,
      ),
    };
    const grown = setBlockParams(saved, a, { rowsCount: 10 });
    expect(rowsOf(grown, a)[0]).toBe("A");
  });

  it("respects a start the organizer typed", () => {
    const { doc, a } = twoBlocks();
    const grown = setBlockParams(doc, a, { rowsCount: 3, startRowIndex: 20 });
    expect(rowsOf(grown, a)[0]).toBe("U");
  });

  it("leaves a block in a DIFFERENT section alone", () => {
    const { doc, a, categoryId } = { ...twoBlocks(), categoryId: 1 };
    const other = addSection(doc, "Khu B");
    const c = addBlock(
      other.doc,
      "seating-block",
      { x: 1000, y: 6000 },
      { sectionId: other.id, categoryId },
    );
    // Its own section, its own namespace — it may start at A again.
    expect(rowsOf(c.doc, c.key)[0]).toBe("A");
    expect(rowsOf(c.doc, a)[0]).toBe("A");
  });
});

describe("where a new block goes", () => {
  /*
   * Every new block used to land in sections[0] / categories[0] whatever the organizer was working on,
   * so building a VIP area meant: add the block, scroll past the inspector to the price-class panel,
   * reassign it — every time. The selection is the best statement of intent available.
   */
  const chart = () => {
    let doc = emptyDocument();
    const a = addSection(doc, "Khu A");
    doc = a.doc;
    const b = addSection(doc, "Khu B");
    doc = b.doc;
    const std = addCategory(doc, "Thường");
    doc = std.doc;
    const vip = addCategory(doc, "VIP");
    doc = vip.doc;
    const block = addBlock(
      doc,
      "seating-block",
      { x: 1000, y: 1000 },
      { sectionId: b.id, categoryId: vip.id },
    );
    return { doc: block.doc, key: block.key, secA: a.id, secB: b.id, std: std.id, vip: vip.id };
  };
  // `undefined` is 'no preference stated'; `null` is the organizer saying 'nowhere', which is a
  // different thing and has to survive the fallback chain.
  const none = { sectionId: undefined, categoryId: undefined };

  it("inherits from the single selected block", () => {
    const c = chart();
    expect(nextBlockContext(c.doc, new Set([c.key]), none)).toEqual({
      sectionId: c.secB,
      categoryId: c.vip,
    });
  });

  it("falls back to the last one used when nothing is selected", () => {
    const c = chart();
    expect(nextBlockContext(c.doc, new Set(), { sectionId: c.secA, categoryId: c.vip })).toEqual({
      sectionId: c.secA,
      categoryId: c.vip,
    });
  });

  it("ignores a mixed selection — it states no single intent", () => {
    // With two sections and no single statement, the section is left unset rather than guessed; the
    // class still defaults, because a wrong colour costs a click and a wrong section costs the
    // block's lettering. See `nextBlockContext`.
    const c = chart();
    const second = addBlock(
      c.doc,
      "seating-block",
      { x: 5000, y: 1000 },
      { sectionId: c.secA, categoryId: c.std },
    );
    expect(nextBlockContext(second.doc, new Set([c.key, second.key]), none)).toEqual({
      sectionId: null,
      categoryId: c.std,
    });
  });

  it("falls back to the first CLASS on an untouched chart, but names no section", () => {
    const c = chart();
    expect(nextBlockContext(c.doc, new Set(), none)).toEqual({
      sectionId: null,
      categoryId: c.std,
    });
  });

  it("does fall back to the section when it is the only one", () => {
    const only = addSection(emptyDocument(), "Khu duy nhất");
    const cat = addCategory(only.doc, "Thường");
    expect(nextBlockContext(cat.doc, new Set(), none).sectionId).toBe(only.id);
  });

  it("drops a remembered id that no longer exists", () => {
    const c = chart();
    // The class was deleted since; remembering it would put the block in nothing.
    expect(nextBlockContext(c.doc, new Set(), { sectionId: 9999, categoryId: 9999 })).toEqual({
      sectionId: null,
      categoryId: c.std,
    });
  });

  it("puts the next block in VIP once you are working in VIP", () => {
    // The reported flow, end to end.
    const c = chart();
    const ctx = nextBlockContext(c.doc, new Set([c.key]), none);
    const added = addBlock(c.doc, "seating-block", { x: 6000, y: 1000 }, ctx);
    const made = added.doc.blocks.find((b) => b.key === added.key)!;
    expect(made.categoryId).toBe(c.vip);
    expect(made.sectionId).toBe(c.secB);
  });
});

describe("assigning a whole selection at once", () => {
  // The contextual toolbar applies its section / price class to EVERY selected block, so moving six
  // blocks into VIP is one action. The reducer it uses is asserted here because the toolbar itself is
  // JSX with no harness.
  it("applies to every selected block and leaves the rest alone", () => {
    const { doc, sectionId, categoryId } = start();
    const a = addBlock(doc, "seating-block", { x: 1000, y: 1000 }, { sectionId, categoryId });
    const b = addBlock(a.doc, "seating-block", { x: 4000, y: 1000 }, { sectionId, categoryId });
    const c = addBlock(b.doc, "seating-block", { x: 7000, y: 1000 }, { sectionId, categoryId });
    const vip = addCategory(c.doc, "VIP");

    const chosen = new Set([a.key, c.key]);
    const after = [...chosen].reduce(
      (acc, key) => updateBlock(acc, key, { categoryId: vip.id }),
      vip.doc,
    );

    expect(after.blocks.find((x) => x.key === a.key)!.categoryId).toBe(vip.id);
    expect(after.blocks.find((x) => x.key === c.key)!.categoryId).toBe(vip.id);
    expect(after.blocks.find((x) => x.key === b.key)!.categoryId).toBe(categoryId);
  });
});

describe("a block holding more than one kind of seat", () => {
  /*
   * A block is a DEFAULT, not a container: the projection resolves `seat.categoryId ?? block.categoryId`,
   * so one block may hold VIP and standard seats, or a wheelchair place in the middle of a row. Storage,
   * regeneration and inventory always allowed it; nothing in the editor could produce it.
   */
  const built = () => {
    const { doc, sectionId, categoryId } = start();
    const vip = addCategory(doc, "VIP");
    const added = addBlock(
      vip.doc,
      "seating-block",
      { x: 2000, y: 2000 },
      { sectionId, categoryId },
    );
    return { doc: added.doc, key: added.key, std: categoryId, vip: vip.id, sectionId };
  };
  const seatsOf = (d: ReturnType<typeof emptyDocument>) => projectDocument(d).seats;

  it("lets two seats take a different class from the rest", () => {
    const { doc, key, std, vip } = built();
    const after = updateSeats(
      doc,
      [
        { blockKey: key, index: 0 },
        { blockKey: key, index: 1 },
      ],
      {
        categoryId: vip,
      },
    );
    const classes = seatsOf(after).map((s) => s.categoryId);
    expect(classes.filter((c) => c === vip)).toHaveLength(2);
    expect(classes.filter((c) => c === std)).toHaveLength(classes.length - 2);
  });

  it("marks individual seats accessible without touching the others", () => {
    const { doc, key } = built();
    const after = updateSeats(doc, [{ blockKey: key, index: 3 }], { isAccessible: true });
    const flags = seatsOf(after).map((s) => s.isAccessible);
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags[3]).toBe(true);
  });

  it("keeps the overrides when the block is regenerated", () => {
    // Growing a block must not quietly un-VIP the seats somebody set.
    const { doc, key, vip } = built();
    const mixed = updateSeats(doc, [{ blockKey: key, index: 0 }], { categoryId: vip });
    const grown = setBlockParams(mixed, key, { rowsCount: 7 });
    expect(seatsOf(grown).filter((s) => s.categoryId === vip)).toHaveLength(1);
  });

  it("clears overrides when the whole block is reassigned", () => {
    // Otherwise "set this block to VIP" would leave individually-classed seats behind, and the toolbar
    // would go on reporting a mix the organizer thought they had just resolved.
    const { doc, key, std, vip } = built();
    const mixed = updateSeats(doc, [{ blockKey: key, index: 0 }], { categoryId: vip });
    const refs = (mixed.blocks.find((b) => b.key === key)!.seats ?? []).map((_, index) => ({
      blockKey: key,
      index,
    }));
    const reset = updateSeats(updateBlock(mixed, key, { categoryId: std }), refs, {
      categoryId: undefined,
    });
    expect(new Set(seatsOf(reset).map((s) => s.categoryId))).toEqual(new Set([std]));
  });

  it("never patches a table's seats — the server owns those", () => {
    const { doc } = built();
    const withTable = {
      ...doc,
      blocks: [
        ...doc.blocks,
        {
          key: "t-1",
          kind: "table" as const,
          title: "Bàn 1",
          x: 5000,
          y: 5000,
          rotation: 0,
          width: 600,
          height: 600,
          sectionId: 1,
          categoryId: 1,
          tableId: 9,
          seats: [{ seatId: 21, rowLabel: "Bàn 1", seatNumber: 1, dx: 400, dy: 0, rotation: 0 }],
        },
      ],
    };
    const after = updateSeats(withTable, [{ blockKey: "t-1", index: 0 }], { isAccessible: true });
    expect(after.blocks.find((b) => b.key === "t-1")!.seats![0].isAccessible).toBeUndefined();
  });
});

describe("drawing a block as a named shape", () => {
  /*
   * Everything is a polygon underneath — `layout_elements.points` is a vertex list and the canvas draws
   * it closed — so a circle is a polygon with enough points to read as round. That is what makes
   * "make this an oval" one click, and what keeps a generated shape editable vertex by vertex after.
   */
  const box = { x: 5000, y: 5000, width: 2000, height: 1000 };

  it("gives a rectangle its four corners, clockwise from the top-left", () => {
    expect(geometryPoints("rect", box)).toEqual([
      { x: 4000, y: 4500 },
      { x: 6000, y: 4500 },
      { x: 6000, y: 5500 },
      { x: 4000, y: 5500 },
    ]);
  });

  it("keeps a square and a circle regular by taking the smaller side", () => {
    const square = geometryPoints("square", box);
    const width = Math.max(...square.map((p) => p.x)) - Math.min(...square.map((p) => p.x));
    const height = Math.max(...square.map((p) => p.y)) - Math.min(...square.map((p) => p.y));
    expect(width).toBe(height);

    const circle = geometryPoints("circle", box);
    const cw = Math.max(...circle.map((p) => p.x)) - Math.min(...circle.map((p) => p.x));
    const ch = Math.max(...circle.map((p) => p.y)) - Math.min(...circle.map((p) => p.y));
    expect(Math.abs(cw - ch)).toBeLessThanOrEqual(2); // rounding to integers only
  });

  it("lets an oval follow the box, unlike a circle", () => {
    const oval = geometryPoints("oval", box);
    const w = Math.max(...oval.map((p) => p.x)) - Math.min(...oval.map((p) => p.x));
    const h = Math.max(...oval.map((p) => p.y)) - Math.min(...oval.map((p) => p.y));
    expect(w).toBeGreaterThan(h);
  });

  it("starts every curve at the top, so a triangle points up", () => {
    const tri = geometryPoints("triangle", box);
    expect(tri).toHaveLength(3);
    expect(tri[0].x).toBe(box.x);
    expect(tri[0].y).toBeLessThan(box.y);
  });

  it("stays inside the polygon cap the route enforces", () => {
    // 64 is the server's limit; a generated shape must never be refused at the boundary.
    for (const g of ["rect", "square", "circle", "oval", "triangle", "hexagon"] as const) {
      expect(geometryPoints(g, box).length).toBeLessThanOrEqual(64);
    }
  });

  it("keeps every vertex inside the coordinate space", () => {
    // A shape dragged to the edge and then regenerated must not produce points the database rejects.
    //
    // Bounded by the WALL at both ends, and the lower end is no longer 0: the frame's corner stopped
    // being the limit when the wall moved out (0041), so a circle centred near the top edge now keeps
    // the negative half of its outline instead of having it flattened onto y=0. That flattening was
    // never desirable — it turned a circle into a circle with one straight side.
    const atEdge = { x: 9800, y: 200, width: 3000, height: 3000 };
    for (const p of geometryPoints("circle", atEdge)) {
      expect(p.x).toBeGreaterThanOrEqual(LAYOUT_MIN);
      expect(p.x).toBeLessThanOrEqual(LAYOUT_MAX);
      expect(p.y).toBeGreaterThanOrEqual(LAYOUT_MIN);
      expect(p.y).toBeLessThanOrEqual(LAYOUT_MAX);
    }
  });
});

describe("moving a drawn shape", () => {
  /*
   * `points` are ABSOLUTE layout coordinates — what `layout_elements.points` stores and what the canvas
   * draws from — so changing a block's x/y alone moved an invisible box and left the outline where it
   * was drawn. A duplicate landed exactly on top of its original for the same reason.
   */
  const drawn = () => ({
    ...emptyDocument(),
    blocks: [
      {
        key: "s-1",
        kind: "shape" as const,
        title: "Hình",
        x: 3000,
        y: 3000,
        rotation: 0,
        width: 2000,
        height: 2000,
        sectionId: null,
        categoryId: null,
        points: [
          { x: 2000, y: 2000 },
          { x: 4000, y: 2000 },
          { x: 4000, y: 4000 },
          { x: 2000, y: 4000 },
        ],
      },
    ],
  });
  const xs = (d: ReturnType<typeof emptyDocument>, key = "s-1") =>
    d.blocks.find((b) => b.key === key)!.points!.map((p) => p.x);

  it("carries the outline with the block", () => {
    const moved = moveBlocks(drawn(), new Set(["s-1"]), 1000, 0, false);
    expect(moved.blocks[0].x).toBe(4000);
    expect(xs(moved)).toEqual([3000, 5000, 5000, 3000]);
  });

  it("keeps the outline's shape exactly — it slides, it does not distort", () => {
    const doc = drawn();
    const before = doc.blocks[0].points!;
    const after = moveBlocks(doc, new Set(["s-1"]), 700, -400, false).blocks[0].points!;
    const gaps = (pts: typeof before) =>
      pts.slice(1).map((p, i) => `${p.x - pts[i].x},${p.y - pts[i].y}`);
    expect(gaps(after)).toEqual(gaps(before));
  });

  it("what the projection draws follows too", () => {
    const moved = moveBlocks(drawn(), new Set(["s-1"]), 1000, 0, false);
    expect(projectDocument(moved).elements[0].points!.map((p) => p.x)).toEqual([
      3000, 5000, 5000, 3000,
    ]);
  });

  it("puts a duplicate beside the original, not on top of it", () => {
    const dup = duplicateBlocks(drawn(), new Set(["s-1"]), 500, 500);
    const copy = [...dup.keys][0];
    expect(xs(dup.doc, copy)).toEqual([2500, 4500, 4500, 2500]);
  });

  it("stops the OUTLINE at the edge of the map, not the advisory box", () => {
    // width/height is only advisory and can be far smaller than the drawn shape, which would otherwise
    // let the outline be dragged off the map.
    const doc = drawn();
    const wide = {
      ...doc,
      blocks: [{ ...doc.blocks[0], width: 10, height: 10 }],
    };
    const moved = moveBlocks(wide, new Set(["s-1"]), 9000, 0, false);
    expect(Math.max(...xs(moved))).toBeLessThanOrEqual(LAYOUT_MAX);
  });
});

// A shape is a block like any other, and is made where blocks are made. These cover the three things
// that has to mean: creating one produces something you can SEE, its colour survives the projection,
// and a colour is only offered where the projection can actually keep it.
describe("creating a shape from the block palette", () => {
  const at = { x: 3000, y: 3000 };

  it("draws an outline, so a new shape is visible on the canvas", () => {
    // A block with no points renders nothing: the canvas needs >= 2 to draw a polyline. Creating one
    // from the palette used to produce exactly that — a selected, movable, INVISIBLE block.
    const { doc, key } = addBlock(emptyDocument(), "shape", at);
    const block = doc.blocks.find((b) => b.key === key)!;
    expect(block.points?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("makes the shape the palette was asked for", () => {
    const { doc, key } = addBlock(emptyDocument(), "shape", at, { geometry: "circle" });
    const block = doc.blocks.find((b) => b.key === key)!;
    expect(block.geometry).toBe("circle");
    expect(block.points).toHaveLength(32);
    // Centred on the drop point rather than offset from it.
    const cx = block.points!.reduce((s, p) => s + p.x, 0) / block.points!.length;
    expect(Math.abs(cx - at.x)).toBeLessThan(50);
  });

  it("keeps geometry and colour through a save", () => {
    const { doc } = addBlock(emptyDocument(), "shape", at, {
      geometry: "hexagon",
      color: "#4C9A6B",
    });
    const el = projectDocument(doc).elements[0];
    expect(el.geometry).toBe("hexagon");
    expect(el.color).toBe("#4C9A6B");
    expect(el.points).toHaveLength(6);
  });
});

describe("colouring blocks", () => {
  const made = (kind: Parameters<typeof addBlock>[1]) => {
    const { doc, key } = addBlock(emptyDocument(), kind, { x: 2000, y: 2000 });
    return { doc, keys: new Set([key]) };
  };

  it("recolours a decoration block and the colour reaches the saved rows", () => {
    const { doc, keys } = made("stage");
    const painted = setBlockColor(doc, keys, "#D93025");
    expect(painted.blocks[0].color).toBe("#D93025");
    expect(projectDocument(painted).elements[0].color).toBe("#D93025");
  });

  it("clears a colour back to the theme default", () => {
    const { doc, keys } = made("stage");
    const cleared = setBlockColor(setBlockColor(doc, keys, "#D93025"), keys, null);
    expect(cleared.blocks[0].color ?? null).toBeNull();
  });

  it("leaves a seat block alone — the projection has nowhere to keep its colour", () => {
    // A seat block becomes a section plus seats, not an element, so a colour set here would be accepted
    // in the editor and silently gone on the next read.
    const { doc, keys } = made("seating-block");
    expect(setBlockColor(doc, keys, "#D93025").blocks[0].color ?? null).toBeNull();
  });

  it("leaves a locked block alone, like every other block operation", () => {
    const { doc, keys } = made("stage");
    const locked = setLocked(doc, keys, true);
    expect(setBlockColor(locked, keys, "#D93025").blocks[0].color ?? null).toBeNull();
  });

  it("colours a capacity zone, which does keep one", () => {
    const { doc, keys } = made("ga-zone");
    expect(setBlockColor(doc, keys, "#8A0C24").blocks[0].color).toBe("#8A0C24");
  });
});

describe("the palette's drag payload", () => {
  it("round-trips a plain kind", () => {
    expect(parseBlockDrag(formatBlockDrag("stage"))).toEqual({ kind: "stage", geometry: null });
  });

  it("round-trips a shape with its geometry", () => {
    expect(parseBlockDrag(formatBlockDrag("shape", "oval"))).toEqual({
      kind: "shape",
      geometry: "oval",
    });
  });

  it("refuses anything that is not a block kind", () => {
    // The payload is a string off a DataTransfer, so it is untrusted: an unrecognised kind used to be
    // cast straight through and produced a block with no label and no size.
    expect(parseBlockDrag("javascript:alert(1)")).toBeNull();
    expect(parseBlockDrag("shape:trapezoid")).toBeNull();
    expect(parseBlockDrag("")).toBeNull();
  });
});

// A row of seats that belongs to no section yet. The database has allowed it since 0024 and the
// validator names it at publish — but the editor always resolved a section for you, so it could not be
// expressed at all.
describe("placing blocks outside every section", () => {
  const chart = () => {
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    const cat = addCategory(d, "Thường");
    d = cat.doc;
    return { doc: d, sec: sec.id, cat: cat.id };
  };

  it("takes 'nowhere' as an answer instead of reaching for the first section", () => {
    const c = chart();
    expect(nextBlockContext(c.doc, new Set(), { sectionId: null, categoryId: null })).toEqual({
      sectionId: null,
      categoryId: null,
    });
  });

  it("lets an explicit choice beat what happens to be selected", () => {
    // Otherwise picking "no section" while a block is selected would silently do nothing.
    const c = chart();
    const made = addBlock(
      c.doc,
      "seating-block",
      { x: 1000, y: 1000 },
      { sectionId: c.sec, categoryId: c.cat },
    );
    expect(
      nextBlockContext(made.doc, new Set([made.key]), { sectionId: null, categoryId: undefined }),
    ).toEqual({ sectionId: null, categoryId: c.cat });
  });

  it("still falls back when nothing has been stated", () => {
    const c = chart();
    expect(
      nextBlockContext(c.doc, new Set(), { sectionId: undefined, categoryId: undefined }),
    ).toEqual({
      sectionId: c.sec,
      categoryId: c.cat,
    });
  });

  it("saves the seats with no section rather than inventing one", () => {
    const c = chart();
    const made = addBlock(
      c.doc,
      "single-row",
      { x: 1000, y: 1000 },
      { sectionId: null, categoryId: null },
    );
    const p = projectDocument(made.doc);
    expect(p.seats.length).toBeGreaterThan(0);
    expect(p.seats.every((s) => s.sectionId === null)).toBe(true);
    // The section that exists is untouched — nothing was quietly filed into it.
    expect(p.sections).toHaveLength(1);
  });

  it("letters a second section-less block past the first, as it does inside a section", () => {
    // Section-less seats share one label namespace ('none'), so the same collision the sectioned case
    // had applies here — two blocks both starting at row A would be reported as duplicates.
    const c = chart();
    const first = addBlock(
      c.doc,
      "seating-block",
      { x: 1000, y: 1000 },
      { sectionId: null, categoryId: null },
    );
    const second = addBlock(
      first.doc,
      "seating-block",
      { x: 5000, y: 1000 },
      { sectionId: null, categoryId: null },
    );
    const rowsOf = (key: string) =>
      new Set(second.doc.blocks.find((b) => b.key === key)!.seats!.map((st) => st.rowLabel));
    const a = rowsOf(first.key);
    const b = rowsOf(second.key);
    expect([...a].some((r) => b.has(r))).toBe(false);
  });

  it("keeps a section-less block clear of a sectioned one — separate namespaces", () => {
    const c = chart();
    const inside = addBlock(
      c.doc,
      "seating-block",
      { x: 1000, y: 1000 },
      { sectionId: c.sec, categoryId: c.cat },
    );
    const outside = addBlock(
      inside.doc,
      "seating-block",
      { x: 5000, y: 1000 },
      { sectionId: null, categoryId: null },
    );
    const block = outside.doc.blocks.find((b) => b.key === outside.key)!;
    // Free to start at A again: a duplicate label only collides within one section.
    expect(block.seats!.some((st) => st.rowLabel === "A")).toBe(true);
  });
});

// A shape's outline is the content. Text belongs in a separate label block so scaling the outline
// cannot leave a caption behind at its old size or position.
describe("shape display text", () => {
  it("creates a shape without text inside it", () => {
    const { doc, key } = addBlock(emptyDocument(), "shape", { x: 3000, y: 3000 });
    const block = doc.blocks.find((b) => b.key === key)!;
    expect(block.label).toBeNull();
    expect(projectDocument(doc).elements[0].label).toBeNull();
  });

  it("suppresses text left on a shape by an older saved document", () => {
    const { doc, key } = addBlock(emptyDocument(), "shape", { x: 3000, y: 3000 });
    const renamed = updateBlock(doc, key, { label: "Khán đài B" });
    expect(projectDocument(renamed).elements[0].label).toBeNull();
  });
});

// Deleting rows should close the gap they leave: with A–D and E–H in a section, deleting A–D leaves
// E–H, which should become A–D rather than starting the section at E.
describe("re-lettering a section after seats are removed", () => {
  const twoBlocks = () => {
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    const first = addBlock(d, "seating-block", { x: 1000, y: 1000 }, { sectionId: sec.id });
    d = first.doc;
    const second = addBlock(d, "seating-block", { x: 5000, y: 1000 }, { sectionId: sec.id });
    return { doc: second.doc, sec: sec.id, first: first.key, second: second.key };
  };
  const rowsOf = (d: ReturnType<typeof emptyDocument>, key: string) => [
    ...new Set(d.blocks.find((b) => b.key === key)!.seats!.map((s) => s.rowLabel)),
  ];

  it("letters the second block past the first while both are there", () => {
    const c = twoBlocks();
    expect(rowsOf(c.doc, c.first)).toEqual(["A", "B", "C", "D", "E"]);
    expect(rowsOf(c.doc, c.second)).toEqual(["F", "G", "H", "I", "J"]);
  });

  it("pulls the survivors back to A when the block before them goes", () => {
    const c = twoBlocks();
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    expect(rowsOf(after, c.second)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("KEEPS every seat id through the re-lettering", () => {
    // The one that matters. `regenerateBlock` matches existing seats by `rowLabel|seatNumber` — so
    // re-lettering through it would find no match, mint a fresh id for every seat, and the save would
    // then delete the originals (or be refused `seat_in_use` once a showtime had bound them). The
    // labels move; the seats do not.
    const c = twoBlocks();
    const before = c.doc.blocks.find((b) => b.key === c.second)!.seats!;
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first]))).blocks.find(
      (b) => b.key === c.second,
    )!.seats!;
    expect(after.map((s) => s.seatId)).toEqual(before.map((s) => s.seatId));
  });

  it("moves no seat — only what the row is called", () => {
    const c = twoBlocks();
    const before = c.doc.blocks.find((b) => b.key === c.second)!.seats!;
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first]))).blocks.find(
      (b) => b.key === c.second,
    )!.seats!;
    expect(after.map((s) => `${s.dx},${s.dy}`)).toEqual(before.map((s) => `${s.dx},${s.dy}`));
    expect(after.map((s) => s.seatNumber)).toEqual(before.map((s) => s.seatNumber));
  });

  it("leaves a locked block exactly where it is, and letters the rest around it", () => {
    // `locked` is the existing "do not touch this" signal — a block lettered to match the signage
    // physically bolted to the building says so by being locked.
    const c = twoBlocks();
    const locked = setLocked(c.doc, new Set([c.second]), true);
    const after = repackRowLabels(removeBlocks(locked, new Set([c.first])));
    expect(rowsOf(after, c.second)).toEqual(["F", "G", "H", "I", "J"]);
  });

  it("leaves an adopted block alone — it has no parameters to re-letter from", () => {
    // A chart that predates documents carries literal labels and no params. Re-lettering it would
    // rename rows nobody asked to change, so it is skipped and the rest letters past it.
    const c = twoBlocks();
    const adopted = {
      ...c.doc,
      blocks: c.doc.blocks.map((b) => (b.key === c.first ? { ...b, params: undefined } : b)),
    };
    const after = repackRowLabels(adopted);
    expect(rowsOf(after, c.first)).toEqual(["A", "B", "C", "D", "E"]);
    expect(rowsOf(after, c.second)).toEqual(["F", "G", "H", "I", "J"]);
  });

  it("keeps sections independent", () => {
    const c = twoBlocks();
    let d = c.doc;
    const other = addSection(d, "Khu B");
    d = other.doc;
    const inB = addBlock(d, "seating-block", { x: 8000, y: 1000 }, { sectionId: other.id });
    d = inB.doc;
    // Khu B letters from A on its own; deleting in Khu A must not disturb it.
    expect(rowsOf(d, inB.key)).toEqual(["A", "B", "C", "D", "E"]);
    const after = repackRowLabels(removeBlocks(d, new Set([c.first])));
    expect(rowsOf(after, inB.key)).toEqual(["A", "B", "C", "D", "E"]);
    expect(rowsOf(after, c.second)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("closes the gap when a block SHRINKS, not only when one is deleted", () => {
    const c = twoBlocks();
    const shrunk = setBlockParams(c.doc, c.first, { rowsCount: 2 });
    const after = repackRowLabels(shrunk);
    expect(rowsOf(after, c.first)).toEqual(["A", "B"]);
    expect(rowsOf(after, c.second)).toEqual(["C", "D", "E", "F", "G"]);
  });

  it("changes nothing when run again", () => {
    // Called after every edit that frees labels, so it has to be a no-op on an already-packed chart.
    const c = twoBlocks();
    const once = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    expect(repackRowLabels(once)).toEqual(once);
  });

  it("leaves the chart with no duplicate labels", () => {
    const c = twoBlocks();
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    const p = projectDocument(after);
    const keys = p.seats.map((s) => `${s.sectionId}|${s.rowLabel}|${s.seatNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("re-letters section-less blocks in their own namespace", () => {
    let d = emptyDocument();
    const first = addBlock(d, "seating-block", { x: 1000, y: 1000 }, { sectionId: null });
    d = first.doc;
    const second = addBlock(d, "seating-block", { x: 5000, y: 1000 }, { sectionId: null });
    const after = repackRowLabels(removeBlocks(second.doc, new Set([first.key])));
    expect(rowsOf(after, second.key)).toEqual(["A", "B", "C", "D", "E"]);
  });
});

// `seats.seat_type` has allowed three values since 0002, and the editor could set none of them: every
// seat it made was `single` by default and no control existed to change one.
describe("seat types", () => {
  const oneBlock = () => {
    const { doc, key } = addBlock(emptyDocument(), "single-row", { x: 2000, y: 2000 });
    const refs = doc.blocks
      .find((b) => b.key === key)!
      .seats!.map((_, index) => ({ blockKey: key, index }));
    return { doc, key, refs };
  };

  it("offers exactly the types a seat may be", () => {
    expect([...EDITABLE_SEAT_TYPES]).toEqual(["single", "double"]);
  });

  it("sets the type on the seats named, and only those", () => {
    const c = oneBlock();
    const after = setSeatType(c.doc, c.refs.slice(0, 3), "double");
    const seats = after.blocks.find((b) => b.key === c.key)!.seats!;
    expect(seats.slice(0, 3).map((s) => s.seatType)).toEqual(["double", "double", "double"]);
    expect(seats.slice(3).every((s) => s.seatType === undefined)).toBe(true);
  });

  it("carries the type through a save", () => {
    const c = oneBlock();
    const p = projectDocument(setSeatType(c.doc, c.refs.slice(0, 2), "double"));
    expect(p.seats.slice(0, 2).map((s) => s.seatType)).toEqual(["double", "double"]);
    // Anything never given one is `single`, which is what the column defaults to.
    expect(p.seats[2].seatType).toBe("single");
  });

  it("REFUSES to mark an ordinary seat as standing", () => {
    // `standing` is not a style of seat, it is a structural marker owned by the standing-area path —
    // and `reshapeStandingArea` uses it as a DELETE key:
    //   DELETE FROM seats WHERE layout_id = $1 AND row_label = $2 AND seat_type = 'standing'
    // so a seat marked standing from the editor can be silently destroyed by a later reshape of an
    // unrelated standing area that happens to share its row label.
    const c = oneBlock();
    const after = setSeatType(
      c.doc,
      c.refs,
      "standing" as unknown as (typeof EDITABLE_SEAT_TYPES)[number],
    );
    expect(after).toEqual(c.doc);
  });

  it("leaves the rest of the seat untouched", () => {
    const c = oneBlock();
    const before = c.doc.blocks.find((b) => b.key === c.key)!.seats![0];
    const after = setSeatType(c.doc, [c.refs[0]], "double").blocks.find((b) => b.key === c.key)!
      .seats![0];
    expect({ ...after, seatType: undefined }).toEqual({ ...before, seatType: undefined });
  });
});

// Rows have ids now (0032), so a renumber has to move the LABEL and leave the row itself alone —
// otherwise the row that was F is abandoned and a brand-new row A appears in its place.
describe("re-lettering keeps a row's identity", () => {
  const chart = () => {
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    const first = addBlock(d, "seating-block", { x: 1000, y: 1000 }, { sectionId: sec.id });
    d = first.doc;
    const second = addBlock(d, "seating-block", { x: 5000, y: 1000 }, { sectionId: sec.id });
    // Give the second block's rows real ids, as a save would have.
    const doc: ReturnType<typeof emptyDocument> = {
      ...second.doc,
      rows: ["F", "G", "H", "I", "J"].map((label, i) => ({
        id: 100 + i,
        label,
        sectionId: sec.id,
        displayOrder: 5 + i,
      })),
      blocks: second.doc.blocks.map((b) =>
        b.key === second.key
          ? {
              ...b,
              seats: b.seats?.map((s) => ({
                ...s,
                rowId: 100 + (letterIndex(s.rowLabel) ?? 5) - 5,
              })),
            }
          : b,
      ),
    };
    return { doc, sec: sec.id, first: first.key, second: second.key };
  };

  it("renames the row rather than abandoning it", () => {
    const c = chart();
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    // Row 100 was F and is now A — same row, new label.
    expect(after.rows?.find((r) => r.id === 100)?.label).toBe("A");
    expect(after.rows?.map((r) => r.label)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("leaves every row id in place", () => {
    const c = chart();
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    expect(after.rows?.map((r) => r.id).sort((a, b) => a - b)).toEqual([100, 101, 102, 103, 104]);
  });

  it("keeps each seat pointing at the row it was already in", () => {
    const c = chart();
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    const seats = after.blocks.find((b) => b.key === c.second)!.seats!;
    // Every seat now in row A must carry row 100 — the row that used to be F.
    expect(seats.filter((s) => s.rowLabel === "A").every((s) => s.rowId === 100)).toBe(true);
  });

  it("projects without minting a second row for the new label", () => {
    // The failure this guards: the stored row stays "F" with no seats, a new row "A" is minted, and
    // the chart quietly grows a duplicate row on every renumber.
    const c = chart();
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    const p = projectDocument(after);
    expect(p.rows).toHaveLength(5);
    expect(p.rows.every((r) => r.id > 0)).toBe(true);
  });
});

describe("deleting a block takes its rows with it", () => {
  const chart = () => {
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    const first = addBlock(d, "seating-block", { x: 1000, y: 1000 }, { sectionId: sec.id });
    d = first.doc;
    const second = addBlock(d, "seating-block", { x: 5000, y: 1000 }, { sectionId: sec.id });
    const rows = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((label, i) => ({
      id: 100 + i,
      label,
      sectionId: sec.id,
      displayOrder: i,
    }));
    const withRows = {
      ...second.doc,
      rows,
      blocks: second.doc.blocks.map((b) => ({
        ...b,
        seats: b.seats?.map((s) => ({ ...s, rowId: 100 + (letterIndex(s.rowLabel) ?? 0) })),
      })),
    };
    return { doc: withRows, first: first.key, second: second.key };
  };

  it("drops the rows the deleted block emptied", () => {
    const after = removeBlocks(chart().doc, new Set([chart().first]));
    expect(after.rows?.map((r) => r.label)).toEqual(["F", "G", "H", "I", "J"]);
  });

  it("keeps a row that still has seats in another block", () => {
    // Two blocks can legitimately share a section; only rows left with nothing go.
    const c = chart();
    const shared = {
      ...c.doc,
      blocks: c.doc.blocks.map((b) =>
        b.key === c.second ? { ...b, seats: b.seats?.map((s) => ({ ...s, rowId: 100 })) } : b,
      ),
    };
    expect(removeBlocks(shared, new Set([c.first])).rows?.some((r) => r.id === 100)).toBe(true);
  });

  it("keeps a row that never had seats — an empty row is deliberate", () => {
    const c = chart();
    const withEmpty = {
      ...c.doc,
      rows: [...(c.doc.rows ?? []), { id: 900, label: "Z", sectionId: 1, displayOrder: 99 }],
    };
    expect(removeBlocks(withEmpty, new Set([c.first])).rows?.some((r) => r.id === 900)).toBe(true);
  });

  it("leaves no two rows sharing a label after a delete and repack", () => {
    // The failure this guards: the deleted block's rows stayed behind still called A–E while the
    // survivors were renumbered onto A–E, so the save presented two rows called "A" in one section
    // and `layout_rows_label_idx` refused it.
    const c = chart();
    const after = repackRowLabels(removeBlocks(c.doc, new Set([c.first])));
    const keys = (after.rows ?? []).map((r) => `${r.sectionId}|${r.label}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// §26 distribute and §7 flip: the two selection operations the align toolbar was missing.
describe("distributing blocks", () => {
  const three = () => {
    let d = emptyDocument();
    const a = addBlock(d, "stage", { x: 1000, y: 1000 });
    d = a.doc;
    const b = addBlock(d, "stage", { x: 1200, y: 1000 });
    d = b.doc;
    const c = addBlock(d, "stage", { x: 5000, y: 1000 });
    return { doc: c.doc, keys: new Set([a.key, b.key, c.key]), a: a.key, b: b.key, c: c.key };
  };
  const xOf = (d: ReturnType<typeof emptyDocument>, key: string) =>
    d.blocks.find((x) => x.key === key)!.x;

  it("spaces them evenly between the two ends", () => {
    const t = three();
    const after = distributeBlocks(t.doc, t.keys, "horizontal");
    expect(xOf(after, t.a)).toBe(1000);
    expect(xOf(after, t.c)).toBe(5000);
    expect(xOf(after, t.b)).toBe(3000);
  });

  it("leaves the outermost two where they are — they define the span", () => {
    const t = three();
    const after = distributeBlocks(t.doc, t.keys, "horizontal");
    expect(xOf(after, t.a)).toBe(xOf(t.doc, t.a));
    expect(xOf(after, t.c)).toBe(xOf(t.doc, t.c));
  });

  it("does nothing to fewer than three — there is no gap to even out", () => {
    const t = three();
    expect(distributeBlocks(t.doc, new Set([t.a, t.b]), "horizontal")).toBe(t.doc);
  });

  it("distributes vertically on the other axis", () => {
    let d = emptyDocument();
    const a = addBlock(d, "stage", { x: 1000, y: 1000 });
    d = a.doc;
    const b = addBlock(d, "stage", { x: 1000, y: 1100 });
    d = b.doc;
    const c = addBlock(d, "stage", { x: 1000, y: 3000 });
    const after = distributeBlocks(c.doc, new Set([a.key, b.key, c.key]), "vertical");
    expect(after.blocks.find((x) => x.key === b.key)!.y).toBe(2000);
  });
});

describe("flipping a selection", () => {
  const seated = () => {
    const made = addBlock(emptyDocument(), "seating-block", { x: 3000, y: 3000 });
    return { doc: made.doc, key: made.key };
  };
  const seats = (d: ReturnType<typeof emptyDocument>, key: string) =>
    d.blocks.find((b) => b.key === key)!.seats!;

  it("mirrors the seats horizontally", () => {
    const c = seated();
    const before = seats(c.doc, c.key).map((s) => s.dx);
    const after = seats(flipBlocks(c.doc, new Set([c.key]), "horizontal"), c.key).map((s) => s.dx);
    const span = Math.min(...before) + Math.max(...before);
    expect(after).toEqual(before.map((dx) => span - dx));
  });

  it("keeps every seat id and label — a flip moves seats, it does not rename them", () => {
    const c = seated();
    const before = seats(c.doc, c.key);
    const after = seats(flipBlocks(c.doc, new Set([c.key]), "horizontal"), c.key);
    expect(after.map((s) => s.seatId)).toEqual(before.map((s) => s.seatId));
    expect(after.map((s) => `${s.rowLabel}${s.seatNumber}`)).toEqual(
      before.map((s) => `${s.rowLabel}${s.seatNumber}`),
    );
  });

  it("is its own inverse", () => {
    const c = seated();
    const twice = flipBlocks(
      flipBlocks(c.doc, new Set([c.key]), "horizontal"),
      new Set([c.key]),
      "horizontal",
    );
    expect(seats(twice, c.key).map((s) => s.dx)).toEqual(seats(c.doc, c.key).map((s) => s.dx));
  });

  it("mirrors vertically on the other axis", () => {
    const c = seated();
    const before = seats(c.doc, c.key).map((s) => s.dy);
    const after = seats(flipBlocks(c.doc, new Set([c.key]), "vertical"), c.key).map((s) => s.dy);
    const span = Math.min(...before) + Math.max(...before);
    expect(after).toEqual(before.map((dy) => span - dy));
  });

  it("leaves a locked block alone", () => {
    const c = seated();
    const locked = setLocked(c.doc, new Set([c.key]), true);
    expect(seats(flipBlocks(locked, new Set([c.key]), "horizontal"), c.key)).toEqual(
      seats(locked, c.key),
    );
  });

  it("mirrors a drawn shape's outline too", () => {
    const made = addBlock(emptyDocument(), "shape", { x: 3000, y: 3000 }, { geometry: "triangle" });
    const before = made.doc.blocks[0].points!.map((p) => p.x);
    const after = flipBlocks(made.doc, new Set([made.key]), "horizontal").blocks[0].points!.map(
      (p) => p.x,
    );
    const span = Math.min(...before) + Math.max(...before);
    expect(after).toEqual(before.map((x) => span - x));
  });
});

// §5 and §23: an object can be hidden while it is being worked around. Hiding is a VIEW state.
describe("hiding blocks", () => {
  const chart = () => {
    const made = addBlock(emptyDocument(), "seating-block", { x: 2000, y: 2000 });
    return { doc: made.doc, key: made.key };
  };

  it("marks the block hidden", () => {
    const c = chart();
    expect(setHidden(c.doc, new Set([c.key]), true).blocks[0].hidden).toBe(true);
  });

  it("shows it again", () => {
    const c = chart();
    const hidden = setHidden(c.doc, new Set([c.key]), true);
    expect(setHidden(hidden, new Set([c.key]), false).blocks[0].hidden).toBe(false);
  });

  it("does NOT change what is for sale — a hidden block still projects every seat", () => {
    // The property that makes hiding safe. It is a view state for the person drawing, and the
    // projection is what sells; if hiding removed seats, an organizer tidying their screen would
    // silently take a row off sale.
    const c = chart();
    const before = projectDocument(c.doc);
    const after = projectDocument(setHidden(c.doc, new Set([c.key]), true));
    expect(after.seats).toHaveLength(before.seats.length);
    expect(after.seats.map((s) => s.rowLabel)).toEqual(before.seats.map((s) => s.rowLabel));
  });

  it("hides a LOCKED block too — locking protects from edits, not from the eye", () => {
    const c = chart();
    const locked = setLocked(c.doc, new Set([c.key]), true);
    expect(setHidden(locked, new Set([c.key]), true).blocks[0].hidden).toBe(true);
  });
});

// §27 copy/paste. Ctrl+D duplicates in place; this is the pair that crosses a gap in time — copy now,
// paste after panning somewhere else, or paste twice.
describe("copying and pasting blocks", () => {
  const chart = () => {
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    const a = addBlock(d, "seating-block", { x: 2000, y: 2000 }, { sectionId: sec.id });
    d = a.doc;
    const b = addBlock(d, "stage", { x: 5000, y: 500 });
    return { doc: b.doc, sec: sec.id, a: a.key, b: b.key };
  };

  it("copies exactly what was selected", () => {
    const c = chart();
    expect(copyBlocks(c.doc, new Set([c.a])).map((x) => x.key)).toEqual([c.a]);
    expect(copyBlocks(c.doc, new Set([c.a, c.b]))).toHaveLength(2);
  });

  it("pastes with FRESH keys and FRESH seat ids (§42 Rule 4)", () => {
    const c = chart();
    const clip = copyBlocks(c.doc, new Set([c.a]));
    const after = pasteBlocks(c.doc, clip, { x: 400, y: 400 });
    expect(after.doc.blocks).toHaveLength(3);

    const pasted = after.doc.blocks.find((x) => after.keys.has(x.key))!;
    const originalSeatIds = new Set(
      c.doc.blocks.find((x) => x.key === c.a)!.seats!.map((s) => s.seatId),
    );
    expect(pasted.key).not.toBe(c.a);
    expect(pasted.seats!.every((s) => !originalSeatIds.has(s.seatId))).toBe(true);
  });

  it("lands the copy where it was asked for, not on top of the original", () => {
    const c = chart();
    const clip = copyBlocks(c.doc, new Set([c.a]));
    const after = pasteBlocks(c.doc, clip, { x: 400, y: 400 });
    const pasted = after.doc.blocks.find((x) => after.keys.has(x.key))!;
    expect(pasted.x).toBe(2400);
    expect(pasted.y).toBe(2400);
  });

  it("can be pasted twice without the two copies colliding", () => {
    const c = chart();
    const clip = copyBlocks(c.doc, new Set([c.a]));
    const once = pasteBlocks(c.doc, clip, { x: 400, y: 0 });
    const twice = pasteBlocks(once.doc, clip, { x: 800, y: 0 });
    const keys = twice.doc.blocks.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = twice.doc.blocks.flatMap((b) => (b.seats ?? []).map((s) => s.seatId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives the paste no row ids — a pasted row is a new row", () => {
    const c = chart();
    const clip = copyBlocks(c.doc, new Set([c.a]));
    const after = pasteBlocks(c.doc, clip, { x: 400, y: 400 });
    const pasted = after.doc.blocks.find((x) => after.keys.has(x.key))!;
    expect(pasted.seats!.every((s) => s.rowId == null)).toBe(true);
  });

  it("carries a drawn shape's outline to where it was pasted", () => {
    const made = addBlock(emptyDocument(), "shape", { x: 3000, y: 3000 }, { geometry: "square" });
    const clip = copyBlocks(made.doc, new Set([made.key]));
    const after = pasteBlocks(made.doc, clip, { x: 1000, y: 0 });
    const pasted = after.doc.blocks.find((x) => after.keys.has(x.key))!;
    const before = made.doc.blocks[0].points!.map((p) => p.x);
    expect(pasted.points!.map((p) => p.x)).toEqual(before.map((x) => x + 1000));
  });

  it("pastes nothing from an empty clipboard", () => {
    const c = chart();
    expect(pasteBlocks(c.doc, [], { x: 100, y: 100 }).doc).toBe(c.doc);
  });
});

// §25: snap to object, not only to the grid. Aligning two blocks by eye at 4,000 units across is
// guesswork; the grid does not help, because a 50-unit cell means "near enough" is still 50 out.
describe("snapping a drag to nearby blocks", () => {
  const chart = () => {
    let d = emptyDocument();
    const anchor = addBlock(d, "stage", { x: 3000, y: 2000 });
    d = anchor.doc;
    const moving = addBlock(d, "stage", { x: 6000, y: 5000 });
    return { doc: moving.doc, anchor: anchor.key, moving: moving.key };
  };

  it("pulls a near-miss onto the other block's centre line", () => {
    const c = chart();
    // 40 units off in x: inside the threshold, so it should land exactly on 3000.
    const snapped = snapToObjects(c.doc, new Set([c.moving]), { x: 3040, y: 5000 }, 120);
    expect(snapped.x).toBe(3000);
    expect(snapped.guides.some((g) => g.axis === "x" && g.at === 3000)).toBe(true);
  });

  it("leaves a position that is not near anything alone", () => {
    const c = chart();
    const snapped = snapToObjects(c.doc, new Set([c.moving]), { x: 7000, y: 5000 }, 120);
    expect(snapped.x).toBe(7000);
    expect(snapped.y).toBe(5000);
    expect(snapped.guides).toEqual([]);
  });

  it("snaps both axes independently", () => {
    const c = chart();
    const snapped = snapToObjects(c.doc, new Set([c.moving]), { x: 3030, y: 2030 }, 120);
    expect(snapped.x).toBe(3000);
    expect(snapped.y).toBe(2000);
    expect(snapped.guides).toHaveLength(2);
  });

  it("never snaps to a block that is itself being dragged", () => {
    // Otherwise a multi-block drag locks onto its own members and cannot be moved at all.
    const c = chart();
    const both = new Set([c.moving, c.anchor]);
    const snapped = snapToObjects(c.doc, both, { x: 3040, y: 5000 }, 120);
    expect(snapped.x).toBe(3040);
  });

  it("takes the NEAREST candidate when two are in range", () => {
    let d = emptyDocument();
    const a = addBlock(d, "stage", { x: 3000, y: 1000 });
    d = a.doc;
    // `addBlock` snaps to the 50-unit grid, so this block lands on 3100, not 3080.
    const b = addBlock(d, "stage", { x: 3080, y: 1500 });
    d = b.doc;
    const m = addBlock(d, "stage", { x: 6000, y: 5000 });
    expect(b.doc.blocks.find((x) => x.key === b.key)!.x).toBe(3100);

    // 3060 is 60 from 3000 and 40 from 3100: both inside the threshold, and the nearer one wins.
    const snapped = snapToObjects(m.doc, new Set([m.key]), { x: 3060, y: 5000 }, 120);
    expect(snapped.x).toBe(3100);
  });

  it("ignores hidden and locked blocks as anchors", () => {
    // A hidden block is not on screen to align against, and a locked one is usually scenery.
    const c = chart();
    const hidden = setHidden(c.doc, new Set([c.anchor]), true);
    expect(snapToObjects(hidden, new Set([c.moving]), { x: 3040, y: 5000 }, 120).x).toBe(3040);
  });

  it("does nothing when the threshold is zero", () => {
    const c = chart();
    const snapped = snapToObjects(c.doc, new Set([c.moving]), { x: 3040, y: 5000 }, 0);
    expect(snapped.x).toBe(3040);
    expect(snapped.guides).toEqual([]);
  });
});

// §6: a drawn outline has no honest resize box — `width`/`height` only approximate a polygon — so its
// size control scales the POINTS instead, uniformly, from the corner opposite the one being held.
describe("scaling a drawn outline from a corner", () => {
  // A 100x100 square with its top-left at the origin, so every expectation below is arithmetic.
  const square = () => [
    { x: 1000, y: 1000 },
    { x: 1100, y: 1000 },
    { x: 1100, y: 1100 },
    { x: 1000, y: 1100 },
  ];

  it("finds the true extent from the vertices", () => {
    expect(shapeBounds(square())).toEqual({ minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 });
    expect(shapeBounds([])).toBeNull();
  });

  it("doubles the outline when the corner is dragged to twice its diagonal", () => {
    const anchor = { x: 1000, y: 1000 };
    const held = { x: 1100, y: 1100 };
    const out = scaleShapePoints(square(), anchor, held, { x: 1200, y: 1200 });
    expect(out).toEqual([
      { x: 1000, y: 1000 },
      { x: 1200, y: 1000 },
      { x: 1200, y: 1200 },
      { x: 1000, y: 1200 },
    ]);
  });

  it("holds the anchor corner exactly still", () => {
    const anchor = { x: 1100, y: 1100 };
    const held = { x: 1000, y: 1000 };
    const out = scaleShapePoints(square(), anchor, held, { x: 500, y: 500 });
    // The dragged corner moves; the opposite one does not, or the shape slides while it scales.
    expect(out.some((p) => p.x === 1100 && p.y === 1100)).toBe(true);
  });

  it("stays uniform, so a shape keeps its proportions", () => {
    // A wide rectangle: 200 across, 50 tall. Any scale must preserve the 4:1 ratio.
    const wide = [
      { x: 1000, y: 1000 },
      { x: 1200, y: 1000 },
      { x: 1200, y: 1050 },
      { x: 1000, y: 1050 },
    ];
    const out = scaleShapePoints(
      wide,
      { x: 1000, y: 1000 },
      { x: 1200, y: 1050 },
      { x: 1600, y: 1300 },
    );
    const b = shapeBounds(out)!;
    // Not exact, and cannot be: every coordinate is rounded to a whole unit on the way out, because
    // `seats.pos_x`/`pos_y` are INT columns. Each axis rounds independently, so the ratio drifts by
    // up to half a unit per edge — a few tenths of a percent here. Uniform means uniform ON THE GRID
    // the coordinates actually live on, and a tolerance tight enough to forbid that would be
    // asserting against the storage model rather than against this function.
    expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(4, 1);
  });

  it("never mirrors the shape through the anchor", () => {
    // Dragging PAST the held corner and out the other side would give a negative factor, which reads
    // as the outline flipping inside out. Mirroring is `flipBlocks`, and it says so.
    const out = scaleShapePoints(
      square(),
      { x: 1000, y: 1000 },
      { x: 1100, y: 1100 },
      { x: 200, y: 200 },
    );
    const b = shapeBounds(out)!;
    expect(b.minX).toBeGreaterThanOrEqual(1000);
    expect(b.minY).toBeGreaterThanOrEqual(1000);
    expect(b.maxX).toBeGreaterThan(b.minX);
  });

  it("leaves a zero-extent outline alone rather than emitting NaN", () => {
    const dot = [{ x: 500, y: 500 }];
    const out = scaleShapePoints(dot, { x: 500, y: 500 }, { x: 500, y: 500 }, { x: 900, y: 900 });
    expect(out).toEqual(dot);
  });
});

// The other half of §25: the guide says "in line with", these say "this far from". Three blocks can
// be perfectly aligned and unevenly spaced, and that is the error the guides alone cannot show.
describe("measuring the gap along a guide", () => {
  /** Three stages on one vertical line at x=3000, at y = 1000, 4000 and (the dragged one) free. */
  const column = () => {
    let d = emptyDocument();
    const top = addBlock(d, "stage", { x: 3000, y: 1000 });
    d = top.doc;
    const bottom = addBlock(d, "stage", { x: 3000, y: 4000 });
    d = bottom.doc;
    const moving = addBlock(d, "stage", { x: 8000, y: 8000 });
    return { doc: moving.doc, moving: moving.key };
  };

  it("reports the gap to the neighbour on each side of the drag", () => {
    const c = column();
    const at = { x: 3000, y: 2500 };
    const marks = spacingMarks(c.doc, new Set([c.moving]), at, [{ axis: "x", at: 3000 }]);

    // Dead centre between them: 1500 each way, and both sides reported.
    expect(marks.map((m) => m.distance).sort((a, b) => a - b)).toEqual([1500, 1500]);
    expect(marks.every((m) => m.axis === "x" && m.at === 3000)).toBe(true);
  });

  it("takes the NEAREST block on a side, not every block on the line", () => {
    const c = column();
    // Just below the top block: 500 up to it, 3000 down to the bottom one.
    const marks = spacingMarks(c.doc, new Set([c.moving]), { x: 3000, y: 1500 }, [
      { axis: "x", at: 3000 },
    ]);
    expect(marks.map((m) => m.distance).sort((a, b) => a - b)).toEqual([500, 2500]);
  });

  it("reports one side only at the end of a line", () => {
    const c = column();
    // Above both anchors — nothing on the far side to measure to.
    const marks = spacingMarks(c.doc, new Set([c.moving]), { x: 3000, y: 200 }, [
      { axis: "x", at: 3000 },
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0].distance).toBe(800);
  });

  it("measures nothing without a guide to measure along", () => {
    const c = column();
    expect(spacingMarks(c.doc, new Set([c.moving]), { x: 3000, y: 2500 }, [])).toEqual([]);
  });

  it("never measures to a block being dragged, or to a hidden or locked one", () => {
    const c = column();
    const all = new Set(c.doc.blocks.map((b) => b.key));
    expect(spacingMarks(c.doc, all, { x: 3000, y: 2500 }, [{ axis: "x", at: 3000 }])).toEqual([]);

    const hidden = setHidden(
      c.doc,
      new Set(c.doc.blocks.filter((b) => b.key !== c.moving).map((b) => b.key)),
      true,
    );
    expect(
      spacingMarks(hidden, new Set([c.moving]), { x: 3000, y: 2500 }, [{ axis: "x", at: 3000 }]),
    ).toEqual([]);
  });
});

// §6: group and ungroup. Selecting one member selects the group, so a stage and its surround move as
// the one thing the organizer thinks of them as.
describe("grouping blocks", () => {
  const three = () => {
    let d = emptyDocument();
    const a = addBlock(d, "stage", { x: 1000, y: 1000 });
    d = a.doc;
    const b = addBlock(d, "aisle", { x: 2000, y: 1000 });
    d = b.doc;
    const c = addBlock(d, "bar", { x: 8000, y: 8000 });
    return { doc: c.doc, a: a.key, b: b.key, c: c.key };
  };
  const groupOf = (d: ReturnType<typeof emptyDocument>, key: string) =>
    d.blocks.find((x) => x.key === key)!.groupId;

  it("gives every member the same group id", () => {
    const t = three();
    const after = groupBlocks(t.doc, new Set([t.a, t.b]));
    expect(groupOf(after, t.a)).toBeTruthy();
    expect(groupOf(after, t.a)).toBe(groupOf(after, t.b));
    expect(groupOf(after, t.c)).toBeUndefined();
  });

  it("refuses to group fewer than two — a group of one is just a block", () => {
    const t = three();
    expect(groupBlocks(t.doc, new Set([t.a]))).toBe(t.doc);
  });

  it("gives a second group a different id", () => {
    const t = three();
    const one = groupBlocks(t.doc, new Set([t.a, t.b]));
    const d = addBlock(one, "door", { x: 5000, y: 5000 });
    const two = groupBlocks(d.doc, new Set([t.c, d.key]));
    expect(groupOf(two, t.c)).not.toBe(groupOf(two, t.a));
  });

  it("ungroups every member, not only the one clicked", () => {
    const t = three();
    const grouped = groupBlocks(t.doc, new Set([t.a, t.b]));
    const after = ungroupBlocks(grouped, new Set([t.a]));
    expect(groupOf(after, t.a)).toBeUndefined();
    expect(groupOf(after, t.b)).toBeUndefined();
  });

  it("expands a selection to whole groups", () => {
    // What makes a group feel like one object: clicking any member selects all of it.
    const t = three();
    const grouped = groupBlocks(t.doc, new Set([t.a, t.b]));
    expect(withGroups(grouped, new Set([t.a]))).toEqual(new Set([t.a, t.b]));
  });

  it("leaves an ungrouped selection exactly as it was", () => {
    const t = three();
    expect(withGroups(t.doc, new Set([t.c]))).toEqual(new Set([t.c]));
  });

  it("moves a group as one when any member is dragged", () => {
    const t = three();
    const grouped = groupBlocks(t.doc, new Set([t.a, t.b]));
    const moved = moveBlocks(grouped, withGroups(grouped, new Set([t.a])), 500, 0, false);
    expect(moved.blocks.find((x) => x.key === t.a)!.x).toBe(1500);
    expect(moved.blocks.find((x) => x.key === t.b)!.x).toBe(2500);
  });
});

// §6: resize handles. Dragging a corner is how every visual editor sizes an object; the inspector's
// number fields are the precise route, not the only one.
describe("resizing by a handle", () => {
  const box = { x: 5000, y: 5000, width: 1000, height: 600 };

  it("drags the right edge without moving the left one", () => {
    const after = resizedBox(box, "e", 200, 0);
    expect(after.width).toBe(1200);
    expect(after.height).toBe(600);
    // The centre shifts by half the growth, which is what keeps the left edge still.
    expect(after.x).toBe(5100);
    expect(after.y).toBe(5000);
  });

  it("drags the left edge without moving the right one", () => {
    const after = resizedBox(box, "w", -200, 0);
    expect(after.width).toBe(1200);
    expect(after.x).toBe(4900);
  });

  it("drags a corner on both axes at once", () => {
    const after = resizedBox(box, "se", 200, 100);
    expect(after.width).toBe(1200);
    expect(after.height).toBe(700);
    expect(after.x).toBe(5100);
    expect(after.y).toBe(5050);
  });

  it("never inverts a block through zero", () => {
    // Dragging the right edge past the left would otherwise give a negative width, which renders as
    // nothing and saves as a CHECK violation.
    const after = resizedBox(box, "e", -5000, 0);
    expect(after.width).toBeGreaterThan(0);
  });

  it("keeps the far edge still even when it hits the minimum", () => {
    const after = resizedBox(box, "w", 5000, 0);
    expect(after.width).toBeGreaterThan(0);
    // Right edge was 5500 before and stays there.
    expect(after.x + after.width / 2).toBe(5500);
  });

  it("stays inside the map", () => {
    const edge = { x: 9800, y: 5000, width: 400, height: 400 };
    const after = resizedBox(edge, "e", 2000, 0);
    expect(after.x + after.width / 2).toBeLessThanOrEqual(LAYOUT_MAX);
  });

  it("does nothing on a zero drag", () => {
    expect(resizedBox(box, "se", 0, 0)).toEqual(box);
  });
});

// The precondition for a safe autosave (§29): a document whose every id is already real.
describe("telling a saved document from one holding placeholders", () => {
  it("sees the placeholders in a freshly drawn chart", () => {
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    d = addBlock(d, "seating-block", { x: 2000, y: 2000 }, { sectionId: sec.id }).doc;
    expect(hasPlaceholderIds(d)).toBe(true);
  });

  it("sees none once every id is real", () => {
    // What a document looks like after a save: the server has stitched its own ids in.
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    d = addBlock(d, "seating-block", { x: 2000, y: 2000 }, { sectionId: sec.id }).doc;
    const saved: ReturnType<typeof emptyDocument> = {
      ...d,
      sections: d.sections.map((s, i) => ({ ...s, id: 100 + i })),
      categories: d.categories.map((c, i) => ({ ...c, id: 200 + i })),
      rows: (d.rows ?? []).map((r, i) => ({ ...r, id: 300 + i, sectionId: 100 })),
      blocks: d.blocks.map((b) => ({
        ...b,
        sectionId: b.sectionId === null ? null : 100,
        categoryId: b.categoryId === null ? null : 200,
        seats: b.seats?.map((s, i) => ({ ...s, seatId: 1000 + i, rowId: 300 })),
      })),
    };
    expect(hasPlaceholderIds(saved)).toBe(false);
  });

  it("catches a single new block added to an otherwise saved chart", () => {
    // The case that matters: one new block is enough to make a quiet save unsafe, because the server
    // will hand back ids the editor must take.
    let d = emptyDocument();
    d = { ...d, sections: [{ id: 100, name: "Khu A" }] };
    const made = addBlock(d, "stage", { x: 2000, y: 2000 }, { sectionId: 100 });
    expect(hasPlaceholderIds(made.doc)).toBe(false); // a stage has no seats to mint

    const seated = addBlock(made.doc, "single-row", { x: 4000, y: 2000 }, { sectionId: 100 });
    expect(hasPlaceholderIds(seated.doc)).toBe(true);
  });

  it("treats an empty chart as having nothing to stitch", () => {
    expect(hasPlaceholderIds(emptyDocument())).toBe(false);
  });
});

// Dragging a handle to rotate: the angle from the block's centre to the pointer.
describe("rotating by dragging a handle", () => {
  const centre = { x: 5000, y: 5000 };

  it("reads 0° when the pointer is straight above the centre", () => {
    // The handle starts above the block, so "no rotation" must be straight up — not to the right,
    // which is where atan2's zero actually is.
    expect(angleFromPointer(centre, { x: 5000, y: 3000 })).toBe(0);
  });

  it("reads 90° to the right, 180° below, 270° to the left", () => {
    expect(angleFromPointer(centre, { x: 7000, y: 5000 })).toBe(90);
    expect(angleFromPointer(centre, { x: 5000, y: 7000 })).toBe(180);
    expect(angleFromPointer(centre, { x: 3000, y: 5000 })).toBe(270);
  });

  it("reads the diagonals", () => {
    expect(angleFromPointer(centre, { x: 6000, y: 4000 })).toBe(45);
    expect(angleFromPointer(centre, { x: 4000, y: 6000 })).toBe(225);
  });

  it("stays in 0–359, never negative", () => {
    // `seats.rotation` has a CHECK of 0..359, so a negative angle is a refused save.
    for (const p of [
      { x: 4999, y: 3000 },
      { x: 3000, y: 4999 },
      { x: 4000, y: 4000 },
    ]) {
      const a = angleFromPointer(centre, p);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(359);
    }
  });

  it("snaps to 15° steps when asked, for a deliberate right angle", () => {
    expect(angleFromPointer(centre, { x: 6000, y: 3900 }, 15)).toBe(45);
    expect(angleFromPointer(centre, { x: 7000, y: 4900 }, 15)).toBe(90);
  });

  it("holds still when the pointer is on the centre — no angle to read", () => {
    expect(angleFromPointer(centre, centre)).toBe(0);
  });
});

describe("setting a rotation outright", () => {
  const chart = () => {
    const made = addBlock(emptyDocument(), "stage", { x: 3000, y: 3000 });
    return { doc: made.doc, key: made.key };
  };

  it("sets the angle rather than adding to it", () => {
    const c = chart();
    const once = setRotation(c.doc, new Set([c.key]), 40);
    expect(setRotation(once, new Set([c.key]), 40).blocks[0].rotation).toBe(40);
  });

  it("normalises anything out of range", () => {
    const c = chart();
    expect(setRotation(c.doc, new Set([c.key]), 370).blocks[0].rotation).toBe(10);
    expect(setRotation(c.doc, new Set([c.key]), -30).blocks[0].rotation).toBe(330);
  });

  it("leaves a locked block alone", () => {
    const c = chart();
    const locked = setLocked(c.doc, new Set([c.key]), true);
    expect(setRotation(locked, new Set([c.key]), 90).blocks[0].rotation).toBe(0);
  });

  it("moves no seat — a rotation is the block's angle, not new offsets", () => {
    const made = addBlock(emptyDocument(), "seating-block", { x: 3000, y: 3000 });
    const after = setRotation(made.doc, new Set([made.key]), 37);
    expect(after.blocks[0].seats!.map((s) => `${s.dx},${s.dy}`)).toEqual(
      made.doc.blocks[0].seats!.map((s) => `${s.dx},${s.dy}`),
    );
  });
});

// A new block used to be filed into `sections[0]` whenever nothing said otherwise — so a row the
// organizer thought was separate silently joined the first section and continued ITS lettering.
describe("where a new block goes when nothing says", () => {
  const twoSections = () => {
    let d = emptyDocument();
    const a = addSection(d, "Khu A");
    d = a.doc;
    const b = addSection(d, "Khu B");
    return { doc: b.doc, a: a.id, b: b.id };
  };

  it("uses the only section there is — with one, there is no ambiguity to protect against", () => {
    const only = addSection(emptyDocument(), "Khu A");
    expect(
      nextBlockContext(only.doc, new Set(), { sectionId: undefined, categoryId: undefined })
        .sectionId,
    ).toBe(only.id);
  });

  it("picks NO section when there are several and nothing states which", () => {
    // Guessing "the first one" is how a row ends up lettered F in a section the organizer never chose.
    // Unassigned is honest: the publish gate names it, and assigning it letters it properly.
    const c = twoSections();
    expect(
      nextBlockContext(c.doc, new Set(), { sectionId: undefined, categoryId: undefined }).sectionId,
    ).toBeNull();
  });

  it("still inherits from the selected block, which IS a statement", () => {
    const c = twoSections();
    const made = addBlock(c.doc, "seating-block", { x: 1000, y: 1000 }, { sectionId: c.b });
    expect(
      nextBlockContext(made.doc, new Set([made.key]), {
        sectionId: undefined,
        categoryId: undefined,
      }).sectionId,
    ).toBe(c.b);
  });

  it("still honours an explicit pin", () => {
    const c = twoSections();
    expect(
      nextBlockContext(c.doc, new Set(), { sectionId: c.b, categoryId: undefined }).sectionId,
    ).toBe(c.b);
  });

  it("letters a new row from A rather than continuing another section's sequence", () => {
    // The reported symptom, end to end.
    const c = twoSections();
    const inA = addBlock(c.doc, "seating-block", { x: 1000, y: 1000 }, { sectionId: c.a });
    const ctx = nextBlockContext(inA.doc, new Set(), {
      sectionId: undefined,
      categoryId: undefined,
    });
    const next = addBlock(inA.doc, "single-row", { x: 5000, y: 1000 }, ctx);
    const labels = [
      ...new Set(next.doc.blocks.find((b) => b.key === next.key)!.seats!.map((s) => s.rowLabel)),
    ];
    expect(labels).toEqual(["A"]);
  });
});
