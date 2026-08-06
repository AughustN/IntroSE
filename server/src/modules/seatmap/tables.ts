import type { LayoutTable } from "@shared/catalog/seatmap.js";
import { clampCoord, normaliseRotation } from "@shared/catalog/seatmap-validate.js";
import type pg from "pg";
import {
  LAYOUT_MAX_SEATS,
  LAYOUT_MAX_TABLES,
  TABLE_MAX_SEATS,
  TABLE_MIN_SEATS,
} from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { err, HttpError } from "../../http.js";

/**
 * Tables (feature 005 amendment, FR-047..FR-056) — the gala-dinner layout.
 *
 * A table is a DRAWING object that owns seats. Its seats are ordinary seats: they belong to a
 * section, carry a tier, and are held and sold by features 003 and 004 completely unchanged. The
 * table row exists only so the editor can move, rotate, rename and re-count a group as one thing.
 *
 * Seats are stored as ABSOLUTE coordinates, not offsets from the table, so every existing reader —
 * the renderers, the overlap test, the snapshot — keeps working unchanged and a table seat is
 * indistinguishable from any other seat to everything except the editor (R-19). The cost is that
 * moving a table means recomputing its seats, which is why the sold/held guard sits in front of it.
 */

export interface TableInput {
  sectionId: number | null;
  name: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  seatCount: number;
  sideCounts?: number[] | null;
}

/** How far outside the table edge a seat sits, in layout units. */
const SEAT_GAP = 90;

/**
 * Where each seat goes. Round tables space evenly around the circumference; rectangular tables walk
 * the per-side counts around the perimeter, clockwise from the top (FR-048).
 *
 * Returns absolute coordinates plus a rotation that faces each seat toward the table.
 */
export function distributeSeats(t: {
  shape: "round" | "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  seatCount: number;
  sideCounts?: number[] | null;
}): { x: number; y: number; rotation: number }[] {
  const spots: { x: number; y: number; rotation: number }[] = [];

  if (t.shape === "round") {
    const radius = t.width / 2 + SEAT_GAP;
    for (let i = 0; i < t.seatCount; i++) {
      const angle = (2 * Math.PI * i) / t.seatCount;
      spots.push({
        x: t.x + radius * Math.sin(angle),
        y: t.y - radius * Math.cos(angle),
        // Face the centre: a seat at the top looks down, one at the bottom looks up.
        rotation: (angle * 180) / Math.PI + 180,
      });
    }
  } else {
    // Sides clockwise from the top: [top, right, bottom, left]. Absent counts spread as evenly as
    // the count allows, so a bare `seatCount` on a rectangle still produces a sensible table.
    const sides = normaliseSideCounts(t.seatCount, t.sideCounts);
    const halfW = t.width / 2 + SEAT_GAP;
    const halfH = t.height / 2 + SEAT_GAP;

    const place = (n: number, fn: (k: number) => { x: number; y: number; rotation: number }) => {
      for (let k = 0; k < n; k++) spots.push(fn(k));
    };
    // Each seat sits at the (k+1)/(n+1) point along its side, so a side is symmetric about its centre.
    const along = (n: number, k: number) => (k + 1) / (n + 1) - 0.5;

    place(sides[0], (k) => ({
      x: t.x + along(sides[0], k) * t.width,
      y: t.y - halfH,
      rotation: 180,
    }));
    place(sides[1], (k) => ({
      x: t.x + halfW,
      y: t.y + along(sides[1], k) * t.height,
      rotation: 270,
    }));
    place(sides[2], (k) => ({
      x: t.x - along(sides[2], k) * t.width,
      y: t.y + halfH,
      rotation: 0,
    }));
    place(sides[3], (k) => ({
      x: t.x - halfW,
      y: t.y - along(sides[3], k) * t.height,
      rotation: 90,
    }));
  }

  // The table's own rotation turns the whole arrangement about its centre.
  const rot = (t.rotation * Math.PI) / 180;
  return spots.map((s) => {
    const dx = s.x - t.x;
    const dy = s.y - t.y;
    return {
      x: clampCoord(Math.round(t.x + dx * Math.cos(rot) - dy * Math.sin(rot))),
      y: clampCoord(Math.round(t.y + dx * Math.sin(rot) + dy * Math.cos(rot))),
      rotation: normaliseRotation(Math.round(s.rotation + t.rotation)),
    };
  });
}

/** Spread `total` over four sides when the organizer did not say how. */
function normaliseSideCounts(
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

// ---- guards ---------------------------------------------------------------

function assertSeatCount(n: number): void {
  if (!Number.isInteger(n) || n < TABLE_MIN_SEATS || n > TABLE_MAX_SEATS) {
    throw err.badRequest(
      "validation_failed",
      `Một bàn phải có từ ${TABLE_MIN_SEATS} đến ${TABLE_MAX_SEATS} ghế.`,
    );
  }
}

/**
 * The whole point of the tables design: nothing may disturb a seat someone has bought or is holding.
 * Refused WHOLE, naming the seats, using the vocabulary the shipped map editor already speaks
 * (FR-051, FR-052).
 */
async function assertNoCommittedSeats(client: pg.PoolClient, tableId: number): Promise<void> {
  const { rows } = await client.query<{ status: "sold" | "held"; n: number; labels: string[] }>(
    `SELECT ss.status, count(*)::int AS n, array_agg(ss.row_label || ' - Ghế ' || ss.seat_number) AS labels
       FROM showtime_seats ss
       JOIN seats s ON s.id = ss.seat_id
      WHERE s.table_id = $1
        AND (ss.status = 'sold' OR (ss.status = 'held' AND ss.hold_expires_at > now()))
      GROUP BY ss.status`,
    [tableId],
  );
  if (rows.length === 0) return;

  // A sold seat is the harder stop, so report it first when both are present.
  const sold = rows.find((r) => r.status === "sold");
  const row = sold ?? rows[0];
  const code = row.status === "sold" ? "seat_sold" : "seat_held";
  const what = row.status === "sold" ? "đã bán" : "đang được giữ";
  throw new HttpError(
    409,
    code,
    `Không thể thay đổi bàn này: ${row.n} ghế ${what} (${row.labels.slice(0, 5).join(", ")}).`,
    {
      seats: row.n,
    },
  );
}

async function assertNameFree(
  client: pg.PoolClient,
  layoutId: number,
  sectionId: number | null,
  name: string,
  excludeTableId?: number,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM layout_tables
      WHERE layout_id = $1 AND name = $2 AND section_id IS NOT DISTINCT FROM $3
        AND ($4::bigint IS NULL OR id <> $4)
      LIMIT 1`,
    [layoutId, name, sectionId, excludeTableId ?? null],
  );
  if (rows.length > 0) {
    throw err.conflict(
      "table_name_taken",
      `Khu vực này đã có bàn tên "${name}". Hãy đặt tên khác.`,
    );
  }
}

/** Table seats share the layout's seat budget — tables get no separate allowance (FR-055). */
async function assertSeatBudget(
  client: pg.PoolClient,
  layoutId: number,
  adding: number,
): Promise<void> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM seats WHERE layout_id = $1`,
    [layoutId],
  );
  if (rows[0].n + adding > LAYOUT_MAX_SEATS) {
    throw err.conflict(
      "seat_limit_reached",
      `Sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế; thêm bàn này sẽ vượt quá.`,
    );
  }
}

// ---- writes ---------------------------------------------------------------

/** Replace a table's seats with a freshly distributed set. Callers guard inventory FIRST. */
async function writeSeats(
  client: pg.PoolClient,
  layoutId: number,
  tableId: number,
  t: TableInput,
): Promise<void> {
  await client.query(`DELETE FROM seats WHERE table_id = $1`, [tableId]);
  const spots = distributeSeats(t);
  for (const [i, spot] of spots.entries()) {
    await client.query(
      `INSERT INTO seats (layout_id, section_id, table_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
       VALUES ($1, $2, $3, $4, $5, 'single', $6, $7, $8)`,
      [layoutId, t.sectionId, tableId, t.name, i + 1, spot.x, spot.y, spot.rotation],
    );
  }
}

export async function createTable(layoutId: number, input: TableInput): Promise<LayoutTable> {
  assertSeatCount(input.seatCount);

  return withTransaction(async (client) => {
    const { rows: count } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM layout_tables WHERE layout_id = $1`,
      [layoutId],
    );
    if (count[0].n >= LAYOUT_MAX_TABLES) {
      throw err.conflict(
        "table_limit_reached",
        `Mỗi sơ đồ chỉ có tối đa ${LAYOUT_MAX_TABLES} bàn.`,
      );
    }
    await assertNameFree(client, layoutId, input.sectionId, input.name);
    await assertSeatBudget(client, layoutId, input.seatCount);

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO layout_tables (layout_id, section_id, name, shape, pos_x, pos_y, width, height, rotation, seat_count, side_counts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        layoutId,
        input.sectionId,
        input.name,
        input.shape,
        clampCoord(input.x),
        clampCoord(input.y),
        input.width,
        input.height,
        normaliseRotation(input.rotation),
        input.seatCount,
        input.sideCounts ? JSON.stringify(input.sideCounts) : null,
      ],
    );
    const tableId = rows[0].id;
    await writeSeats(client, layoutId, tableId, input);
    return { id: tableId, ...input };
  });
}

export async function updateTable(
  tableId: number,
  patch: Partial<TableInput>,
): Promise<LayoutTable> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      layout_id: number;
      section_id: number | null;
      name: string;
      shape: "round" | "rect";
      pos_x: number;
      pos_y: number;
      width: number;
      height: number;
      rotation: number;
      seat_count: number;
      side_counts: number[] | null;
    }>(`SELECT * FROM layout_tables WHERE id = $1 FOR UPDATE`, [tableId]);
    const cur = rows[0];
    if (!cur) throw err.notFound("not_found", "Không tìm thấy bàn.");

    const next: TableInput = {
      sectionId: patch.sectionId !== undefined ? patch.sectionId : cur.section_id,
      name: patch.name ?? cur.name,
      shape: patch.shape ?? cur.shape,
      x: patch.x ?? cur.pos_x,
      y: patch.y ?? cur.pos_y,
      width: patch.width ?? cur.width,
      height: patch.height ?? cur.height,
      rotation: patch.rotation ?? cur.rotation,
      seatCount: patch.seatCount ?? cur.seat_count,
      sideCounts: patch.sideCounts !== undefined ? patch.sideCounts : cur.side_counts,
    };
    assertSeatCount(next.seatCount);

    // Every field of a table moves, relabels or removes its seats, so any change at all is gated on
    // inventory. Refused whole — nothing below this line runs (FR-051).
    await assertNoCommittedSeats(client, tableId);
    await assertNameFree(client, cur.layout_id, next.sectionId, next.name, tableId);
    if (next.seatCount > cur.seat_count) {
      await assertSeatBudget(client, cur.layout_id, next.seatCount - cur.seat_count);
    }

    await client.query(
      `UPDATE layout_tables SET section_id = $2, name = $3, shape = $4, pos_x = $5, pos_y = $6,
                                width = $7, height = $8, rotation = $9, seat_count = $10, side_counts = $11
        WHERE id = $1`,
      [
        tableId,
        next.sectionId,
        next.name,
        next.shape,
        clampCoord(next.x),
        clampCoord(next.y),
        next.width,
        next.height,
        normaliseRotation(next.rotation),
        next.seatCount,
        next.sideCounts ? JSON.stringify(next.sideCounts) : null,
      ],
    );
    await writeSeats(client, cur.layout_id, tableId, next);
    return { id: tableId, ...next };
  });
}

export async function deleteTable(tableId: number): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT 1 FROM layout_tables WHERE id = $1 FOR UPDATE`, [
      tableId,
    ]);
    if (rows.length === 0) throw err.notFound("not_found", "Không tìm thấy bàn.");

    await assertNoCommittedSeats(client, tableId);
    await client.query(`DELETE FROM seats WHERE table_id = $1`, [tableId]);
    await client.query(`DELETE FROM layout_tables WHERE id = $1`, [tableId]);
  });
}

/** The layout a table belongs to, for the ownership check the routes perform. */
export async function tableLayoutId(tableId: number): Promise<number | null> {
  const { rows } = await pool.query<{ layout_id: number }>(
    `SELECT layout_id FROM layout_tables WHERE id = $1`,
    [tableId],
  );
  return rows[0]?.layout_id ?? null;
}
