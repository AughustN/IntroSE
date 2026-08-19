/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SeatMapElement, SeatMapSeat } from "@/shared/catalog/types";
import { SEAT_DIAMETER } from "@/shared/catalog/seatmap-validate";

/**
 * Best available seat picking — the answer to "chọn giúp tôi chỗ tốt nhất" (Humanitix/Eventive
 * parity, FR-072).
 *
 * The buyer does not read the map the way an organizer does. Their question is not "where is A14"
 * but "where is the good seat", and making them scan a few hundred dots for it is the part of seat
 * picking that most often sends first-timers away.
 *
 * "Good" is defined here, and it is a deliberate definition, not a magic one:
 *
 *  1. CONTIGUITY FIRST. Two seats bought together must be side by side. Ten seats with one gap
 *     between the 5th and 6th is not a pair; buyers will not discover that until they are already
 *     holding the wrong two. So the only N-seat candidates are CONSECUTIVE seat numbers on one
 *     row, held by at most one seat of spacing each — in practice exactly adjacent, sorted seat
 *     numbers.
 *  2. CLOSE TO THE FOCAL POINT, THEN CENTRED. The focal point is where the event happens — the
 *     stage's centre when the map carries one, else the CENTROID of every seat, which is the middle
 *     of the seating block and the best guess available when nobody drew a stage. Distance dominates
 *     the score; among runs at similar distance, the one nearer the middle of its row wins, because
 *     a run of 2 in a row of 20 is better centred than one hugging the aisle.
 *  3. FAIR PRICE IS NOT A FACTOR. Cheap-first would silently steer every buyer to the worst cheap
 *     seat, and the tier is already a colour and a legend. Distance and geometry decide; what the
 *     run costs is shown afterwards, exactly like the map shows everything else.
 *
 * Pure on purpose — the whole thing is testable without a DOM, and the buyer screen calls it with
 * whatever seats it currently shows.
 */

/**
 * How hard the map refuses to strand a lone seat.
 *
 * `balanced` — a buyer may not leave a single seat marooned between two taken ones, but a one-seat
 * gap at an aisle or at the end of a row is fine: somebody sitting alone on the end is ordinary, and
 * forbidding it costs more sales than it saves.
 * `strict` — no single empty seat anywhere, wherever it falls. Fills the house harder, and refuses
 * arrangements plenty of buyers would consider reasonable.
 */
export type OrphanRule = "balanced" | "strict";

export interface BestSeatChoice {
  seats: SeatMapSeat[];
  /** Why there is no answer, when `seats` is empty. */
  reason: "none_available" | "no_run_fits" | null;
  /**
   * How the answer was found, so the buyer can be told the truth about it.
   *
   * `scattered` is the one that matters: those seats are NOT next to each other, and offering them
   * with the same words as a neat pair is how somebody ends up holding four seats in four different
   * rows without noticing.
   */
  match: "adjacent_no_orphan" | "adjacent" | "scattered" | null;
}

/** The point every run is measured against. Stage centre if the map has a stage; otherwise the
 *  average of all seats' positions, and for an empty map, null. */
export function focalPoint(
  seats: SeatMapSeat[],
  elements: SeatMapElement[] | undefined,
): { x: number; y: number } | null {
  const stage = elements?.find((el) => el.kind === "stage");
  if (stage) return { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  if (seats.length === 0) return null;
  const sum = seats.reduce((acc, s) => ({ x: acc.x + s.x, y: acc.y + s.y }), { x: 0, y: 0 });
  return { x: sum.x / seats.length, y: sum.y / seats.length };
}


/**
 * Sort a row by POSITION along its dominant axis, not by seat number.
 *
 * Adjacency below is index adjacency in this array, so the array order has to BE the physical order.
 * Sorting by number is only the same thing when numbers ascend along the row, and a genuine
 * centre-aisle row is the case where they do not: it is two blocks sharing one section and row
 * label, odd on the left and even on the right, which the snapshot merges into a single row. Sorting
 * that by number interleaves the halves — 1, 2, 3, 4 becomes left, right, left, right — so every
 * index-adjacent pair crossed the aisle, and the median gap came out at the width of the aisle
 * rather than the seat pitch, which made the distance check wave those pairs through as well.
 *
 * The dominant axis rather than always x, so a row of side seats running up the side of a hall
 * sorts along its own length.
 *
 * A cartesian sort assumes the row's position is monotonic along that axis, which for a curved row
 * holds only while the arc stays within ±90° of its midpoint — `dx = rr * sin(a)` with `a` spanning
 * `±arcAngle/2` (seatmap-project.ts). `MAX_ARC_ANGLE` is what keeps that true, and the editor's
 * slider reads its maximum from it. Past 180° the arms fold back over the same x range and this sort
 * interleaves them, producing exactly the aisle-crossing pair this function exists to prevent.
 *
 * `document.schema.ts` still accepts up to 360°, so a hand-posted document can exceed what the editor
 * can draw. Deliberately not tightened: rejecting stored documents to close a hole nothing has walked
 * through is the worse trade. If `MAX_ARC_ANGLE` is ever raised, or the schema trusted over it, order
 * the row by angle about the arc's centre or by cumulative distance along it, not by a cartesian axis.
 */
function sortAlongRow(row: SeatMapSeat[]): SeatMapSeat[] {
  const xs = row.map((s) => s.x);
  const ys = row.map((s) => s.y);
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  return [...row].sort((a, b) =>
    horizontal ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x,
  );
}

/** Group seats into rows keyed by `${section}·${row}`, each in physical order along the row. A run is
 *  only a run within one row of one section — crossing either breaks contiguity for the buyer. */
function groupByRow(seats: SeatMapSeat[]): SeatMapSeat[][] {
  const map = new Map<string, SeatMapSeat[]>();
  for (const seat of seats) {
    const key = `${seat.section ?? ""}·${seat.row}`;
    const row = map.get(key);
    if (row) row.push(seat);
    else map.set(key, [seat]);
  }
  return [...map.values()].map(sortAlongRow);
}

/** How much further apart than the row's usual pitch two seats may sit and still be neighbours. */
const ADJACENT_TOLERANCE = 1.5;

const gap = (a: SeatMapSeat, b: SeatMapSeat) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The row's seat pitch: the median distance between seats that follow one another along it.
 *
 * Median rather than minimum or mean so one aisle, or one gap where a seat was removed, cannot
 * redefine what "next to" means for the whole row. Null below three seats, where there are too few
 * gaps for a median to mean anything — the caller falls back to the map's overall pitch.
 */
function pitchOf(row: SeatMapSeat[]): number | null {
  if (row.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < row.length; i += 1) gaps.push(gap(row[i - 1], row[i]));
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * A maximal stretch of free seats that genuinely sit next to each other, and what is at either end.
 *
 * Adjacency is read off the GEOMETRY, not off the numbers. It used to be `seat.number ===
 * prev.number + 1`, which is only true for the one numbering scheme where seats step by one — and
 * the editor offers three others. `odd` mints 1,3,5,7 and `even` 2,4,6 (the normal way to label a
 * centre-aisle row), `num-desc` counts down, and `seatNumberStep` lets the organizer pick any step.
 * On any of those, no two seats ever satisfied `n + 1`, so every free seat became a run of one, no
 * run was ever long enough, and a buyer asking for two seats on a completely empty row was handed
 * two seats far apart labelled `scattered`. Nothing errored; the answer was just quietly worse.
 *
 * The same arithmetic ran the bounds — `numbers.has(first.number - 1)` looks, on an odd row, for an
 * even number that by construction cannot be there — so both ends always read unbounded and the
 * orphan rule from migration 0037 never fired on exactly the charts most likely to strand a seat.
 *
 * Position alone is not enough either: a seat REMOVED from a row leaves its neighbours adjacent by
 * index while a real gap sits between them (`deleteSeats` drops the entry and the rest keep their
 * offsets). So a run continues only when the next seat is both the next one along the row AND no
 * further away than the row's own pitch allows.
 */
interface FreeRun {
  seats: SeatMapSeat[];
  /** A taken seat sits immediately beside this run's first, close enough to count as its neighbour.
   *  False means an aisle, a removed seat, or the end of the row — none of which strands anybody. */
  leftBounded: boolean;
  rightBounded: boolean;
  /** Every free seat in the row, for the centre-of-row tie-break. */
  freeRow: SeatMapSeat[];
}

function freeRunsOf(
  row: SeatMapSeat[],
  free: (s: SeatMapSeat) => boolean,
  fallbackPitch: number,
): FreeRun[] {
  const pitch = pitchOf(row) ?? fallbackPitch;
  const near = (a: SeatMapSeat, b: SeatMapSeat) => gap(a, b) <= pitch * ADJACENT_TOLERANCE;
  const indexInRow = new Map(row.map((s, i) => [s.id, i]));
  const freeRow = row.filter(free);

  const runs: SeatMapSeat[][] = [];
  let run: SeatMapSeat[] = [];
  for (let i = 0; i < freeRow.length; i += 1) {
    const seat = freeRow[i];
    const prev = freeRow[i - 1];
    const follows =
      prev !== undefined &&
      indexInRow.get(seat.id) === (indexInRow.get(prev.id) ?? -2) + 1 &&
      near(prev, seat);
    if (follows) run.push(seat);
    else {
      if (run.length > 0) runs.push(run);
      run = [seat];
    }
  }
  if (run.length > 0) runs.push(run);

  return runs.map((r) => {
    const firstIdx = indexInRow.get(r[0].id) ?? 0;
    const lastIdx = indexInRow.get(r[r.length - 1].id) ?? row.length - 1;
    const before = row[firstIdx - 1];
    const after = row[lastIdx + 1];
    return {
      seats: r,
      // A neighbour further away than the pitch allows is across an aisle, and a lone seat beside an
      // aisle is precisely what `balanced` is willing to leave behind.
      leftBounded: !!before && near(before, r[0]),
      rightBounded: !!after && near(r[r.length - 1], after),
      freeRow,
    };
  });
}

/** Distance to the focal point, plus a penalty for sitting off to one side of the row. */
function scoreOf(
  windowSeats: SeatMapSeat[],
  freeRow: SeatMapSeat[],
  focal: { x: number; y: number },
): number {
  const want = windowSeats.length;
  const cx = windowSeats.reduce((sum, s) => sum + s.x, 0) / want;
  const cy = windowSeats.reduce((sum, s) => sum + s.y, 0) / want;
  const dist = Math.hypot(cx - focal.x, cy - focal.y);
  // Centre-of-row bonus: penalise runs pushed toward the ends of the row. Normalised against the
  // row's own length so a 2-seat pick in a 20-seat row and one in a short row stay comparable.
  const firstIdx = freeRow.indexOf(windowSeats[0]);
  const centreOffset =
    Math.abs(firstIdx + (want - 1) / 2 - (freeRow.length - 1) / 2) / freeRow.length;
  return dist + centreOffset * 250;
}

/**
 * Pick `count` seats.
 *
 * Three attempts, in this order, which is the order a human would try them in:
 *
 *  1. Seats together on one row that leave NO orphan behind.
 *  2. Seats together on one row, accepting that a lone seat gets stranded — better to seat this
 *     buyer than to protect a hypothetical future one.
 *  3. The nearest `count` free seats anywhere, no longer together. A busy show genuinely may not
 *     have four seats in a row left, and refusing to answer is worse than answering honestly —
 *     PROVIDED the answer says so, which is what `match: "scattered"` is for.
 *
 * The old version stopped after step 2 and returned `no_run_fits`, so a buyer wanting four seats in
 * a nearly-full house was told no while dozens of seats sat unsold.
 *
 * `heldIds` is the buyer's OWN current hold. It is folded into the free filter (not a post-check)
 * because the buyer's seats can still read `available` locally for a beat after they click — the
 * socket has not caught up — so a second "best" click must not offer them a seat they already hold.
 */
export function bestSeats(
  seats: SeatMapSeat[],
  elements: SeatMapElement[] | undefined,
  count: number,
  heldIds: ReadonlySet<number> = new Set(),
  orphanRule: OrphanRule = "balanced",
): BestSeatChoice {
  const want = Math.max(1, Math.floor(count));
  const focal = focalPoint(seats, elements);
  if (focal === null) return { seats: [], reason: "none_available", match: null };

  const free = (s: SeatMapSeat) => s.status === "available" && !heldIds.has(s.id);
  const freeSeats = seats.filter(free);
  if (freeSeats.length === 0) return { seats: [], reason: "none_available", match: null };
  // Nothing on any of the three rungs can conjure seats that do not exist.
  if (freeSeats.length < want) return { seats: [], reason: "no_run_fits", match: null };

  let bestClean: { run: SeatMapSeat[]; score: number } | null = null;
  let bestAny: { run: SeatMapSeat[]; score: number } | null = null;

  /*
   * A pitch for rows too short to have one of their own.
   *
   * Median across every row in the map: a two-seat row cannot say whether its pair is a neighbouring
   * pair or opposite ends of a bench, and the rest of the chart can.
   */
  const rows = groupByRow(seats);
  const rowPitches = rows.map(pitchOf).filter((p): p is number => p !== null).sort((a, b) => a - b);
  // Last resort, when no row in the map is long enough to measure: the nominal seat size. Seats
  // closer together than this overlap (`seatmap-validate`), so it is the tightest a real pitch can
  // be — and a floor is the safe direction to be wrong in. Treating an unmeasurable map as "every
  // seat neighbours every other" would offer a buyer opposite ends of a bench as a pair.
  const fallbackPitch = rowPitches[Math.floor(rowPitches.length / 2)] ?? SEAT_DIAMETER;

  for (const row of rows) {
    for (const run of freeRunsOf(row, free, fallbackPitch)) {
      const r = run.seats;
      if (r.length < want) continue;
      // Every window of `want` inside this contiguous run — a 5-seat run serves two 3-seat windows,
      // and the better-centred one should win.
      for (let start = 0; start + want <= r.length; start += 1) {
        const windowSeats = r.slice(start, start + want);
        const leftRemainder = start;
        const rightRemainder = r.length - start - want;
        const strands = (remainder: number, bounded: boolean) =>
          remainder === 1 && (orphanRule === "strict" || bounded);
        const orphaned =
          strands(leftRemainder, run.leftBounded) || strands(rightRemainder, run.rightBounded);

        const score = scoreOf(windowSeats, run.freeRow, focal);
        const candidate = { run: windowSeats, score };
        if (!bestAny || score < bestAny.score) bestAny = candidate;
        if (!orphaned && (!bestClean || score < bestClean.score)) bestClean = candidate;
      }
    }
  }

  if (bestClean) return { seats: bestClean.run, reason: null, match: "adjacent_no_orphan" };
  if (bestAny) return { seats: bestAny.run, reason: null, match: "adjacent" };

  // Rung 3. Sorted back into section → row → number afterwards so the summary reads in the order the
  // buyer will walk the room, not in order of distance from the stage.
  const scattered = [...freeSeats]
    .sort((a, b) => Math.hypot(a.x - focal.x, a.y - focal.y) - Math.hypot(b.x - focal.x, b.y - focal.y))
    .slice(0, want)
    .sort(
      (a, b) =>
        (a.section ?? "").localeCompare(b.section ?? "") ||
        a.row.localeCompare(b.row) ||
        a.number - b.number,
    );
  return { seats: scattered, reason: null, match: "scattered" };
}
