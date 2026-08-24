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

import { pointInPolygon } from "@shared/catalog/seatmap-validate.js";
import { defaultCategoryId, forgetDocument } from "./layouts.repo.js";
import type { ShapePoint } from "@shared/catalog/seatmap.js";
import {
  LAYOUT_MAX_SEATS,
  POLYGON_MAX_POINTS,
  POLYGON_MIN_POINTS,
  SEAT_DIAMETER,
} from "../../config.js";
import { withTransaction, type Db } from "../../db/pool.js";
import { err } from "../../http.js";

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
export async function createStandingArea(
  layoutId: number,
  input: StandingAreaInput,
): Promise<number> {
  if (input.points.length < POLYGON_MIN_POINTS || input.points.length > POLYGON_MAX_POINTS) {
    throw err.badRequest(
      "invalid_polygon",
      `Vùng đứng cần từ ${POLYGON_MIN_POINTS} đến ${POLYGON_MAX_POINTS} điểm.`,
    );
  }

  return withTransaction(async (client) => {
    // Two overlapping areas cannot share space honestly: whichever reshaped second would claim the
    // seats the first generated, because ownership is decided by polygon containment. Refused at
    // creation with a bounding-box test — cheap, and conservative in the safe direction (it may
    // flag two areas that merely have nearby corners, never one that truly intersects).
    const { rows: others } = await client.query<{ points: ShapePoint[] }>(
      `SELECT points FROM layout_elements
        WHERE layout_id = $1 AND kind = 'area' AND points IS NOT NULL`,
      [layoutId],
    );
    const box = (pts: ShapePoint[]) => ({
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
    });
    const a = box(input.points);
    for (const o of others) {
      const b = box(o.points);
      if (a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY) {
        throw err.conflict(
          "area_overlaps",
          "Vùng đứng chồng lên một khu đã vẽ. Hãy vẽ vùng không giao nhau với khu khác.",
        );
      }
    }

    const { rows: cur } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM seats WHERE layout_id = $1`,
      [layoutId],
    );
    if (Number(cur[0].n) + input.count > LAYOUT_MAX_SEATS) {
      throw err.conflict(
        "seat_limit_reached",
        `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế.`,
      );
    }

    const positions = standingPositions(input.points, input.count);
    // Refused rather than silently generating fewer: an organizer who asked for 200 places and got 140
    // would only discover it when 60 buyers could not stand anywhere (Principle I).
    if (positions.length < input.count) {
      throw err.conflict(
        "area_too_small",
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
      `INSERT INTO seats (layout_id, section_id, category_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
       SELECT $1, $2, $7, $3, $4::int + i, 'standing', p.x, p.y, 0
         FROM unnest($5::int[], $6::int[]) WITH ORDINALITY AS p(x, y, i)
       ON CONFLICT (section_id, row_label, seat_number) DO NOTHING`,
      [
        layoutId,
        input.sectionId,
        input.rowLabel,
        from - 1,
        positions.map((p) => p.x),
        positions.map((p) => p.y),
        await defaultCategoryId(layoutId, client),
      ],
    );

    // NO `capacity`. That column means ONE thing — "sold by head count against this class's tier"
    // (0027) — and a standing area is the opposite: its inventory is the seat rows just written, one
    // per person. Writing the generated count there made the same floor sellable twice, because
    // generation turns a zone's capacity into its tier's quantity while every seat under it stays its
    // own row: a 200-place area came out as 400 tickets. It also left the area with a capacity and no
    // class, which `zone_without_category` refuses — so a standing area could not be published at all.
    await client.query(
      `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label, points)
       VALUES ($1, 'area', $2, $3, $4, $5, 0, $6, $7::jsonb)`,
      [
        layoutId,
        Math.round(
          (Math.min(...input.points.map((p) => p.x)) + Math.max(...input.points.map((p) => p.x))) /
            2,
        ),
        Math.round(
          (Math.min(...input.points.map((p) => p.y)) + Math.max(...input.points.map((p) => p.y))) /
            2,
        ),
        Math.max(...input.points.map((p) => p.x)) - Math.min(...input.points.map((p) => p.x)),
        Math.max(...input.points.map((p) => p.y)) - Math.min(...input.points.map((p) => p.y)),
        input.rowLabel,
        JSON.stringify(input.points),
      ],
    );

    // Standing positions are generated here, not from the document, so the document no longer
    // describes this layout. The next read adopts a fresh one from the rows.
    await forgetDocument(layoutId, client);
    return res.rowCount ?? 0;
  });
}

/**
 * Re-shape an area, or change how many people it holds.
 *
 * The polygon and the positions inside it are regenerated together in one transaction, for the same
 * reason they are created together: a drawn area whose shape and headcount disagree is a lie the
 * buyer discovers at the door.
 *
 * Refused WHOLE if any position is already sold or held, using exactly the discipline tables.ts
 * applies (FR-051, FR-052) — an area is a group of seats, and dragging its corner is no more allowed
 * to disturb a paid seat than dragging a table is.
 */
export async function reshapeStandingArea(
  layoutId: number,
  elementId: number,
  input: { points: ShapePoint[]; capacity: number },
): Promise<number> {
  if (input.points.length < POLYGON_MIN_POINTS || input.points.length > POLYGON_MAX_POINTS) {
    throw err.badRequest(
      "invalid_polygon",
      `Vùng đứng cần từ ${POLYGON_MIN_POINTS} đến ${POLYGON_MAX_POINTS} điểm.`,
    );
  }

  return withTransaction(async (client) => {
    const { rows: el } = await client.query<{ label: string | null; points: ShapePoint[] | null }>(
      `SELECT label, points FROM layout_elements WHERE id = $1 AND layout_id = $2 AND kind = 'area' FOR UPDATE`,
      [elementId, layoutId],
    );
    if (!el[0]) throw err.notFound("not_found", "Không tìm thấy vùng đứng.");
    const rowLabel = el[0].label ?? "ĐỨNG";
    // The STORED polygon decides which seats belong to this area — they were generated inside it.
    // Matching by row label alone would let two areas sharing a label (the editor sends "ĐỨNG" for
    // every one, even across sections) destroy each other's seats on reshape.
    const polygon = el[0].points;
    if (!Array.isArray(polygon) || polygon.length < POLYGON_MIN_POINTS) {
      throw err.badRequest("invalid_polygon", "Vùng đứng này chưa có hình vẽ hợp lệ.");
    }

    // This area's seats: standing seats carrying its row label whose position falls inside its
    // polygon. A sibling area with the same label in another section is invisible here — a sale or
    // hold on one can neither block this reshape nor be disturbed by it.
    const { rows: candidates } = await client.query<{
      id: number;
      section_id: number | null;
      category_id: number | null;
      pos_x: number;
      pos_y: number;
    }>(
      `SELECT id, section_id, category_id, pos_x, pos_y FROM seats
        WHERE layout_id = $1 AND row_label = $2 AND seat_type = 'standing'`,
      [layoutId, rowLabel],
    );
    const mineIds = candidates
      .filter((s) => pointInPolygon({ x: s.pos_x, y: s.pos_y }, polygon))
      .map((s) => s.id);

    // Nothing here may disturb a seat someone has bought or is holding.
    if (mineIds.length > 0) {
      const { rows: committed } = await client.query<{ status: "sold" | "held"; n: number }>(
        `SELECT ss.status, count(*)::int AS n
           FROM showtime_seats ss
          WHERE ss.seat_id = ANY($1::bigint[])
            AND (ss.status = 'sold' OR (ss.status = 'held' AND ss.hold_expires_at > now()))
          GROUP BY ss.status`,
        [mineIds],
      );
      if (committed.length > 0) {
        const sold = committed.find((r) => r.status === "sold");
        const row = sold ?? committed[0];
        throw err.conflict(
          row.status === "sold" ? "seat_sold" : "seat_held",
          `Không thể sửa vùng này: ${row.n} chỗ ${row.status === "sold" ? "đã bán" : "đang được giữ"}.`,
        );
      }
    }

    const positions = standingPositions(input.points, input.capacity);
    if (positions.length < input.capacity) {
      throw err.conflict(
        "area_too_small",
        `Vùng đã vẽ chỉ chứa được ${positions.length} chỗ đứng, cần ${input.capacity}. Hãy vẽ vùng rộng hơn.`,
      );
    }

    // The area's own seats come out of the budget while being replaced, so everything ELSE is what
    // the new capacity has to fit alongside.
    const { rows: cur } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM seats WHERE layout_id = $1 AND NOT (id = ANY($2::bigint[]))`,
      [layoutId, mineIds],
    );
    if (Number(cur[0].n) + input.capacity > LAYOUT_MAX_SEATS) {
      throw err.conflict(
        "seat_limit_reached",
        `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế.`,
      );
    }

    // The replacement inherits the section and class of what it replaced (first row wins should a
    // legacy pair of areas have straddled sections), falling back to the layout's default class.
    const keep = candidates.find((s) => mineIds.includes(s.id));
    const sectionId = keep?.section_id ?? null;
    const categoryId = keep?.category_id ?? (await defaultCategoryId(layoutId, client));

    if (mineIds.length > 0) {
      await client.query(`DELETE FROM seats WHERE id = ANY($1::bigint[])`, [mineIds]);
    }
    const res = await client.query(
      `INSERT INTO seats (layout_id, section_id, category_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
       SELECT $1, $2, $3, $4, i, 'standing', p.x, p.y, 0
         FROM unnest($5::int[], $6::int[]) WITH ORDINALITY AS p(x, y, i)`,
      [
        layoutId,
        sectionId,
        categoryId,
        rowLabel,
        positions.map((p) => p.x),
        positions.map((p) => p.y),
      ],
    );

    const xs = input.points.map((p) => p.x);
    const ys = input.points.map((p) => p.y);
    await client.query(
      // `capacity` is left alone for the same reason creation never sets it — see the INSERT above.
      `UPDATE layout_elements
          SET pos_x = $2, pos_y = $3, width = $4, height = $5, points = $6::jsonb
        WHERE id = $1`,
      [
        elementId,
        Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
        Math.max(1, Math.max(...xs) - Math.min(...xs)),
        Math.max(1, Math.max(...ys) - Math.min(...ys)),
        JSON.stringify(input.points),
      ],
    );

    await forgetDocument(layoutId, client);
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
              -- category_id IS NULL separates a genuine GA leftover from a capacity zone's tier
              -- (0027): a zone tier always names its class, and its quantity is legitimate on a seated
              -- showtime. Without this clause a lawful seated-plus-standing chart reports SC-026 broken
              -- the moment one exists.
              WHERE showtime_id = $1 AND total_quantity IS NOT NULL AND category_id IS NULL)::text AS ga`,
    [showtimeId],
  );
  return Number(rows[0].seated) > 0 && Number(rows[0].ga) > 0;
}
