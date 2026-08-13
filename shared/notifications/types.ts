// The notification outbox as the reader sees it (011, UC-19), declared once for both sides.
// Mirrors specs/011-waitlist/contracts/waitlist.openapi.yaml.

/**
 * Every kind of message the product sends.
 *
 * The server imports this rather than declaring its own copy: the enqueue side and the page that
 * renders the result have to agree about what kinds exist, and a union written twice is a union
 * that eventually differs.
 */
export type NotificationType =
  | 'order_confirmed'
  | 'ticket_resend'
  | 'reminder_7d'
  | 'reminder_1d'
  | 'event_changed'
  | 'event_cancelled'
  | 'waitlist_open'
  | 'announcement';

export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  /** Type-specific context. For `waitlist_open`: `eventTitle` and `showtimeId`. */
  payload: Record<string, unknown>;
  /**
   * Where this message leads, resolved on the server from the notification's own event reference.
   *
   * Not read from `payload`: the destination of a link is not something the renderer should take
   * from a free-form blob, and a message whose event has since been deleted must degrade to "no
   * link" rather than to a broken one.
   */
  eventSlug: string | null;
  /** `null` while unread. The unread count is how many of these are null. */
  readAt: string | null;
  createdAt: string;
}
