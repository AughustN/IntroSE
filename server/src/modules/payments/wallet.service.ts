import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { broadcastSeatUpdate } from "../../realtime/io.js";

export interface WalletView {
  balanceAmount: number;
}

export interface TopupView {
  id: number;
  orderRef: string;
  amount: number;
  status: "pending" | "paid" | "failed";
  paymentUrl?: string;
  createdAt: string;
  paidAt: string | null;
}

export interface PurchasedTicket {
  id: number;
  ticketCode: string;
  status: "valid" | "used" | "refunded";
  tierLabel: string;
  seatLabel: string | null;
  unitPriceAmount: number;
}

export interface OrderView {
  id: number;
  reservationId: number;
  showtimeId: number;
  totalAmount: number;
  paymentMethod: "wallet";
  status: "paid" | "refunded";
  createdAt: string;
  tickets: PurchasedTicket[];
}

export async function getWallet(userId: number, db: Db = pool): Promise<WalletView> {
  const { rows } = await db.query<{ balance_amount: number }>(
    `SELECT balance_amount FROM wallets WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0]) throw err.notFound("wallet_not_found", "Không tìm thấy ví của tài khoản.");
  return { balanceAmount: rows[0].balance_amount };
}

export async function createTopup(
  userId: number,
  amount: number,
  db: Db = pool,
): Promise<TopupView> {
  const orderRef = `TU${Date.now()}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const { rows } = await db.query<{
    id: number;
    order_ref: string;
    amount: number;
    status: "pending" | "paid" | "failed";
    created_at: Date;
    paid_at: Date | null;
  }>(
    `INSERT INTO payment_transactions (user_id, payment_kind, provider, provider_txn_ref, amount_cents, status)
     VALUES ($1, 'topup', 'vnpay', $2, $3, 'initiated')
     RETURNING id, provider_txn_ref AS order_ref, amount_cents AS amount,
               CASE status WHEN 'success' THEN 'paid' WHEN 'failed' THEN 'failed' ELSE 'pending' END AS status,
               created_at, NULL::timestamptz AS paid_at`,
    [userId, orderRef, amount],
  );
  return toTopup(rows[0]);
}

export async function getTopup(userId: number, id: number, db: Db = pool): Promise<TopupView> {
  const { rows } = await db.query<{
    id: number;
    order_ref: string;
    amount: number;
    status: "pending" | "paid" | "failed";
    created_at: Date;
    paid_at: Date | null;
  }>(
    `SELECT id, provider_txn_ref AS order_ref, amount_cents AS amount,
            CASE status WHEN 'success' THEN 'paid' WHEN 'failed' THEN 'failed' ELSE 'pending' END AS status,
            created_at, NULL::timestamptz AS paid_at
       FROM payment_transactions WHERE id = $1 AND user_id = $2 AND payment_kind = 'topup'`,
    [id, userId],
  );
  if (!rows[0]) throw err.notFound("topup_not_found", "Không tìm thấy giao dịch nạp ví.");
  return toTopup(rows[0]);
}

function toTopup(row: {
  id: number;
  order_ref: string;
  amount: number;
  status: "pending" | "paid" | "failed";
  created_at: Date;
  paid_at: Date | null;
}): TopupView {
  return {
    id: row.id,
    orderRef: row.order_ref,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    paidAt: row.paid_at?.toISOString() ?? null,
  };
}

export async function applyVnpayIpn(input: {
  orderRef: string;
  amount: number;
  responseCode: string;
  transactionStatus: string;
  transactionNo: string | null;
}): Promise<"paid" | "failed" | "duplicate" | "not_found" | "amount_mismatch"> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: number;
      user_id: number;
      amount: number;
      status: "pending" | "paid" | "failed";
    }>(
      `SELECT id, user_id, amount_cents AS amount,
              CASE status WHEN 'success' THEN 'paid' WHEN 'failed' THEN 'failed' ELSE 'pending' END AS status
         FROM payment_transactions
        WHERE provider = 'vnpay' AND provider_txn_ref = $1 AND payment_kind = 'topup' FOR UPDATE`,
      [input.orderRef],
    );
    const topup = rows[0];
    if (!topup) return "not_found";
    if (topup.amount !== input.amount) return "amount_mismatch";
    if (topup.status === "paid") return "duplicate";
    if (topup.status === "failed") return "failed";

    const successful = input.responseCode === "00" && input.transactionStatus === "00";
    await client.query(
      `UPDATE payment_transactions
          SET status = $2, provider_txn_id = $3,
              raw_payload = jsonb_build_object('responseCode', $4, 'transactionStatus', $5), updated_at = now()
        WHERE id = $1`,
      [
        topup.id,
        successful ? "success" : "failed",
        input.transactionNo,
        input.responseCode,
        input.transactionStatus,
      ],
    );
    if (!successful) return "failed";

    const wallet = (
      await client.query<{ id: number; balance_amount: number }>(
        `SELECT id, balance_amount FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [topup.user_id],
      )
    ).rows[0];
    if (!wallet) throw err.notFound("wallet_not_found");
    const balanceAfter = wallet.balance_amount + topup.amount;
    await client.query(`UPDATE wallets SET balance_amount = $2, updated_at = now() WHERE id = $1`, [
      wallet.id,
      balanceAfter,
    ]);
    await client.query(
      `INSERT INTO wallet_transactions (wallet_id, kind, amount, balance_after, payment_transaction_id)
       VALUES ($1, 'topup', $2, $3, $4)`,
      [wallet.id, topup.amount, balanceAfter, topup.id],
    );
    return "paid";
  });
}

export async function checkout(userId: number, reservationId: number): Promise<OrderView> {
  const outcome = await withTransaction(async (client) => {
    const reservation = (
      await client.query<{
        id: number;
        user_id: number;
        showtime_id: number;
        status: string;
        expires_at: Date;
      }>(
        `SELECT id, user_id, showtime_id, status, expires_at
           FROM reservations WHERE id = $1 FOR UPDATE`,
        [reservationId],
      )
    ).rows[0];
    if (!reservation) throw err.notFound("reservation_not_found", "Không tìm thấy đơn giữ chỗ.");
    if (reservation.user_id !== userId)
      throw err.forbidden("not_owner", "Đơn giữ chỗ này không phải của bạn.");

    const existing = await readOrder(client, userId, reservationId);
    if (existing)
      return {
        order: existing,
        soldSeatIds: [],
        tiers: [] as { id: number; remaining: number | null }[],
      };
    if (reservation.status !== "active")
      throw err.conflict("reservation_closed", "Đơn giữ chỗ đã kết thúc.");
    if (reservation.expires_at.getTime() <= Date.now()) {
      throw err.conflict("reservation_expired", "Đơn giữ chỗ đã hết hạn.");
    }

    const items = (
      await client.query<{
        id: number;
        ticket_tier_id: number;
        showtime_seat_id: number | null;
        quantity: number;
        unit_price_amount: number;
        seat_label: string | null;
        tier_label: string;
      }>(
        `SELECT ri.id, ri.ticket_tier_id, ri.showtime_seat_id, ri.quantity, ri.unit_price_amount,
                CASE WHEN ri.showtime_seat_id IS NULL THEN NULL ELSE (se.row_label || se.seat_number::text) END AS seat_label,
                tt.label AS tier_label
           FROM reservation_items ri
           JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
           LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
           LEFT JOIN seats se ON se.id = ss.seat_id
          WHERE ri.reservation_id = $1 ORDER BY ri.id`,
        [reservationId],
      )
    ).rows;
    if (items.length === 0) throw err.conflict("empty_reservation", "Đơn giữ chỗ không có vé.");
    const total = items.reduce((sum, item) => sum + item.quantity * item.unit_price_amount, 0);

    const wallet = (
      await client.query<{ id: number; balance_amount: number }>(
        `SELECT id, balance_amount FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [userId],
      )
    ).rows[0];
    if (!wallet) throw err.notFound("wallet_not_found");
    if (wallet.balance_amount < total)
      throw err.unprocessable("insufficient_wallet_balance", "Số dư ví không đủ để mua vé.");

    // Lock every tier in deterministic order before changing inventory.
    const tierIds = [...new Set(items.map((item) => item.ticket_tier_id))].sort((a, b) => a - b);
    for (const tierId of tierIds) {
      await client.query(`SELECT id FROM ticket_tiers WHERE id = $1 FOR UPDATE`, [tierId]);
    }

    const order = (
      await client.query<{ id: number; created_at: Date }>(
        `INSERT INTO orders (order_code, user_id, reservation_id, customer_name, customer_email, customer_phone,
                             subtotal_cents, service_fee_cents, discount_cents, final_total_cents, payment_method, payment_status)
         SELECT $1, u.id, $2, COALESCE(u.nickname, u.email), u.email, COALESCE(u.phone, ''),
                $3, 0, 0, $3, 'wallet', 'paid'
           FROM users u WHERE u.id = $4
         RETURNING id, created_at`,
        [
          `ORD${Date.now()}${randomUUID().replaceAll("-", "").slice(0, 8)}`,
          reservationId,
          total,
          userId,
        ],
      )
    ).rows[0];
    const ticketRows: PurchasedTicket[] = [];
    const soldSeatIds: number[] = [];

    for (const item of items) {
      if (item.showtime_seat_id !== null) {
        const sold = await client.query(
          `UPDATE showtime_seats
              SET status = 'sold', hold_owner_id = NULL, hold_expires_at = NULL
            WHERE id = $1 AND status = 'held' AND hold_owner_id = $2 AND hold_expires_at > now()`,
          [item.showtime_seat_id, userId],
        );
        if (sold.rowCount !== 1)
          throw err.conflict("seat_unavailable", "Một ghế trong đơn không còn được giữ.");
        soldSeatIds.push(item.showtime_seat_id);
      }
      await client.query(
        `UPDATE ticket_tiers
            SET sold_quantity = sold_quantity + $2,
                reserved_quantity = GREATEST(reserved_quantity - $2, 0)
          WHERE id = $1`,
        [item.ticket_tier_id, item.quantity],
      );
      for (let i = 0; i < item.quantity; i++) {
        const code = randomUUID();
        const ticket = (
          await client.query<{ id: number; barcode_value: string }>(
            `INSERT INTO tickets (order_id, reservation_item_id, price_cents, qr_token_hash, barcode_value, qr_status)
             VALUES ($1, $2, $3, $4, $5, 'unused') RETURNING id, barcode_value`,
            [
              order.id,
              item.id,
              item.unit_price_amount,
              createHash("sha256").update(code).digest("hex"),
              code,
            ],
          )
        ).rows[0];
        ticketRows.push({
          id: ticket.id,
          ticketCode: ticket.barcode_value,
          status: "valid",
          tierLabel: item.tier_label,
          seatLabel: item.seat_label,
          unitPriceAmount: item.unit_price_amount,
        });
      }
    }

    const balanceAfter = wallet.balance_amount - total;
    await client.query(`UPDATE wallets SET balance_amount = $2, updated_at = now() WHERE id = $1`, [
      wallet.id,
      balanceAfter,
    ]);
    await client.query(
      `INSERT INTO wallet_transactions (wallet_id, kind, amount, balance_after, order_id)
       VALUES ($1, 'purchase', $2, $3, $4)`,
      [wallet.id, -total, balanceAfter, order.id],
    );
    await client.query(`UPDATE reservations SET status = 'converted' WHERE id = $1`, [
      reservationId,
    ]);

    const orderView: OrderView = {
      id: order.id,
      reservationId,
      showtimeId: reservation.showtime_id,
      totalAmount: total,
      paymentMethod: "wallet",
      status: "paid",
      createdAt: order.created_at.toISOString(),
      tickets: ticketRows,
    };
    const tiers = await client.query<{ id: number; remaining: number | null }>(
      `SELECT id, CASE WHEN total_quantity IS NULL THEN NULL
                       ELSE total_quantity - sold_quantity - reserved_quantity END AS remaining
         FROM ticket_tiers WHERE id = ANY($1::bigint[])`,
      [tierIds],
    );
    return { order: orderView, soldSeatIds, tiers: tiers.rows };
  });
  if (outcome.soldSeatIds.length > 0) {
    broadcastSeatUpdate({
      showtimeId: outcome.order.showtimeId,
      seats: outcome.soldSeatIds.map((showtimeSeatId) => ({ showtimeSeatId, status: "sold" })),
    });
  }
  for (const tier of outcome.tiers) {
    broadcastSeatUpdate({
      showtimeId: outcome.order.showtimeId,
      tier: { ticketTierId: tier.id, remaining: tier.remaining },
    });
  }
  return outcome.order;
}

export async function getOrder(userId: number, orderId: number, db: Db = pool): Promise<OrderView> {
  const order = await readOrderById(db, userId, orderId);
  if (!order) throw err.notFound("order_not_found", "Không tìm thấy đơn hàng.");
  return order;
}

async function readOrder(db: Db, userId: number, reservationId: number): Promise<OrderView | null> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM orders WHERE user_id = $1 AND reservation_id = $2`,
    [userId, reservationId],
  );
  return rows[0] ? readOrderById(db, userId, rows[0].id) : null;
}

async function readOrderById(db: Db, userId: number, orderId: number): Promise<OrderView | null> {
  const { rows } = await db.query<{
    id: number;
    reservation_id: number;
    showtime_id: number;
    total_amount: number;
    payment_method: "wallet";
    status: "paid" | "refunded";
    created_at: Date;
  }>(
    `SELECT o.id, o.reservation_id, r.showtime_id, o.final_total_cents AS total_amount,
            o.payment_method, o.payment_status AS status, o.created_at
       FROM orders o JOIN reservations r ON r.id = o.reservation_id
      WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  const tickets = (
    await db.query<PurchasedTicket>(
      `SELECT t.id, t.barcode_value AS "ticketCode",
              CASE t.qr_status WHEN 'unused' THEN 'valid' WHEN 'checked_in' THEN 'used' ELSE 'refunded' END AS status,
              tt.label AS "tierLabel",
              CASE WHEN ri.showtime_seat_id IS NULL THEN NULL ELSE (se.row_label || se.seat_number::text) END AS "seatLabel",
              ri.unit_price_amount AS "unitPriceAmount"
         FROM tickets t
         JOIN reservation_items ri ON ri.id = t.reservation_item_id
         JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
         LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
         LEFT JOIN seats se ON se.id = ss.seat_id
        WHERE t.order_id = $1 ORDER BY t.id`,
      [row.id],
    )
  ).rows;
  return {
    id: row.id,
    reservationId: row.reservation_id,
    showtimeId: row.showtime_id,
    totalAmount: row.total_amount,
    paymentMethod: row.payment_method,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    tickets,
  };
}
