import type { ConcessionItem, PublicConcession, ReservationConcessionLine } from "@shared/types/fnb.js";
import type pg from "pg";
import type { Db } from "../../db/pool.js";
import { VISIBLE_JOIN, VISIBLE_WHERE } from "../catalog/visibility.js";

/**
 * All concession SQL in one place (feature 014). Money is whole VND đồng end to end (STD-03);
 * nothing here ever computes with a float.
 *
 * Two invariants shape these queries:
 *
 *  - **Paid lines are snapshots.** `order_concessions` carries its own label and price; nothing
 *    that renders history may join back to `concession_items`, because stopping sales or editing
 *    a price must never rewrite what was already bought (FR-010/FR-014).
 *  - **The cart reprices live.** Reservation lines store an add-time price for reference, but
 *    reads surface the item's CURRENT listed price and checkout charges that same live number —
 *    the screen a buyer confirms on is the screen they pay for (research D2).
 */

// ---- Menu ------------------------------------------------------------------

/** Listed items of one PUBLICLY visible event — empty, never an error, when anything fails the gate. */
export async function listPublicByEvent(db: Db, eventId: number): Promise<PublicConcession[]> {
  const { rows } = await db.query<{
    id: number;
    label: string;
    description: string | null;
    price_amount: number;
  }>(
    `SELECT ci.id, ci.label, ci.description, ci.price_amount
       FROM concession_items ci
       JOIN events e ON e.id = ci.event_id
       ${VISIBLE_JOIN}
      WHERE ci.event_id = $1 AND ci.state = 'listed'
        AND ${VISIBLE_WHERE}
      ORDER BY ci.id`,
    [eventId],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    priceAmount: r.price_amount,
  }));
}

/** The owning organizer's menu regardless of moderation state — they manage what they own. */
export async function listByEventOwned(db: Db, eventId: number): Promise<ConcessionItem[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT id, event_id, label, description, price_amount, state FROM concession_items
      WHERE event_id = $1 ORDER BY id`,
    [eventId],
  );
  return rows.map(toItem);
}

export async function getItem(db: Db, itemId: number): Promise<ConcessionItem | null> {
  const { rows } = await db.query<ItemRow>(
    `SELECT id, event_id, label, description, price_amount, state FROM concession_items WHERE id = $1`,
    [itemId],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

interface ItemRow {
  id: number;
  event_id: number;
  label: string;
  description: string | null;
  price_amount: number;
  state: "listed" | "stopped";
}

const toItem = (row: ItemRow): ConcessionItem => ({
  id: row.id,
  eventId: row.event_id,
  label: row.label,
  description: row.description,
  priceAmount: row.price_amount,
  state: row.state,
});

export async function insertItem(
  db: Db,
  eventId: number,
  label: string,
  description: string | null,
  priceAmount: number,
): Promise<ConcessionItem> {
  const { rows } = await db.query<ItemRow>(
    `INSERT INTO concession_items (event_id, label, description, price_amount)
     VALUES ($1, $2, $3, $4)
     RETURNING id, event_id, label, description, price_amount, state`,
    [eventId, label, description, priceAmount],
  );
  return toItem(rows[0]);
}

/**
 * Overwrite the editable fields wholesale. The service merges the caller's PATCH with the stored
 * item first, so this stays a plain three-column write — no conditional-SQL gymnastics here.
 */
export async function updateItemFields(
  db: Db,
  itemId: number,
  fields: { label: string; description: string | null; priceAmount: number },
): Promise<void> {
  await db.query(
    `UPDATE concession_items SET label = $2, description = $3, price_amount = $4, updated_at = now()
      WHERE id = $1`,
    [itemId, fields.label, fields.description, fields.priceAmount],
  );
}

export async function setItemState(db: Db, itemId: number, state: "listed" | "stopped"): Promise<void> {
  await db.query(
    `UPDATE concession_items SET state = $2, updated_at = now() WHERE id = $1`,
    [itemId, state],
  );
}

export async function deleteItem(db: Db, itemId: number): Promise<boolean> {
  const res = await db.query(`DELETE FROM concession_items WHERE id = $1`, [itemId]);
  return (res.rowCount ?? 0) > 0;
}

/** Whether anything was ever selected or sold against this item — DELETE is refused when true. */
export async function itemReferenced(db: Db, itemId: number): Promise<boolean> {
  const { rows } = await db.query<{ referenced: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM reservation_concessions WHERE concession_item_id = $1)
          OR EXISTS (SELECT 1 FROM order_concessions WHERE concession_item_id = $1)) AS referenced`,
    [itemId],
  );
  return rows[0]?.referenced ?? false;
}

// ---- Reservation cart lines ------------------------------------------------

/**
 * The cart as the API shows it: listed items only, at their CURRENT price. A line whose item was
 * stopped vanishes from the view immediately (FR-010) — and checkout still refuses it until the
 * client sends a clean set, so nothing is ever charged that the buyer could not see.
 */
export async function listedCartLines(
  db: Db,
  reservationId: number,
): Promise<ReservationConcessionLine[]> {
  const { rows } = await db.query<ReservationConcessionLine>(
    `SELECT rc.concession_item_id AS "concessionItemId", ci.label, rc.quantity,
            ci.price_amount AS "unitPriceAmount"
       FROM reservation_concessions rc
       JOIN concession_items ci ON ci.id = rc.concession_item_id AND ci.state = 'listed'
      WHERE rc.reservation_id = $1
      ORDER BY rc.id`,
    [reservationId],
  );
  return rows;
}

export interface StoredCartLine {
  concessionItemId: number;
  /** Live values straight off the item row — the truth checkout will charge. */
  label: string;
  state: "listed" | "stopped";
  priceAmount: number;
  quantity: number;
}

/**
 * The cart's raw lines with the item's CURRENT state and price, rows locked — checkout's view.
 * Locking both sides means a price edit or stop-selling cannot commit between this read and the
 * money moving for these lines.
 */
export async function cartLinesForCheckout(
  client: pg.PoolClient,
  reservationId: number,
): Promise<StoredCartLine[]> {
  const { rows } = await client.query<StoredCartLine>(
    `SELECT rc.concession_item_id AS "concessionItemId", ci.label, ci.state,
            ci.price_amount AS "priceAmount", rc.quantity
       FROM reservation_concessions rc
       JOIN concession_items ci ON ci.id = rc.concession_item_id
      WHERE rc.reservation_id = $1
      ORDER BY rc.id
      FOR UPDATE OF rc, ci`,
    [reservationId],
  );
  return rows;
}

/** Replace the caller's cart wholesale. Caller owns the reservation check and transaction. */
export async function replaceCartLines(
  client: pg.PoolClient,
  reservationId: number,
  lines: { concessionItemId: number; quantity: number; unitPriceAmount: number }[],
): Promise<void> {
  await client.query(`DELETE FROM reservation_concessions WHERE reservation_id = $1`, [
    reservationId,
  ]);
  for (const line of lines) {
    await client.query(
      `INSERT INTO reservation_concessions
         (reservation_id, concession_item_id, quantity, unit_price_amount)
       VALUES ($1, $2, $3, $4)`,
      [reservationId, line.concessionItemId, line.quantity, line.unitPriceAmount],
    );
  }
}

// ---- Paid order lines ------------------------------------------------------

export interface OrderLineRow {
  id: number;
  concessionItemId: number;
  label: string;
  quantity: number;
  unitPriceAmount: number;
}

/** Snapshot lines of ONE order — the only thing any order view may read. */
export async function linesForOrder(db: Db, orderId: number): Promise<OrderLineRow[]> {
  const { rows } = await db.query<OrderLineRow>(
    `SELECT id, concession_item_id AS "concessionItemId", item_label AS label,
            quantity, unit_price_amount AS "unitPriceAmount"
       FROM order_concessions WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return rows;
}

/** Snapshot lines of MANY orders in one round trip, grouped by order (the list page's shape). */
export async function linesForOrders(
  db: Db,
  orderIds: number[],
): Promise<Map<number, OrderLineRow[]>> {
  const grouped = new Map<number, OrderLineRow[]>();
  if (orderIds.length === 0) return grouped;
  const { rows } = await db.query<OrderLineRow & { orderId: number }>(
    `SELECT order_id AS "orderId", id, concession_item_id AS "concessionItemId",
            item_label AS label, quantity, unit_price_amount AS "unitPriceAmount"
       FROM order_concessions WHERE order_id = ANY($1::bigint[]) ORDER BY id`,
    [orderIds],
  );
  for (const { orderId, ...line } of rows) {
    const list = grouped.get(orderId);
    if (list) list.push(line);
    else grouped.set(orderId, [line]);
  }
  return grouped;
}

// ---- Vouchers --------------------------------------------------------------

export interface MintedVoucher {
  code: string;
  status: "unredeemed" | "redeemed" | "void";
  redeemedAt: Date | null;
}

/** Mint the order's single voucher — UNIQUE(order_id) is what makes "exactly once" true. */
export async function mintVoucher(
  client: pg.PoolClient,
  orderId: number,
  code: string,
  codeHash: string,
): Promise<MintedVoucher> {
  const { rows } = await client.query<MintedVoucher>(
    `INSERT INTO concession_vouchers (order_id, code, code_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING code, status, redeemed_at AS "redeemedAt"`,
    [orderId, code, codeHash],
  );
  // Idempotent re-checkout of the same order must answer with the voucher that already exists.
  if (!rows[0]) return (await voucherForOrder(client, orderId))!;
  return rows[0];
}

export async function voucherForOrder(db: Db, orderId: number): Promise<MintedVoucher | null> {
  const { rows } = await db.query<MintedVoucher>(
    `SELECT code, status, redeemed_at AS "redeemedAt" FROM concession_vouchers WHERE order_id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

/** Vouchers of MANY orders in one round trip, keyed by order (the list page's shape). */
export async function vouchersForOrders(
  db: Db,
  orderIds: number[],
): Promise<Map<number, MintedVoucher>> {
  const map = new Map<number, MintedVoucher>();
  if (orderIds.length === 0) return map;
  const { rows } = await db.query<MintedVoucher & { orderId: number }>(
    `SELECT order_id AS "orderId", code, status, redeemed_at AS "redeemedAt"
       FROM concession_vouchers WHERE order_id = ANY($1::bigint[])`,
    [orderIds],
  );
  for (const { orderId, ...voucher } of rows) map.set(orderId, voucher);
  return map;
}
