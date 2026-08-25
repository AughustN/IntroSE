import { describe, expect, it } from "vitest";
import { blockingIssues, validateLayout, type ValidationIssue } from "./seatmap-validate";

/*
 * The focal-point check, and the severity split it needed to exist.
 *
 * Lives here rather than in `server/tests/seatmap/validate.test.ts` because that project's setup file
 * opens Postgres and truncates ~30 tables between cases; this is a pure function and belongs in the
 * no-database project (see the comment at the top of `vitest.web.config.ts`).
 */

const seat = (id: number, x: number, y: number) => ({
  id,
  sectionId: 1,
  categoryId: 1,
  rowLabel: "A",
  seatNumber: id,
  x,
  y,
});

const sections = [{ id: 1, name: "Khu A" }];
const stage = { kind: "stage", x: 4_500, y: 200 };
/** Two seats a full diameter apart, so nothing else in the validator has anything to say. */
const cleanSeats = [seat(1, 5_000, 3_000), seat(2, 5_100, 3_000)];

const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);

describe("focal_point_unset", () => {
  it("warns when a chart has seats but no stage — best-available will rank from the seat centroid", () => {
    const issues = validateLayout({ seats: cleanSeats, sections });
    const focal = issues.filter((i) => i.code === "focal_point_unset");
    expect(focal).toHaveLength(1);
    expect(focal[0].severity).toBe("warning");
  });

  it("is silent once a stage exists", () => {
    const issues = validateLayout({ seats: cleanSeats, sections, elements: [stage] });
    expect(codes(issues)).not.toContain("focal_point_unset");
  });

  it("is silent on a chart with no seats — a standing-only room has nothing to rank", () => {
    // A capacity zone keeps this off `zero_capacity`, so the only question left is the focal point.
    const issues = validateLayout({
      seats: [],
      sections,
      categories: [{ id: 2, name: "Đứng" }],
      elements: [{ kind: "area", x: 1_000, y: 1_000, capacity: 300, categoryId: 2 }],
    });
    expect(codes(issues)).not.toContain("focal_point_unset");
  });

  /*
   * The point of the whole severity split. Before it, adding this check would have made every
   * stage-less chart permanently unpublishable — a conference hall, a standing room, a stadium drawn
   * without its pitch — which is a worse failure than the silent ranking it was meant to surface.
   */
  it("does NOT block publishing: a chart whose only issue is this one is still publishable", () => {
    const issues = validateLayout({ seats: cleanSeats, sections });
    expect(codes(issues)).toEqual(["focal_point_unset"]);
    expect(blockingIssues(issues)).toEqual([]);
  });
});

describe("blockingIssues", () => {
  it("keeps issues that carry no severity — an unmarked issue blocks, so the safe direction is refusing", () => {
    const unmarked: ValidationIssue = { code: "zero_capacity", message: "x" };
    expect(blockingIssues([unmarked])).toEqual([unmarked]);
  });

  it("drops only the warnings, keeping the errors alongside them", () => {
    // An empty chart: zero_capacity blocks, and there are no seats so no focal warning is raised.
    const issues = validateLayout({ seats: [], sections });
    expect(codes(issues)).toContain("zero_capacity");
    expect(codes(blockingIssues(issues))).toContain("zero_capacity");
  });

  it("still blocks a real error on a chart that also has the focal warning", () => {
    // Two seats on the same point: overlapping AND duplicate-labelled, plus no stage.
    const issues = validateLayout({
      seats: [seat(1, 5_000, 3_000), seat(2, 5_000, 3_000)],
      sections,
    });
    expect(codes(issues)).toContain("focal_point_unset");
    const blocking = blockingIssues(issues);
    expect(blocking.length).toBeGreaterThan(0);
    expect(codes(blocking)).not.toContain("focal_point_unset");
  });
});

/*
 * Companion seats (0036): a wheelchair seat and the one that accompanies it.
 *
 * The pairing is stored as a pointer on the ORDINARY seat naming the ACCESSIBLE one — the checklist
 * of valid shapes is therefore exactly three: the pointer resolves, points at a wheelchair seat,
 * and no other seat points at the same one. A wheelchair seat with nothing pointing at it is the
 * advisory half (a draft state, not a refusal).
 */
const accessibleSeat = (id: number, x: number, y: number) => ({
  id,
  sectionId: 1,
  categoryId: 1,
  rowLabel: "A",
  seatNumber: id,
  x,
  y,
  isAccessible: true,
});

describe("companion seats", () => {
  it("is silent when a seat accompanies a wheelchair seat and only one does", () => {
    const issues = validateLayout({
      seats: [
        { ...seat(1, 5_000, 3_000), companionSeatId: 2 },
        accessibleSeat(2, 5_100, 3_000),
        seat(3, 5_200, 3_000),
      ],
      sections,
      elements: [stage],
    });
    expect(codes(issues)).not.toContain("companion_wrong_target");
    expect(codes(issues)).not.toContain("accessible_without_companion");
  });

  it("BLOCKS when a pointer names a seat that is not in the chart", () => {
    const issues = validateLayout({
      seats: [{ ...seat(1, 5_000, 3_000), companionSeatId: 999 }],
      sections,
      elements: [stage],
    });
    const wrong = issues.filter((i) => i.code === "companion_wrong_target");
    expect(wrong).toHaveLength(1);
    expect(wrong[0].seatIds).toEqual([1]);
    expect(blockingIssues(issues).some((i) => i.code === "companion_wrong_target")).toBe(true);
  });

  it("BLOCKS when a pointer names a seat that is NOT a wheelchair seat", () => {
    const issues = validateLayout({
      seats: [{ ...seat(1, 5_000, 3_000), companionSeatId: 2 }, seat(2, 5_100, 3_000)],
      sections,
      elements: [stage],
    });
    expect(codes(issues)).toContain("companion_wrong_target");
  });

  it("BLOCKS when two seats claim the same wheelchair seat", () => {
    const issues = validateLayout({
      seats: [
        { ...seat(1, 5_000, 3_000), companionSeatId: 3 },
        { ...seat(2, 5_100, 3_000), companionSeatId: 3 },
        accessibleSeat(3, 5_200, 3_000),
      ],
      sections,
      elements: [stage],
    });
    const wrong = issues.filter((i) => i.code === "companion_wrong_target");
    expect(wrong).toHaveLength(2);
    // Both claimants are named, one message each — the wheelchair seat itself is not.
    expect(wrong.flatMap((i) => i.seatIds ?? []).sort()).toEqual([1, 2]);
    expect(blockingIssues(issues).some((i) => i.code === "companion_wrong_target")).toBe(true);
  });

  it("WARNs, without blocking, when a wheelchair seat has nothing accompanying it", () => {
    const issues = validateLayout({
      seats: [accessibleSeat(2, 5_100, 3_000), seat(3, 5_200, 3_000)],
      sections,
      elements: [stage],
    });
    const warn = issues.filter((i) => i.code === "accessible_without_companion");
    expect(warn).toHaveLength(1);
    expect(warn[0].severity).toBe("warning");
    // An unpaired wheelchair seat is a work-in-progress state, NOT a publish refusal.
    expect(blockingIssues(issues)).toEqual([]);
  });

  it("does not warn for an ORDINARY seat: only wheelchair seats must be accompanied", () => {
    const issues = validateLayout({
      seats: [seat(1, 5_000, 3_000), seat(2, 5_100, 3_000)],
      sections,
      elements: [stage],
    });
    expect(codes(issues)).not.toContain("accessible_without_companion");
  });
});

/*
 * zone_over_seats — a capacity zone drawn on top of seats.
 *
 * `category_mixed_inventory` compares price CLASSES, and two classes can describe one physical space.
 * A zone of 300 laid over a block of seats names a different class, so it passed, published, and
 * generated capacity + seats sellable tickets for a floor that holds only the seats. Measured before
 * the fix on a 200-place standing area: `{"seats": 400}`.
 */
describe("zone_over_seats", () => {
  const zone = (extra: Record<string, unknown>) => ({
    kind: "area",
    capacity: 300,
    categoryId: 2,
    ...extra,
  });

  it("refuses a zone whose BOX encloses seats — a rectangle carries no points", () => {
    const issues = validateLayout({
      seats: cleanSeats,
      sections,
      elements: [stage, zone({ x: 5_050, y: 3_000, width: 400, height: 400 })],
    });
    const found = issues.filter((i) => i.code === "zone_over_seats");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBeUndefined(); // blocking
    expect(found[0].seatIds).toEqual([1, 2]);
  });

  it("refuses a zone whose POLYGON encloses seats", () => {
    const issues = validateLayout({
      seats: cleanSeats,
      sections,
      elements: [
        stage,
        zone({
          points: [
            { x: 4_900, y: 2_900 },
            { x: 5_200, y: 2_900 },
            { x: 5_200, y: 3_100 },
            { x: 4_900, y: 3_100 },
          ],
        }),
      ],
    });
    expect(codes(issues)).toContain("zone_over_seats");
  });

  it("is silent on a zone standing clear of every seat — the normal arena floor", () => {
    const issues = validateLayout({
      seats: cleanSeats,
      sections,
      elements: [stage, zone({ x: 20_000, y: 20_000, width: 400, height: 400 })],
    });
    expect(codes(issues)).not.toContain("zone_over_seats");
  });

  it("is silent on a drawn area carrying NO capacity — that is a standing area, whose seats ARE its inventory", () => {
    const issues = validateLayout({
      seats: cleanSeats,
      sections,
      elements: [stage, { kind: "area", x: 5_050, y: 3_000, width: 400, height: 400 }],
    });
    expect(codes(issues)).not.toContain("zone_over_seats");
    expect(codes(issues)).not.toContain("zone_without_category");
  });
});

/*
 * Two seats on DIFFERENT LEVELS do not occupy the same space (0044).
 *
 * `findOverlaps` buckets purely by x/y, which was right when a chart was one plane. With floors it
 * means a stacked balcony — the upper tier directly above the stalls, which is where a balcony
 * physically IS — reports `overlapping_seats` for every seat and can never be published.
 */
describe("overlapping_seats across floors", () => {
  const twoLevels = [
    { id: 1, name: "Tầng trệt", floorId: 10 },
    { id: 2, name: "Ban công", floorId: 20 },
  ];
  const stacked = [
    { id: 1, sectionId: 1, categoryId: 1, rowLabel: "A", seatNumber: 1, x: 5_000, y: 3_000 },
    // Same point, one storey up.
    { id: 2, sectionId: 2, categoryId: 1, rowLabel: "A", seatNumber: 1, x: 5_000, y: 3_000 },
  ];

  it("does not report a seat stacked directly above another on a different floor", () => {
    const issues = validateLayout({ seats: stacked, sections: twoLevels, elements: [stage] });
    expect(codes(issues)).not.toContain("overlapping_seats");
  });

  it("still reports two seats on the SAME floor", () => {
    const sameFloor = [
      { id: 1, name: "Khu A", floorId: 10 },
      { id: 2, name: "Khu B", floorId: 10 },
    ];
    const issues = validateLayout({ seats: stacked, sections: sameFloor, elements: [stage] });
    expect(codes(issues)).toContain("overlapping_seats");
  });

  it("still reports two seats on a chart with NO floors at all", () => {
    const flat = [
      { id: 1, name: "Khu A" },
      { id: 2, name: "Khu B" },
    ];
    const issues = validateLayout({ seats: stacked, sections: flat, elements: [stage] });
    expect(codes(issues)).toContain("overlapping_seats");
  });
});
