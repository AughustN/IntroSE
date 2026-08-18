import { describe, expect, it } from "vitest";
import type { SeatMapSeat, SeatStatus } from "@/shared/catalog/types";
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

  it("answers no_run_fits when only runs shorter than requested exist", () => {
    const seats = [seat("A", 1, 500, 500), seat("A", 3, 700, 500), seat("B", 1, 2000, 1500)];
    const pick = bestSeats(seats, [stage as never], 2);
    expect(pick.seats).toEqual([]);
    expect(pick.reason).toBe("no_run_fits");
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
