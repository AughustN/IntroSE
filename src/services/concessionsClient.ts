// Concession add-ons (feature 014) — the browser half of the contract in shared/types/fnb.ts.
// The menu read is public; the cart write rides the signed-in identity because a cart line belongs
// to a reservation, and a reservation always has an owner (FR-001).
import type { PublicConcession } from "@/shared/types/fnb";
import type { Reservation } from "@/shared/holds/types";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

export class ConcessionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await withAuthRetry(async (token) => {
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
    throw new ConcessionError(
      err.code === "error" ? "concession_request_failed" : err.code,
      err.message ?? "Không thực hiện được thao tác bắp nước.",
      res.status,
    );
  }
  return (await res.json().catch(() => ({}))) as T;
}

export const concessionsClient = {
  /** The public menu of one event — empty when the event is invisible or sells nothing. */
  menu: (eventId: number): Promise<{ items: PublicConcession[] }> =>
    call(`/catalog/events/${eventId}/concessions`),

  /** Replace the caller's snack cart wholesale; answers the updated reservation. */
  putCart: (
    reservationId: number,
    items: { concessionItemId: number; quantity: number }[],
  ): Promise<Reservation> =>
    call(`/reservations/${reservationId}/concessions`, { method: "PUT", body: { items } }),
};
