/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SeatMapElement, SeatMapSeat } from "@/shared/catalog/types";

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
 *     stage's centre when the map carries one, else the seat nearest the top of the room (the
 *     convention every chart draws by: row A faces the stage at low y). Distance dominates the
 *     score; among runs at similar distance, the one nearer the middle of its row wins, because a
 *     run of 2 in a row of 20 is better centred than one hugging the aisle.
 *  3. FAIR PRICE IS NOT A FACTOR. Cheap-first would silently steer every buyer to the worst cheap
 *     seat, and the tier is already a colour and a legend. Distance and geometry decide; what the
 *     run costs is shown afterwards, exactly like the map shows everything else.
 *
 * Pure on purpose — the whole thing is testable without a DOM, and the buyer screen calls it with
 * whatever seats it currently shows.
 */

export interface BestSeatChoice {
  seats: SeatMapSeat[];
  /** Why there is no answer, when `seats` is empty. */
  reason: "none_available" | "no_run_fits" | null;
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

/** Group seats into rows keyed by `${section}·${row}`, each sorted by seat number. A run is only
 *  a run within one row of one section — crossing either breaks contiguity for the buyer. */
function groupByRow(seats: SeatMapSeat[]): SeatMapSeat[][] {
  const map = new Map<string, SeatMapSeat[]>();
  for (const seat of seats) {
    const key = `${seat.section ?? ""}·${seat.row}`;
    const row = map.get(key);
    if (row) row.push(seat);
    else map.set(key, [seat]);
  }
  return [...map.values()].map((row) => row.sort((a, b) => a.number - b.number));
}

/** Every maximal run of CONSECUTIVE seat numbers within a sorted row. Seat numbers, not array
 *  adjacency: row [1,2,3,5,6] holds the runs [1,2,3] and [5,6], and a 2-seat pick inside it must
 *  never take seats 3 and 5. */
function consecutiveRuns(sortedRow: SeatMapSeat[]): SeatMapSeat[][] {
  const runs: SeatMapSeat[][] = [];
  let run: SeatMapSeat[] = [];
  for (let i = 0; i < sortedRow.length; i += 1) {
    const seat = sortedRow[i];
    const prev = sortedRow[i - 1];
    if (prev && seat.number === prev.number + 1) run.push(seat);
    else {
      if (run.length > 0) runs.push(run);
      run = [seat];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Pick `count` seats. Returns up to `count` consecutive, available seats on one row, chosen to be
 * nearest the focal point and, at a tie, most centred. Returns an empty `seats` array with a
 * `reason` when nothing fits — the caller decides what to tell the buyer.
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
): BestSeatChoice {
  const want = Math.max(1, Math.floor(count));
  const focal = focalPoint(seats, elements);
  if (focal === null) return { seats: [], reason: "none_available" };

  const free = (s: SeatMapSeat) => s.status === "available" && !heldIds.has(s.id);
  const rows = groupByRow(seats.filter(free));
  if (rows.every((r) => r.length === 0)) return { seats: [], reason: "none_available" };

  interface Candidate {
    run: SeatMapSeat[];
    score: number;
  }
  let best: Candidate | null = null;

  for (const row of rows) {
    for (const run of consecutiveRuns(row)) {
      if (run.length < want) continue;
      // Every window of `want` inside this contiguous run — a 5-seat run serves two 3-seat windows,
      // and the better-centred one should win.
      for (let start = 0; start + want <= run.length; start += 1) {
        const windowSeats = run.slice(start, start + want);
        const cx = windowSeats.reduce((sum, s) => sum + s.x, 0) / want;
        const cy = windowSeats.reduce((sum, s) => sum + s.y, 0) / want;
        const dist = Math.hypot(cx - focal.x, cy - focal.y);
        // Centre-of-row bonus: penalise runs pushed toward the ends of the row. Normalised against
        // the row's own length so a 2-seat pick in a 20-seat row and one in a short row stay
        // comparable.
        const firstIdx = run.indexOf(windowSeats[0]);
        const centreOffset =
          Math.abs(firstIdx + (want - 1) / 2 - (row.length - 1) / 2) / row.length;
        const score = dist + centreOffset * 250;
        if (!best || score < best.score) best = { run: windowSeats, score };
      }
    }
  }

  if (!best) return { seats: [], reason: "no_run_fits" };
  return { seats: best.run, reason: null };
}
