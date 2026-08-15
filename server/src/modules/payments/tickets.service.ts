import { withTransaction, type Db } from "../../db/pool.js";
import { err } from "../../http.js";
import { broadcastSeatUpdate } from "../../realtime/io.js";
import {
  notifyWaitlistForShowtime,
  kickNotificationWorker,
  queueEventNotification,
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
