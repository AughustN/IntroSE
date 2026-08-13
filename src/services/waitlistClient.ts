import type {
  WaitlistEntry,
  WaitlistErrorCode,
  WaitlistJoinInput,
  WaitlistJoinResult,
} from "@/shared/waitlist/types";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

// Types are imported, never re-declared: the server builds these responses from the same file, so a
// shape change that breaks this client fails at compile time rather than in the browser.
export type { WaitlistEntry, WaitlistErrorCode, WaitlistJoinInput, WaitlistJoinResult };

/**
 * A refusal the interface has to act on differently, not merely print.
 *
 * `tickets_available` sends the reader to the purchase control; `waitlist_full` explains the limit
 * and offers nothing. Switching on a message string would break the moment the copy is edited.
 */
export class WaitlistError extends Error {
  constructor(
    message: string,
    public code: WaitlistErrorCode | string,
  ) {
    super(message);
    this.name = "WaitlistError";
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await withAuthRetry((token) =>
    fetch(apiUrl(`/api${path}`), {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  if (!response.ok) {
    const error = await readApiError(response);
    throw new WaitlistError(
      error.message ?? error.code ?? "Không thể thực hiện thao tác.",
      error.code ?? "unknown",
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const waitlistClient = {
  /**
   * Take a place in a queue. Signed in only.
   *
   * Omit `ticketTierId` to wait for any tier of the showtime — which the server allows only when
   * every tier is exhausted. Joining twice is not an error: the existing place comes back with
   * `existing: true`, so the caller can simply show the position either way.
   */
  join: (input: WaitlistJoinInput) =>
    call<WaitlistJoinResult>("/waitlists", { method: "POST", body: input }),

  /** The caller's own open places, optionally narrowed to one showtime. */
  listMine: (showtimeId?: number) =>
    call<WaitlistEntry[]>(`/waitlists${showtimeId ? `?showtimeId=${showtimeId}` : ""}`),

  /** Give up a place. The queue behind it closes up on its own. */
  leave: (entryId: number) => call<void>(`/waitlists/${entryId}`, { method: "DELETE" }),
};
