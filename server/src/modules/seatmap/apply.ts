import type pg from 'pg';
import type { ApplyChange, ApplyPreview, ApplyRefusal } from '@shared/catalog/seatmap.js';
import { clampCoord, normaliseRotation } from '@shared/catalog/seatmap-validate.js';
import { type Db, pool, withTransaction } from '../../db/pool.js';
import { err } from '../../http.js';
import { SHOWTIME_ON_SALE, VISIBLE_JOIN } from '../catalog/visibility.js';

/**
 * Applying a map edit to a showtime that already has bookable seats (FR-027..FR-029).
 *
 * This is the only inventory-aware module in the feature. Editing a LAYOUT never comes through here,
 * because a generated map is a snapshot and a layout edit cannot disturb a show that is on sale
 * (FR-005). Two entry points share the same classification: a direct edit of the showtime's map, and
 * a re-apply of its source layout.
 *
 * The rules, per seat (FR-028):
 *   available / blocked → anything
 *   sold                → position and rotation only; identity, tier and deletion refused
 *   held (live)         → nothing at all, and the buyer's hold is NEVER cancelled to make room
 *
 * Any refused seat rejects the WHOLE edit — the map is left exactly as it was (FR-029).
 */

/**
 * Refuse to reshape or reprice a map once its showtime is on sale.
 *
 * The per-seat rules above protect seats that are already spoken for, one at a time. They do not
 * protect the map: with them alone an organizer may, mid-sale, delete every seat still available,
 * add new ones, or move a sold seat's position — and `setTier` may reprice any seat nobody has
 * bought yet. A buyer watching the picker sees inventory and prices change under them.
 *
 * So the gate is the sale itself, not the individual seat. `SHOWTIME_ON_SALE` is the buy path's own
 * predicate, which makes the boundary exact rather than approximate: anything a buyer may hold a
 * seat on is closed to the editor, by the same test, with no third state in between.
 *
 * **Callers must hold the row locks before calling this.** Under those locks no hold can commit
 * between this check and the write it guards, which is what makes the check meaningful rather than
 * a hopeful glance — the same reason `apply` locks before it classifies.
 */
async function assertNotOnSale(client: pg.PoolClient, showtimeId: number): Promise<void> {
  const { rows } = await client.query<{ on_sale: boolean }>(
    `SELECT (${SHOWTIME_ON_SALE}) AS on_sale
       FROM showtimes s
       JOIN events e ON e.id = s.event_id
       ${VISIBLE_JOIN}
      WHERE s.id = $1`,
    [showtimeId],
  );
  if (rows[0]?.on_sale) {
    throw err.refused(409, 'sale_started', 'Suất diễn đã mở bán, không thể sửa sơ đồ ghế.', {
      refusals: [],
    });
  }
}

/** One seat as the organizer wants it to end up. */
export interface DesiredSeat {
  /** Existing bookable seat this line refers to; null for a seat being added. */
  showtimeSeatId: number | null;
  /** The layout seat it comes from — how a re-apply matches an addition to a physical seat. */
  seatId: number;
  rowLabel: string;
  seatNumber: number;
  sectionName: string | null;
  ticketTierId: number;
  x: number;
  y: number;
  rotation: number;
}

interface CurrentSeat {
  id: number;
  seat_id: number;
  row_label: string | null;
  seat_number: number | null;
  section_name: string | null;
  ticket_tier_id: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  pos_x: number | null;
  pos_y: number | null;
  rotation: number;
  live_hold: boolean;
}

const labelOf = (s: { sectionName?: string | null; section_name?: string | null; rowLabel?: string; row_label?: string | null; seatNumber?: number; seat_number?: number | null }): string => {
  const section = s.sectionName ?? s.section_name ?? null;
  const row = s.rowLabel ?? s.row_label ?? '?';
  const num = s.seatNumber ?? s.seat_number ?? '?';
  return section ? `${section} / ${row}${num}` : `${row}${num}`;
};

/**
 * Read the showtime's current map. `live_hold` is computed the same way the hold path does it — a
 * `held` row already past its expiry counts as free, so an organizer is not blocked by a hold that
 * has lapsed but which the sweep has not yet collected.
 */
async function readCurrent(showtimeId: number, db: Db): Promise<CurrentSeat[]> {
  const { rows } = await db.query<CurrentSeat>(
    `SELECT id, seat_id, row_label, seat_number, section_name, ticket_tier_id, status,
            pos_x, pos_y, rotation,
            (status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at > now()) AS live_hold
       FROM showtime_seats WHERE showtime_id = $1`,
    [showtimeId],
  );
  return rows;
}

/** Does this line change anything about the seat's identity or price class? */
function identityChanged(desired: DesiredSeat, current: CurrentSeat): boolean {
  return (
    desired.rowLabel !== current.row_label ||
    desired.seatNumber !== current.seat_number ||
    (desired.sectionName ?? null) !== (current.section_name ?? null) ||
    desired.ticketTierId !== current.ticket_tier_id
  );
}

function positionChanged(desired: DesiredSeat, current: CurrentSeat): boolean {
  return (
    clampCoord(desired.x) !== current.pos_x ||
    clampCoord(desired.y) !== current.pos_y ||
    normaliseRotation(desired.rotation) !== current.rotation
  );
}

/** Classify an edit without writing anything. Pure — used by both the preview and the apply. */
export function classify(desired: DesiredSeat[], current: CurrentSeat[]): ApplyPreview {
  const changes: ApplyChange[] = [];
  const refusals: ApplyRefusal[] = [];
  const byId = new Map(current.map((c) => [c.id, c]));
  const keptIds = new Set<number>();

  for (const d of desired) {
    if (d.showtimeSeatId === null) {
      changes.push({ kind: 'add', showtimeSeatId: null, seatLabel: labelOf(d) });
      continue;
    }
    const c = byId.get(d.showtimeSeatId);
    if (!c) {
      // Refers to a seat this showtime does not have — treat as an addition rather than failing.
      changes.push({ kind: 'add', showtimeSeatId: null, seatLabel: labelOf(d) });
      continue;
    }
    keptIds.add(c.id);

    const movedOnly = positionChanged(d, c);
    const identity = identityChanged(d, c);
    if (!movedOnly && !identity) continue; // untouched

    if (c.live_hold) {
      refusals.push({
        reason: 'seat_held',
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đang được một khách giữ. Hãy thử lại sau khi lượt giữ hết hạn.`,
      });
      continue;
    }
    if (c.status === 'sold' && identity) {
      refusals.push({
        reason: 'seat_sold',
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đã được bán: chỉ có thể đổi vị trí hiển thị, không đổi nhãn, khu vực hay hạng vé.`,
      });
      continue;
    }
    changes.push({
      kind: identity ? (d.ticketTierId !== c.ticket_tier_id ? 'retier' : 'relabel') : 'move',
      showtimeSeatId: c.id,
      seatLabel: labelOf(d),
    });
  }

  for (const c of current) {
    if (keptIds.has(c.id)) continue;
    if (c.live_hold) {
      refusals.push({
        reason: 'seat_held',
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đang được một khách giữ, không thể xoá.`,
      });
      continue;
    }
    if (c.status === 'sold') {
      refusals.push({
        reason: 'seat_sold',
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đã được bán, không thể xoá khỏi sơ đồ.`,
      });
      continue;
    }
    changes.push({ kind: 'remove', showtimeSeatId: c.id, seatLabel: labelOf(c) });
  }

  return { changes, refusals, wouldSucceed: refusals.length === 0 };
}

/** Preview only — writes nothing (FR-027a). Advisory: re-classified under lock on confirm. */
export async function preview(showtimeId: number, desired: DesiredSeat[]): Promise<ApplyPreview> {
  return classify(desired, await readCurrent(showtimeId, pool));
}

/**
 * Apply an edit. Locks every touched row, re-classifies under the lock, and refuses the whole edit
 * if anything came up refused — so a sale or hold landing between preview and confirm is never
 * silently overwritten (research R-6, Principle I).
 */
export async function apply(showtimeId: number, desired: DesiredSeat[]): Promise<ApplyPreview> {
  return withTransaction(async (client) => {
    // Lock first, then read: whatever we classify cannot move underneath us.
    await client.query(`SELECT id FROM showtime_seats WHERE showtime_id = $1 FOR UPDATE`, [showtimeId]);
    await assertNotOnSale(client, showtimeId);
    const current = await readCurrent(showtimeId, client);
    const outcome = classify(desired, current);
    if (!outcome.wouldSucceed) return outcome; // caller turns this into 409; the txn wrote nothing

    const byId = new Map(current.map((c) => [c.id, c]));
    const keptIds = new Set<number>();

    for (const d of desired) {
      const c = d.showtimeSeatId === null ? undefined : byId.get(d.showtimeSeatId);
      if (c) {
        keptIds.add(c.id);
        await client.query(
          `UPDATE showtime_seats
              SET pos_x = $2, pos_y = $3, rotation = $4, row_label = $5, seat_number = $6,
                  section_name = $7, ticket_tier_id = $8
            WHERE id = $1`,
          [
            c.id,
            clampCoord(d.x),
            clampCoord(d.y),
            normaliseRotation(d.rotation),
            d.rowLabel,
            d.seatNumber,
            d.sectionName,
            d.ticketTierId,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status,
                                       pos_x, pos_y, rotation, row_label, seat_number, section_name)
           VALUES ($1, $2, $3, 'available', $4, $5, $6, $7, $8, $9)
           ON CONFLICT (showtime_id, seat_id) DO NOTHING`,
          [
            showtimeId,
            d.seatId,
            d.ticketTierId,
            clampCoord(d.x),
            clampCoord(d.y),
            normaliseRotation(d.rotation),
            d.rowLabel,
            d.seatNumber,
            d.sectionName,
          ],
        );
      }
    }

    const removable = current.filter((c) => !keptIds.has(c.id)).map((c) => c.id);
    if (removable.length > 0) {
      await client.query(`DELETE FROM showtime_seats WHERE id = ANY($1::bigint[])`, [removable]);
    }

    return outcome;
  });
}

/**
 * Build the desired state from the showtime's SOURCE layout — the re-apply path (FR-027a). Seats are
 * matched to the existing map by `seat_id`, so a seat that survived keeps its bookable row (and its
 * sale) rather than being deleted and re-added.
 */
export async function desiredFromLayout(showtimeId: number, db: Db = pool): Promise<DesiredSeat[] | null> {
  const head = await db.query<{ layout_id: number | null }>(`SELECT layout_id FROM showtimes WHERE id = $1`, [showtimeId]);
  const layoutId = head.rows[0]?.layout_id ?? null;
  if (layoutId === null) return null;

  const { rows } = await db.query<{
    seat_id: number;
    showtime_seat_id: number | null;
    row_label: string;
    seat_number: number;
    section_name: string | null;
    pos_x: number;
    pos_y: number;
    rotation: number;
    ticket_tier_id: number | null;
  }>(
    `SELECT se.id AS seat_id, ss.id AS showtime_seat_id, se.row_label, se.seat_number,
            sec.name AS section_name, se.pos_x, se.pos_y, se.rotation,
            COALESCE(ss.ticket_tier_id, tier.id) AS ticket_tier_id
       FROM seats se
       LEFT JOIN sections sec ON sec.id = se.section_id
       LEFT JOIN showtime_seats ss ON ss.seat_id = se.id AND ss.showtime_id = $1
       -- A brand-new seat needs a tier: fall back to the cheapest tier of this showtime, which the
       -- organizer can then change by marquee (FR-034) rather than being blocked here.
       LEFT JOIN LATERAL (
         -- Archived filtered here for the same reason every other tier read filters it (see
         -- catalog.write.ts and layouts.repo.ts): a retired class is not a price a new seat may be
         -- bound to.
         SELECT id FROM ticket_tiers
          WHERE showtime_id = $1 AND archived_at IS NULL ORDER BY price_amount LIMIT 1
       ) AS tier ON true
      -- An archived seat has left the chart; re-applying must not resurrect it as new inventory.
      WHERE se.layout_id = $2 AND se.archived_at IS NULL`,
    [showtimeId, layoutId],
  );

  return rows
    .filter((r) => r.ticket_tier_id !== null)
    .map((r) => ({
      showtimeSeatId: r.showtime_seat_id,
      seatId: r.seat_id,
      rowLabel: r.row_label,
      seatNumber: r.seat_number,
      sectionName: r.section_name,
      ticketTierId: r.ticket_tier_id as number,
      x: r.pos_x,
      y: r.pos_y,
      rotation: r.rotation,
    }));
}

/** Refresh the decoration half of the snapshot from the source layout (FR-005, T046). */
export async function refreshSnapshot(showtimeId: number, layoutId: number, db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE showtimes st
        SET layout_id = $2,
            layout_snapshot = jsonb_build_object(
              'elements', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'kind', e.kind, 'x', e.pos_x, 'y', e.pos_y,
                  'width', e.width, 'height', e.height, 'rotation', e.rotation, 'label', e.label,
                  -- Shapes carry an ordered point list; every other kind stores null (FR-058).
                  'points', e.points,
                  -- A capacity zone is INVENTORY the buyer can buy (0027), so the buyer's copy of the
                  -- map has to carry what makes it one. Without these it drew as an anonymous shape and
                  -- a standing floor looked like decoration.
                  'capacity', e.capacity, 'categoryId', e.category_id,
                  -- A drawn outline's colour reaches the buyer through here or not at all.
                  'color', e.color, 'geometry', e.geometry))
                  FROM layout_elements e WHERE e.layout_id = l.id), '[]'::jsonb),
              -- Tables ride in the SAME snapshot as the elements (FR-081). The snapshot is what stops
              -- a later layout edit reshaping a show that is already selling, and a table sits in the
              -- same picture as the seats — reading it live would let tidying a venue silently change
              -- a live map. Buyers need it so a seat labelled "Bàn 5 - Ghế 3" is drawn at its table.
              'tables', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', t.name, 'shape', t.shape, 'x', t.pos_x, 'y', t.pos_y,
                  'width', t.width, 'height', t.height, 'rotation', t.rotation))
                  FROM layout_tables t WHERE t.layout_id = l.id), '[]'::jsonb),
              -- Area capacity rides along so a re-shape can regenerate the same headcount.
              'areas', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('label', e.label, 'capacity', e.capacity))
                  FROM layout_elements e WHERE e.layout_id = l.id AND e.kind = 'area'), '[]'::jsonb),
              -- Section STYLE, keyed by name because that is the only section identity a
              -- showtime_seats row carries. Shape and size are snapshotted with the geometry for the
              -- same reason the geometry is: restyling a venue must not re-draw a show already selling.
              -- Colour is deliberately NOT snapshotted — it never reaches a buyer (FR-064).
              'sectionStyles', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', sec.name, 'seatShape', sec.seat_shape,
                  'seatSizeMultiplier', sec.seat_size_multiplier))
                  FROM sections sec WHERE sec.layout_id = l.id), '[]'::jsonb),
              'planUrl', l.background_url,
              'planScale', round(l.background_scale * 1000),
              'planOffsetX', l.background_offset_x,
              'planOffsetY', l.background_offset_y,
              'planOpacity', round(l.background_opacity * 100),
              'planVisibleToBuyers', l.background_public,
              -- Snapshotted like everything else here: the rule the buyer's picker obeys is the one
              -- that was in force when the map was applied, so retuning a venue cannot change how a
              -- show already selling answers "chọn giúp tôi" halfway through its on-sale.
              'orphanRule', l.orphan_rule
            )
       FROM venue_layouts l
      WHERE st.id = $1 AND l.id = $2`,
    [showtimeId, layoutId],
  );
}

/** Block or unblock seats on a live map. Never takes a seat from someone who has it (FR-033). */
export async function setBlocked(
  showtimeId: number,
  showtimeSeatIds: number[],
  blocked: boolean,
): Promise<{ refusals: ApplyRefusal[]; changed: { showtimeSeatId: number; status: 'available' | 'blocked' }[] }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<CurrentSeat>(
      `SELECT id, seat_id, row_label, seat_number, section_name, ticket_tier_id, status, pos_x, pos_y, rotation,
              (status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at > now()) AS live_hold
         FROM showtime_seats WHERE showtime_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE`,
      [showtimeId, showtimeSeatIds],
    );

    const refusals: ApplyRefusal[] = [];
    for (const s of rows) {
      if (s.live_hold) {
        refusals.push({ reason: 'seat_held', showtimeSeatId: s.id, seatLabel: labelOf(s), message: `Ghế ${labelOf(s)} đang được giữ.` });
      } else if (s.status === 'sold') {
        refusals.push({ reason: 'seat_sold', showtimeSeatId: s.id, seatLabel: labelOf(s), message: `Ghế ${labelOf(s)} đã được bán.` });
      }
    }
    if (refusals.length > 0) return { refusals, changed: [] };

    const next = blocked ? 'blocked' : 'available';
    await client.query(`UPDATE showtime_seats SET status = $3 WHERE showtime_id = $1 AND id = ANY($2::bigint[])`, [
      showtimeId,
      showtimeSeatIds,
      next,
    ]);
    return { refusals: [], changed: rows.map((s) => ({ showtimeSeatId: s.id, status: next as 'available' | 'blocked' })) };
  });
}

/** Assign a tier to a marquee selection, across sections. A sold seat refuses the whole action
 *  rather than silently repricing a ticket someone owns (FR-034). */
export async function setTier(
  showtimeId: number,
  showtimeSeatIds: number[],
  ticketTierId: number,
): Promise<{ refusals: ApplyRefusal[]; tier: { label: string; price: number } | null }> {
  return withTransaction(async (client) => {
    const tier = await client.query<{ id: number; label: string; price: string }>(
      `SELECT id, label, price_amount::text AS price FROM ticket_tiers WHERE id = $1 AND showtime_id = $2`,
      [ticketTierId, showtimeId],
    );
    if (!tier.rows[0]) return { refusals: [], tier: null };

    const { rows } = await client.query<CurrentSeat>(
      `SELECT id, seat_id, row_label, seat_number, section_name, ticket_tier_id, status, pos_x, pos_y, rotation,
              (status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at > now()) AS live_hold
         FROM showtime_seats WHERE showtime_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE`,
      [showtimeId, showtimeSeatIds],
    );
    // A retier is a price change. Refusing it only for seats already sold left every unsold seat
    // repriceable while the picker was showing its old price.
    await assertNotOnSale(client, showtimeId);

    const refusals: ApplyRefusal[] = [];
    for (const s of rows) {
      if (s.status === 'sold') {
        refusals.push({
          reason: 'seat_sold',
          showtimeSeatId: s.id,
          seatLabel: labelOf(s),
          message: `Ghế ${labelOf(s)} đã được bán, không thể đổi hạng vé.`,
        });
      } else if (s.live_hold) {
        refusals.push({ reason: 'seat_held', showtimeSeatId: s.id, seatLabel: labelOf(s), message: `Ghế ${labelOf(s)} đang được giữ.` });
      }
    }
    if (refusals.length > 0) return { refusals, tier: null };

    await client.query(`UPDATE showtime_seats SET ticket_tier_id = $3 WHERE showtime_id = $1 AND id = ANY($2::bigint[])`, [
      showtimeId,
      showtimeSeatIds,
      ticketTierId,
    ]);
    return { refusals: [], tier: { label: tier.rows[0].label, price: Number(tier.rows[0].price) } };
  });
}
