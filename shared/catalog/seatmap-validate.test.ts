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
