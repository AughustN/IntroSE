// Seat holds & reservations (feature 003). Every call needs the signed-in identity — a hold has an
// owner and there are no anonymous holds (FR-001) — so all of them go out with the access token.
import type { HoldRequest, Reservation } from "@/shared/holds/types";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

/** A refusal the UI has to explain, carrying the server's stable machine code (SC-008). */
export class HoldError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  seat_taken: "Ghế vừa được người khác giữ. Vui lòng chọn ghế khác.",
  cap_exceeded: "Bạn đã giữ tối đa số vé cho suất này.",
  insufficient_stock: "Không đủ vé còn lại cho hạng vé này.",
  showtime_unavailable: "Suất diễn này không còn mở bán.",
  invalid_selection: "Lựa chọn không hợp lệ.",
  not_owner: "Đơn giữ chỗ này không phải của bạn.",
  rate_limited: "Bạn thao tác quá nhanh, vui lòng thử lại sau giây lát.",
  unauthenticated: "Vui lòng đăng nhập để giữ ghế.",
};

async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // Through `withAuthRetry`: the seat map is a screen a buyer sits on, so the in-memory access token
  // will expire under them. Refreshing once on a 401 is what stops that surfacing as a bogus
  // "please sign in" while they are, in fact, signed in.
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(apiUrl(`/api${path}`), {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  });

  if (!res.ok) {
    const err = await readApiError(res);
    throw new HoldError(
      err.code,
      err.message ?? MESSAGES[err.code] ?? "Không thể thực hiện thao tác.",
      res.status,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const holdsClient = {
  /** Hold seats (or a GA quantity): creates the caller's active reservation for the showtime or joins it. */
  hold(body: HoldRequest): Promise<Reservation> {
    return call<Reservation>("/reservations", { method: "POST", body });
  },

  /** Add to the live reservation. Never extends the window (FR-006). */
  add(reservationId: number, body: Omit<HoldRequest, "showtimeId">): Promise<Reservation> {
    return call<Reservation>(`/reservations/${reservationId}`, {
      method: "PATCH",
      body: { add: body },
    });
  },

  release(reservationId: number, seatIds: number[]): Promise<Reservation> {
    return call<Reservation>(`/reservations/${reservationId}`, {
      method: "PATCH",
      body: { removeSeatIds: seatIds },
    });
  },

  /**
   * General admission's release: give quantity back to a tier.
   *
   * Separate from `release` because a GA line has no seat to name — the reservation holds a count
   * against a tier, not rows. Like the seated path it leaves the window alone (FR-006), so a buyer
   * stepping a quantity up and down cannot keep renewing their claim on the stock.
   */
  releaseQuantity(
    reservationId: number,
    ticketTierId: number,
    quantity: number,
  ): Promise<Reservation> {
    return call<Reservation>(`/reservations/${reservationId}`, {
      method: "PATCH",
      body: { removeQuantity: { ticketTierId, quantity } },
    });
  },

  /** Release everything this reservation holds at once (FR-014). */
  cancel(reservationId: number): Promise<void> {
    return call<void>(`/reservations/${reservationId}`, { method: "DELETE" });
  },

  get(reservationId: number): Promise<Reservation> {
    return call<Reservation>(`/reservations/${reservationId}`);
  },

  /** The caller's live selection for a showtime — what a returning owner's map is restored from (FR-022). */
  active(showtimeId: number): Promise<Reservation | null> {
    return call<Reservation | null>(`/reservations/active?showtimeId=${showtimeId}`);
  },
};
