import { createHash } from 'node:crypto';
import type pg from 'pg';
import type {
  ApplyChange,
  ApplyPreview,
  ApplyRefusal,
  ApplySource,
  ZoneCapacityChange,
} from '@shared/catalog/seatmap.js';
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
  status: "available" | "held" | "sold" | "blocked";
  pos_x: number | null;
  pos_y: number | null;
  rotation: number;
  live_hold: boolean;
}

const labelOf = (s: {
  sectionName?: string | null;
  section_name?: string | null;
  rowLabel?: string;
  row_label?: string | null;
  seatNumber?: number;
  seat_number?: number | null;
}): string => {
  const section = s.sectionName ?? s.section_name ?? null;
  const row = s.rowLabel ?? s.row_label ?? "?";
  const num = s.seatNumber ?? s.seat_number ?? "?";
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

/**
 * Which current seat does this desired line refer to?
 *
 * The direct id wins. When the line carries no showtime_seat id — or one this map does not have —
 * it falls back to the PHYSICAL seat, so an existing row can never be classified as an addition
 * and then swept away by the removal pass while its INSERT no-ops on the (showtime_id, seat_id)
 * conflict. The fallback is what makes a client that lost track of ids degrade into an edit of
 * the right seat instead of a silent delete; both callers (classify and apply's write loop) go
 * through this one function so preview and write can never resolve differently.
 */
function resolveCurrent(
  d: DesiredSeat,
  byId: Map<number, CurrentSeat>,
  bySeatId: Map<number, CurrentSeat>,
): CurrentSeat | undefined {
  const direct = d.showtimeSeatId !== null ? byId.get(d.showtimeSeatId) : undefined;
  return direct ?? bySeatId.get(d.seatId);
}

/** Classify an edit without writing anything. Pure — used by both the preview and the apply. */
export function classify(desired: DesiredSeat[], current: CurrentSeat[]): ApplyPreview {
  const changes: ApplyChange[] = [];
  const refusals: ApplyRefusal[] = [];
  const byId = new Map(current.map((c) => [c.id, c]));
  const bySeatId = new Map(current.map((c) => [c.seat_id, c]));
  const keptIds = new Set<number>();
  // A line that resolves to a current seat ANOTHER line already claimed is an addition: two lines
  // cannot both edit one row, and the second's INSERT then no-ops harmlessly on the unique
  // (showtime_id, seat_id) conflict instead of double-writing it.
  const matched = new Set<number>();

  for (const d of desired) {
    const c = resolveCurrent(d, byId, bySeatId);
    if (!c || matched.has(c.id)) {
      // Refers to nothing on this map (or to a seat another line already edits) — an addition.
      changes.push({ kind: "add", showtimeSeatId: null, seatLabel: labelOf(d) });
      continue;
    }
    matched.add(c.id);
    keptIds.add(c.id);

    const movedOnly = positionChanged(d, c);
    const identity = identityChanged(d, c);
    if (!movedOnly && !identity) continue; // untouched

    if (c.live_hold) {
      refusals.push({
        reason: "seat_held",
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đang được một khách giữ. Hãy thử lại sau khi lượt giữ hết hạn.`,
      });
      continue;
    }
    if (c.status === "sold" && identity) {
      refusals.push({
        reason: "seat_sold",
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đã được bán: chỉ có thể đổi vị trí hiển thị, không đổi nhãn, khu vực hay hạng vé.`,
      });
      continue;
    }
    changes.push({
      kind: identity ? (d.ticketTierId !== c.ticket_tier_id ? "retier" : "relabel") : "move",
      showtimeSeatId: c.id,
      seatLabel: labelOf(d),
    });
  }

  for (const c of current) {
    if (keptIds.has(c.id)) continue;
    if (c.live_hold) {
      refusals.push({
        reason: "seat_held",
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đang được một khách giữ, không thể xoá.`,
      });
      continue;
    }
    if (c.status === "sold") {
      refusals.push({
        reason: "seat_sold",
        showtimeSeatId: c.id,
        seatLabel: labelOf(c),
        message: `Ghế ${labelOf(c)} đã được bán, không thể xoá khỏi sơ đồ.`,
      });
      continue;
    }
    changes.push({ kind: "remove", showtimeSeatId: c.id, seatLabel: labelOf(c) });
  }

  return { changes, refusals, wouldSucceed: refusals.length === 0 };
}

/** Preview only — writes nothing (FR-027a). Advisory: re-classified under lock on confirm. */
export async function preview(
  showtimeId: number,
  desired: DesiredSeat[],
  sourceLayoutId?: number | null,
): Promise<ApplyPreview> {
  const outcome = classify(desired, await readCurrent(showtimeId, pool));
  if (sourceLayoutId == null) return outcome;
  // The re-apply path only. A zone change produces no seat change, so without this the preview
  // reported "nothing to do" for the one edit the organizer had just drawn (0035 finding 1).
  const zones = await zonePlan(showtimeId, sourceLayoutId, pool);
  const { rows } = await pool.query<{ version: number }>(
    `SELECT version FROM venue_layouts WHERE id = $1`,
    [sourceLayoutId],
  );
  return {
    ...outcome,
    zones,
    // What the confirm must echo back, so it can prove it is confirming THIS (0035 finding 5).
    source: {
      layoutId: sourceLayoutId,
      layoutVersion: rows[0]?.version ?? 0,
      digest: desiredDigest(desired, zones),
    },
    wouldSucceed: outcome.wouldSucceed && zones.every((z) => !z.blocked),
  };
}

/**
 * A stable fingerprint of everything the organizer was shown.
 *
 * Only the fields that can change what the apply DOES go in, in a canonical order, so the digest is
 * reproducible from either side of the two requests and is not disturbed by row ordering. The version
 * alone would not be enough: a tier repriced or a class archived changes the desired state without
 * touching the chart at all.
 */
export function desiredDigest(desired: DesiredSeat[], zones: ZoneCapacityChange[]): string {
  const seats = desired
    .map((d) =>
      [
        d.seatId,
        d.showtimeSeatId ?? '',
        d.rowLabel,
        d.seatNumber,
        d.sectionName ?? '',
        d.ticketTierId,
        clampCoord(d.x),
        clampCoord(d.y),
        normaliseRotation(d.rotation),
      ].join('\u0001'),
    )
    .sort();
  const zoneLines = zones.map((z) => `${z.categoryId}\u0001${z.to}`).sort();
  return createHash('sha256')
    .update([...seats, '\u0002', ...zoneLines].join('\n'))
    .digest('hex')
    .slice(0, 32);
}

/**
 * The confirm is confirming the preview the organizer actually read (0035 finding 5).
 *
 * Taken under `FOR UPDATE` on the source chart, so nothing can edit it between this check and the
 * writes below — which is what makes the check a guarantee rather than a hopeful glance. The lock is
 * meaningful only because every geometry write now bumps `version` (finding 4); before that a table
 * moved through its own endpoint left the version untouched and this would have waved it through.
 *
 * The digest is checked as well as the version because the desired state also depends on things that
 * are not the chart: archive a tier or reprice a class and the version never moves.
 */
async function assertPreviewFresh(
  showtimeId: number,
  expected: ApplySource,
  desired: DesiredSeat[],
  client: pg.PoolClient,
): Promise<void> {
  const stale = (): never => {
    throw err.refused(
      409,
      "stale_preview",
      "Sơ đồ nguồn đã thay đổi kể từ lúc bạn xem trước. Hãy xem trước lại rồi áp dụng.",
      { refusals: [] },
    );
  };

  const { rows } = await client.query<{ version: number }>(
    `SELECT version FROM venue_layouts WHERE id = $1 FOR UPDATE`,
    [expected.layoutId],
  );
  if (rows.length === 0 || rows[0].version !== expected.layoutVersion) stale();

  const zones = await zonePlan(showtimeId, expected.layoutId, client);
  if (desiredDigest(desired, zones) !== expected.digest) stale();
}

/**
 * Every id in the request belongs to THIS showtime (0035 finding 7).
 *
 * `showtime_seats` carries three independent foreign keys — showtime, seat, tier — and nothing in the
 * schema ties the second and third to the first. The route authorises the SHOWTIME and then trusted
 * whatever ids the body named, so an organizer calling the API directly could bind their showtime to
 * another showtime's tier (corrupting both maps' price and inventory accounting) or to a physical seat
 * from a chart this showtime is not bound to.
 *
 * Both checks in one round trip, inside the write transaction and under the locks `apply` has already
 * taken, so a tier archived or a seat detached between the check and the write cannot slip through.
 */
async function assertReferencesInScope(
  showtimeId: number,
  desired: DesiredSeat[],
  client: pg.PoolClient,
): Promise<void> {
  if (desired.length === 0) return;
  const seatIds = [...new Set(desired.map((d) => d.seatId))];
  const tierIds = [...new Set(desired.map((d) => d.ticketTierId))];

  const { rows } = await client.query<{ bad_seats: string; bad_tiers: string }>(
    /*
     * A seat is in scope when it comes from a layout THIS showtime's map is made of: the chart it is
     * bound to, or — for a showtime that never recorded one — the chart its existing rows came from.
     *
     * The second arm is not a loophole, it is the same question asked of older data. `showtimes.
     * layout_id` is only set by the paths that generate through a chart; a map assembled another way
     * has rows and a null binding, and a rule that read the binding alone would refuse every edit to
     * it while still admitting exactly the foreign seats this check exists to stop.
     */
    `WITH scope AS (
       SELECT layout_id FROM showtimes WHERE id = $1 AND layout_id IS NOT NULL
       UNION
       SELECT se.layout_id FROM showtime_seats ss JOIN seats se ON se.id = ss.seat_id
        WHERE ss.showtime_id = $1
     )
     SELECT
       (SELECT count(*) FROM unnest($2::bigint[]) AS want(id)
         WHERE NOT EXISTS (
           SELECT 1 FROM seats se
            WHERE se.id = want.id AND se.layout_id IN (SELECT layout_id FROM scope)))::bigint
         AS bad_seats,
       (SELECT count(*) FROM unnest($3::bigint[]) AS want(id)
         WHERE NOT EXISTS (
           SELECT 1 FROM ticket_tiers t
            WHERE t.id = want.id AND t.showtime_id = $1 AND t.archived_at IS NULL))::bigint AS bad_tiers`,
    [showtimeId, seatIds, tierIds],
  );

  if (Number(rows[0].bad_seats) > 0)
    throw err.badRequest(
      "validation_failed",
      "Yêu cầu tham chiếu tới ghế không thuộc sơ đồ của suất chiếu này.",
    );
  if (Number(rows[0].bad_tiers) > 0)
    throw err.badRequest(
      "validation_failed",
      "Yêu cầu tham chiếu tới loại vé không thuộc suất chiếu này.",
    );
}

/**
 * Apply an edit. Locks every touched row, re-classifies under the lock, and refuses the whole edit
 * if anything came up refused — so a sale or hold landing between preview and confirm is never
 * silently overwritten (research R-6, Principle I).
 *
 * `opts.refreshLayoutId` names the source layout whose decoration should be re-snapshotted onto the
 * showtime (the re-apply path). It runs INSIDE this transaction, on purpose: a snapshot refreshed
 * after the seat writes commit could crash in between and leave seats describing one layout under
 * decoration from another. Direct PUT edits pass nothing — they change no decoration.
 */
export async function apply(
  showtimeId: number,
  desired: DesiredSeat[],
  opts: { refreshLayoutId?: number | null; expectSource?: ApplySource } = {},
): Promise<ApplyPreview> {
  return withTransaction(async (client) => {
    // Lock first, then read: whatever we classify cannot move underneath us.
    await client.query(`SELECT id FROM showtime_seats WHERE showtime_id = $1 FOR UPDATE`, [showtimeId]);
    await assertNotOnSale(client, showtimeId);
    if (opts.expectSource)
      await assertPreviewFresh(showtimeId, opts.expectSource, desired, client);
    await assertReferencesInScope(showtimeId, desired, client);
    const current = await readCurrent(showtimeId, client);
    const outcome = classify(desired, current);
    /*
     * Zone inventory is judged BEFORE any seat write, alongside the per-seat refusals, so a zone
     * shrunk below what is already sold rejects the whole apply exactly the way a sold seat does
     * (FR-029) rather than throwing halfway through (0035 finding 1).
     */
    const zones =
      opts.refreshLayoutId != null ? await zonePlan(showtimeId, opts.refreshLayoutId, client) : [];
    if (zones.length > 0) {
      outcome.zones = zones;
      outcome.wouldSucceed = outcome.wouldSucceed && zones.every((z) => !z.blocked);
    }
    if (!outcome.wouldSucceed) return outcome; // caller turns this into 409; the txn wrote nothing

    const byId = new Map(current.map((c) => [c.id, c]));
    const bySeatId = new Map(current.map((c) => [c.seat_id, c]));
    const keptIds = new Set<number>();
    const matched = new Set<number>();

    /*
     * Sorted in memory, written in two statements — NOT one statement per seat.
     *
     * The loop used to `await` a query per desired seat, inside this transaction and under the
     * `FOR UPDATE` taken above. That is one network round trip each, serialised, while every seat
     * of the showtime stays locked: no buyer can hold or buy anything on this showtime until the
     * last seat lands. At the 2,000-seat ceiling that is 2,000 round trips of lock time, and it is
     * what made the seat cap a write-path limit rather than a rendering one.
     *
     * `unnest` carries each column as ONE array parameter, so the whole edit is two statements
     * whatever its size — the bind-parameter ceiling is never approached, because eight arrays are
     * eight parameters, not eight per seat.
     *
     * Ordering is not lost by grouping the two kinds: updates address existing rows by primary key
     * and are independent of each other.
     *
     * `matched` mirrors `classify` exactly. Without it this loop resolved two lines naming one seat to
     * the same row and pushed that row into the batch UPDATE twice, where `unnest` leaves the winner
     * unspecified — while the preview had already called the second line an addition. The route now
     * refuses duplicates outright, so this is belt and braces for `desiredFromLayout` and for any
     * future caller: preview and write must classify identically or the preview is a lie (0035
     * finding 7).
     */
    const up = {
      id: [] as number[],
      x: [] as number[],
      y: [] as number[],
      rot: [] as number[],
      row: [] as (string | null)[],
      num: [] as (number | null)[],
      sect: [] as (string | null)[],
      tier: [] as number[],
    };
    const ins = {
      seatId: [] as number[],
      tier: [] as number[],
      x: [] as number[],
      y: [] as number[],
      rot: [] as number[],
      row: [] as (string | null)[],
      num: [] as (number | null)[],
      sect: [] as (string | null)[],
    };

    for (const d of desired) {
      // Same resolution classify used, so the writes land exactly where the preview said they
      // would — including a line that names an existing physical seat without its row id.
      const c = resolveCurrent(d, byId, bySeatId);
      if (c && !matched.has(c.id)) {
        matched.add(c.id);
        keptIds.add(c.id);
        up.id.push(c.id);
        up.x.push(clampCoord(d.x));
        up.y.push(clampCoord(d.y));
        up.rot.push(normaliseRotation(d.rotation));
        up.row.push(d.rowLabel);
        up.num.push(d.seatNumber);
        up.sect.push(d.sectionName);
        up.tier.push(d.ticketTierId);
      } else {
        ins.seatId.push(d.seatId);
        ins.tier.push(d.ticketTierId);
        ins.x.push(clampCoord(d.x));
        ins.y.push(clampCoord(d.y));
        ins.rot.push(normaliseRotation(d.rotation));
        ins.row.push(d.rowLabel);
        ins.num.push(d.seatNumber);
        ins.sect.push(d.sectionName);
      }
    }

    if (up.id.length > 0) {
      await client.query(
        `UPDATE showtime_seats AS s
            SET pos_x = v.pos_x, pos_y = v.pos_y, rotation = v.rotation,
                row_label = v.row_label, seat_number = v.seat_number,
                section_name = v.section_name, ticket_tier_id = v.ticket_tier_id
           FROM unnest($1::bigint[], $2::int[], $3::int[], $4::smallint[],
                       $5::text[], $6::int[], $7::text[], $8::bigint[])
                AS v(id, pos_x, pos_y, rotation, row_label, seat_number, section_name, ticket_tier_id)
          WHERE s.id = v.id`,
        [up.id, up.x, up.y, up.rot, up.row, up.num, up.sect, up.tier],
      );
    }

    if (ins.seatId.length > 0) {
      // `DO NOTHING` rather than `DO UPDATE`, exactly as before — and unlike `DO UPDATE` it is also
      // safe when one batch carries the same seat twice, which Postgres refuses for the update form.
      await client.query(
        `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status,
                                     pos_x, pos_y, rotation, row_label, seat_number, section_name)
         SELECT $1, v.seat_id, v.ticket_tier_id, 'available',
                v.pos_x, v.pos_y, v.rotation, v.row_label, v.seat_number, v.section_name
           FROM unnest($2::bigint[], $3::bigint[], $4::int[], $5::int[], $6::smallint[],
                       $7::text[], $8::int[], $9::text[])
                AS v(seat_id, ticket_tier_id, pos_x, pos_y, rotation, row_label, seat_number, section_name)
         ON CONFLICT (showtime_id, seat_id) DO NOTHING`,
        [showtimeId, ins.seatId, ins.tier, ins.x, ins.y, ins.rot, ins.row, ins.num, ins.sect],
      );
    }

    const removable = current.filter((c) => !keptIds.has(c.id)).map((c) => c.id);
    if (removable.length > 0) {
      await client.query(`DELETE FROM showtime_seats WHERE id = ANY($1::bigint[])`, [removable]);
    }

    // The re-apply just added and removed seat rows (0036): re-sync the pair links from the chart,
    // the same way initial generation copies them. A no-op when nothing is paired.
    const bound = await client.query<{ layout_id: number | null }>(
      `SELECT layout_id FROM showtimes WHERE id = $1`,
      [showtimeId],
    );
    const layoutId = bound.rows[0]?.layout_id ?? null;
    if (layoutId !== null) await syncCompanionLinks(showtimeId, layoutId, client);

    // Same transaction as the seat writes: seats and their decoration can never disagree about
    // which layout they describe, even if this process dies mid-apply.
    if (opts.refreshLayoutId != null) {
      await refreshSeatSnapshot(showtimeId, opts.refreshLayoutId, client);
      await writeZonePlan(showtimeId, zones, client);
      await refreshSnapshot(showtimeId, opts.refreshLayoutId, client);
    }

    return outcome;
  });
}

/**
 * Build the desired state from the showtime's SOURCE layout — the re-apply path (FR-027a). Seats are
 * matched to the existing map by `seat_id`, so a seat that survived keeps its bookable row (and its
 * sale) rather than being deleted and re-added.
 */
export async function desiredFromLayout(
  showtimeId: number,
  db: Db = pool,
): Promise<DesiredSeat[] | null> {
  const head = await db.query<{ layout_id: number | null }>(
    `SELECT layout_id FROM showtimes WHERE id = $1`,
    [showtimeId],
  );
  const layoutId = head.rows[0]?.layout_id ?? null;
  if (layoutId === null) return null;

  await assertOneTierPerCategory(showtimeId, db);

  const { rows } = await db.query<{
    seat_id: number;
    showtime_seat_id: number | null;
    row_label: string;
    seat_number: number;
    section_name: string | null;
    category_name: string | null;
    pos_x: number;
    pos_y: number;
    rotation: number;
    ticket_tier_id: number | null;
  }>(
    `SELECT se.id AS seat_id, ss.id AS showtime_seat_id, se.row_label, se.seat_number,
            sec.name AS section_name, cat.name AS category_name,
            se.pos_x, se.pos_y, se.rotation,
            -- The seat's own CLASS decides its price, exactly as it does at initial generation
            -- (catalog.write.ts). This used to read COALESCE(ss.ticket_tier_id, cheapest), which
            -- meant a seat moved from Standard into VIP kept its Standard price forever and a
            -- brand-new VIP seat was born at the cheapest price on the showtime (0035 finding 1).
            -- The existing row is the fallback, not the answer: a seat whose class was unpriced or
            -- deleted keeps what it is selling at rather than losing its tier mid-flight.
            COALESCE(tier.id, ss.ticket_tier_id) AS ticket_tier_id
       FROM seats se
       LEFT JOIN sections sec ON sec.id = se.section_id
       LEFT JOIN layout_categories cat ON cat.id = se.category_id
       LEFT JOIN showtime_seats ss ON ss.seat_id = se.id AND ss.showtime_id = $1
       LEFT JOIN LATERAL (
         -- Archived filtered here for the same reason every other tier read filters it (see
         -- catalog.write.ts and layouts.repo.ts): a retired class is not a price a new seat may be
         -- bound to.
         SELECT id FROM ticket_tiers
          WHERE showtime_id = $1 AND archived_at IS NULL AND category_id = se.category_id
       ) AS tier ON true
      -- An archived seat has left the chart; re-applying must not resurrect it as new inventory.
      WHERE se.layout_id = $2 AND se.archived_at IS NULL`,
    [showtimeId, layoutId],
  );

  /*
   * A seat with neither a priced class nor an existing row would be dropped silently, and a dropped
   * desired line reads as a REMOVAL — so an unpriced new class would delete inventory instead of
   * adding it. Name it instead. The re-apply route validates the source layout first, so this is
   * normally unreachable; it is the backstop for the class that was priced when the chart was
   * validated and archived before the confirm landed.
   */
  const unpriced = rows.filter((r) => r.ticket_tier_id === null);
  if (unpriced.length > 0) {
    const classes = [...new Set(unpriced.map((r) => r.category_name ?? "không có hạng ghế"))];
    throw err.refused(
      422,
      "category_without_tier",
      `Chưa đặt giá cho hạng ghế: ${classes.join(", ")}. Hãy đặt giá rồi áp dụng lại.`,
      { refusals: [] },
    );
  }

  return rows.map((r) => ({
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

/**
 * One active tier per price class, or the re-apply has no single answer for what a seat costs.
 *
 * `LEFT JOIN LATERAL … WHERE category_id = se.category_id` returns a ROW PER MATCH, so two active
 * tiers naming one class would silently duplicate every seat of it — each duplicate then classified
 * as an addition on the second pass. Refusing is the honest outcome: the organizer has two prices for
 * one class and only they can say which is meant (0035 finding 1).
 */
async function assertOneTierPerCategory(showtimeId: number, db: Db): Promise<void> {
  const { rows } = await db.query<{ name: string | null }>(
    `SELECT c.name
       FROM ticket_tiers t
       LEFT JOIN layout_categories c ON c.id = t.category_id
      WHERE t.showtime_id = $1 AND t.archived_at IS NULL AND t.category_id IS NOT NULL
      GROUP BY t.category_id, c.name
     HAVING count(*) > 1`,
    [showtimeId],
  );
  if (rows.length > 0)
    throw err.refused(
      409,
      "category_tier_ambiguous",
      `Hạng ghế ${rows.map((r) => `"${r.name ?? "?"}"`).join(", ")} đang có nhiều hơn một loại vé đang bán. Hãy gộp hoặc lưu trữ bớt trước khi áp dụng lại.`,
      { refusals: [] },
    );
}

/**
 * Capacity-zone inventory the source layout describes, against what the showtime is selling.
 *
 * Shared by the preview and the write so they can never disagree, and by initial generation so a
 * zone's quantity is computed in exactly one place. Summed per class because one class may be drawn
 * as several zones (two standing wings at the same price).
 */
export async function zonePlan(
  showtimeId: number,
  layoutId: number,
  db: Db = pool,
): Promise<ZoneCapacityChange[]> {
  const { rows } = await db.query<{
    category_id: number;
    category_name: string;
    to_capacity: string;
    from_capacity: string | null;
    taken: string;
  }>(
    `SELECT e.category_id, c.name AS category_name,
            sum(e.capacity)::bigint AS to_capacity,
            max(t.total_quantity) AS from_capacity,
            COALESCE(max(t.sold_quantity + t.reserved_quantity), 0)::bigint AS taken
       FROM layout_elements e
       JOIN layout_categories c ON c.id = e.category_id
       -- INNER, so an unpriced zone class produces no plan line at all — the same skip the old
       -- inline loop made, and the apply gate refuses that class before it can reach here anyway.
       JOIN ticket_tiers t ON t.category_id = e.category_id
                          AND t.showtime_id = $1 AND t.archived_at IS NULL
      WHERE e.layout_id = $2 AND e.kind = 'area' AND e.capacity IS NOT NULL
      GROUP BY e.category_id, c.name
      ORDER BY c.name`,
    [showtimeId, layoutId],
  );

  return rows.map((r) => {
    const to = Number(r.to_capacity);
    const taken = Number(r.taken);
    return {
      categoryId: r.category_id,
      categoryName: r.category_name,
      from: r.from_capacity === null ? null : Number(r.from_capacity),
      to,
      taken,
      blocked: to < taken,
    };
  });
}

/**
 * Write the zone quantities `zonePlan` computed. Caller has already refused any blocked plan.
 *
 * Locks each tier row before writing it, so the sold/held count the plan was judged against cannot
 * move between the judgement and the write.
 */
export async function writeZonePlan(
  showtimeId: number,
  plan: ZoneCapacityChange[],
  client: pg.PoolClient,
): Promise<number> {
  let total = 0;
  for (const zone of plan) {
    // By class ID, never by name: two charts may name a class the same thing, and the tier a
    // showtime carries is not guaranteed to belong to the chart being applied.
    const { rows } = await client.query<{ id: number; taken: string }>(
      `SELECT t.id, (t.sold_quantity + t.reserved_quantity)::bigint AS taken
         FROM ticket_tiers t
        WHERE t.showtime_id = $1 AND t.archived_at IS NULL AND t.category_id = $2
        FOR UPDATE`,
      [showtimeId, zone.categoryId],
    );
    const tier = rows[0];
    if (!tier) continue;
    const taken = Number(tier.taken);
    if (zone.to < taken)
      throw err.conflict(
        "zone_capacity_below_sold",
        `Khu "${zone.categoryName}" chỉ còn ${zone.to} chỗ nhưng đã bán hoặc giữ ${taken}.`,
      );
    await client.query(`UPDATE ticket_tiers SET total_quantity = $2 WHERE id = $1`, [
      tier.id,
      zone.to,
    ]);
    total += zone.to;
  }
  return total;
}

/**
 * Re-copy the decoration a SEAT carries onto the showtime's own rows (0035 finding 1).
 *
 * `showtime_seats` snapshots more than position and price: `category_name` is what the buyer's legend
 * reads, and `is_accessible` / `table_id` / `table_booking_mode` are what makes a seat a wheelchair
 * space or one chair of a bookable table. Initial generation copies all four; the re-apply write loop
 * carries only the seven columns a `DesiredSeat` names, so every one of them went stale — a seat moved
 * into VIP was repriced and still labelled Standard to the buyer.
 *
 * Driven straight off `seats`, in the same transaction as the seat writes, so it cannot describe a
 * different revision of the chart than the rows beside it.
 */
export async function refreshSeatSnapshot(
  showtimeId: number,
  layoutId: number,
  db: Db,
): Promise<void> {
  await db.query(
    `UPDATE showtime_seats ss
        SET category_name = (SELECT c.name FROM layout_categories c WHERE c.id = se.category_id),
            is_accessible = se.is_accessible,
            table_id = se.table_id,
            table_booking_mode = (SELECT t.booking_mode FROM layout_tables t WHERE t.id = se.table_id)
       FROM seats se
      WHERE se.id = ss.seat_id AND ss.showtime_id = $1 AND se.layout_id = $2`,
    [showtimeId, layoutId],
  );
}

/** Refresh the decoration half of the snapshot from the source layout (FR-005, T046). */
export async function refreshSnapshot(
  showtimeId: number,
  layoutId: number,
  db: Db = pool,
): Promise<void> {
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
                  'color', e.color, 'geometry', e.geometry,
                  -- The level this decoration stands on (0044), by NAME, reached through its section.
                  -- Without it a stage drawn on the stalls would also be drawn over the balcony, on
                  -- every floor the buyer switched to. Null means it belongs to the whole chart --
                  -- structural outlines usually have no section, and those SHOULD stay visible.
                  'floor', (SELECT f.name FROM sections sec2
                              JOIN layout_floors f ON f.id = sec2.floor_id
                             WHERE sec2.id = e.section_id)))
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
                  'seatSizeMultiplier', sec.seat_size_multiplier,
                  -- The level (0044), by NAME. It rides this key because a section name is the only
                  -- section identity a showtime_seats row carries -- which is the whole reason a
                  -- floor hangs off a section rather than off a seat. No new column, no migration of
                  -- inventory already selling.
                  'floor', (SELECT f.name FROM layout_floors f WHERE f.id = sec.floor_id)))
                  FROM sections sec WHERE sec.layout_id = l.id), '[]'::jsonb),
              -- The chart's levels, in order, so the buyer's strip presents them the way the
              -- organizer arranged them rather than in whatever order seats happen to arrive.
              -- Snapshotted like everything else here: adding a floor to a venue must not re-shape
              -- the picker of a show already selling.
              'floors', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', f.name, 'displayOrder', f.display_order)
                         ORDER BY f.display_order, f.name)
                  FROM layout_floors f WHERE f.layout_id = l.id), '[]'::jsonb),
              'planUrl', l.background_url,
              'planScale', round(l.background_scale * 1000),
              'planOffsetX', l.background_offset_x,
              'planOffsetY', l.background_offset_y,
              'planOpacity', round(l.background_opacity * 100),
              'planVisibleToBuyers', l.background_public,
              -- Snapshotted like everything else here: the rule the buyer's picker obeys is the one
              -- that was in force when the map was applied, so retuning a venue cannot change how a
              -- show already selling answers "chọn giúp tôi" halfway through its on-sale.
              'orphanRule', l.orphan_rule,
              -- Snapshotted for the same reason the orphan rule above is: the point a show ranks
              -- from must be the one that was in force when its map was applied. No backticks in
              -- here — this whole statement is a JS template literal, and one would end the string.
              'focalPoint', CASE
                WHEN l.focal_x IS NULL OR l.focal_y IS NULL THEN NULL
                ELSE jsonb_build_object('x', l.focal_x, 'y', l.focal_y)
              END
            )
       FROM venue_layouts l
      WHERE st.id = $1 AND l.id = $2`,
    [showtimeId, layoutId],
  );
}

/**
 * Re-sync the showtime's companion links from its source layout (0036).
 *
 * The pairing lives on `seats` (the chart) and is COPIED onto `showtime_seats` — a self-reference
 * between the showtime's own rows, resolved through both seats' physical ids. Whatever path just
 * (re)wrote the showtime's seat rows — initial generation or a re-apply — calls this afterwards, so
 * the snapshot and the chart never disagree about who accompanies whom while the chart is the
 * current source of truth.
 *
 * Written as one UPDATE rather than a per-seat loop: pairs are rare on a chart but a map holds
 * thousands of seats, and a statement that touches nothing on an unpaired chart costs a scan and
 * returns. NULL-clears pairs whose partner was REMOVED from this showtime (the deleted row breaks
 * the join, so the seat simply stops naming a companion — the layout's validator is still the one
 * that calls the chart itself out).
 */
export async function syncCompanionLinks(
  showtimeId: number,
  layoutId: number,
  db: Db,
): Promise<void> {
  await db.query(
    `UPDATE showtime_seats ss
        SET companion_seat_id = partner.id
       FROM seats se
       JOIN showtime_seats partner ON partner.showtime_id = $1 AND partner.seat_id = se.companion_seat_id
      WHERE ss.showtime_id = $1
        AND ss.seat_id = se.id
        AND se.layout_id = $2
        AND se.archived_at IS NULL
        AND se.companion_seat_id IS NOT NULL`,
    [showtimeId, layoutId],
  );
  // Seats whose partner row is gone (deleted or archived out of this showtime) must stop pointing
  // at the old link: the UPDATE above cannot reach them (the join fails), so clear explicitly.
  await db.query(
    `UPDATE showtime_seats ss
        SET companion_seat_id = NULL
       FROM seats se
      WHERE ss.showtime_id = $1
        AND ss.seat_id = se.id
        AND ss.companion_seat_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM showtime_seats partner
           WHERE partner.id = ss.companion_seat_id
        )`,
    [showtimeId],
  );
}

/**
 * Every id the request named must exist on THIS showtime. Counted distinctly, so a duplicated id
 * in the payload neither passes nor inflates the count.
 */
function assertAllRequested(found: number, showtimeSeatIds: number[]): void {
  const distinct = new Set(showtimeSeatIds).size;
  if (found !== distinct) {
    throw err.badRequest(
      "unknown_seats",
      `${distinct - found} ghế trong lựa chọn không thuộc suất chiếu này.`,
    );
  }
}

/** Block or unblock seats on a live map. Never takes a seat from someone who has it (FR-033). */
export async function setBlocked(
  showtimeId: number,
  showtimeSeatIds: number[],
  blocked: boolean,
): Promise<{
  refusals: ApplyRefusal[];
  changed: { showtimeSeatId: number; status: "available" | "blocked" }[];
}> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<CurrentSeat>(
      `SELECT id, seat_id, row_label, seat_number, section_name, ticket_tier_id, status, pos_x, pos_y, rotation,
              (status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at > now()) AS live_hold
         FROM showtime_seats WHERE showtime_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE`,
      [showtimeId, showtimeSeatIds],
    );
    // Ids that matched nothing are refused, not silently dropped: a selection built from a stale
    // screen must not report success over seats it never touched.
    assertAllRequested(rows.length, showtimeSeatIds);

    const refusals: ApplyRefusal[] = [];
    for (const s of rows) {
      if (s.live_hold) {
        refusals.push({
          reason: "seat_held",
          showtimeSeatId: s.id,
          seatLabel: labelOf(s),
          message: `Ghế ${labelOf(s)} đang được giữ.`,
        });
      } else if (s.status === "sold") {
        refusals.push({
          reason: "seat_sold",
          showtimeSeatId: s.id,
          seatLabel: labelOf(s),
          message: `Ghế ${labelOf(s)} đã được bán.`,
        });
      }
    }
    if (refusals.length > 0) return { refusals, changed: [] };

    const next = blocked ? "blocked" : "available";
    await client.query(
      `UPDATE showtime_seats SET status = $3 WHERE showtime_id = $1 AND id = ANY($2::bigint[])`,
      [showtimeId, showtimeSeatIds, next],
    );
    return {
      refusals: [],
      changed: rows.map((s) => ({ showtimeSeatId: s.id, status: next as "available" | "blocked" })),
    };
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
    const tier = await client.query<{
      id: number;
      label: string;
      price: string;
      archived_at: Date | null;
    }>(
      `SELECT id, label, price_amount::text AS price, archived_at
         FROM ticket_tiers WHERE id = $1 AND showtime_id = $2`,
      [ticketTierId, showtimeId],
    );
    if (!tier.rows[0]) return { refusals: [], tier: null };
    // An archived class is a retired price: it has left every buyer-facing read, so binding seats
    // to it would make them unsellable while looking assigned. Refused with its own code rather
    // than the generic not-belonging error, so the organizer can tell the two apart — the same
    // rule `desiredFromLayout` applies when matching new seats to a tier.
    if (tier.rows[0].archived_at !== null) {
      throw err.badRequest("tier_archived", "Hạng vé đã được lưu trữ, không thể gán cho ghế.");
    }

    const { rows } = await client.query<CurrentSeat>(
      `SELECT id, seat_id, row_label, seat_number, section_name, ticket_tier_id, status, pos_x, pos_y, rotation,
              (status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at > now()) AS live_hold
         FROM showtime_seats WHERE showtime_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE`,
      [showtimeId, showtimeSeatIds],
    );
    // Same honesty as blocking: a stale selection is refused, never half-applied.
    assertAllRequested(rows.length, showtimeSeatIds);
    // A retier is a price change. Refusing it only for seats already sold left every unsold seat
    // repriceable while the picker was showing its old price.
    await assertNotOnSale(client, showtimeId);

    const refusals: ApplyRefusal[] = [];
    for (const s of rows) {
      if (s.status === "sold") {
        refusals.push({
          reason: "seat_sold",
          showtimeSeatId: s.id,
          seatLabel: labelOf(s),
          message: `Ghế ${labelOf(s)} đã được bán, không thể đổi hạng vé.`,
        });
      } else if (s.live_hold) {
        refusals.push({
          reason: "seat_held",
          showtimeSeatId: s.id,
          seatLabel: labelOf(s),
          message: `Ghế ${labelOf(s)} đang được giữ.`,
        });
      }
    }
    if (refusals.length > 0) return { refusals, tier: null };

    await client.query(
      `UPDATE showtime_seats SET ticket_tier_id = $3 WHERE showtime_id = $1 AND id = ANY($2::bigint[])`,
      [showtimeId, showtimeSeatIds, ticketTierId],
    );
    return { refusals: [], tier: { label: tier.rows[0].label, price: Number(tier.rows[0].price) } };
  });
}
