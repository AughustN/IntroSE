/**
 * Standing areas — the in-scope substitute for a commercial builder's "fan zone" (FR-080).
 *
 * A commercial fan zone is an area bought by HEADCOUNT: the buyer says "three of us" and the system
 * decrements a number. TixHub cannot express that, because a showtime is strictly seated or general
 * admission and feature 003's reservation invariant depends on it (a reservation is one or the other,
 * never mixed). Making it mixed is its own feature with its own concurrency and checkout work.
 *
 * So a standing area here is exactly what the existing machinery already sells: a section of ordinary
 * seats whose `seat_type` is `standing`, generated at positions inside a drawn shape. Each position is
 * held, released, and sold through the unchanged 003/004 path — nothing about how a seat is claimed
 * changes, only where it is drawn. The honest difference from a fan zone is that a buyer picks a
 * position rather than a headcount; the honest gain is that it needs no new concurrency work at all.
 */

import { pointInPolygon } from '@shared/catalog/seatmap-validate.js';
import type { ShapePoint } from '@shared/catalog/seatmap.js';
import {
  LAYOUT_MAX_SEATS,
  POLYGON_MAX_POINTS,
  POLYGON_MIN_POINTS,
  SEAT_DIAMETER,
} from '../../config.js';
import { withTransaction, type Db } from '../../db/pool.js';
import { err } from '../../http.js';

export interface StandingAreaInput {
  sectionId: number;
  /** Row label the positions share, e.g. "ĐỨNG" — keeps (section, row, number) unique as before. */
  rowLabel: string;
  count: number;
  points: ShapePoint[];
}

/**
 * Positions on a square grid, clipped to the polygon.
 *
 * The grid pitch is the seat diameter plus a margin, which is the same footprint the publish-time
 * overlap rule measures — so an area that generates cleanly also validates cleanly. Row-major order
 * makes the numbering read top-to-bottom, left-to-right, matching how the buyer's map is tabbed.
 */
export function standingPositions(points: ShapePoint[], count: number): { x: number; y: number }[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pitch = Math.round(SEAT_DIAMETER * 1.2);
  const out: { x: number; y: number }[] = [];
  for (let y = minY + pitch / 2; y <= maxY && out.length < count; y += pitch) {
    for (let x = minX + pitch / 2; x <= maxX && out.length < count; x += pitch) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (pointInPolygon({ x: px, y: py }, points)) out.push({ x: px, y: py });
    }
  }
  return out;
}

/**
 * Generate a standing area, and draw the shape it was generated inside.
 *
 * The shape is stored as an ordinary `area` element carrying the same points, so the drawn area and
 * the positions inside it cannot drift apart: both are written in one transaction from one polygon.
 */
export async function createStandingArea(layoutId: number, input: StandingAreaInput): Promise<number> {
  if (input.points.length < POLYGON_MIN_POINTS || input.points.length > POLYGON_MAX_POINTS) {
    throw err.badRequest(
      'invalid_polygon',
      `Vùng đứng cần từ ${POLYGON_MIN_POINTS} đến ${POLYGON_MAX_POINTS} điểm.`,
    );
  }

  return withTransaction(async (client) => {
    const { rows: cur } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM seats WHERE layout_id = $1`,
      [layoutId],
    );
    if (Number(cur[0].n) + input.count > LAYOUT_MAX_SEATS) {
      throw err.conflict('seat_limit_reached', `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế.`);
    }

    const positions = standingPositions(input.points, input.count);
    // Refused rather than silently generating fewer: an organizer who asked for 200 places and got 140
    // would only discover it when 60 buyers could not stand anywhere (Principle I).
    if (positions.length < input.count) {
      throw err.conflict(
        'area_too_small',
        `Vùng đã vẽ chỉ chứa được ${positions.length} chỗ đứng, cần ${input.count}. Hãy vẽ vùng rộng hơn.`,
      );
    }

    // Numbering continues past whatever the row already holds, so generating twice into the same row
    // extends the area instead of colliding on (section, row, number).
    const { rows: last } = await client.query<{ max_n: number | null }>(
      `SELECT max(seat_number) AS max_n FROM seats
        WHERE layout_id = $1 AND section_id = $2 AND row_label = $3`,
      [layoutId, input.sectionId, input.rowLabel],
    );
    const from = (last[0].max_n ?? 0) + 1;

    const res = await client.query(
      `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
       SELECT $1, $2, $3, $4::int + i, 'standing', p.x, p.y, 0
         FROM unnest($5::int[], $6::int[]) WITH ORDINALITY AS p(x, y, i)
       ON CONFLICT (section_id, row_label, seat_number) DO NOTHING`,
      [
        layoutId,
        input.sectionId,
        input.rowLabel,
        from - 1,
        positions.map((p) => p.x),
        positions.map((p) => p.y),
      ],
    );

    await client.query(
      `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label, points)
       VALUES ($1, 'area', $2, $3, $4, $5, 0, $6, $7::jsonb)`,
      [
        layoutId,
        Math.round((Math.min(...input.points.map((p) => p.x)) + Math.max(...input.points.map((p) => p.x))) / 2),
        Math.round((Math.min(...input.points.map((p) => p.y)) + Math.max(...input.points.map((p) => p.y))) / 2),
        Math.max(...input.points.map((p) => p.x)) - Math.min(...input.points.map((p) => p.x)),
        Math.max(...input.points.map((p) => p.y)) - Math.min(...input.points.map((p) => p.y)),
        input.rowLabel,
        JSON.stringify(input.points),
      ],
    );

    return res.rowCount ?? 0;
  });
}

/**
 * The invariant this whole design exists to preserve (SC-026): a showtime is seated or general
 * admission, never both. Exported so the guard is one function with one test, not a condition
 * repeated wherever someone is tempted to relax it.
 */
export async function isMixedShowtime(showtimeId: number, db: Db): Promise<boolean> {
  const { rows } = await db.query<{ seated: string; ga: string }>(
    `SELECT (SELECT count(*) FROM showtime_seats WHERE showtime_id = $1)::text AS seated,
            (SELECT count(*) FROM ticket_tiers
              WHERE showtime_id = $1 AND total_quantity IS NOT NULL)::text AS ga`,
    [showtimeId],
  );
  return Number(rows[0].seated) > 0 && Number(rows[0].ga) > 0;
}
