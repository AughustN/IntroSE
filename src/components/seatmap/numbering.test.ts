import { describe, expect, it } from "vitest";
import { emptyDocument } from "@/shared/catalog/seatmap-document";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import { addBlock, addSection, setLocked } from "./documentOps";
import { applyNumbering, numberRows, numberSeats, renumberSection } from "./numbering";

// §13/§14/§15: numbering is a named operation, and it moves LABELS without disturbing seats.
const chart = () => {
  let d = emptyDocument();
  const sec = addSection(d, "Khu A");
  d = sec.doc;
  const made = addBlock(d, "seating-block", { x: 2000, y: 2000 }, { sectionId: sec.id });
  return { doc: made.doc, key: made.key, sec: sec.id };
};
const seatsOf = (d: ReturnType<typeof emptyDocument>, key: string) =>
  d.blocks.find((b) => b.key === key)!.seats!;

describe("numbering seats", () => {
  it("produces the specification's stepped row: 1 3 5 7 9", () => {
    const c = chart();
    const after = numberSeats(c.doc, new Set([c.key]), { seatNumberStep: 2 });
    const rowA = seatsOf(after, c.key).filter((s) => s.rowLabel === "A");
    expect(rowA.map((s) => s.seatNumber).slice(0, 5)).toEqual([1, 3, 5, 7, 9]);
  });

  it("KEEPS every seat id while the numbers change", () => {
    // The property the whole module rests on. Through `regenerateBlock` — which matches on
    // `rowLabel|seatNumber` — every id here would be freshly minted and the originals deleted.
    const c = chart();
    const before = seatsOf(c.doc, c.key).map((s) => s.seatId);
    const after = numberSeats(c.doc, new Set([c.key]), { seatNumberStep: 3, startSeatNumber: 5 });
    expect(seatsOf(after, c.key).map((s) => s.seatId)).toEqual(before);
  });

  it("moves no seat and adds none", () => {
    const c = chart();
    const before = seatsOf(c.doc, c.key);
    const after = seatsOf(numberSeats(c.doc, new Set([c.key]), { seatNumberStep: 2 }), c.key);
    expect(after).toHaveLength(before.length);
    expect(after.map((s) => `${s.dx},${s.dy}`)).toEqual(before.map((s) => `${s.dx},${s.dy}`));
  });

  it("reverses a row without renumbering it into a different set", () => {
    const c = chart();
    const after = numberSeats(c.doc, new Set([c.key]), { seatLabelScheme: "num-desc" });
    const rowA = seatsOf(after, c.key).filter((s) => s.rowLabel === "A");
    expect(rowA.map((s) => s.seatNumber)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe("numbering rows", () => {
  it("produces the specification's prefixed rows: Row-A, Row-B, Row-C", () => {
    const c = chart();
    const after = numberRows(c.doc, new Set([c.key]), { rowLabelPrefix: "Row-" });
    expect([...new Set(seatsOf(after, c.key).map((s) => s.rowLabel))].slice(0, 3)).toEqual([
      "Row-A",
      "Row-B",
      "Row-C",
    ]);
  });

  it("switches a block to numeric rows", () => {
    const c = chart();
    const after = numberRows(c.doc, new Set([c.key]), { rowLabelScheme: "num-asc" });
    expect([...new Set(seatsOf(after, c.key).map((s) => s.rowLabel))]).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("keeps every seat id through a row rename", () => {
    const c = chart();
    const before = seatsOf(c.doc, c.key).map((s) => s.seatId);
    const after = numberRows(c.doc, new Set([c.key]), { rowLabelScheme: "num-asc" });
    expect(seatsOf(after, c.key).map((s) => s.seatId)).toEqual(before);
  });

  it("leaves a locked block alone", () => {
    // Locked is the existing "do not touch this" signal — a block lettered to match the building.
    const c = chart();
    const locked = setLocked(c.doc, new Set([c.key]), true);
    const after = numberRows(locked, new Set([c.key]), { rowLabelPrefix: "Row-" });
    expect(seatsOf(after, c.key)[0].rowLabel).toBe("A");
  });

  it("still projects to uniquely-labelled seats", () => {
    const c = chart();
    const after = numberRows(c.doc, new Set([c.key]), { rowLabelPrefix: "R" });
    const p = projectDocument(after);
    const keys = p.seats.map((s) => `${s.sectionId}|${s.rowLabel}|${s.seatNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("renumbering a section on demand", () => {
  const two = () => {
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    const first = addBlock(d, "seating-block", { x: 1000, y: 1000 }, { sectionId: sec.id });
    d = first.doc;
    const second = addBlock(d, "seating-block", { x: 5000, y: 1000 }, { sectionId: sec.id });
    return { doc: second.doc, sec: sec.id, first: first.key, second: second.key };
  };

  it("closes the gap the explicit way", () => {
    const c = two();
    const gapped = { ...c.doc, blocks: c.doc.blocks.filter((b) => b.key !== c.first) };
    const after = renumberSection(gapped, c.sec);
    expect([...new Set(seatsOf(after, c.second).map((s) => s.rowLabel))]).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("touches only the section it was asked about", () => {
    const c = two();
    let d = c.doc;
    const other = addSection(d, "Khu B");
    d = other.doc;
    const inB = addBlock(d, "seating-block", { x: 8000, y: 1000 }, { sectionId: other.id });
    d = inB.doc;
    const gapped = { ...d, blocks: d.blocks.filter((b) => b.key !== c.first) };
    const after = renumberSection(gapped, c.sec);
    // Khu B was already A–E and must be untouched; Khu A's survivor has been pulled back.
    expect([...new Set(seatsOf(after, inB.key).map((s) => s.rowLabel))]).toEqual(["A", "B", "C", "D", "E"]);
    expect([...new Set(seatsOf(after, c.second).map((s) => s.rowLabel))]).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("keeps every seat id", () => {
    const c = two();
    const gapped = { ...c.doc, blocks: c.doc.blocks.filter((b) => b.key !== c.first) };
    const before = seatsOf(gapped, c.second).map((s) => s.seatId);
    expect(seatsOf(renumberSection(gapped, c.sec), c.second).map((s) => s.seatId)).toEqual(before);
  });
});

describe("applyNumbering on its own", () => {
  it("returns a non-parametric block untouched", () => {
    // An adopted chart carries literal labels and no description of how they were made; inventing one
    // to renumber from would rename rows nobody asked to change.
    const c = chart();
    const plain = { ...c.doc.blocks[0], params: undefined };
    expect(applyNumbering(plain, { rowLabelPrefix: "X" })).toBe(plain);
  });
});
