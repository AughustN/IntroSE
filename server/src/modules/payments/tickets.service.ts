import { pool, withTransaction, type Db } from "../../db/pool.js";
import { err } from "../../http.js";
import { broadcastSeatUpdate } from "../../realtime/io.js";
import {
  notifyWaitlistForShowtime,
  kickNotificationWorker,
  queueEventNotification,
  closeWaitlistsForEvent,
} from "../notifications/notifications.service.js";

type RefundRow = {
  ticket_id: number;
  order_id: number;
  user_id: number;
  showtime_id: number;
  ticket_tier_id: number;
  showtime_seat_id: number | null;
  refundable_amount: number;
  starts_at: Date;
};

async function refundTicket(db: Db, row: RefundRow): Promise<number> {
  const wallet = await db.query<{ id: number }>(
    `SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE`,
    [row.user_id],
  );
  if (!wallet.rows[0]) throw err.notFound("wallet_not_found");
  const balance = await db.query<{ balance_amount: number }>(
    `UPDATE wallets SET balance_amount = balance_amount + $2, updated_at = now() WHERE id = $1 RETURNING balance_amount`,
    [wallet.rows[0].id, row.refundable_amount],
  );
  await db.query(`UPDATE tickets SET qr_status = 'void' WHERE id = $1`, [row.ticket_id]);
  await db.query(
    `UPDATE ticket_tiers SET sold_quantity = GREATEST(sold_quantity - 1, 0) WHERE id = $1`,
    [row.ticket_tier_id],
  );
  if (row.showtime_seat_id !== null) {
    await db.query(
      `UPDATE showtime_seats SET status = 'available', hold_owner_id = NULL, hold_expires_at = NULL WHERE id = $1 AND status = 'sold'`,
      [row.showtime_seat_id],
    );
  }
  await db.query(
    `INSERT INTO wallet_transactions (wallet_id, kind, amount, balance_after, order_id) VALUES ($1, 'refund', $2, $3, $4)`,
    [wallet.rows[0].id, row.refundable_amount, balance.rows[0].balance_amount, row.order_id],
  );
  return balance.rows[0].balance_amount;
}

async function updateOrderRefundStatus(db: Db, orderIds: number[]): Promise<void> {
  if (!orderIds.length) return;
  await db.query(
    `UPDATE orders o
        SET payment_status = CASE WHEN NOT EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.qr_status <> 'void')
                                  THEN 'refunded' ELSE 'partially_refunded' END,
            updated_at = now()
      WHERE o.id = ANY($1::bigint[])`,
    [orderIds],
  );
}

export async function cancelTicket(userId: number, ticketId: number): Promise<void> {
  const row = await withTransaction(async (db) => {
    const result = await db.query<RefundRow>(
      `SELECT t.id AS ticket_id, t.order_id, o.user_id, s.id AS showtime_id, ri.ticket_tier_id,
              ri.showtime_seat_id, t.refundable_amount, s.starts_at
         FROM tickets t
         JOIN orders o ON o.id = t.order_id
         JOIN reservation_items ri ON ri.id = t.reservation_item_id
         JOIN reservations r ON r.id = o.reservation_id
         JOIN showtimes s ON s.id = r.showtime_id
        WHERE t.id = $1 FOR UPDATE OF t, o`,
      [ticketId],
    );
    const ticket = result.rows[0];
    if (!ticket || ticket.user_id !== userId) throw err.notFound("ticket_not_found");
    if (ticket.starts_at.getTime() <= Date.now() + 24 * 60 * 60_000) {
      throw err.unprocessable(
        "ticket_cancellation_closed",
        "Vé chỉ có thể hủy trước giờ diễn ít nhất 24 giờ.",
      );
    }
    const active = await db.query(
      `SELECT 1 FROM tickets WHERE id = $1 AND qr_status = 'unused' FOR UPDATE`,
      [ticketId],
    );
    if (!active.rowCount)
      throw err.conflict("ticket_not_cancellable", "Vé này không còn có thể hủy.");
    await refundTicket(db, ticket);
    await updateOrderRefundStatus(db, [ticket.order_id]);
    return ticket;
  });
  broadcastSeatUpdate({
    showtimeId: row.showtime_id,
    ...(row.showtime_seat_id === null
      ? { tier: { ticketTierId: row.ticket_tier_id, remaining: null } }
      : { seats: [{ showtimeSeatId: row.showtime_seat_id, status: "available" as const }] }),
  });
  await notifyWaitlistForShowtime(row.showtime_id);
  kickNotificationWorker();
}

export async function settleEventCancellation(
  db: Db,
  eventId: number,
  body = "Sự kiện đã bị hủy. Vé chưa sử dụng của bạn đã được hoàn lại vào ví TixHub.",
): Promise<{ refundedTickets: number; refundedAmount: number }> {
  const event = await db.query<{ id: number; status: string }>(
    `SELECT id, status FROM events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  if (!event.rowCount) throw err.notFound("not_found");
  if (event.rows[0].status === "cancelled") return { refundedTickets: 0, refundedAmount: 0 };

  await db.query(`UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1`, [
    eventId,
  ]);
  await db.query(
    `UPDATE showtimes SET status = 'cancelled' WHERE event_id = $1 AND starts_at > now()`,
    [eventId],
  );
  const tickets = await db.query<RefundRow>(
    `SELECT t.id AS ticket_id, t.order_id, o.user_id, s.id AS showtime_id, ri.ticket_tier_id,
            ri.showtime_seat_id, t.refundable_amount, s.starts_at
       FROM tickets t
       JOIN orders o ON o.id = t.order_id
       JOIN reservation_items ri ON ri.id = t.reservation_item_id
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
      WHERE s.event_id = $1 AND s.starts_at > now() AND t.qr_status = 'unused'
      ORDER BY o.user_id, t.id FOR UPDATE OF t, o`,
    [eventId],
  );
  for (const ticket of tickets.rows) await refundTicket(db, ticket);
  await updateOrderRefundStatus(db, [...new Set(tickets.rows.map((ticket) => ticket.order_id))]);
  await closeWaitlistsForEvent(db, eventId, "cancelled");
  await queueEventNotification(db, eventId, "event_cancelled", body, "cancellation");
  return {
    refundedTickets: tickets.rowCount ?? 0,
    refundedAmount: tickets.rows.reduce((sum, ticket) => sum + ticket.refundable_amount, 0),
  };
}

export async function cancelEvent(eventId: number): Promise<{ refundedTickets: number }> {
  const result = await withTransaction(async (db) => settleEventCancellation(db, eventId));
  kickNotificationWorker();
  return { refundedTickets: result.refundedTickets };
}

/** A QR-scanned ticket, for the organizer's check-in screen. */
export interface ScanTicket {
  id: number;
  code: string;
  status: "unused" | "checked_in" | "void";
  tierLabel: string;
  seatLabel: string | null;
  customerName: string;
  customerEmail: string;
  eventId: number;
  eventTitle: string;
  showtimeId: number;
  startsAt: string;
  venueName: string;
  venueAddress: string;
}

/** Ticket + owning organizer, restricted to the caller's events (organizer cannot see other shows). */
async function readScannableTicket(
  code: string,
  organizerUserId: number,
  db: Db = pool,
): Promise<ScanTicket | null> {
  const { rows } = await db.query(
    `SELECT t.id, t.barcode_value AS code, t.qr_status AS status, tt.label AS "tierLabel",
            CASE WHEN ss.id IS NULL THEN NULL ELSE se.row_label || se.seat_number::text END AS "seatLabel",
            o.customer_name AS "customerName", o.customer_email AS "customerEmail",
            e.id AS "eventId", e.title AS "eventTitle", s.id AS "showtimeId",
            s.starts_at AS "startsAt", v.name AS "venueName", v.raw_address AS "venueAddress"
       FROM tickets t
       JOIN orders o ON o.id = t.order_id
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN organizers org ON org.id = e.organizer_id
       JOIN venues v ON v.id = s.venue_id
       JOIN reservation_items ri ON ri.id = t.reservation_item_id
       JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
       LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
       LEFT JOIN seats se ON se.id = ss.seat_id
      WHERE t.barcode_value = $1 AND org.user_id = $2`,
    [code, organizerUserId],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...row, startsAt: row.startsAt.toISOString() };
}

/** Look a ticket up by its QR code, scoped to the organizer's own events (US6 check-in). */
export async function lookupTicket(
  code: string,
  organizerUserId: number,
  db: Db = pool,
): Promise<ScanTicket> {
  const ticket = await readScannableTicket(code, organizerUserId, db);
  if (!ticket) throw err.notFound("ticket_not_found", "Không tìm thấy vé trong sự kiện của bạn.");
  return ticket;
}

/**
 * Check a ticket in (US6). The QR payload is the ticket's own `barcode_value`.
 *
 * A real check-in is not just "was this code issued" — a void ticket is a refunded one and must stay
 * closed, an unused one should only be admitted once (a copied QR scanned twice would admit two
 * people), and a rescan of an already-checked-in ticket is a read, not an error. The row lock plus
 * the status guard make the "already" case race-free: two concurrent scans of the same unused ticket
 * settle with one winner, the loser reads the freshly set `checked_in`.
 */
export async function checkInTicket(
  code: string,
  organizerUserId: number,
  db: Db = pool,
): Promise<{ ticket: ScanTicket; already: boolean }> {
  const existing = await readScannableTicket(code, organizerUserId, db);
  if (!existing) throw err.notFound("ticket_not_found", "Không tìm thấy vé trong sự kiện của bạn.");
  if (existing.status === "void")
    throw err.conflict("ticket_void", "Vé này đã bị hủy/hoàn tiền, không thể soát.");
  if (existing.status === "checked_in") return { ticket: existing, already: true };

  const { rows } = await db.query(
    `UPDATE tickets SET qr_status = 'checked_in', checked_in_at = now(), checked_in_by = $2
      WHERE id = $1 AND qr_status = 'unused'
      RETURNING id`,
    [existing.id, organizerUserId],
  );
  if (!rows.length) {
    // Lost the race — the other scanner flipped it first. Re-read and treat as a benign rescan.
    return { ticket: await readScannableTicket(code, organizerUserId, db) ?? existing, already: true };
  }
  return {
    ticket: { ...existing, status: "checked_in" },
    already: false,
  };
}
