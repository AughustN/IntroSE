import { createHash, randomUUID } from "node:crypto";
import { WALLET_BALANCE_CAP } from "../../config.js";
import type { Db } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { broadcastSeatUpdate } from "../../realtime/io.js";
import {
  kickNotificationWorker,
  markWaitlistConverted,
  queueOrderConfirmation,
} from "../notifications/notifications.service.js";

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
  /** The hold this top-up was started from, so the client knows which checkout to return to. */
  reservationId: number | null;
}

interface TopupRow {
  id: number;
  order_ref: string;
  amount: number;
  status: "pending" | "paid" | "failed";
  created_at: Date;
  paid_at: Date | null;
  reservation_id: number | null;
}

/** One line of the wallet statement (UC-41). `amount` is signed: credits positive, debits negative. */
export interface WalletEntry {
  id: number;
  kind: "topup" | "purchase" | "refund";
  amount: number;
  balanceAfter: number;
  createdAt: string;
  orderId: number | null;
  /** Present on purchase/refund rows, so the statement can link to the event it was for. */
  eventTitle: string | null;
}

/** A top-up that has left for VNPay but not come back — shown as Pending, never as lost money. */
export interface PendingTopup {
  id: number;
  amount: number;
  createdAt: string;
}

export interface WalletStatement {
  balanceAmount: number;
  entries: WalletEntry[];
  pending: PendingTopup[];
  /** True when older entries remain; the client pages with `before`. */
  hasMore: boolean;
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

/**
 * Records an `initiated` top-up and returns it for hand-off to VNPay (UC-40 steps 3-4).
 *
 * The balance ceiling is checked here, before the buyer ever reaches the gateway. Checking it on
 * the callback instead would take real money and then have nowhere to put it — the wallet cannot
 * exceed the cap and there is no automatic path back out (UC-40 step 3, A2).
 *
 * `reservationId` is the hold the buyer came from, when the top-up was started from a short balance
 * at checkout. It is stored so the grace can be granted against it and so they can be returned to
 * that checkout; a top-up from the wallet page carries none.
 */
export async function createTopup(
  userId: number,
  amount: number,
  reservationId: number | null = null,
): Promise<TopupView> {
  const orderRef = `TU${Date.now()}${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  return withTransaction(async (client) => {
    // Locked so two top-ups opened in two tabs cannot both pass a ceiling check that only one of
    // them leaves room for.
    const wallet = (
      await client.query<{ balance_amount: number }>(
        `SELECT balance_amount FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [userId],
      )
    ).rows[0];
    if (!wallet) throw err.notFound("wallet_not_found", "Không tìm thấy ví của tài khoản.");

    const headroom = WALLET_BALANCE_CAP - wallet.balance_amount;
    if (amount > headroom) {
      throw err.unprocessable(
        "wallet_cap_exceeded",
        headroom > 0
          ? `Ví chỉ còn nhận thêm được ${headroom.toLocaleString("vi-VN")}₫.`
          : "Số dư ví đã đạt mức tối đa.",
        {
          balance: wallet.balance_amount,
          cap: WALLET_BALANCE_CAP,
          maxAddable: Math.max(headroom, 0),
        },
      );
    }

    const { rows } = await client.query<TopupRow>(
      `INSERT INTO payment_transactions
         (user_id, payment_kind, provider, provider_txn_ref, amount_cents, status, reservation_id)
       VALUES ($1, 'topup', 'vnpay', $2, $3, 'initiated', $4::bigint)
       RETURNING id, provider_txn_ref AS order_ref, amount_cents AS amount,
                 CASE status WHEN 'success' THEN 'paid' WHEN 'failed' THEN 'failed' ELSE 'pending' END AS status,
                 created_at, NULL::timestamptz AS paid_at, reservation_id`,
      [userId, orderRef, amount, reservationId],
    );
    return toTopup(rows[0]);
  });
}

export async function getTopup(userId: number, id: number, db: Db = pool): Promise<TopupView> {
  const { rows } = await db.query<TopupRow>(
    `SELECT id, provider_txn_ref AS order_ref, amount_cents AS amount,
            CASE status WHEN 'success' THEN 'paid' WHEN 'failed' THEN 'failed' ELSE 'pending' END AS status,
            created_at, updated_at AS paid_at, reservation_id
       FROM payment_transactions WHERE id = $1 AND user_id = $2 AND payment_kind = 'topup'`,
    [id, userId],
  );
  if (!rows[0]) throw err.notFound("topup_not_found", "Không tìm thấy giao dịch nạp ví.");
  return toTopup(rows[0]);
}

function toTopup(row: TopupRow): TopupView {
  return {
    id: row.id,
    orderRef: row.order_ref,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    // `updated_at` only means "paid at" once the row actually reached success.
    paidAt: row.status === "paid" ? (row.paid_at?.toISOString() ?? null) : null,
    reservationId: row.reservation_id,
  };
}

/**
 * The wallet statement (UC-41): balance, the ledger newest first, and any top-up still in flight.
 *
 * Pending top-ups are returned separately rather than mixed into the ledger because they are not
 * ledger rows — nothing has moved yet. Folding them in would make the listed entries stop summing
 * to the balance, which is the one invariant this screen exists to demonstrate (DATA-04).
 */
export async function getStatement(
  userId: number,
  opts: { limit?: number; before?: number } = {},
  db: Db = pool,
): Promise<WalletStatement> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  const wallet = (
    await db.query<{ id: number; balance_amount: number }>(
      `SELECT id, balance_amount FROM wallets WHERE user_id = $1`,
      [userId],
    )
  ).rows[0];
  if (!wallet) throw err.notFound("wallet_not_found", "Không tìm thấy ví của tài khoản.");

  // One extra row answers "is there more?" without a second COUNT over the whole ledger.
  const { rows } = await db.query<{
    id: number;
    kind: "topup" | "purchase" | "refund";
    amount: number;
    balance_after: number;
    created_at: Date;
    order_id: number | null;
    event_title: string | null;
  }>(
    `SELECT wt.id, wt.kind, wt.amount, wt.balance_after, wt.created_at, wt.order_id,
            e.title AS event_title
       FROM wallet_transactions wt
       LEFT JOIN orders o ON o.id = wt.order_id
       LEFT JOIN reservations r ON r.id = o.reservation_id
       LEFT JOIN showtimes s ON s.id = r.showtime_id
       LEFT JOIN events e ON e.id = s.event_id
      WHERE wt.wallet_id = $1 AND ($2::bigint IS NULL OR wt.id < $2)
      ORDER BY wt.id DESC
      LIMIT $3`,
    [wallet.id, opts.before ?? null, limit + 1],
  );

  const pending = (
    await db.query<{ id: number; amount: number; created_at: Date }>(
      `SELECT id, amount_cents AS amount, created_at
         FROM payment_transactions
        WHERE user_id = $1 AND payment_kind = 'topup' AND status = 'initiated'
        ORDER BY id DESC`,
      [userId],
    )
  ).rows;

  return {
    balanceAmount: wallet.balance_amount,
    entries: rows.slice(0, limit).map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      balanceAfter: row.balance_after,
      createdAt: row.created_at.toISOString(),
      orderId: row.order_id,
      eventTitle: row.event_title,
    })),
    pending: pending.map((row) => ({
      id: row.id,
      amount: row.amount,
      createdAt: row.created_at.toISOString(),
    })),
    hasMore: rows.length > limit,
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
      // Every parameter is cast explicitly: `jsonb_build_object` is variadic "any", and
      // `provider_txn_id` takes a NULL when VNPay sends no transaction number — in both cases
      // Postgres has nothing to infer a parameter type from and refuses to plan the statement.
      `UPDATE payment_transactions
          SET status = $2, provider_txn_id = $3::text,
              raw_payload = jsonb_build_object('responseCode', $4::text, 'transactionStatus', $5::text),
              updated_at = now()
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
    /**
     * Vouchers are a separate feature and no order carries one yet, so the discount is zero and
     * `refundable_amount` equals face value. It is threaded through as a variable rather than
     * inlined as 0 because the allocation below is the part that must already be right: getting it
     * wrong later mints money on every refund of a discounted order.
     */
    const discount = 0;

    const wallet = (
      await client.query<{ id: number; balance_amount: number }>(
        `SELECT id, balance_amount FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [userId],
      )
    ).rows[0];
    if (!wallet) throw err.notFound("wallet_not_found");
    if (wallet.balance_amount < total) {
      // The exact shortfall, so the top-up sheet opens pre-filled instead of making the buyer work
      // out how far short they are (UC-12 A2). Nothing has been created at this point.
      const shortfall = total - wallet.balance_amount;
      throw err.unprocessable(
        "insufficient_wallet_balance",
        `Số dư ví thiếu ${shortfall.toLocaleString("vi-VN")}₫ để mua vé.`,
        { required: total, balance: wallet.balance_amount, shortfall },
      );
    }

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

    // One entry per admitted person — a seated line is one, a GA line of 3 is three. Flattened up
    // front because the discount is allocated across tickets, which cannot be done one line at a
    // time (see `allocateRefundable`).
    const plan = items.flatMap((item) => Array.from({ length: item.quantity }, () => item));
    const refundable = allocateRefundable(
      plan.map((item) => item.unit_price_amount),
      discount,
    );

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
      // The guard in the WHERE clause is what makes A4 (tier sold out while the buyer reviewed)
      // impossible to lose to: capacity is re-checked at the moment of sale, not before it. A
      // reserved quantity normally makes this unreachable — it is here for the case where the hold
      // was swept between the expiry check above and this write.
      const tier = await client.query(
        `UPDATE ticket_tiers
            SET sold_quantity = sold_quantity + $2,
                reserved_quantity = GREATEST(reserved_quantity - $2, 0)
          WHERE id = $1
            AND (total_quantity IS NULL OR sold_quantity + $2 <= total_quantity)`,
        [item.ticket_tier_id, item.quantity],
      );
      if (tier.rowCount !== 1)
        throw err.conflict(
          "tier_sold_out",
          `Hạng vé "${item.tier_label}" vừa bán hết. Bạn có thể tham gia danh sách chờ.`,
        );
      for (let i = 0; i < item.quantity; i++) {
        const code = randomUUID();
        const ticket = (
          await client.query<{ id: number; barcode_value: string }>(
            `INSERT INTO tickets
               (order_id, reservation_item_id, price_cents, refundable_amount, qr_token_hash, barcode_value, qr_status)
             VALUES ($1, $2, $3, $4, $5, $6, 'unused') RETURNING id, barcode_value`,
            [
              order.id,
              item.id,
              item.unit_price_amount,
              refundable[ticketRows.length],
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
    // The buyer waited for this and now has it, so their place in the queue closes here — inside
    // the same transaction as the tickets, so the two can never disagree (UC-17, FR-010).
    await markWaitlistConverted(
      client,
      userId,
      reservation.showtime_id,
      [...new Set(items.map((item) => item.ticket_tier_id))],
    );

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
    await queueOrderConfirmation(client, order.id);
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
  kickNotificationWorker();
  return outcome.order;
}

/**
 * Splits what was actually paid across the tickets of one order, so each ticket knows what it is
 * worth back (UC-12 step 5, UC-16).
 *
 * The discount is shared out in proportion to face value, floored per ticket, with the leftover
 * đồng put on the first ticket. That keeps the order's invariant exact —
 * `SUM(refundable_amount) = subtotal - discount` — which is what stops a refund from returning more
 * than the buyer paid. Refunding face value on a voucher-discounted order mints money: four
 * 200,000₫ tickets bought for 620,000₫ after a 200,000₫ voucher would refund 800,000₫
 * (docs/Analysis_Design/SCHEMA_DATABASE.md).
 *
 * Integer đồng throughout [STD-03]; no floating point touches a ledger amount.
 */
export function allocateRefundable(faceValues: number[], discount: number): number[] {
  const subtotal = faceValues.reduce((sum, value) => sum + value, 0);
  if (discount <= 0 || subtotal <= 0) return [...faceValues];

  const shares = faceValues.map((value) => Math.floor((discount * value) / subtotal));
  // Flooring each share leaves a few đồng unallocated; they go on the first ticket so the sum lands
  // exactly on `subtotal - discount` rather than a đồng or two above it.
  shares[0] += discount - shares.reduce((sum, share) => sum + share, 0);

  return faceValues.map((value, i) => value - shares[i]);
}

/**
 * One row of the buyer's ticket list.
 *
 * Deliberately wider than `OrderView`. That shape answers "what did I just buy" to a screen that
 * already knows the event, because it is returned from the checkout the buyer just completed. A
 * list has no such context: it is the *only* thing the tickets page has, so it has to carry what
 * that page prints — the event's name and poster, where and when, and what the tickets are.
 *
 * It exists because the tickets page had no server source at all. Orders were written to
 * `localStorage` at checkout and read back from there, so a purchase made in one browser was
 * invisible in every other, and clearing site data destroyed the only record the buyer could see —
 * while the wallet, which reads the server, still showed the money leaving. The database always had
 * the order; there was simply no way to ask for the list.
 */
export interface OrderListItem extends OrderView {
  eventSlug: string;
  eventTitle: string;
  eventImageUrl: string | null;
  /** ISO instant of the showtime, so the client can split its own date and time. */
  startsAt: string;
  venueName: string;
  city: string;
}

/**
 * Every order this buyer has, newest first.
 *
 * Two queries rather than a join with the tickets: one order can hold eight tickets, and folding
 * them into the same result set would repeat every event title and poster URL eight times over the
 * wire. The second query fetches them all at once, keyed by order — not one round trip per order.
 */
export async function listOrders(userId: number, db: Db = pool): Promise<OrderListItem[]> {
  const { rows } = await db.query<{
    id: number;
    reservation_id: number;
    showtime_id: number;
    total_amount: number;
    payment_method: "wallet";
    status: "paid" | "refunded";
    created_at: Date;
    starts_at: Date;
    event_slug: string;
    event_title: string;
    event_image_url: string | null;
    venue_name: string;
    city: string;
  }>(
    `SELECT o.id, o.reservation_id, r.showtime_id, o.final_total_cents AS total_amount,
            o.payment_method, o.payment_status AS status, o.created_at,
            s.starts_at, e.slug AS event_slug, e.title AS event_title, e.image_url AS event_image_url,
            v.name AS venue_name, v.city
       FROM orders o
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC, o.id DESC`,
    [userId],
  );
  if (rows.length === 0) return [];

  const ticketRows = (
    await db.query<PurchasedTicket & { orderId: number }>(
      `SELECT t.order_id AS "orderId", t.id, t.barcode_value AS "ticketCode",
              CASE t.qr_status WHEN 'unused' THEN 'valid' WHEN 'checked_in' THEN 'used' ELSE 'refunded' END AS status,
              tt.label AS "tierLabel",
              CASE WHEN ri.showtime_seat_id IS NULL THEN NULL ELSE (se.row_label || se.seat_number::text) END AS "seatLabel",
              ri.unit_price_amount AS "unitPriceAmount"
         FROM tickets t
         JOIN reservation_items ri ON ri.id = t.reservation_item_id
         JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
         LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
         LEFT JOIN seats se ON se.id = ss.seat_id
        WHERE t.order_id = ANY($1::bigint[]) ORDER BY t.id`,
      [rows.map((r) => r.id)],
    )
  ).rows;

  const byOrder = new Map<number, PurchasedTicket[]>();
  for (const { orderId, ...ticket } of ticketRows) {
    const list = byOrder.get(orderId);
    if (list) list.push(ticket);
    else byOrder.set(orderId, [ticket]);
  }

  return rows.map((row) => ({
    id: row.id,
    reservationId: row.reservation_id,
    showtimeId: row.showtime_id,
    totalAmount: row.total_amount,
    paymentMethod: row.payment_method,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    tickets: byOrder.get(row.id) ?? [],
    eventSlug: row.event_slug,
    eventTitle: row.event_title,
    eventImageUrl: row.event_image_url,
    startsAt: row.starts_at.toISOString(),
    venueName: row.venue_name,
    city: row.city,
  }));
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
