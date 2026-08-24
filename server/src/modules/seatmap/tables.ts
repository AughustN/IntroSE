import type { LayoutTable } from "@shared/catalog/seatmap.js";
import { clampCoord, normaliseRotation } from "@shared/catalog/seatmap-validate.js";
import { tableSeatOffsets } from "@shared/catalog/seatmap-tables.js";
import type pg from "pg";
import {
  LAYOUT_MAX_SEATS,
  LAYOUT_MAX_TABLES,
  TABLE_MAX_SEATS,
  TABLE_MIN_SEATS,
} from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { defaultCategoryId, forgetDocument } from "./layouts.repo.js";
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
  /** Imparted to this table's seats, like its section. Defaults to the layout's first category. */
  categoryId?: number | null;
  /** `whole_table` groups the table's seats into one pick on the buyer's map (§3). */
  bookingMode?: "per_seat" | "whole_table";
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

/**
 * Where each seat goes, in ABSOLUTE coordinates — the shape from `shared/catalog/seatmap-tables.ts`
 * with the table's own position and rotation applied.
 *
 * The shape itself moved to `shared/` so the document projection can lay a `table` block out the same
 * way (Principle VI). A table drawn through this endpoint and the same table expressed in a document
 * must land in the same place, or re-saving a chart would move every table seat.
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
  const rot = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return tableSeatOffsets(t).map((s) => ({
    x: clampCoord(Math.round(t.x + s.dx * cos - s.dy * sin)),
    y: clampCoord(Math.round(t.y + s.dx * sin + s.dy * cos)),
    rotation: normaliseRotation(Math.round(s.rotation + t.rotation)),
  }));
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
  // A table imparts its category to its seats, exactly as it imparts its section (FR-049).
  const categoryId = t.categoryId ?? (await defaultCategoryId(layoutId, client));
  // Any table mutation rewrites seats outside the document, so the document no longer describes the
  // layout. The next read adopts a fresh one from the rows.
  await forgetDocument(layoutId, client);
  const spots = distributeSeats(t);
  for (const [i, spot] of spots.entries()) {
    await client.query(
      `INSERT INTO seats (layout_id, section_id, category_id, table_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
       VALUES ($1, $2, $9, $3, $4, $5, 'single', $6, $7, $8)`,
      [layoutId, t.sectionId, tableId, t.name, i + 1, spot.x, spot.y, spot.rotation, categoryId],
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
      `INSERT INTO layout_tables (layout_id, section_id, category_id, name, shape, pos_x, pos_y, width, height,
                                  rotation, seat_count, side_counts, booking_mode)
       VALUES ($1, $2, $12, $3, $4, $5, $6, $7, $8, $9, $10, $11, $13) RETURNING id`,
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
        input.categoryId ?? null,
        input.bookingMode ?? "per_seat",
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
      category_id: number | null;
      booking_mode: "per_seat" | "whole_table";
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
      // A PATCH that does not mention these keeps what is stored, rather than silently resetting a
      // table to per-seat or unclassifying its seats.
      categoryId: patch.categoryId !== undefined ? patch.categoryId : cur.category_id,
      bookingMode: patch.bookingMode ?? cur.booking_mode,
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
                                width = $7, height = $8, rotation = $9, seat_count = $10, side_counts = $11,
                                category_id = $12, booking_mode = $13
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
        next.categoryId ?? null,
        next.bookingMode ?? "per_seat",
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
    const { rows: owner } = await client.query<{ layout_id: number }>(
      `SELECT layout_id FROM layout_tables WHERE id = $1`,
      [tableId],
    );
    await client.query(`DELETE FROM seats WHERE table_id = $1`, [tableId]);
    await client.query(`DELETE FROM layout_tables WHERE id = $1`, [tableId]);
    // Seats went away outside the document, so it no longer describes the layout.
    if (owner[0]) await forgetDocument(owner[0].layout_id, client);
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
