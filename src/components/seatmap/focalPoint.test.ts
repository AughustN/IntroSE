import { describe, expect, it } from "vitest";
import { bestSeats, focalPoint } from "./bestAvailable";
import type { SeatMapElement, SeatMapSeat } from "@/shared/catalog/types";

/**
 * The focal point governs which seats a buyer is offered, so this file is a REGRESSION guard as much
 * as a feature test: charts drawn before 0043 state no focal point, and their ranking must not move.
 */

const seat = (id: number, x: number, y: number): SeatMapSeat =>
  ({
    id,
    x,
    y,
    row: "A",
    number: id,
    section: null,
    status: "available",
    price: 100,
    tier: "T",
    ticketTierId: 1,
    rotation: 0,
  }) as unknown as SeatMapSeat;

const stage = (x: number, y: number): SeatMapElement =>
  ({ kind: "stage", x, y, width: 1000, height: 400 }) as unknown as SeatMapElement;

describe("focalPoint", () => {
  const seats = [seat(1, 0, 0), seat(2, 1000, 0), seat(3, 2000, 0)];

  it("falls back to the stage centre when the chart states nothing", () => {
    // The behaviour of every chart drawn before 0043, unchanged.
    expect(focalPoint(seats, [stage(4000, 2000)])).toEqual({ x: 4500, y: 2200 });
  });

  it("falls back to the seat centroid when there is no stage either", () => {
    expect(focalPoint(seats, [])).toEqual({ x: 1000, y: 0 });
  });

  it("returns null for an empty chart with nothing to infer from", () => {
    expect(focalPoint([], [])).toBeNull();
  });

  it("prefers an explicit point over BOTH inferences", () => {
    // The whole point of the control: an arena's focus is its pitch, not its biggest stand and not
    // the middle of the seating. Inferring over the top of a stated answer makes it decorative.
    expect(focalPoint(seats, [stage(4000, 2000)], { x: 77, y: 88 })).toEqual({ x: 77, y: 88 });
    expect(focalPoint(seats, [], { x: 77, y: 88 })).toEqual({ x: 77, y: 88 });
  });

  it("ignores a null or undefined explicit point rather than treating it as the origin", () => {
    // `{x:0,y:0}` is a legitimate focal point, so the absent case must be distinguished from it by
    // the value being nullish and not by it being falsy — a `0,0` chart would otherwise lose its
    // stated focus.
    expect(focalPoint(seats, [], null)).toEqual({ x: 1000, y: 0 });
    expect(focalPoint(seats, [], undefined)).toEqual({ x: 1000, y: 0 });
    expect(focalPoint(seats, [], { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("bestSeats honours the stated focal point", () => {
  // A row running left to right. With no stated focus the centroid is the middle seat; stating the
  // far left end must move the offer there.
  const row = [seat(1, 0, 0), seat(2, 500, 0), seat(3, 1000, 0), seat(4, 1500, 0), seat(5, 2000, 0)];

  it("offers the centre when the focus is inferred from the seating", () => {
    const got = bestSeats(row, [], 1);
    expect(got.seats.map((s) => s.id)).toEqual([3]);
  });

  it("offers the end nearest a stated focal point instead", () => {
    const got = bestSeats(row, [], 1, new Set(), "balanced", { x: -500, y: 0 });
    expect(got.seats.map((s) => s.id)).toEqual([1]);
  });

  it("leaves the inferred ranking untouched when the point is null", () => {
    // The regression that matters: an existing chart passes `null` here and must rank as it always did.
    expect(bestSeats(row, [], 1, new Set(), "balanced", null).seats.map((s) => s.id)).toEqual([3]);
  });
});
