// Waitlist for sold-out tickets (011, UC-17), declared once for both sides.
// Mirrors specs/011-waitlist/contracts/waitlist.openapi.yaml.

/**
 * Where a place in the queue stands.
 *
 * `waiting` and `notified` are the two **open** states, and everything that matters counts them
 * together: the limit of ten, the notifier's reach, and what leaving removes.
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
  /*
   * No position is carried, deliberately.
   *
   * A number would promise an order of service the feature does not keep: waiting earlier buys no
   * claim on a released ticket, everyone told of it races for it equally, and the only thing being
   * in the queue earns is the message. Showing "vị trí 3" would read as a turn that will come.
   */
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
  /**
   * Too near the start for a queue to mean anything (UC-17 A6).
   *
   * Inside the 24-hour cancel cutoff no ticket can come back from a cancellation, so the queues of
   * that showtime are closed to new places and the open ones are being shut down.
   */
  | 'waitlist_closed'
  /** Unknown showtime, or one already begun or cancelled. */
  | 'showtime_not_found'
  /** Unknown entry, or one belonging to somebody else — deliberately indistinguishable. */
  | 'waitlist_entry_not_found';
