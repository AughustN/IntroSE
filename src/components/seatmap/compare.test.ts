import { describe, expect, it } from "vitest";
import { emptyDocument } from "@/shared/catalog/seatmap-document";
import { addBlock, addSection, moveBlocks, removeBlocks, rotateBlocks, updateBlock } from "./documentOps";
import { compareDocuments } from "./compare";

const chart = () => {
  let d = emptyDocument();
  const sec = addSection(d, "Khu A");
  d = sec.doc;
  const a = addBlock(d, "seating-block", { x: 2000, y: 2000 }, { sectionId: sec.id });
  d = a.doc;
  const b = addBlock(d, "stage", { x: 5000, y: 500 });
  return { doc: b.doc, sec: sec.id, a: a.key, b: b.key };
};

describe("comparing two versions of a chart", () => {
  it("reports no change between a document and itself", () => {
    const c = chart();
    const diff = compareDocuments(c.doc, c.doc);
    expect(diff.identical).toBe(true);
    expect(diff.seatDelta).toBe(0);
  });

  it("names a block that was added", () => {
    const c = chart();
    const after = addBlock(c.doc, "bar", { x: 8000, y: 8000 });
    const diff = compareDocuments(c.doc, after.doc);
    expect(diff.added.map((x) => x.title)).toEqual(["Quầy"]);
    expect(diff.removed).toEqual([]);
    expect(diff.identical).toBe(false);
  });

  it("names a block that was removed, and the seats with it", () => {
    const c = chart();
    const after = removeBlocks(c.doc, new Set([c.a]));
    const diff = compareDocuments(c.doc, after);
    expect(diff.removed.map((x) => x.title)).toEqual(["Khối ghế"]);
    expect(diff.seatDelta).toBe(-50);
  });

  it("reads a MOVE as a move, not as a delete plus an add", () => {
    // Blocks are matched by key, which survives a save — so the diff says what a person would say.
    const c = chart();
    const after = moveBlocks(c.doc, new Set([c.a]), 1000, 0, false);
    const diff = compareDocuments(c.doc, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes).toEqual(["moved"]);
  });

  it("reports a rotation", () => {
    const c = chart();
    const diff = compareDocuments(c.doc, rotateBlocks(c.doc, new Set([c.b]), 90));
    expect(diff.changed[0].changes).toEqual(["rotated"]);
  });

  it("reports a rename", () => {
    const c = chart();
    const diff = compareDocuments(c.doc, updateBlock(c.doc, c.a, { title: "Khán đài B" }));
    expect(diff.changed[0].changes).toEqual(["renamed"]);
    expect(diff.changed[0].title).toBe("Khán đài B");
  });

  it("lists several changes to one block in one entry", () => {
    const c = chart();
    const moved = moveBlocks(c.doc, new Set([c.a]), 500, 0, false);
    const after = updateBlock(moved, c.a, { title: "Khán đài B", rotation: 45 });
    const diff = compareDocuments(c.doc, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes).toEqual(["moved", "rotated", "renamed"]);
  });

  it("names sections that came and went", () => {
    const c = chart();
    const added = addSection(c.doc, "Khu B");
    const diff = compareDocuments(c.doc, added.doc);
    expect(diff.sectionsAdded).toEqual(["Khu B"]);
    expect(diff.sectionsRemoved).toEqual([]);
  });

  it("reports a seat-count change on a block whose shape changed", () => {
    const c = chart();
    const block = c.doc.blocks.find((b) => b.key === c.a)!;
    const after = updateBlock(c.doc, c.a, { seats: block.seats!.slice(0, 10) });
    const diff = compareDocuments(c.doc, after);
    expect(diff.changed[0].changes).toContain("recounted");
    expect(diff.seatDelta).toBe(-40);
  });
});
