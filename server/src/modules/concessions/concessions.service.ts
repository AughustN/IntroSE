import { createHash } from "node:crypto";
import { err } from "../../http.js";
import { pool } from "../../db/pool.js";
import { eventOwnerUserId } from "../catalog/catalog.write.js";
import type { ConcessionItem } from "@shared/types/fnb.js";
import {
  deleteItem,
  getItem,
  insertItem,
  itemReferenced,
  linesForOrder,
  listByEventOwned,
  setItemState,
  updateItemFields,
} from "./concessions.repo.js";

/**
 * The organizer side of the menu (feature 014 US2). Ownership is recomputed from
 * `events.organizer_id → organizers.user_id` on every call — the client's word is never taken
 * for who owns an event — and every mutation keeps the two history invariants: edits reach only
 * future purchases, and a referenced item can be stopped but never deleted.
 */

export interface Actor {
  userId: number;
  isAdmin: boolean;
}

/** The event must exist and belong to the caller (admins pass) — the one gate every route shares. */
async function assertEventOwnedBy(actor: Actor, eventId: number): Promise<void> {
  const owner = await eventOwnerUserId(eventId);
  if (owner === null) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  if (owner !== actor.userId && !actor.isAdmin)
    throw err.forbidden("not_owner", "Bạn không sở hữu tài nguyên này.");
}

function assertValidPrice(priceAmount: number): void {
  if (!Number.isInteger(priceAmount) || priceAmount < 0)
    throw err.unprocessable("invalid_price", "Giá phải là số nguyên đồng không âm.");
}

/** The item must exist AND sit under the event in the path — no cross-event reach-through. */
async function ownedItemOr404(eventId: number, concessionId: number): Promise<ConcessionItem> {
  const item = await getItem(pool, concessionId);
  if (!item || item.eventId !== eventId)
    throw err.notFound(
      "concession_unavailable",
      "Không tìm thấy món trong menu của sự kiện này.",
    );
  return item;
}

export async function createItem(
  actor: Actor,
  eventId: number,
  input: { label: string; description: string | null; priceAmount: number },
): Promise<ConcessionItem> {
  await assertEventOwnedBy(actor, eventId);
  assertValidPrice(input.priceAmount);
  return insertItem(pool, eventId, input.label, input.description, input.priceAmount);
}

export async function getOwnedMenu(actor: Actor, eventId: number): Promise<ConcessionItem[]> {
  await assertEventOwnedBy(actor, eventId);
  return listByEventOwned(pool, eventId);
}

export async function updateItem(
  actor: Actor,
  eventId: number,
  concessionId: number,
  patch: { label?: string; description?: string | null; priceAmount?: number },
): Promise<ConcessionItem> {
  await assertEventOwnedBy(actor, eventId);
  const item = await ownedItemOr404(eventId, concessionId);
  const label = patch.label ?? item.label;
  const description = patch.description !== undefined ? patch.description : item.description;
  const priceAmount = patch.priceAmount ?? item.priceAmount;
  assertValidPrice(priceAmount);
  await updateItemFields(pool, concessionId, { label, description, priceAmount });
  return { ...item, label, description, priceAmount };
}

export async function changeItemState(
  actor: Actor,
  eventId: number,
  concessionId: number,
  state: "listed" | "stopped",
): Promise<ConcessionItem> {
  await assertEventOwnedBy(actor, eventId);
  const item = await ownedItemOr404(eventId, concessionId);
  await setItemState(pool, concessionId, state);
  return { ...item, state };
}

export async function removeItem(
  actor: Actor,
  eventId: number,
  concessionId: number,
): Promise<void> {
  await assertEventOwnedBy(actor, eventId);
  await ownedItemOr404(eventId, concessionId);
  if (await itemReferenced(pool, concessionId))
    throw err.conflict(
      "concession_in_use",
      "Món này đã nằm trong giỏ hoặc đơn hàng, không thể xoá. Hãy dùng “Ngừng bán” để ẩn nó khỏi trang mua vé.",
    );
  const deleted = await deleteItem(pool, concessionId);
  if (!deleted) throw err.notFound("concession_unavailable", "Không tìm thấy món.");
}

// ---- Voucher redemption (US3) ----------------------------------------------

export interface RedeemedVoucher {
  already: boolean;
  orderId: number;
  eventTitle: string;
  buyerName: string;
  lines: { label: string; quantity: number; unitPriceAmount: number }[];
}

const sha256 = (code: string): string => createHash("sha256").update(code).digest("hex");

/**
 * Hand over a whole snack order on one scan.
 *
 * The scanner's rules, in the order they are asked: the code must exist AND belong to an event
 * the caller owns — and both failures answer with the SAME body so a probe cannot distinguish
 * "no such voucher" from "not yours"; a voided one is closed for good; a rescan is a read that
 * mutates nothing; and only then does a guarded flip `unredeemed → redeemed` run, whose WHERE
 * clause makes two concurrent scanners settle with exactly one winner.
 */
export async function redeemVoucher(rawCode: string, actor: Actor): Promise<RedeemedVoucher> {
  const { rows } = await pool.query<{
    voucher_id: number;
    status: "unredeemed" | "redeemed" | "void";
    order_id: number;
    eventTitle: string;
    buyerName: string;
    organizer_user_id: number;
  }>(
    `SELECT cv.id AS voucher_id, cv.status, cv.order_id,
            e.title AS "eventTitle", o.customer_name AS "buyerName",
            org.user_id AS organizer_user_id
       FROM concession_vouchers cv
       JOIN orders o ON o.id = cv.order_id
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN organizers org ON org.id = e.organizer_id
      WHERE cv.code_hash = $1`,
    [sha256(rawCode.trim())],
  );
  const row = rows[0];
  if (!row || (!actor.isAdmin && row.organizer_user_id !== actor.userId))
    throw err.notFound(
      "concession_voucher_not_found",
      "Mã không hợp lệ hoặc không thuộc sự kiện của bạn.",
    );
  if (row.status === "void")
    throw err.conflict("voucher_void", "Đơn này đã được hoàn tiền, không thể nhận món.");
  let already = row.status === "redeemed";

  if (!already) {
    const flip = await pool.query(
      `UPDATE concession_vouchers
          SET status = 'redeemed', redeemed_at = now(), redeemed_by = $2
        WHERE id = $1 AND status = 'unredeemed'`,
      [row.voucher_id, actor.userId],
    );
    // Lost the race — the other counter flipped it first; answer as a benign rescan.
    if ((flip.rowCount ?? 0) === 0) already = true;
  }

  return {
    already,
    orderId: row.order_id,
    eventTitle: row.eventTitle,
    buyerName: row.buyerName,
    // The counter's handover list is the snapshot lines and nothing else.
    lines: (await linesForOrder(pool, row.order_id)).map((line) => ({
      label: line.label,
      quantity: line.quantity,
      unitPriceAmount: line.unitPriceAmount,
    })),
  };
}
