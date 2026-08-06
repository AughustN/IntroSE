import type { HoldRequest, Reservation, SeatUpdate } from "@shared/holds/types.js";
import { HOLD_ABSOLUTE_MS, HOLD_GRACE_MS, HOLD_TTL_MS, SEAT_CAP } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { broadcastSeatUpdate } from "../../realtime/io.js";
import * as repo from "./holds.repo.js";

/**
 * Seat holds (feature 003). Every path here obeys four rules:
 *
 *  1. **The owner comes from the session, never the request** (FR-024).
 *  2. **One active reservation per (attendee, showtime)** — a further hold joins it (FR-011).
 *  3. **One clock**: the window starts at the first hold and is never extended by adding a seat.
 *     The only extension is the one-time top-up grace (FR-006/FR-010).
 *  4. **Refuse loudly**: a taken seat, a full cap or an oversell is an error with a stable code,
 *     never a silent partial success.
 */

export interface HoldResult {
  reservation: Reservation;
  /** 200 when the caller already held exactly this, 201 when something new was held (idempotency). */
  created: boolean;
}

const ttlFrom = (createdAt: Date): Date => new Date(createdAt.getTime() + HOLD_TTL_MS);

/** Load the caller's reservation as the API returns it. */
async function view(reservationId: number): Promise<Reservation> {
  const row = await repo.findReservation(pool, reservationId);
  if (!row) throw err.notFound("not_found", "Không tìm thấy đơn giữ chỗ.");
  return repo.toReservationView(row, await repo.listItems(pool, reservationId));
}

function assertSelection(
  body: HoldRequest,
): { kind: "seated"; seatIds: number[] } | { kind: "ga"; tierId: number; quantity: number } {
  const seatIds = body.seatIds ?? [];
  const hasSeats = seatIds.length > 0;
  const hasGa = body.ticketTierId !== undefined && body.quantity !== undefined;

  // A reservation is seated or GA, never both and never empty (FR-012, edge cases).
  if (hasSeats && hasGa)
    throw err.unprocessable("invalid_selection", "Không thể vừa chọn ghế vừa chọn số lượng.");
  if (hasSeats) {
    if (new Set(seatIds).size !== seatIds.length) {
      throw err.unprocessable("invalid_selection", "Danh sách ghế bị trùng.");
    }
    return { kind: "seated", seatIds };
  }
  if (hasGa) {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw err.unprocessable("invalid_selection", "Số lượng vé không hợp lệ.");
    }
    return { kind: "ga", tierId: Number(body.ticketTierId), quantity };
  }
  throw err.unprocessable("invalid_selection", "Chưa chọn ghế hoặc số lượng vé.");
}

async function requireSellableShowtime(showtimeId: number): Promise<repo.ShowtimeInfo> {
  const info = await repo.getShowtimeInfo(showtimeId);
  if (!info) throw err.notFound("not_found", "Không tìm thấy suất diễn.");
  if (!info.sellable) {
    throw err.unprocessable("showtime_unavailable", "Suất diễn này không còn mở bán.");
  }
  return info;
}

// ---- Hold (create or join the single active reservation) -------------------

export async function hold(userId: number, body: HoldRequest): Promise<HoldResult> {
  const selection = assertSelection(body);
  const showtime = await requireSellableShowtime(body.showtimeId);

  if (selection.kind === "seated" && showtime.eventType !== "seated") {
    throw err.unprocessable("invalid_selection", "Suất diễn này không có sơ đồ ghế.");
  }
  if (selection.kind === "ga" && showtime.eventType !== "general_admission") {
    throw err.unprocessable("invalid_selection", "Suất diễn này phải chọn ghế cụ thể.");
  }

  const outcome = await withTransaction(async (client) => {
    const now = new Date();
    let reservation = await repo.findActiveReservation(client, userId, body.showtimeId, true);
    // An active row whose window already passed is spent — the sweep just has not reached it yet.
    if (reservation && reservation.expires_at.getTime() <= now.getTime()) {
      await repo.setReservationStatus(client, reservation.id, "expired");
      await repo.releaseSeats(client, await repo.listSeatIds(client, reservation.id));
      for (const line of await repo.listGaLines(client, reservation.id)) {
        await repo.bumpReserved(client, line.ticket_tier_id, -line.quantity);
      }
      reservation = null;
    }

    const held = reservation ? await repo.countHeldTickets(client, reservation.id) : 0;

    if (selection.kind === "seated") {
      const seats = await repo.lockSeats(client, body.showtimeId, selection.seatIds);
      if (seats.length !== selection.seatIds.length) {
        // A seat id that is not on this showtime (or does not exist) — refuse the whole request.
        throw err.unprocessable("invalid_selection", "Ghế không thuộc suất diễn này.");
      }

      const mine = seats.filter((s) => repo.isHeldBy(s, userId, now));
      const fresh = seats.filter((s) => !repo.isHeldBy(s, userId, now));

      // Re-holding what the caller already holds is an idempotent success (FR-005).
      if (fresh.length === 0 && reservation) {
        return { reservationId: reservation.id, created: false, update: null as SeatUpdate | null };
      }

      for (const seat of fresh) {
        if (!repo.isHoldable(seat, now)) {
          throw err.conflict("seat_taken", "Ghế vừa được người khác giữ.");
        }
      }

      if (held + fresh.length > SEAT_CAP) {
        throw err.unprocessable(
          "cap_exceeded",
          `Mỗi tài khoản chỉ giữ tối đa ${SEAT_CAP} vé cho một suất diễn.`,
        );
      }

      if (!reservation) {
        reservation = await repo.createReservation(client, userId, body.showtimeId, ttlFrom(now));
      }

      const freshIds = fresh.map((s) => s.id);
      await repo.holdSeats(client, freshIds, userId, reservation.expires_at);
      await repo.addSeatItems(client, reservation.id, [...fresh, ...mine]);

      return {
        reservationId: reservation.id,
        created: true,
        update: {
          showtimeId: body.showtimeId,
          seats: freshIds.map((id) => ({ showtimeSeatId: id, status: "held" as const })),
        },
      };
    }

    // ---- General admission: a quantity against a tier, no seat rows (R-7) ----
    const tier = await repo.lockTier(client, selection.tierId);
    if (!tier || tier.showtime_id !== body.showtimeId) {
      throw err.unprocessable("invalid_selection", "Hạng vé không thuộc suất diễn này.");
    }
    // An archived tier is retired (006 FR-006). Excluding it from the catalog read only makes it
    // INVISIBLE — a stale tab or a replayed request still carries its id, and without this check the
    // hold would succeed. "Unpurchasable" has to be enforced where purchases happen. Holds placed
    // BEFORE the archive are untouched and still convert: this guards new holds only.
    if (tier.archived_at !== null) {
      throw err.unprocessable("tier_archived", "Hạng vé này đã ngừng bán.");
    }

    const remaining = repo.tierRemaining(tier);
    if (remaining !== null && selection.quantity > remaining) {
      throw err.unprocessable("insufficient_stock", "Không đủ vé còn lại cho hạng vé này.");
    }
    if (held + selection.quantity > SEAT_CAP) {
      throw err.unprocessable(
        "cap_exceeded",
        `Mỗi tài khoản chỉ giữ tối đa ${SEAT_CAP} vé cho một suất diễn.`,
      );
    }

    if (!reservation) {
      reservation = await repo.createReservation(client, userId, body.showtimeId, ttlFrom(now));
    }
    await repo.bumpReserved(client, tier.id, selection.quantity);
    await repo.upsertGaItem(client, reservation.id, tier.id, selection.quantity, tier.price_amount);

    const left = repo.tierRemaining({
      ...tier,
      reserved_quantity: tier.reserved_quantity + selection.quantity,
    });
    return {
      reservationId: reservation.id,
      created: true,
      update: { showtimeId: body.showtimeId, tier: { ticketTierId: tier.id, remaining: left } },
    };
  });

  if (outcome.update) broadcastSeatUpdate(outcome.update);
  return { reservation: await view(outcome.reservationId), created: outcome.created };
}

// ---- Patch (add / remove) -------------------------------------------------

export async function addToReservation(
  userId: number,
  reservationId: number,
  body: HoldRequest,
): Promise<Reservation> {
  const reservation = await requireOwnedActive(userId, reservationId);
  const result = await hold(userId, { ...body, showtimeId: reservation.showtime_id });
  return result.reservation;
}

export async function removeSeats(
  userId: number,
  reservationId: number,
  seatIds: number[],
): Promise<Reservation> {
  const reservation = await requireOwnedActive(userId, reservationId);
  if (seatIds.length === 0) return view(reservationId);

  const released = await withTransaction(async (client) => {
    // Re-lock the reservation in this transaction: checkout also owns this lock, so a stale
    // remove request cannot delete items from a reservation that just became an order.
    const lockedReservation = await repo.findReservation(client, reservation.id, true);
    if (
      !lockedReservation ||
      lockedReservation.user_id !== userId ||
      lockedReservation.status !== "active" ||
      lockedReservation.expires_at.getTime() <= Date.now()
    ) {
      throw err.notFound("not_found", "Đơn giữ chỗ đã hết hạn hoặc đã kết thúc.");
    }
    const seats = await repo.lockSeats(client, lockedReservation.showtime_id, seatIds);
    const now = new Date();
    // Releasing a seat the caller does not own is refused; one that already lapsed is a no-op
    // success — it is free either way (FR-004, edge case).
    const owned = seats.filter((s) => repo.isHeldBy(s, userId, now));
    const foreign = seats.filter((s) => s.status === "held" && s.hold_owner_id !== userId);
    if (foreign.length > 0) throw err.forbidden("not_owner", "Bạn không giữ ghế này.");

    const ids = owned.map((s) => s.id);
    await repo.releaseSeats(client, ids);
    await repo.removeSeatItems(client, lockedReservation.id, seatIds);

    // An empty reservation is finished — it must not linger and block the next selection (FR-011).
    if ((await repo.countHeldTickets(client, lockedReservation.id)) === 0) {
      await repo.setReservationStatus(client, lockedReservation.id, "cancelled");
    }
    return ids;
  });

  if (released.length > 0) {
    broadcastSeatUpdate({
      showtimeId: reservation.showtime_id,
      seats: released.map((id) => ({ showtimeSeatId: id, status: "available" as const })),
    });
  }
  return view(reservationId);
}

// ---- Cancel ---------------------------------------------------------------

export async function cancel(userId: number, reservationId: number): Promise<void> {
  const reservation = await requireOwnedActive(userId, reservationId);
  const update = await releaseEverything(reservation, "cancelled");
  for (const u of update) broadcastSeatUpdate(u);
}

/**
 * Release every seat / GA quantity a reservation holds and close it. Shared by cancel (FR-014) and
 * the expiry sweep (FR-006/008) — the two paths that can end a hold, and the only two (FR-009).
 */
export async function releaseEverything(
  reservation: repo.ReservationRow,
  status: "cancelled" | "expired",
): Promise<SeatUpdate[]> {
  return withTransaction(async (client) => {
    const locked = await repo.findReservation(client, reservation.id, true);
    if (!locked || locked.status !== "active") return []; // someone got there first (or 004 converted it)

    const seatIds = await repo.listSeatIds(client, locked.id);
    const gaLines = await repo.listGaLines(client, locked.id);

    await repo.releaseSeats(client, seatIds);
    for (const line of gaLines)
      await repo.bumpReserved(client, line.ticket_tier_id, -line.quantity);
    await repo.setReservationStatus(client, locked.id, status);

    const updates: SeatUpdate[] = [];
    if (seatIds.length > 0) {
      updates.push({
        showtimeId: locked.showtime_id,
        seats: seatIds.map((id) => ({ showtimeSeatId: id, status: "available" as const })),
      });
    }
    for (const line of gaLines) {
      const tier = await repo.lockTier(client, line.ticket_tier_id);
      updates.push({
        showtimeId: locked.showtime_id,
        tier: {
          ticketTierId: line.ticket_tier_id,
          remaining: tier ? repo.tierRemaining(tier) : null,
        },
      });
    }
    return updates;
  });
}

// ---- One-time top-up grace (FR-010) ---------------------------------------

/**
 * Internal operation, not a public route: feature 004's `POST /wallet/topups` calls it when the
 * top-up carries a `reservationId`. Bounded on purpose — one grace, hard ceiling — so a slow VNPay
 * detour cannot become a free seat lock (schema D2 amendment).
 */
export async function extendOnce(userId: number, reservationId: number): Promise<Reservation> {
  const reservation = await requireOwnedActive(userId, reservationId);

  const extended = await withTransaction(async (client) => {
    const row = await repo.extendReservationOnce(
      client,
      reservation.id,
      HOLD_GRACE_MS,
      HOLD_ABSOLUTE_MS,
    );
    if (row) await repo.syncSeatExpiry(client, row.id, row.expires_at);
    return row;
  });

  // Already spent: not an error, just no extra time — the window stands as it is.
  return extended
    ? repo.toReservationView(extended, await repo.listItems(pool, reservation.id))
    : view(reservation.id);
}

// ---- Read -----------------------------------------------------------------

export async function getReservation(userId: number, reservationId: number): Promise<Reservation> {
  const row = await repo.findReservation(pool, reservationId);
  if (!row) throw err.notFound("not_found", "Không tìm thấy đơn giữ chỗ.");
  if (row.user_id !== userId)
    throw err.forbidden("not_owner", "Đơn giữ chỗ này không phải của bạn.");
  return repo.toReservationView(row, await repo.listItems(pool, reservationId));
}

/** The caller's live selection for a showtime, if any — what the map shows a returning owner (FR-022). */
export async function getActiveForShowtime(
  userId: number,
  showtimeId: number,
): Promise<Reservation | null> {
  const row = await repo.findActiveReservation(pool, userId, showtimeId);
  if (!row || row.expires_at.getTime() <= Date.now()) return null;
  return repo.toReservationView(row, await repo.listItems(pool, row.id));
}

async function requireOwnedActive(
  userId: number,
  reservationId: number,
): Promise<repo.ReservationRow> {
  const row = await repo.findReservation(pool, reservationId);
  if (!row) throw err.notFound("not_found", "Không tìm thấy đơn giữ chỗ.");
  if (row.user_id !== userId)
    throw err.forbidden("not_owner", "Đơn giữ chỗ này không phải của bạn.");
  // Expired / cancelled / converted are all closed to changes (FR-013).
  if (row.status !== "active" || row.expires_at.getTime() <= Date.now()) {
    throw err.notFound("not_found", "Đơn giữ chỗ đã hết hạn hoặc đã kết thúc.");
  }
  return row;
}
