// Where a table's seats sit, shared by the server's table endpoints and the document projection.
//
// This lived only in `server/src/modules/seatmap/tables.ts`, which is why a `table` block in a
// ChartDocument produced NOTHING: the projection's `seatOffsets` had no ring branch and fell through
// to the rectangular grid it uses for a seating block, so a round table came out as a square of
// seats sitting on top of itself. The starters worked around it by authoring their own rings, and
// those rings had no `layout_tables` row behind them.
//
// One implementation, two callers (Principle VI). The two must not disagree about where seat 3 of a
// ten-seat round table is: a table drawn through the endpoint and the same table expressed in a
// document have to land in the same place, or re-saving a chart moves every table seat.

/** How far outside the table edge a seat sits, in layout units. */
export const TABLE_SEAT_GAP = 90;

/** Spread `total` over four sides when the organizer did not say how. */
export function normaliseSideCounts(
  total: number,
  given?: number[] | null,
): [number, number, number, number] {
  if (given && given.length === 4 && given.reduce((a, b) => a + b, 0) === total) {
    return [given[0], given[1], given[2], given[3]];
  }
  // Long sides first — that is how a banquet table actually seats people.
  const perLong = Math.ceil((total - 2) / 2);
  const top = Math.min(perLong, total);
  const bottom = Math.min(perLong, total - top);
  const remaining = total - top - bottom;
  return [top, remaining > 0 ? 1 : 0, bottom, remaining > 1 ? 1 : 0];
}

export interface TableShapeSpec {
  shape: "round" | "rect";
  width: number;
  height: number;
  seatCount: number;
  sideCounts?: number[] | null;
}

/**
 * Seat positions RELATIVE to the table's centre, before the table's own rotation.
 *
 * Deliberately un-rotated and un-translated. The document projection already turns a block's seats by
 * the block's rotation and offsets them from its origin, so returning absolute coordinates here would
 * rotate every table twice. `distributeSeats` on the server adds both back for the endpoint that
 * writes rows directly.
 *
 * `rotation` is the seat's own facing — toward the table — and composes with the table's rotation the
 * same way.
 */
export function tableSeatOffsets(t: TableShapeSpec): { dx: number; dy: number; rotation: number }[] {
  const spots: { dx: number; dy: number; rotation: number }[] = [];

  if (t.shape === "round") {
    const radius = t.width / 2 + TABLE_SEAT_GAP;
    for (let i = 0; i < t.seatCount; i += 1) {
      const angle = (2 * Math.PI * i) / t.seatCount;
      spots.push({
        dx: radius * Math.sin(angle),
        dy: -radius * Math.cos(angle),
        // Face the centre: a seat at the top looks down, one at the bottom looks up.
        rotation: (angle * 180) / Math.PI + 180,
      });
    }
    return spots;
  }

  // Sides clockwise from the top: [top, right, bottom, left]. Absent counts spread as evenly as the
  // count allows, so a bare `seatCount` on a rectangle still produces a sensible table.
  const sides = normaliseSideCounts(t.seatCount, t.sideCounts);
  const halfW = t.width / 2 + TABLE_SEAT_GAP;
  const halfH = t.height / 2 + TABLE_SEAT_GAP;

  const place = (n: number, fn: (k: number) => { dx: number; dy: number; rotation: number }) => {
    for (let k = 0; k < n; k += 1) spots.push(fn(k));
  };
  // Each seat sits at the (k+1)/(n+1) point along its side, so a side is symmetric about its centre.
  const along = (n: number, k: number) => (k + 1) / (n + 1) - 0.5;

  place(sides[0], (k) => ({ dx: along(sides[0], k) * t.width, dy: -halfH, rotation: 180 }));
  place(sides[1], (k) => ({ dx: halfW, dy: along(sides[1], k) * t.height, rotation: 270 }));
  place(sides[2], (k) => ({ dx: -along(sides[2], k) * t.width, dy: halfH, rotation: 0 }));
  place(sides[3], (k) => ({ dx: -halfW, dy: -along(sides[3], k) * t.height, rotation: 90 }));

  return spots;
}
