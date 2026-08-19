import { describe, expect, it } from "vitest";
import type { SeatMapSeat, SeatStatus } from "@/shared/catalog/types";
import { MAX_ARC_ANGLE } from "@/shared/catalog/seatmap-document";
import { bestSeats, focalPoint } from "./bestAvailable";

let id = 0;
const seat = (
  row: string,
  number: number,
  x: number,
  y: number,
  opts: Partial<SeatMapSeat> = {},
): SeatMapSeat => ({
  id: ++id,
  row,
  number,
  tier: "VIP",
  price: 200000,
  status: "available" as SeatStatus,
  x,
  y,
  rotation: 0,
  section: opts.section ?? null,
  ...opts,
});

const stage = {
  kind: "stage",
  x: 2000,
  y: 0,
  width: 1000,
  height: 400,
  rotation: 0,
  label: "Stage",
} as const;

describe("focalPoint", () => {
  it("is the stage centre when the map has a stage", () => {
    expect(focalPoint([], [stage as never])).toEqual({ x: 2500, y: 200 });
  });

  it("falls back to the seats' centroid without a stage", () => {
    const s = [seat("A", 1, 0, 0), seat("A", 2, 100, 200)];
    expect(focalPoint(s, [])).toEqual({ x: 50, y: 100 });
  });

  it("is null for an empty map", () => {
    expect(focalPoint([], [])).toBeNull();
  });
});

describe("bestSeats", () => {
  it("picks the run closest to the stage", () => {
    // Two 2-seat runs; row A (y=500) is closer to the stage (y=200) than row B (y=1500).
    const seats = [
      seat("A", 1, 500, 500),
      seat("A", 2, 600, 500),
      seat("B", 1, 500, 1500),
      seat("B", 2, 600, 1500),
    ];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.reason).toBeNull();
    expect(pick.seats.map((s) => `${s.row}${s.number}`)).toEqual(["A1", "A2"]);
  });

  it("never offers seats across a number gap", () => {
    // Row A has 1,3 (a gap at 2) near the stage; row B has a true pair farther away. A pair is a
    // CONSECUTIVE run — so the answer must come from row B even though row A is closer.
    const seats = [
      seat("A", 1, 500, 500),
      seat("A", 3, 700, 500),
      seat("B", 1, 2000, 1500),
      seat("B", 2, 2100, 1500),
    ];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.seats.map((s) => `${s.row}${s.number}`)).toEqual(["B1", "B2"]);
  });

  it("skips non-available seats inside a run", () => {
    const seats = [
      seat("A", 1, 500, 500),
      seat("A", 2, 600, 500, { status: "sold" }),
      seat("A", 3, 700, 500),
      seat("A", 4, 800, 500),
    ];
    // 1 and 2 are not consecutive-free; 3,4 are — and they are the only full run.
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.seats.map((s) => s.number)).toEqual([3, 4]);
  });

  it("does not offer a seat the buyer already holds", () => {
    const held = seat("A", 1, 500, 500);
    const seats = [
      held,
      seat("A", 2, 600, 500),
      seat("B", 1, 2000, 1500),
      seat("B", 2, 2100, 1500),
    ];
    const pick = bestSeats(seats, [stage as never], 2, new Set([held.id]));
    expect(pick.seats.map((s) => `${s.row}${s.number}`)).toEqual(["B1", "B2"]);
  });

  it("prefers the centred window inside a long run", () => {
    // One 6-seat run, stage centred over the row's midpoint so DISTANCE cannot pick a side — only
    // the centre-of-row tie-break can, and it must land mid-run rather than at seat 1.
    const centredStage = {
      kind: "stage",
      x: 900,
      y: 0,
      width: 1000,
      height: 400,
      rotation: 0,
      label: "Stage",
    } as const;
    const row = [1, 2, 3, 4, 5, 6].map((n) => seat("A", n, 400 * n, 800));
    const pick = bestSeats(row, [centredStage as never], 2);
    expect(pick.seats.map((s) => s.number)).toEqual([3, 4]);
  });

  it("falls back to the nearest seats when no run is long enough, and says they are scattered", () => {
    // Three free seats, no two of them adjacent. Refusing outright would tell a buyer the show is
    // full while three seats sit unsold, so the answer is the nearest two — labelled for what it is.
    const seats = [seat("A", 1, 500, 500), seat("A", 3, 700, 500), seat("B", 1, 2000, 1500)];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.reason).toBeNull();
    expect(pick.match).toBe("scattered");
    expect(pick.seats).toHaveLength(2);
  });

  it("answers no_run_fits only when there are genuinely too few seats left", () => {
    const seats = [seat("A", 1, 500, 500)];
    const pick = bestSeats(seats, [stage as never], 3);
    expect(pick.seats).toEqual([]);
    expect(pick.reason).toBe("no_run_fits");
  });

  it("will not strand a single seat between two taken ones", () => {
    // A1 sold, A2–A4 free. Taking A3+A4 would maroon A2 between a sold seat and the buyer's own.
    // The only orphan-free pair is A2+A3, which leaves A4 against the end of the row.
    const seats = [
      seat("A", 1, 400, 800, { status: "sold" }),
      seat("A", 2, 800, 800),
      seat("A", 3, 1200, 800),
      seat("A", 4, 1600, 800),
    ];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.match).toBe("adjacent_no_orphan");
    expect(pick.seats.map((s) => s.number)).toEqual([2, 3]);
  });

  it("allows a lone seat left at the end of a row", () => {
    // Nothing below A1 and nothing above A3: whichever pair is taken, the leftover sits against an
    // aisle rather than between two taken seats, so `balanced` permits it.
    const seats = [seat("A", 1, 400, 800), seat("A", 2, 800, 800), seat("A", 3, 1200, 800)];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.match).toBe("adjacent_no_orphan");
    expect(pick.seats).toHaveLength(2);
  });

  it("strict refuses the aisle-end single that balanced allows", () => {
    const seats = [seat("A", 1, 400, 800), seat("A", 2, 800, 800), seat("A", 3, 1200, 800)];
    const strict = bestSeats(seats, [stage as never], 2, new Set(), "strict");
    // Every pair here leaves exactly one seat over, so strict has no clean option and has to fall
    // back to rung 2 — still adjacent, just no longer orphan-free.
    expect(strict.match).toBe("adjacent");
    expect(strict.seats).toHaveLength(2);
  });

  it("takes an orphaning pair rather than refusing, when nothing cleaner exists", () => {
    // A1 sold, A4 sold, A2–A3 free: the only pair stranded nothing on either side would be one that
    // does not exist. Rung 2 answers instead of rung 1.
    const seats = [
      seat("A", 1, 400, 800, { status: "sold" }),
      seat("A", 2, 800, 800),
      seat("A", 3, 1200, 800),
      seat("A", 4, 1600, 800, { status: "sold" }),
      seat("A", 5, 2000, 800),
    ];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.seats.map((s) => s.number)).toEqual([2, 3]);
  });

  it("answers none_available when every seat is taken", () => {
    const seats = [
      seat("A", 1, 500, 500, { status: "sold" }),
      seat("A", 2, 600, 500, { status: "held" }),
    ];
    const pick = bestSeats(seats, [stage as never], 1);
    expect(pick.seats).toEqual([]);
    expect(pick.reason).toBe("none_available");
  });

  it("counts a single seat as a valid run", () => {
    const seats = [seat("A", 1, 500, 500)];
    const pick = bestSeats(seats, [stage as never], 1);
    expect(pick.reason).toBeNull();
    expect(pick.seats).toHaveLength(1);
  });
});

/*
 * Numbering schemes other than 1,2,3.
 *
 * These exist because the whole suite — and every live chart — numbered consecutively, so the
 * arithmetic adjacency test (`seat.number === prev.number + 1`) was never exercised against the
 * three schemes `seatmap-project.ts` can actually mint. A green suite proved nothing about them.
 *
 * Every case here asserts `match`, not only which seats come back: the failure returned a plausible
 * pair labelled `scattered`, so an assertion on seat ids alone can pass while the buyer is told the
 * opposite of the truth.
 */
describe("rows numbered in ways the editor actually offers", () => {
  /** Ten seats at a fixed pitch, numbered by the given scheme. */
  const rowOf = (numbers: number[]) => numbers.map((n, i) => seat("A", n, 400 + i * 200, 800));

  it("finds an adjacent pair on an odd-numbered row (1,3,5…)", () => {
    // How a centre-aisle row is labelled. Every seat used to become a run of one.
    const pick = bestSeats(rowOf([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]), [stage as never], 2);
    expect(pick.match).toBe("adjacent_no_orphan");
    expect(pick.seats).toHaveLength(2);
    // Adjacent in POSITION is what matters; the labels differ by two.
    expect(Math.abs(pick.seats[0].x - pick.seats[1].x)).toBe(200);
  });

  it("finds an adjacent pair on an even-numbered row (2,4,6…)", () => {
    const pick = bestSeats(rowOf([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]), [stage as never], 2);
    expect(pick.match).toBe("adjacent_no_orphan");
    expect(Math.abs(pick.seats[0].x - pick.seats[1].x)).toBe(200);
  });

  it("finds an adjacent pair on a descending row (10,9,8…)", () => {
    const pick = bestSeats(rowOf([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), [stage as never], 2);
    expect(pick.match).toBe("adjacent_no_orphan");
    expect(Math.abs(pick.seats[0].x - pick.seats[1].x)).toBe(200);
  });

  it("finds an adjacent pair when the organizer set a seat-number step", () => {
    // `seatNumberStep` — 1,4,7,10… is a legal chart.
    const pick = bestSeats(rowOf([1, 4, 7, 10, 13, 16, 19, 22, 25, 28]), [stage as never], 2);
    expect(pick.match).toBe("adjacent_no_orphan");
    expect(Math.abs(pick.seats[0].x - pick.seats[1].x)).toBe(200);
  });

  it("keeps the orphan rule live on an odd row", () => {
    // The bounds were `numbers.has(first.number - 1)` — on an odd row that is an even number which
    // by construction is not there, so both ends read unbounded and NO orphan rule could ever fire.
    // Seat 1 sold, 3/5/7 free: taking 5+7 would maroon 3 between a sold seat and the buyer's own.
    const row = rowOf([1, 3, 5, 7]);
    const seats = [{ ...row[0], status: "sold" as SeatStatus }, ...row.slice(1)];

    const balanced = bestSeats(seats, [stage as never], 2);
    expect(balanced.match).toBe("adjacent_no_orphan");
    expect(balanced.seats.map((s) => s.number)).toEqual([3, 5]);
  });

  it("lets strict refuse on an odd row what balanced allows", () => {
    // Three free seats in a row of three: any pair leaves exactly one over. Balanced permits it
    // (the leftover sits against the row end); strict does not, and must fall to rung 2.
    const row = rowOf([1, 3, 5]);
    expect(bestSeats(row, [stage as never], 2).match).toBe("adjacent_no_orphan");
    expect(bestSeats(row, [stage as never], 2, new Set(), "strict").match).toBe("adjacent");
  });

  it("does not pair the seats either side of a removed one", () => {
    // A deleted seat leaves no entry but keeps the physical gap (`deleteSeats` filters it out and
    // the rest keep their offsets). Index adjacency alone would call these two neighbours.
    const seats = [
      seat("A", 1, 400, 800),
      seat("A", 2, 600, 800),
      seat("A", 3, 800, 800),
      // 1000 is missing — a real gap.
      seat("A", 5, 1200, 800),
      seat("A", 6, 1400, 800),
    ];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.match).toBe("adjacent_no_orphan");
    const xs = pick.seats.map((s) => s.x).sort((a, b) => a - b);
    // Whichever pair wins, it must not straddle the hole at x=1000.
    expect(xs[1] - xs[0]).toBe(200);
  });
});

describe("a genuine centre-aisle row (two blocks sharing one section and row label)", () => {
  // Odd on the left, even on the right — exactly what the odd/even scheme exists for. The snapshot
  // merges them into one row, so this row holds 1,3,5,7 at the left and 2,4,6,8 at the right.
  const centreAisleRow = () => [
    seat("A", 1, 400, 800),
    seat("A", 3, 600, 800),
    seat("A", 5, 800, 800),
    seat("A", 7, 1000, 800),
    // aisle
    seat("A", 2, 1600, 800),
    seat("A", 4, 1800, 800),
    seat("A", 6, 2000, 800),
    seat("A", 8, 2200, 800),
  ];

  it("never offers a pair that straddles the aisle", () => {
    const pick = bestSeats(centreAisleRow(), [stage as never], 2);
    const xs = pick.seats.map((s) => s.x).sort((a, b) => a - b);
    expect(pick.match).toBe("adjacent_no_orphan");
    // Real neighbours on this row are 200 apart; the aisle is 600.
    expect(xs[1] - xs[0]).toBe(200);
  });
});

describe("the curved-row cap this file depends on", () => {
  it("stays at 180°, because sortAlongRow orders rows by a cartesian axis", () => {
    /*
     * Not a test of behaviour — a tripwire on an assumption.
     *
     * `sortAlongRow` orders a row along its dominant x/y axis, which is only the physical order while
     * the arc stays monotonic in that axis. A curved row generates at `dx = rr * sin(a)` over
     * `±arcAngle/2`, so 180 is exactly the edge: at ±90° `sin` is still monotonic, past it the arms
     * fold back and the sort interleaves them into aisle-crossing "adjacent" pairs.
     *
     * Raising the cap is otherwise a one-character edit in a slider with nothing to say it breaks
     * best-available. This is the thing that says so.
     */
    expect(MAX_ARC_ANGLE).toBe(180);
  });
});
