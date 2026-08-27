/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Reservation } from "@/shared/holds/types";
import { HoldSession, Seat } from "../types";

/**
 * `sessionStorage`, not `localStorage`: a hold belongs to the tab that placed it. Reloading mid-flow
 * keeps the selection and the same expiry; closing the tab drops the local copy, and the server-side
 * TTL sweeper frees the seats shortly after.
 *
 * This is a cache of the server's reservation, never the truth — the expiry it stores came from
 * `Reservation.expiresAt`, and the database is what actually holds the seats.
 */
const HOLD_SESSION_KEY = "tixhub_hold_session_v1";

export function loadHoldSession(): HoldSession | null {
  try {
    const raw = sessionStorage.getItem(HOLD_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as HoldSession;
    if (!parsed?.expiresAt || !Array.isArray(parsed.seats) || parsed.seats.length === 0)
      return null;
    // A hold that lapsed while the tab was away is already gone — never restore an expired one.
    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(HOLD_SESSION_KEY);
      return null;
    }

    return parsed;
  } catch (err) {
    console.error("Failed to read the stored hold session:", err);
    return null;
  }
}

export function saveHoldSession(session: HoldSession | null): void {
  try {
    if (session) sessionStorage.setItem(HOLD_SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(HOLD_SESSION_KEY);
  } catch (err) {
    console.error("Failed to save the hold session:", err);
  }
}

/** Milliseconds left on the hold, floored at 0. */
export function holdRemainingMs(session: HoldSession | null, now = Date.now()): number {
  if (!session) return 0;
  return Math.max(session.expiresAt - now, 0);
}

/** `mm:ss` for display. The clock is cosmetic; `expiresAt` decides. */
export function formatHoldClock(remainingMs: number): string {
  const totalSeconds = Math.max(Math.ceil(remainingMs / 1000), 0);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function holdTotalPrice(seats: Seat[]): number {
  return seats.reduce((sum, seat) => sum + seat.price, 0);
}

/**
 * A server reservation rendered as the flow's seat list. A seated item is one seat; a general-
 * admission item of quantity N becomes N lines, because the checkout and ticket screens are built
 * around one row per ticket.
 */
export function seatsFromReservation(reservation: Reservation): Seat[] {
  return reservation.items.flatMap((item) => {
    if (item.showtimeSeatId !== null) {
      const label = item.seatLabel ?? `#${item.showtimeSeatId}`;
      return [
        {
          id: label,
          row: label.replace(/\d+$/, ""),
          number: Number(label.replace(/^\D+/, "")) || 1,
          type: "single" as const,
          price: item.unitPriceAmount,
          isBooked: false,
          showtimeSeatId: item.showtimeSeatId,
          ticketTierId: item.ticketTierId,
        },
      ];
    }
    return Array.from({ length: item.quantity }, (_, index) => ({
      id: `${item.tierLabel} ${index + 1}`,
      row: item.tierLabel,
      number: index + 1,
      type: "single" as const,
      price: item.unitPriceAmount,
      isBooked: false,
      ticketTierId: item.ticketTierId,
    }));
  });
}

/** Fold a server reservation into the flow-scoped session the three screens read from. */
export function sessionFromReservation(
  reservation: Reservation,
  context: {
    eventId: string;
    eventTitle: string;
    selectedDate: string;
    selectedTime: string;
    mode: "seated" | "ga";
    quantities?: Record<string, number>;
  },
): HoldSession {
  return {
    reservationId: reservation.id,
    showtimeId: reservation.showtimeId,
    eventId: context.eventId,
    eventTitle: context.eventTitle,
    mode: context.mode,
    selectedDate: context.selectedDate,
    selectedTime: context.selectedTime,
    seats: seatsFromReservation(reservation),
    quantities:
      context.quantities ??
      Object.fromEntries(
        reservation.items
          .filter((i) => i.showtimeSeatId === null)
          .map((i) => [String(i.ticketTierId), i.quantity]),
      ),
    // The server's absolute instant — never a locally started countdown.
    expiresAt: new Date(reservation.expiresAt).getTime(),
  };
}
