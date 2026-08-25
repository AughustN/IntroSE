import { describe, expect, it } from "vitest";
import { SPLIT_GUTTER, floorShifts, ghostedBlockKeys } from "./floorLayout";

/*
 * The exploded-floor transform (0044).
 *
 * What it has to guarantee: levels that share a footprint stop sharing one on screen, levels that
 * never shared one are not pushed further apart than they need, and the whole thing is a no-op the
 * moment the view is turned off — because the stored geometry is the truthful one.
 */

const floors = [{ name: "Tầng 1" }, { name: "Tầng 2" }];

/** Two decks occupying exactly the same span — the stacked stadium. */
const stacked = [
  { x: 1000, floor: "Tầng 1" },
  { x: 2000, floor: "Tầng 1" },
  { x: 1000, floor: "Tầng 2" },
  { x: 2000, floor: "Tầng 2" },
];

const spanOf = (items: typeof stacked, shift: Map<string, number>, name: string) => {
  const xs = items.filter((i) => i.floor === name).map((i) => i.x + (shift.get(name) ?? 0));
  return { min: Math.min(...xs), max: Math.max(...xs) };
};

describe("floorShifts", () => {
  it("pulls stacked levels apart so they no longer overlap", () => {
    const shift = floorShifts(stacked, floors);
    const a = spanOf(stacked, shift, "Tầng 1");
    const b = spanOf(stacked, shift, "Tầng 2");
    // The whole point: after the transform there is clear air between them.
    expect(b.min).toBeGreaterThan(a.max);
    expect(b.min - a.max).toBeCloseTo(1000 * SPLIT_GUTTER, 5);
  });

  it("leaves the FIRST floor exactly where it was drawn", () => {
    // A chart must not drift away from its own coordinates just because a view was switched on.
    expect(floorShifts(stacked, floors).get("Tầng 1")).toBe(0);
  });

  it("separates concentric levels too, without inventing a gap sized for the whole chart", () => {
    // The rings the stadium starter draws: different footprints, one inside the other.
    const concentric = [
      { x: 1000, floor: "Tầng 1" },
      { x: 2000, floor: "Tầng 1" },
      { x: 3000, floor: "Tầng 2" },
      { x: 3400, floor: "Tầng 2" },
    ];
    const shift = floorShifts(concentric, floors);
    const a = spanOf(concentric, shift, "Tầng 1");
    const b = spanOf(concentric, shift, "Tầng 2");
    expect(b.min).toBeGreaterThan(a.max);
    // Sized from the WIDEST level (1000), not from the chart's full 2400 extent.
    expect(b.min - a.max).toBeCloseTo(1000 * SPLIT_GUTTER, 5);
  });

  it("skips a floor holding nothing rather than reserving empty space for it", () => {
    const three = [{ name: "Tầng 1" }, { name: "Tầng trống" }, { name: "Tầng 2" }];
    const shift = floorShifts(stacked, three);
    expect(shift.has("Tầng trống")).toBe(false);
    expect(shift.get("Tầng 2")).toBeCloseTo(1000 + 1000 * SPLIT_GUTTER, 5);
  });

  it("is a no-op on a chart with one floor, and on items carrying no floor at all", () => {
    expect(floorShifts(stacked, [{ name: "Tầng 1" }]).get("Tầng 1")).toBe(0);
    expect(floorShifts([{ x: 5 }, { x: 9 }], floors).size).toBe(0);
  });
});

/*
 * Ghosting (0044).
 *
 * The layer behaviour every drawing tool has: the level you are not editing stays on screen, dimmed
 * and inert. Hiding it was the first version's mistake — placing a balcony over the stalls means
 * aligning against the stalls.
 */
describe("ghostedBlockKeys", () => {
  const floorOfSection = new Map<number, number | null>([
    [1, 10], // stalls, ground
    [2, 20], // balcony, upper
    [3, null], // a section on no level at all
  ]);
  const blocks = [
    { key: "stalls", sectionId: 1 },
    { key: "balcony", sectionId: 2 },
    { key: "loose", sectionId: 3 },
    { key: "outline", sectionId: null },
    { key: "boundary" },
  ];

  it("ghosts every level except the one being edited", () => {
    const ghost = ghostedBlockKeys(blocks, floorOfSection, 20);
    expect(ghost.has("stalls")).toBe(true);
    expect(ghost.has("balcony")).toBe(false);
  });

  it("never ghosts structural drawing — a hall outline has no section and belongs to every level", () => {
    const ghost = ghostedBlockKeys(blocks, floorOfSection, 20);
    expect(ghost.has("outline")).toBe(false);
    expect(ghost.has("boundary")).toBe(false);
  });

  it("treats a section on no floor as the implicit ground level, not as everywhere", () => {
    // It is a real place on one level, unlike an outline — so editing the balcony ghosts it.
    expect(ghostedBlockKeys(blocks, floorOfSection, 20).has("loose")).toBe(true);
    // ...and editing the implicit level leaves it alone.
    expect(ghostedBlockKeys(blocks, floorOfSection, null).size).toBe(0);
  });

  it("ghosts nothing when every level is editable", () => {
    expect(ghostedBlockKeys(blocks, floorOfSection, null).size).toBe(0);
  });
});
