import type {
  ManagedTier,
  ManagedTierList,
  TierMutationResult,
  TierRemovalResult,
} from "@shared/catalog/types.js";
import type pg from "pg";
import { MAX_TIERS_PER_SHOWTIME } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { err, HttpError } from "../../http.js";
import { applyOrganizerEdit } from "./moderation-guard.js";
import { clearLapsedReservationItems } from "./reservations.cleanup.js";
import {
  activeTierCount,
  listTiers,
  lockTier,
  showtimeEventType,
  tierCommitted,
  tierContext,
  tierHasSeats,
  tierInventory,
  type TierContext,
  type TierRow,
} from "./tiers.repo.js";

/**
 * The ticket-tier lifecycle (feature 006, UC-26).
 *
 * Today tiers can only be created once, inside the showtime-creation call, and never touched again —
 * an organizer who mistypes a price has no route back except abandoning the showtime. This module is
 * the whole life: add, rename, reprice, capacity, archive, restore, delete.
 *
 * Two invariants shape every function here:
 *   - capacity may never fall below sold + reserved, checked under the same row lock feature 003
 *     takes, because reserved quantity is live hold state this feature only reads (FR-004);
 *   - a tier that has sold anything is archived, never deleted, so existing tickets still resolve
 *     their label and price (FR-006).
 */

/** Postgres check_violation — the `sold + reserved <= total_quantity` constraint, our last defence. */
const CHECK_VIOLATION = "23514";

function toManagedTier(
  row: TierRow,
  inv: { sold: number; held: number; remaining: number | null },
): ManagedTier {
  return {
    id: row.id,
    label: row.label,
    price: Number(row.price_amount),
    capacity: row.total_quantity,
    sold: inv.sold,
    held: inv.held,
    remaining: inv.remaining,
    categoryId: row.category_id,
    archived: row.archived_at !== null,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  };
}

async function readManagedTier(
  tierId: number,
  showtimeId: number,
  eventType: "general_admission" | "seated",
  db: pg.PoolClient | typeof pool = pool,
): Promise<ManagedTier> {
  const [rows, inv] = await Promise.all([
    listTiers(showtimeId, db),
    tierInventory(showtimeId, eventType, db),
  ]);
  const row = rows.find((r) => r.id === tierId);
  if (!row) throw err.notFound("not_found", "Không tìm thấy hạng vé.");
  return toManagedTier(row, inv.get(tierId) ?? { sold: 0, held: 0, remaining: null });
}

/** The organizer's view of a showtime's tiers — archived ones INCLUDED, flagged (FR-009). */
export async function listManagedTiers(
  showtimeId: number,
  eventType: "general_admission" | "seated",
): Promise<ManagedTierList> {
  const [rows, inv] = await Promise.all([
    listTiers(showtimeId),
    tierInventory(showtimeId, eventType),
  ]);
  return {
    eventType,
    tiers: rows.map((r) =>
      toManagedTier(r, inv.get(r.id) ?? { sold: 0, held: 0, remaining: null }),
    ),
  };
}

export interface AddTierInput {
  label: string;
  price: number;
  capacity?: number | null;
  /** The chart category this price applies to. Seated showtimes only — GA has no chart. */
  categoryId?: number | null;
}

export async function addTier(
  actorUserId: number,
  showtimeId: number,
  input: AddTierInput,
): Promise<TierMutationResult> {
  const ctx = await showtimeEventType(showtimeId);
  if (!ctx) throw err.notFound("not_found", "Không tìm thấy suất chiếu.");

  // Capacity on a seated showtime comes from the seat map and belongs to feature 005 (UC-26 A4).
  if (ctx.eventType === "seated" && input.capacity !== undefined && input.capacity !== null) {
    throw err.unprocessable(
      "manual_capacity_seated",
      "Suất có ghế ngồi lấy sức chứa từ sơ đồ ghế, không nhập tay được.",
    );
  }

  return withTransaction(async (client) => {
    const active = await activeTierCount(showtimeId, client);
    if (active >= MAX_TIERS_PER_SHOWTIME) {
      throw err.conflict(
        "tier_limit_reached",
        `Mỗi suất chỉ có tối đa ${MAX_TIERS_PER_SHOWTIME} hạng vé đang bán.`,
      );
    }

    const { rows } = await client.query<{ id: number }>(
      // `category_id` is the seated half of the contract: it names the CHART class this price applies
      // to, so generation can bind seats to tiers without the organizer re-picking sections every
      // time (feature 005 categories). Null on general admission, which has no chart.
      `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, category_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        showtimeId,
        input.label,
        input.price,
        ctx.eventType === "seated" ? null : (input.capacity ?? 100),
        input.categoryId ?? null,
      ],
    );
    const tierId = rows[0].id;

    const { returnedToReview } = await applyOrganizerEdit(client, ctx.eventId, actorUserId, [
      "tier.add",
    ]);
    return {
      tier: await readManagedTier(tierId, showtimeId, ctx.eventType, client),
      returnedToReview,
    };
  });
}

export interface UpdateTierInput {
  label?: string;
  price?: number;
  capacity?: number;
  /** Omitted leaves the binding alone; an explicit null clears it. */
  categoryId?: number | null;
}

export async function updateTier(
  actorUserId: number,
  ctx: TierContext,
  input: UpdateTierInput,
): Promise<TierMutationResult> {
  const wantsCapacity = input.capacity !== undefined;
  if (wantsCapacity && ctx.event_type === "seated") {
    throw err.unprocessable(
      "manual_capacity_seated",
      "Suất có ghế ngồi lấy sức chứa từ sơ đồ ghế, không nhập tay được.",
    );
  }

  return withTransaction(async (client) => {
    // Lock first. From here sold + reserved cannot move under us, so the numbers we refuse with are
    // the numbers that were true at commit time (R-3).
    const locked = await lockTier(client, ctx.id);
    if (!locked) throw err.notFound("not_found", "Không tìm thấy hạng vé.");

    const changed: string[] = [];
    if (input.label !== undefined) changed.push("tier.label");
    if (input.price !== undefined) changed.push("tier.price");
    if (input.categoryId !== undefined) changed.push("tier.category");

    if (wantsCapacity) {
      const { sold, held } = await tierCommitted(locked, ctx.event_type, client);
      if (input.capacity! < sold + held) {
        // 409 with the numbers attached: FR-018 requires the refusal to name what blocked it, and
        // `err.conflict` carries no details, so the error is built directly.
        throw new HttpError(
          409,
          "capacity_below_committed",
          `Không thể giảm sức chứa xuống ${input.capacity}: đã bán ${sold} vé và đang giữ ${held} vé.`,
          { sold, held, requested: input.capacity! },
        );
      }
      changed.push("tier.capacity");
    }

    try {
      await client.query(
        `UPDATE ticket_tiers
            SET label = COALESCE($2, label),
                price_amount = COALESCE($3, price_amount),
                total_quantity = CASE WHEN $4::int IS NULL THEN total_quantity ELSE $4::int END,
                -- Distinguishes "not mentioned" from "cleared": only an explicit null unbinds.
                category_id = CASE WHEN $6::boolean THEN $5::bigint ELSE category_id END
          WHERE id = $1`,
        [
          ctx.id,
          input.label ?? null,
          input.price ?? null,
          wantsCapacity ? input.capacity : null,
          input.categoryId ?? null,
          input.categoryId !== undefined,
        ],
      );
    } catch (e) {
      // The table CHECK is the last line of defence behind the explicit refusal above. If a hold
      // slipped in despite the lock, surface the same refusal rather than a 500.
      if ((e as { code?: string }).code === CHECK_VIOLATION) {
        throw new HttpError(
          409,
          "capacity_below_committed",
          "Sức chứa mới thấp hơn số vé đã bán và đang giữ.",
        );
      }
      throw e;
    }

    const { returnedToReview } = await applyOrganizerEdit(
      client,
      ctx.event_id,
      actorUserId,
      changed,
    );
    return {
      tier: await readManagedTier(ctx.id, ctx.showtime_id, ctx.event_type, client),
      returnedToReview,
    };
  });
}

/**
 * Remove a tier. The server decides delete vs archive on live inventory and reports which happened,
 * so the console can word it correctly (FR-006, FR-007, FR-008).
 */
export async function removeTier(
  actorUserId: number,
  ctx: TierContext,
): Promise<TierRemovalResult> {
  if (ctx.archived_at !== null) {
    throw err.conflict("tier_already_archived", "Hạng vé này đã được lưu trữ.");
  }

  return withTransaction(async (client) => {
    const locked = await lockTier(client, ctx.id);
    if (!locked) throw err.notFound("not_found", "Không tìm thấy hạng vé.");

    const { sold, held } = await tierCommitted(locked, ctx.event_type, client);

    // A showtime of an on-sale event must always keep a way to buy: publishing requires ≥ 1 upcoming
    // showtime with ≥ 1 tier (002, FR-017), so removing the last active one would strand it.
    const active = await activeTierCount(ctx.showtime_id, client);
    if (active <= 1 && ctx.event_status === "on_sale") {
      throw err.conflict(
        "tier_last_active",
        "Đây là hạng vé duy nhất đang bán của suất này, không thể xoá.",
      );
    }

    // Live holds are feature 003's state. Deleting the tier under a reservation would corrupt it —
    // archiving stops new purchases while letting the existing holds convert.
    if (held > 0) {
      throw err.conflict(
        "tier_has_holds",
        `Đang có ${held} vé được giữ ở hạng này. Hãy lưu trữ hạng vé thay vì xoá.`,
      );
    }

    if (sold > 0) {
      await client.query(`UPDATE ticket_tiers SET archived_at = now() WHERE id = $1`, [ctx.id]);
      const { returnedToReview } = await applyOrganizerEdit(client, ctx.event_id, actorUserId, [
        "tier.remove",
      ]);
      return {
        outcome: "archived" as const,
        tier: await readManagedTier(ctx.id, ctx.showtime_id, ctx.event_type, client),
        returnedToReview,
      };
    }

    // A seated price class still pricing bookable seats cannot go: those seats would have no tier.
    // Reassigning them is the seat-map designer's job (feature 005).
    if (await tierHasSeats(ctx.id, client)) {
      throw err.conflict(
        "tier_has_seats",
        "Hạng vé đang được gán cho ghế trong sơ đồ. Hãy đổi hạng cho các ghế đó trong trình thiết kế sơ đồ trước.",
      );
    }

    // "No live holds" is not the same as "nothing references this tier": a LAPSED reservation still
    // has a `reservation_items` row pointing here, and that foreign key has no ON DELETE. Clearing
    // the dead lines first is what keeps a legitimate delete from failing on a hold that expired
    // days ago. A converted reservation is never touched — one of those means tickets were sold, and
    // the `sold > 0` branch above has already archived instead of reaching this line.
    await clearLapsedReservationItems(client, "tier", ctx.id);

    await client.query(`DELETE FROM ticket_tiers WHERE id = $1`, [ctx.id]);
    const { returnedToReview } = await applyOrganizerEdit(client, ctx.event_id, actorUserId, [
      "tier.remove",
    ]);
    return { outcome: "deleted" as const, tier: null, returnedToReview };
  });
}

/** Archiving is a shelf, not a delete: the four-active-tier limit is re-checked on the way back. */
export async function restoreTier(
  actorUserId: number,
  ctx: TierContext,
): Promise<TierMutationResult> {
  if (ctx.archived_at === null) {
    throw err.conflict("tier_not_archived", "Hạng vé này đang bán, không cần khôi phục.");
  }

  return withTransaction(async (client) => {
    const active = await activeTierCount(ctx.showtime_id, client);
    if (active >= MAX_TIERS_PER_SHOWTIME) {
      throw err.conflict(
        "tier_limit_reached",
        `Mỗi suất chỉ có tối đa ${MAX_TIERS_PER_SHOWTIME} hạng vé đang bán.`,
      );
    }

    await client.query(`UPDATE ticket_tiers SET archived_at = NULL WHERE id = $1`, [ctx.id]);
    const { returnedToReview } = await applyOrganizerEdit(client, ctx.event_id, actorUserId, [
      "tier.restore",
    ]);
    return {
      tier: await readManagedTier(ctx.id, ctx.showtime_id, ctx.event_type, client),
      returnedToReview,
    };
  });
}

export { tierContext };
