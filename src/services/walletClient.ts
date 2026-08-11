import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

export interface CheckoutOrder {
  id: number;
  reservationId: number;
  showtimeId: number;
  totalAmount: number;
  paymentMethod: "wallet";
  status: "paid" | "refunded";
  createdAt: string;
  tickets: Array<{
    id: number;
    ticketCode: string;
    status: "valid" | "used" | "refunded";
    tierLabel: string;
    seatLabel: string | null;
    unitPriceAmount: number;
  }>;
}

/**
 * One row of the buyer's ticket list, straight from the server.
 *
 * Wider than `CheckoutOrder` because the tickets page has no other context: checkout already knows
 * which event it just sold, a list does not.
 */
export interface OrderListItem extends CheckoutOrder {
  eventSlug: string;
  eventTitle: string;
  eventImageUrl: string | null;
  startsAt: string;
  venueName: string;
  city: string;
}

export interface WalletLimits {
  min: number;
  max: number;
  balanceCap: number;
}

export interface WalletSummary {
  balanceAmount: number;
  limits: WalletLimits;
}

export interface WalletEntry {
  id: number;
  kind: "topup" | "purchase" | "refund";
  /** Signed: credits positive, purchases negative. */
  amount: number;
  balanceAfter: number;
  createdAt: string;
  orderId: number | null;
  eventTitle: string | null;
}

export interface WalletStatement {
  balanceAmount: number;
  entries: WalletEntry[];
  /** Top-ups that left for VNPay and have not come back — pending, never lost. */
  pending: Array<{ id: number; amount: number; createdAt: string }>;
  hasMore: boolean;
}

export interface Topup {
  id: number;
  orderRef: string;
  amount: number;
  status: "pending" | "paid" | "failed";
  paymentUrl?: string;
  createdAt: string;
  paidAt: string | null;
  reservationId: number | null;
}

export class WalletError extends Error {
  constructor(
    public code: string,
    message: string,
    /**
     * Numbers the server sent so the UI can act, not just report: the shortfall on
     * `insufficient_wallet_balance`, the maximum still addable on `wallet_cap_exceeded`.
     */
    public details?: Record<string, number | string>,
  ) {
    super(message);
  }
}

async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(apiUrl(`/api${path}`), {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  });
  if (!res.ok) {
    const err = await readApiError(res);
    throw new WalletError(
      err.code === "error" ? "wallet_request_failed" : err.code,
      err.message ?? "Không thực hiện được thao tác ví.",
      err.details,
    );
  }
  return (await res.json().catch(() => ({}))) as T;
}

export const walletClient = {
  /** Balance plus the server's limits, so the top-up form never hard-codes a copy of them. */
  summary: (): Promise<WalletSummary> => call("/wallet"),

  /** The statement (UC-41). `before` pages backwards through older entries. */
  statement: (opts: { limit?: number; before?: number } = {}): Promise<WalletStatement> => {
    const query = new URLSearchParams();
    if (opts.limit) query.set("limit", String(opts.limit));
    if (opts.before) query.set("before", String(opts.before));
    const qs = query.toString();
    return call(`/wallet/transactions${qs ? `?${qs}` : ""}`);
  },

  /**
   * Starts a top-up and returns it with the VNPay URL to send the buyer to.
   *
   * `reservationId` is passed when the top-up was started from a short balance at checkout: the
   * server stores it, grants the hold its one-time grace so the seats survive the VNPay detour, and
   * hands it back so the client knows which checkout to return to.
   */
  createTopup: (amount: number, reservationId?: number): Promise<Topup> =>
    call("/wallet/topups", { method: "POST", body: { amount, reservationId } }),

  /**
   * The status of one top-up. The browser return URL never changes state, so after coming back from
   * VNPay the client polls this instead of trusting what the redirect said.
   */
  getTopup: (id: number): Promise<Topup> => call(`/wallet/topups/${id}`),

  /** Every order this account owns, newest first. The tickets page's real source. */
  orders: (): Promise<OrderListItem[]> => call("/orders"),

  checkout: (reservationId: number): Promise<CheckoutOrder> =>
    call("/checkout", { method: "POST", body: { reservationId } }),
  resendTicket: (orderId: number): Promise<{ ok: true }> =>
    call(`/orders/${orderId}/resend`, { method: "POST" }),
};
