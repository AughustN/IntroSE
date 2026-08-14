import { describe, expect, it } from "vitest";
import type { LayoutSeat } from "@/shared/catalog/seatmap";
import {
  GRID,
  MAX_PER_ROW,
  MAX_ROWS,
  type SeatFactory,
  alignSeats,
  arcSeats,
  copySeats,
  distributeSeats,
  duplicateSeats,
  makeArc,
  makeGrid,
  makeRow,
  mintId,
  mirrorSeats,
  moveSeats,
  nextRowLabel,
  pasteSeats,
  renumberSeats,
  rotateSeats,
  seatsInRect,
  snap,
} from "./layoutOps";
import { LAYOUT_MAX_SEATS, validateLayout } from "@/shared/catalog/seatmap-validate";

// The editor's geometry, tested where it lives. Every assertion below is either a database CHECK
// (`pos_x`/`pos_y` 0–10000, `rotation` 0–359) or a publish-gate rule (`duplicate_label`) — so a red
// test here is a bug the organizer would have hit as a refused save or a blocked "Phát hành".

const f = (over: Partial<SeatFactory> = {}): SeatFactory => ({
  sectionId: 1,
  categoryId: 1,
  seatType: "single",
  pitch: 150,
  startNumber: 1,
  rowLabel: "A",
  ...over,
});

/** The label the publish gate keys on. */
const labelOf = (s: LayoutSeat) => `${s.sectionId ?? "none"}|${s.rowLabel}|${s.seatNumber}`;

function expectNoDuplicateLabels(seats: LayoutSeat[]) {
  const seen = new Map<string, number>();
  for (const s of seats) seen.set(labelOf(s), (seen.get(labelOf(s)) ?? 0) + 1);
  expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
}

function expectStorable(seats: LayoutSeat[]) {
  for (const s of seats) {
    expect(Number.isInteger(s.x) && s.x >= 0 && s.x <= 10000).toBe(true);
    expect(Number.isInteger(s.y) && s.y >= 0 && s.y <= 10000).toBe(true);
    expect(Number.isInteger(s.rotation) && s.rotation >= 0 && s.rotation <= 359).toBe(true);
    expect(Number.isInteger(s.seatNumber) && s.seatNumber >= 1).toBe(true);
    expect(s.rowLabel.length).toBeGreaterThan(0);
    expect(s.rowLabel.length).toBeLessThanOrEqual(8);
  }
}

const row = (count = 6) =>
  makeRow({ x: 1000, y: 1000 }, { x: 1000 + (count - 1) * 150, y: 1000 }, f(), false);
const allIds = (seats: LayoutSeat[]) => new Set(seats.map((s) => s.id as number));

describe("duplicating and pasting never collides with the labels already on the map", () => {
  it("gives a duplicated row a FRESH row letter, so the copy is publishable", () => {
    const original = row(6);
    const { seats, newIds } = duplicateSeats(original, allIds(original), 300, 300);

    expect(seats).toHaveLength(12);
    expect(newIds.size).toBe(6);
    // The bug: copies kept "A1..A6", which is `duplicate_label` and blocks publishing outright.
    expectNoDuplicateLabels(seats);
    const copies = seats.filter((s) => newIds.has(s.id as number));
    expect(new Set(copies.map((s) => s.rowLabel))).toEqual(new Set(["B"]));
    // Seat numbers within the new row are preserved, so the copy reads like the row it came from.
    expect(copies.map((s) => s.seatNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps the relative shape when the selection spans several rows", () => {
    const block = makeGrid({ x1: 1000, y1: 1000, x2: 1450, y2: 1300 }, f(), false);
    const rowsBefore = new Set(block.map((s) => s.rowLabel));
    expect(rowsBefore.size).toBeGreaterThan(1);

    const { seats, newIds } = duplicateSeats(block, allIds(block), 2000, 0);
    expectNoDuplicateLabels(seats);
    const copies = seats.filter((s) => newIds.has(s.id as number));
    // One fresh letter per source row — the block stays a block rather than collapsing into one row.
    expect(new Set(copies.map((s) => s.rowLabel)).size).toBe(rowsBefore.size);
  });

  it("relabels a paste against the seats present at paste time", () => {
    const original = row(4);
    const clip = copySeats(original, allIds(original));
    expect(clip).not.toBeNull();

    const once = pasteSeats(original, clip!, 5000, 5000);
    expectNoDuplicateLabels(once.seats);
    // Pasting the SAME clipboard twice must not collide with the first paste either.
    const twice = pasteSeats(once.seats, clip!, 7000, 7000);
    expectNoDuplicateLabels(twice.seats);
    expect(twice.seats).toHaveLength(12);
  });

  it("pastes with the block's top-left at the requested point", () => {
    const original = row(4);
    const clip = copySeats(original, allIds(original))!;
    const { seats, newIds } = pasteSeats(original, clip, 4000, 6000);
    const copies = seats.filter((s) => newIds.has(s.id as number));
    expect(Math.min(...copies.map((s) => s.x))).toBe(4000);
    expect(Math.min(...copies.map((s) => s.y))).toBe(6000);
  });
});

describe("a single drawing gesture can never exceed the layout's seat ceiling", () => {
  it("clips a full-canvas grid drag to the remaining budget", () => {
    const huge = makeGrid({ x1: 0, y1: 0, x2: 10000, y2: 10000 }, f({ pitch: 110 }), false);
    // The bug: 8464 seats from one drag, which the server then refuses with 409 seat_limit_reached —
    // losing the entire gesture at save time rather than at draw time.
    expect(huge.length).toBeLessThanOrEqual(LAYOUT_MAX_SEATS);
    expectStorable(huge);
  });

  it("honours a smaller budget when the layout is already partly full", () => {
    const budget = 25;
    const seats = makeGrid({ x1: 0, y1: 0, x2: 10000, y2: 10000 }, f({ pitch: 110, budget }), false);
    expect(seats).toHaveLength(budget);
    expectNoDuplicateLabels(seats);
  });

  it("still caps a single row and the row count", () => {
    const long = makeRow({ x: 0, y: 5000 }, { x: 10000, y: 5000 }, f({ pitch: 1 }), false);
    expect(long.length).toBeLessThanOrEqual(MAX_PER_ROW);
    const tall = makeGrid({ x1: 0, y1: 0, x2: 200, y2: 10000 }, f({ pitch: 1 }), false);
    expect(new Set(tall.map((s) => s.rowLabel)).size).toBeLessThanOrEqual(MAX_ROWS);
  });
});

describe("every op keeps seats storable and uniquely labelled", () => {
  // A seeded sweep, so a failure is reproducible rather than a flake.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pt = () => ({ x: ri(0, 10000), y: ri(0, 10000) });

  it("survives 300 randomised rounds of every operation", () => {
    for (let i = 0; i < 300; i++) {
      const grid = rnd() < 0.5;
      const a = pt();
      const b = pt();
      const bow = ri(-1200, 1200);
      const fac = f({ pitch: ri(110, 400), startNumber: ri(1, 5) });

      for (const [name, made] of [
        ["makeRow", makeRow(a, b, fac, grid)],
        ["makeGrid", makeGrid({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, fac, grid)],
        ["makeArc", makeArc(a, b, bow, fac, grid)],
      ] as const) {
        expectStorable(made);
        expectNoDuplicateLabels(made);
        expect(made.length, name).toBeLessThanOrEqual(LAYOUT_MAX_SEATS);
      }

      const base = makeRow(a, b, fac, grid);
      if (base.length < 2) continue;
      const ids = allIds(base);

      expectStorable(moveSeats(base, ids, ri(-12000, 12000), ri(-12000, 12000), grid));
      for (const edge of ["left", "right", "top", "bottom", "centerX", "centerY"] as const) {
        expectStorable(alignSeats(base, ids, edge));
      }
      expectStorable(distributeSeats(base, ids));
      expectStorable(rotateSeats(base, ids, ri(-2000, 2000)));
      expectStorable(arcSeats(base, ids, bow));
      expectStorable(mirrorSeats(base, ids));

      const dup = duplicateSeats(base, ids, ri(-12000, 12000), ri(-12000, 12000));
      expectStorable(dup.seats);
      expectNoDuplicateLabels(dup.seats);

      const clip = copySeats(base, ids);
      if (clip) {
        const target = pt();
        const pasted = pasteSeats(base, clip, target.x, target.y);
        expectStorable(pasted.seats);
        expectNoDuplicateLabels(pasted.seats);
      }
    }
  });
});

describe("supporting contracts the editor leans on", () => {
  it("nextRowLabel never returns a letter already used in that section", () => {
    let seats = row(4);
    for (let k = 0; k < 30; k++) {
      const label = nextRowLabel(seats, 1);
      expect(seats.some((s) => s.sectionId === 1 && s.rowLabel === label)).toBe(false);
      seats = [...seats, ...makeRow({ x: 500, y: 600 + k * 20 }, { x: 2000, y: 600 + k * 20 }, f({ rowLabel: label }), false)];
    }
  });

  it("mintId hands out unique negative ids", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const id = mintId();
      expect(id).toBeLessThan(0);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("snap returns an integer, and lands on the grid when enabled", () => {
    for (const v of [-4999.7, 0.4, 37.5, 1249.9, 9999.6]) {
      expect(Number.isInteger(snap(v, false))).toBe(true);
      expect(Math.abs(snap(v, true) % GRID)).toBe(0);
    }
  });

  it("seatsInRect selects exactly the seats whose centre is inside", () => {
    const seats = makeGrid({ x1: 1000, y1: 1000, x2: 4000, y2: 4000 }, f(), false);
    const rect = { x1: 1000, y1: 1000, x2: 2500, y2: 2500 };
    const hit = new Set(seatsInRect(seats, rect));
    for (const s of seats) {
      const inside = s.x >= 1000 && s.x <= 2500 && s.y >= 1000 && s.y <= 2500;
      expect(hit.has(s.id as number)).toBe(inside);
    }
  });

  it("lets an explicit renumber collide, and leaves the validator to say so", () => {
    // Deliberately NOT auto-corrected. The organizer typed the start number; quietly shifting it to
    // avoid a clash would hand them numbering they did not ask for. A draft is allowed to be
    // transiently invalid (FR-032) — the publish gate is what must catch it, so assert that it does.
    const ten = row(10);
    const tail = new Set(ten.slice(5).map((s) => s.id as number));
    const after = renumberSeats(ten, tail, { startNumber: 1, reverse: false });

    const issues = validateLayout({
      seats: after.map((s) => ({
        id: s.id as number,
        sectionId: s.sectionId,
        categoryId: s.categoryId,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        x: s.x,
        y: s.y,
      })),
      sections: [{ id: 1, name: "Khu A" }],
      categories: [{ id: 1, name: "VIP" }],
    });
    expect(issues.some((i) => i.code === "duplicate_label")).toBe(true);
  });
});
