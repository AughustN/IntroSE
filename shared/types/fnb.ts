// One typed contract for concession add-ons ("bắp nước", feature 014), shared by server and web
// (Principle VI). Derived from specs/014-fnb-add-ons/contracts/fnb-api.md.
// Money = whole VND đồng integers, never floating point (STD-03).

/** A menu item the organizer curates per event: `listed` is buyable, `stopped` is hidden from buyers. */
export type ConcessionState = "listed" | "stopped";

/** The organizer-facing menu row (CRUD responses). */
export interface ConcessionItem {
  id: number;
  eventId: number;
  label: string;
  description: string | null;
  priceAmount: number; // whole đồng
  state: ConcessionState;
}

/** The buyer-facing menu row served at checkout — listed items only. */
export interface PublicConcession {
  id: number;
  label: string;
  description: string | null;
  priceAmount: number; // whole đồng
}

/** One item × quantity inside a live reservation's cart. */
export interface ReservationConcessionLine {
  concessionItemId: number;
  /** Snapshot of the label at add time, so the cart can render without a menu refetch. */
  label: string;
  quantity: number; // 1..10
  /** Live price — the cart reprices at checkout (research D2), unlike paid lines. */
  unitPriceAmount: number;
}

/** One immutable line of a PAID order: label + unit price captured at payment time (FR-010/014). */
export interface OrderConcessionLine {
  id: number;
  concessionItemId: number;
  label: string; // snapshot
  quantity: number; // 1..10
  unitPriceAmount: number; // snapshot
}

/**
 * The single scannable proof on an order that carries concessions. Lifecycle:
 * unredeemed → redeemed (one guarded scan wins) or → void (event cancellation refund).
 */
export interface ConcessionVoucher {
  code: string; // the QR payload — owner-visible only
  status: "unredeemed" | "redeemed" | "void";
  redeemedAt: string | null;
}

/** Refusals the concession endpoints produce. Every one has an asserting test (quickstart). */
export type ConcessionErrorCode =
  | "concession_quantity_limit"
  | "concession_unavailable"
  | "concession_in_use"
  | "concession_voucher_not_found"
  | "voucher_void";
