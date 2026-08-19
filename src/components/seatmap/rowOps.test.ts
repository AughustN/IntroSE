import { describe, expect, it } from "vitest";
import { emptyDocument } from "@/shared/catalog/seatmap-document";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import { addBlock, addSection, setLocked } from "./documentOps";
import { deleteRow, duplicateRow, moveRow, renameRow, reverseRow, rowLabelsOf } from "./rowOps";

// §9: every section manages its rows independently, and deleting one must not renumber the others.
const chart = () => {
  let d = emptyDocument();
  const sec = addSection(d, "Khu A");
  d = sec.doc;
  const made = addBlock(d, "seating-block", { x: 2000, y: 2000 }, { sectionId: sec.id });
  // Give the rows ids, as a save would have.
  const labels = ["A", "B", "C", "D", "E"];
  const doc = {
    ...made.doc,
    rows: labels.map((label, i) => ({ id: 200 + i, label, sectionId: sec.id, displayOrder: i })),
    blocks: made.doc.blocks.map((b) => ({
      ...b,
      seats: b.seats?.map((s) => ({ ...s, rowId: 200 + labels.indexOf(s.rowLabel) })),
    })),
  };
  return { doc, key: made.key, sec: sec.id };
};
const block = (d: ReturnType<typeof emptyDocument>, key: string) => d.blocks.find((b) => b.key === key)!;
const seatsOf = (d: ReturnType<typeof emptyDocument>, key: string) => block(d, key).seats!;

describe("renaming a row", () => {
  it("renames the row and every seat in it", () => {
    const c = chart();
    const after = renameRow(c.doc, 202, "K");
    expect(after.rows?.find((r) => r.id === 202)?.label).toBe("K");
    expect(seatsOf(after, c.key).filter((s) => s.rowId === 202).every((s) => s.rowLabel === "K")).toBe(true);
  });

  it("leaves the rows around it exactly as they were", () => {
    const c = chart();
    const after = renameRow(c.doc, 202, "K");
    expect(rowLabelsOf(block(after, c.key))).toEqual(["A", "B", "K", "D", "E"]);
  });

  it("keeps every seat id", () => {
    const c = chart();
    const before = seatsOf(c.doc, c.key).map((s) => s.seatId);
    expect(seatsOf(renameRow(c.doc, 202, "K"), c.key).map((s) => s.seatId)).toEqual(before);
  });

  it("refuses an empty name rather than making a row with no label", () => {
    const c = chart();
    expect(renameRow(c.doc, 202, "   ")).toBe(c.doc);
  });
});

describe("reversing a row", () => {
  it("flips the numbering without moving a seat", () => {
    const c = chart();
    const after = reverseRow(c.doc, { blockKey: c.key, label: "A" });
    const rowA = seatsOf(after, c.key).filter((s) => s.rowLabel === "A");
    expect(rowA.map((s) => s.seatNumber)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(rowA.map((s) => s.dx)).toEqual(seatsOf(c.doc, c.key).filter((s) => s.rowLabel === "A").map((s) => s.dx));
  });

  it("keeps each seat's id where the seat physically is", () => {
    // The safety property: the seat nearest the aisle keeps its id and simply gets a new number, so a
    // showtime's snapshot still describes the same physical seat.
    const c = chart();
    const before = seatsOf(c.doc, c.key).filter((s) => s.rowLabel === "A").map((s) => s.seatId);
    const after = seatsOf(reverseRow(c.doc, { blockKey: c.key, label: "A" }), c.key)
      .filter((s) => s.rowLabel === "A")
      .map((s) => s.seatId);
    expect(after).toEqual(before);
  });

  it("touches no other row", () => {
    const c = chart();
    const after = reverseRow(c.doc, { blockKey: c.key, label: "A" });
    const rowB = seatsOf(after, c.key).filter((s) => s.rowLabel === "B");
    expect(rowB.map((s) => s.seatNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("deleting a row", () => {
  it("leaves the survivors' labels alone — A, C, D, not A, B, C", () => {
    // §9 states this outright, and it is the one the specification calls out as most often got wrong.
    const c = chart();
    const after = deleteRow(c.doc, { blockKey: c.key, label: "B" });
    expect(rowLabelsOf(block(after, c.key))).toEqual(["A", "C", "D", "E"]);
  });

  it("drops the row object with it", () => {
    const c = chart();
    const after = deleteRow(c.doc, { blockKey: c.key, label: "B" });
    expect(after.rows?.some((r) => r.id === 201)).toBe(false);
    expect(after.rows).toHaveLength(4);
  });

  it("keeps every remaining seat's id", () => {
    const c = chart();
    const before = seatsOf(c.doc, c.key).filter((s) => s.rowLabel !== "B").map((s) => s.seatId);
    expect(seatsOf(deleteRow(c.doc, { blockKey: c.key, label: "B" }), c.key).map((s) => s.seatId)).toEqual(before);
  });

  it("stops the block claiming to be a generated sequence it no longer is", () => {
    // A, C, D, E cannot be produced by "5 rows lettered A-ascending", so keeping the parameters would
    // mean the next regeneration silently recreated row B.
    const c = chart();
    expect(block(deleteRow(c.doc, { blockKey: c.key, label: "B" }), c.key).params).toBeUndefined();
  });

  it("keeps the sequence when the LAST row goes — that is still a sequence", () => {
    const c = chart();
    const after = deleteRow(c.doc, { blockKey: c.key, label: "E" });
    expect(block(after, c.key).params?.rowsCount).toBe(4);
    expect(rowLabelsOf(block(after, c.key))).toEqual(["A", "B", "C", "D"]);
  });

  it("does not re-letter the OTHER blocks in the section", () => {
    // The stronger form of the rule above. Deleting a row from one block leaves a gap in the
    // section's lettering, and §9/§42 Rule 2 say that gap stays until the organizer asks for it to be
    // closed — a neighbouring block must not slide down to fill it.
    let d = emptyDocument();
    const sec = addSection(d, "Khu A");
    d = sec.doc;
    const first = addBlock(d, "seating-block", { x: 1000, y: 1000 }, { sectionId: sec.id });
    d = first.doc;
    const second = addBlock(d, "seating-block", { x: 5000, y: 1000 }, { sectionId: sec.id });
    const before = rowLabelsOf(block(second.doc, second.key));
    expect(before).toEqual(["F", "G", "H", "I", "J"]);

    const after = deleteRow(second.doc, { blockKey: first.key, label: "B" });
    expect(rowLabelsOf(block(after, second.key))).toEqual(before);
  });

  it("leaves a locked block alone", () => {
    const c = chart();
    const locked = setLocked(c.doc, new Set([c.key]), true);
    expect(rowLabelsOf(block(deleteRow(locked, { blockKey: c.key, label: "B" }), c.key))).toHaveLength(5);
  });
});

describe("duplicating a row", () => {
  it("copies the seats with FRESH ids", () => {
    const c = chart();
    const after = duplicateRow(c.doc, { blockKey: c.key, label: "A" });
    const originals = new Set(seatsOf(c.doc, c.key).map((s) => s.seatId));
    const copies = seatsOf(after, c.key).filter((s) => !originals.has(s.seatId));
    expect(copies).toHaveLength(10);
    expect(copies.every((s) => !originals.has(s.seatId))).toBe(true);
  });

  it("gives the copy a label that is free, so the chart still saves", () => {
    const c = chart();
    const after = duplicateRow(c.doc, { blockKey: c.key, label: "A" });
    const labels = rowLabelsOf(block(after, c.key));
    expect(new Set(labels).size).toBe(labels.length);
    const p = projectDocument(after);
    const keys = p.seats.map((s) => `${s.sectionId}|${s.rowLabel}|${s.seatNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("terminates on a row whose label is already at the length limit", () => {
    // `row_label` is capped at 8 characters. The old candidate was `${label}${n}`.slice(0, 8), which
    // for an 8-character source sliced the counter back off — every attempt produced the source
    // label again, `used` always had it, and the loop never ended. This case hung the tab.
    const c = chart();
    const renamed = {
      ...c.doc,
      blocks: c.doc.blocks.map((b) =>
        b.key === c.key
          ? { ...b, seats: b.seats?.map((s) => (s.rowLabel === "A" ? { ...s, rowLabel: "GHEA1234" } : s)) }
          : b,
      ),
    };

    const after = duplicateRow(renamed, { blockKey: c.key, label: "GHEA1234" });

    const labels = rowLabelsOf(block(after, c.key));
    expect(new Set(labels).size).toBe(labels.length);
    // The copy exists, is not the source label, and still fits the column.
    const copy = labels.find((l) => l !== "GHEA1234" && !["B", "C", "D", "E"].includes(l));
    expect(copy).toBeDefined();
    expect(copy!.length).toBeLessThanOrEqual(8);
  });

  it("puts the copy beside the original, not on top of it", () => {
    const c = chart();
    const after = duplicateRow(c.doc, { blockKey: c.key, label: "A" });
    const originalY = seatsOf(c.doc, c.key).find((s) => s.rowLabel === "A")!.dy;
    const copy = seatsOf(after, c.key).find((s) => s.rowLabel !== "A" && s.seatNumber === 1 && s.dy !== originalY);
    expect(copy).toBeDefined();
  });

  it("gives the copy no row id — it is a new row until a save names it", () => {
    const c = chart();
    const after = duplicateRow(c.doc, { blockKey: c.key, label: "A" });
    const originals = new Set(seatsOf(c.doc, c.key).map((s) => s.seatId));
    expect(seatsOf(after, c.key).filter((s) => !originals.has(s.seatId)).every((s) => s.rowId == null)).toBe(true);
  });
});

describe("reordering a row", () => {
  it("moves it in the list", () => {
    const c = chart();
    const after = moveRow(c.doc, 204, 0);
    const order = [...(after.rows ?? [])].sort((a, b) => a.displayOrder - b.displayOrder).map((r) => r.label);
    expect(order).toEqual(["E", "A", "B", "C", "D"]);
  });

  it("changes displayOrder and NOTHING else (§45)", () => {
    const c = chart();
    const after = moveRow(c.doc, 204, 0);
    expect(after.rows?.map((r) => r.id).sort()).toEqual([200, 201, 202, 203, 204]);
    expect(after.rows?.find((r) => r.id === 204)?.label).toBe("E");
    // No seat is touched at all.
    expect(seatsOf(after, c.key)).toEqual(seatsOf(c.doc, c.key));
  });
});
