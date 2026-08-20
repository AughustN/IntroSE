// One typed contract for seat holds & reservations, shared by server and web (Principle VI).
// Derived from src/specs/003-seat-holds/contracts/reservations.openapi.yaml and
// contracts/seat-socket.md. Money = whole VND đồng.

import type { SeatStatus } from '../catalog/types.js';

export type ReservationStatus = 'active' | 'expired' | 'converted' | 'cancelled';

/**
 * A hold request. A reservation is seated OR general admission, never mixed — send `seatIds` for a
 * seated showtime, `ticketTierId` + `quantity` for general admission.
 */
export interface HoldRequest {
  showtimeId: number;
  seatIds?: number[];
  ticketTierId?: number;
  quantity?: number;
  timingTicket?: string;
  queueToken?: string;
  turnstileToken?: string;
}

export interface ReservationPatch {
  add?: Omit<HoldRequest, 'showtimeId'> & { showtimeId?: number };
  removeSeatIds?: number[];
  /** General admission: give quantity back to a tier. The seated equivalent is `removeSeatIds`. */
  removeQuantity?: { ticketTierId: number; quantity: number };
}

export interface ReservationItem {
  id: number;
  ticketTierId: number;
  tierLabel: string;
  /** Seated only — the held showtime_seat. Null for a general-admission quantity line. */
  showtimeSeatId: number | null;
  seatLabel: string | null; // e.g. "A12"
  quantity: number;
  unitPriceAmount: number; // VND integer, snapshot at hold time
}

export interface Reservation {
  id: number;
  showtimeId: number;
  status: ReservationStatus;
  /** ISO instant. Absolute and server-owned — the client countdown renders from it (never the reverse). */
  expiresAt: string;
  createdAt: string;
  /** True once the one-time top-up grace has been spent (FR-010). */
  extendedOnce: boolean;
  items: ReservationItem[];
  totalAmount: number; // VND integer
}

/** Refusals a hold can produce. Every one of them has an asserting test (SC-008). */
export type HoldErrorCode =
  | 'unauthenticated'
  | 'seat_taken'
  | 'cap_exceeded'
  | 'insufficient_stock'
  | 'showtime_unavailable'
  | 'invalid_selection'
  | 'not_owner'
  | 'not_found'
  | 'rate_limited';

// ---- Real-time channel (contracts/seat-socket.md) ----

/**
 * Broadcast after a committed hold, release or sweep expiry. Advisory only: a client that missed one
 * is still refused correctly by the row lock on its next attempt (FR-023).
 */
export interface SeatUpdate {
  showtimeId: number;
  /**
   * Seated: the seats whose status changed.
   *
   * `tier`/`price` are set ONLY when an organizer retiers a live seat (feature 005, FR-035). Both are
   * optional and no hold path ever sets them, so a client that ignores them behaves exactly as it did
   * before — which is why this does not breach FR-041. Geometry is never broadcast: it is static for
   * the life of a map and belongs to the once-per-page map read.
   */
  seats?: { showtimeSeatId: number; status: SeatStatus; tier?: string; price?: number }[];
  /** General admission: the tier whose remaining changed. */
  tier?: { ticketTierId: number; remaining: number | null };
}

export interface SeatRoomJoin {
  showtimeId: number;
}

export const SEAT_UPDATE_EVENT = 'seat:update';
export const SEAT_JOIN_EVENT = 'seat:join';
export const SEAT_LEAVE_EVENT = 'seat:leave';

export const showtimeRoom = (showtimeId: number): string => `showtime:${showtimeId}`;
