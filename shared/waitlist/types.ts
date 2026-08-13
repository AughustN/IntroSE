// Waitlist for sold-out tickets (011, UC-17), declared once for both sides.
// Mirrors specs/011-waitlist/contracts/waitlist.openapi.yaml.

/**
 * Where a place in the queue stands.
 *
 * `waiting` and `notified` are the two **open** states, and everything that matters counts them
 * together: the limit of ten, the position, the notifier's ordering, and what leaving removes.
 * Being told is not the end of a place (UC-17 A5) — a waiter who loses the race keeps their turn
 * and is told again at the next release, so `notified` can go back to being notified for ever.
 *
 * `expired` (the occasion began) and `converted` (the holder bought what they waited for) are
 * terminal and invisible to all four.
 */
export type WaitlistStatus = 'waiting' | 'notified' | 'expired' | 'converted';

export interface WaitlistEntry {
  id: number;
  showtimeId: number;
  /** The tier queued for; `null` means any tier of this showtime. */
  ticketTierId: number | null;
  status: WaitlistStatus;
  /**
   * 1-based place among the open entries of this queue, in the order people joined.
   *
   * Derived on every read, never stored. A stored position would have to be rewritten each time
   * somebody left, expired or converted, and every one of those rewrites is a chance for two rows
   * to claim third place. Counting ten rows by `joinedAt` cannot drift.
   */
  position: number;
  joinedAt: string;
  /** The *most recent* time this place was told of availability, not a one-shot burn. */
  notifiedAt: string | null;
}

export interface WaitlistJoinInput {
  showtimeId: number;
  /**
   * Omit, or send `null`, to queue for the showtime as a whole.
   *
   * The two are judged differently: a tier join needs that tier exhausted, an any-tier join needs
   * every tier of the showtime exhausted (FR-002).
   */
  ticketTierId?: number | null;
}

export interface WaitlistJoinResult {
  entry: WaitlistEntry;
  /** True when the caller was already in this queue and nothing was created (UC-17 A1). */
  existing: boolean;
}

/** The refusals the interface acts on, rather than matching against a message. */
export type WaitlistErrorCode =
  /** Stock exists in the joined scope — buy instead of queueing (UC-17 A3). */
  | 'tickets_available'
  /** The queue already holds ten open places (UC-17 A2). */
  | 'waitlist_full'
  /** Unknown showtime, or one already begun or cancelled. */
  | 'showtime_not_found'
  /** Unknown entry, or one belonging to somebody else — deliberately indistinguishable. */
  | 'waitlist_entry_not_found';
