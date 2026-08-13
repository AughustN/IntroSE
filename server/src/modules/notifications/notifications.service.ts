import QRCode from "qrcode";
import { Resend } from "resend";
// Declared in `shared/` so the page that renders a notification and the code that enqueues one
// cannot disagree about what kinds exist (constitution VI).
import type { NotificationType } from "@shared/notifications/types.js";
import { config } from "../../config.js";
import { pool, type Db, withTransaction } from "../../db/pool.js";
// The catalog's definition of "this showtime still has something to sell". Imported rather than
// restated so the page that says "Hết vé" and the gate that opens the queue cannot disagree.
import { SHOWTIME_HAS_AVAILABILITY } from "../catalog/visibility.js";

type TicketMailPayload = {
  eventTitle: string;
  startsAt: string;
  venue: string;
  customerName: string;
  totalAmount: number;
  ticketUrl: string;
  refundPolicy: string | null;
  tickets: Array<{ code: string; tier: string; seat: string | null }>;
};

interface EnqueueInput {
  userId: number;
  orderId?: number | null;
  eventId?: number | null;
  type: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;
const MAX_BATCH = 25;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

function formatVietnamTime(value: string): string {
  // The catalog/UI treats showtime fields as Vietnam wall time (`startsAt.slice(0, 16)`). Keep
  // notification mail aligned with that display instead of interpreting the serialized suffix as
  // UTC and adding seven hours a second time.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function retryDelayMs(attempt: number): number {
  // Keep retrying delivery; after five failures, retry daily rather than dropping a paid ticket mail.
  return [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000][
    Math.min(attempt - 1, 4)
  ];
}

export async function enqueue(db: Db, input: EnqueueInput): Promise<void> {
  const payload = JSON.stringify(input.payload ?? {});
  await db.query(
    `INSERT INTO notifications (user_id, order_id, event_id, type, channel, dedupe_key, title, body, payload, sent_at)
     VALUES ($1, $2, $3, $4, 'in_app', $5 || ':in_app', $6, $7, $8::jsonb, now())
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      input.userId,
      input.orderId ?? null,
      input.eventId ?? null,
      input.type,
      input.dedupeKey,
      input.title,
      input.body,
      payload,
    ],
  );
  await db.query(
    `INSERT INTO notifications (user_id, order_id, event_id, type, channel, dedupe_key, title, body, payload)
     VALUES ($1, $2, $3, $4, 'email', $5 || ':email', $6, $7, $8::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      input.userId,
      input.orderId ?? null,
      input.eventId ?? null,
      input.type,
      input.dedupeKey,
      input.title,
      input.body,
      payload,
    ],
  );
}

async function orderPayload(
  db: Db,
  orderId: number,
): Promise<{ userId: number; email: string; eventId: number; payload: TicketMailPayload } | null> {
  const head = await db.query<{
    user_id: number;
    customer_email: string;
    customer_name: string;
    final_total_cents: number;
    event_id: number;
    title: string;
    starts_at: Date;
    venue_name: string;
    city: string;
    raw_address: string;
    refund_policy: string | null;
  }>(
    `SELECT o.user_id, o.customer_email, o.customer_name, o.final_total_cents, e.id AS event_id, e.title, s.starts_at,
            v.name AS venue_name, v.city, v.raw_address, e.refund_policy
       FROM orders o
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
      WHERE o.id = $1 AND o.payment_status IN ('paid', 'partially_refunded')`,
    [orderId],
  );
  const row = head.rows[0];
  if (!row) return null;
  const tickets = await db.query<{ code: string; tier: string; seat: string | null }>(
    `SELECT t.barcode_value AS code, tt.label AS tier,
            CASE WHEN ss.id IS NULL THEN NULL ELSE se.row_label || se.seat_number::text END AS seat
       FROM tickets t
       JOIN reservation_items ri ON ri.id = t.reservation_item_id
       JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
       LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
       LEFT JOIN seats se ON se.id = ss.seat_id
      WHERE t.order_id = $1 AND t.qr_status <> 'void'
      ORDER BY t.id`,
    [orderId],
  );
  return {
    userId: row.user_id,
    email: row.customer_email,
    eventId: row.event_id,
    payload: {
      eventTitle: row.title,
      startsAt: row.starts_at.toISOString(),
      venue: `${row.venue_name}, ${row.raw_address}, ${row.city}`,
      customerName: row.customer_name,
      totalAmount: row.final_total_cents,
      ticketUrl: `${config.appUrl.replace(/\/$/, "")}/tickets/${orderId}`,
      refundPolicy: row.refund_policy,
      tickets: tickets.rows,
    },
  };
}

export async function queueOrderConfirmation(db: Db, orderId: number): Promise<void> {
  const data = await orderPayload(db, orderId);
  if (!data || data.payload.tickets.length === 0) return;
  await enqueue(db, {
    userId: data.userId,
    orderId,
    eventId: data.eventId,
    type: "order_confirmed",
    dedupeKey: `order_confirmed:${orderId}`,
    title: `Xác nhận vé: ${data.payload.eventTitle}`,
    body: "Vé QR của bạn đã sẵn sàng trong TixHub.",
    payload: data.payload as unknown as Record<string, unknown>,
  });
}

export async function queueTicketResend(userId: number, orderId: number): Promise<boolean> {
  const queued = await withTransaction(async (db) => {
    const owner = await db.query(
      `SELECT id FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [orderId, userId],
    );
    if (!owner.rowCount) return false;
    const recent = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications
        WHERE user_id = $1 AND order_id = $2 AND type = 'ticket_resend' AND channel = 'email'
          AND created_at > now() - interval '1 hour'`,
      [userId, orderId],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 3) return false;
    const data = await orderPayload(db, orderId);
    if (!data || data.payload.tickets.length === 0) return false;
    await enqueue(db, {
      userId,
      orderId,
      eventId: data.eventId,
      type: "ticket_resend",
      dedupeKey: `ticket_resend:${orderId}:${Date.now()}`,
      title: `Gửi lại vé: ${data.payload.eventTitle}`,
      body: "Theo yêu cầu của bạn, đây là vé QR của đơn hàng.",
      payload: data.payload as unknown as Record<string, unknown>,
    });
    return true;
  });
  if (queued) kickNotificationWorker();
  return queued;
}

export async function queueEventNotification(
  db: Db,
  eventId: number,
  type: Extract<NotificationType, "event_changed" | "event_cancelled">,
  body: string,
  revision: string,
): Promise<void> {
  const recipients = await db.query<{ user_id: number; title: string }>(
    `SELECT DISTINCT o.user_id, e.title
       FROM orders o
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN tickets t ON t.order_id = o.id
      WHERE e.id = $1 AND o.payment_status IN ('paid', 'partially_refunded', 'refunded')`,
    [eventId],
  );
  for (const recipient of recipients.rows) {
    await enqueue(db, {
      userId: recipient.user_id,
      eventId,
      type,
      dedupeKey: `${type}:${eventId}:${revision}:${recipient.user_id}`,
      title:
        type === "event_cancelled"
          ? `Sự kiện đã hủy: ${recipient.title}`
          : `Thông tin sự kiện thay đổi: ${recipient.title}`,
      body,
      payload: { eventTitle: recipient.title },
    });
  }
}

export async function queueAnnouncement(
  db: Db,
  eventId: number,
  organizerUserId: number,
  title: string,
  body: string,
): Promise<number> {
  const recipients = await db.query<{ user_id: number; event_title: string }>(
    `SELECT DISTINCT o.user_id, e.title AS event_title
       FROM orders o
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN tickets t ON t.order_id = o.id
      WHERE e.id = $1 AND o.payment_status IN ('paid', 'partially_refunded') AND o.user_id <> $2`,
    [eventId, organizerUserId],
  );
  const key = `announcement:${eventId}:${Date.now()}`;
  for (const recipient of recipients.rows) {
    await enqueue(db, {
      userId: recipient.user_id,
      eventId,
      type: "announcement",
      dedupeKey: `${key}:${recipient.user_id}`,
      title: `${recipient.event_title}: ${title}`,
      body,
      payload: { eventTitle: recipient.event_title },
    });
  }
  return recipients.rowCount ?? 0;
}

/**
 * Is there stock in this exact scope — one tier, or the whole showtime?
 *
 * The **single** availability judgement in the app, used both by the join gate and by the notifier
 * below. They used to have one each: the notifier asked per tier, the join route asked across the
 * whole showtime, and that disagreement was the defect — a sold-out tier could not be queued for
 * while any sibling tier still sold (FR-002, UC-09 A2). Two answers to one question is one answer
 * too many, so the route now calls this.
 *
 * `total_quantity IS NULL` means an uncapped tier, which is how seated tiers are written: there the
 * seat rows are the only truth, and a tier with neither a cap nor a free seat is exhausted.
 */
export async function availableForWaitlist(
  db: Db,
  showtimeId: number,
  tierId: number | null,
): Promise<boolean> {
  if (tierId !== null) {
    const tier = await db.query<{ available: boolean }>(
      // Branched on the *event's type*, the same axis `SHOWTIME_HAS_AVAILABILITY` branches on. A
      // seated tier's inventory is its seat rows and nothing else: a seated showtime whose tiers
      // carry a capacity but whose seat map is empty has nothing to sell, however encouraging the
      // counters look.
      `SELECT CASE WHEN e.event_type = 'seated'
                   THEN EXISTS (SELECT 1 FROM showtime_seats ss
                                 WHERE ss.showtime_id = s.id AND ss.ticket_tier_id = $1
                                   AND ss.status = 'available')
                   ELSE EXISTS (SELECT 1 FROM ticket_tiers tt
                                 WHERE tt.id = $1 AND tt.showtime_id = s.id
                                   AND (tt.total_quantity IS NULL
                                        OR tt.sold_quantity + tt.reserved_quantity < tt.total_quantity))
              END AS available
         FROM showtimes s JOIN events e ON e.id = s.event_id
        WHERE s.id = $2`,
      [tierId, showtimeId],
    );
    return tier.rows[0]?.available ?? false;
  }
  /*
   * "Does this showtime still sell anything" is a question the catalog already answers, and the
   * answer a buyer is shown ("Hết vé") must be the same one the queue is gated on.
   *
   * So the catalog's own predicate is used rather than a second version of it here. The two used to
   * disagree exactly where it mattered: a seated showtime with capped tiers but an empty seat map
   * read as sold out on the event page and as four hundred tickets in stock at the join gate, so
   * the button the page offered was refused the moment it was pressed.
   */
  const available = await db.query<{ available: boolean }>(
    `SELECT ${SHOWTIME_HAS_AVAILABILITY} AS available
       FROM showtimes s JOIN events e ON e.id = s.event_id
      WHERE s.id = $1`,
    [showtimeId],
  );
  return available.rows[0]?.available ?? false;
}

export async function notifyWaitlistForShowtime(showtimeId: number): Promise<void> {
  const allowed = await withTransaction(async (db) => {
    const entries = await db.query<{
      id: number;
      user_id: number;
      ticket_tier_id: number | null;
      event_id: number;
      title: string;
    }>(
      // `FOR UPDATE OF w` — the lock belongs on the queue rows this run is about to change.
      // Left unqualified it also took row locks on `showtimes` and `events`, which is a lock on
      // the event itself taken by a notification pass.
      `SELECT w.id, w.user_id, w.ticket_tier_id, e.id AS event_id, e.title
         FROM waitlists w JOIN showtimes s ON s.id = w.showtime_id JOIN events e ON e.id = s.event_id
        WHERE w.showtime_id = $1 AND w.status IN ('waiting', 'notified') AND s.starts_at > now()
        ORDER BY w.joined_at FOR UPDATE OF w`,
      [showtimeId],
    );
    const selected: typeof entries.rows = [];
    const notifiedPerTier = new Map<string, number>();
    for (const entry of entries.rows) {
      const tierKey = String(entry.ticket_tier_id);
      if ((notifiedPerTier.get(tierKey) ?? 0) >= 5) continue;
      if (await availableForWaitlist(db, showtimeId, entry.ticket_tier_id)) {
        selected.push(entry);
        notifiedPerTier.set(tierKey, (notifiedPerTier.get(tierKey) ?? 0) + 1);
      }
    }
    for (const entry of selected) {
      await db.query(
        `UPDATE waitlists SET status = 'notified', notified_at = now() WHERE id = $1`,
        [entry.id],
      );
      await enqueue(db, {
        userId: entry.user_id,
        // Carried so the in-app row can lead back to the event it is about. Read from the
        // notification's own column rather than from `payload`, which is a free-form blob and no
        // place to keep the destination of a link.
        eventId: entry.event_id,
        type: "waitlist_open",
        // The timestamp is deliberate: re-notification is required (UC-17 A5), so this key must
        // differ every release or the outbox's uniqueness would swallow the second message.
        dedupeKey: `waitlist_open:${entry.id}:${Date.now()}`,
        title: `Đã có vé: ${entry.title}`,
        body: "Vé vừa có lại. Số lượng không được giữ riêng, hãy hoàn tất mua vé sớm.",
        payload: { eventTitle: entry.title, showtimeId },
      });
    }
    return selected;
  });
  if (allowed.length > 0) kickNotificationWorker();
}

/**
 * Close the places that can no longer be served: their occasion has begun.
 *
 * One statement on the worker's existing tick rather than a scheduler of its own (research.md §4).
 * Lateness is invisible — `notifyWaitlistForShowtime` already refuses to notify a showtime that has
 * started, so a place left open for a few minutes past the start cannot produce a message.
 */
export async function sweepExpiredWaitlists(db: Db = pool): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE waitlists w
        SET status = 'expired'
       FROM showtimes s
      WHERE s.id = w.showtime_id
        AND w.status IN ('waiting', 'notified')
        AND s.starts_at <= now()`,
  );
  return rowCount ?? 0;
}

/**
 * Close the buyer's places for what they have just bought.
 *
 * Called from inside the checkout transaction, so the ticket and the exit from the queue commit or
 * roll back together: there is no instant where somebody holds a ticket and a place in the queue
 * for that same ticket, and no window where a rolled-back purchase has silently cost them their
 * turn. Their any-tier place for the showtime goes with it — they came for a ticket to this
 * occasion and now have one.
 */
export async function markWaitlistConverted(
  db: Db,
  userId: number,
  showtimeId: number,
  tierIds: number[],
): Promise<void> {
  await db.query(
    `UPDATE waitlists
        SET status = 'converted'
      WHERE user_id = $1
        AND showtime_id = $2
        AND status IN ('waiting', 'notified')
        AND (ticket_tier_id IS NULL OR ticket_tier_id = ANY($3::bigint[]))`,
    [userId, showtimeId, tierIds],
  );
}

export async function queueDueReminders(db: Db = pool): Promise<void> {
  const windows = [
    { type: "reminder_7d" as const, interval: "7 days", label: "1 tuần" },
    { type: "reminder_1d" as const, interval: "1 day", label: "1 ngày" },
  ];
  for (const window of windows) {
    const rows = await db.query<{
      user_id: number;
      order_id: number;
      event_id: number;
      title: string;
    }>(
      `SELECT DISTINCT o.user_id, o.id AS order_id, e.id AS event_id, e.title
         FROM orders o
         JOIN reservations r ON r.id = o.reservation_id
         JOIN showtimes s ON s.id = r.showtime_id
         JOIN events e ON e.id = s.event_id
         JOIN tickets t ON t.order_id = o.id
        WHERE o.payment_status IN ('paid', 'partially_refunded') AND t.qr_status <> 'void'
          AND s.status <> 'cancelled'
          AND s.starts_at BETWEEN now() + $1::interval - interval '15 minutes'
                              AND now() + $1::interval + interval '15 minutes'`,
      [window.interval],
    );
    for (const row of rows.rows) {
      await enqueue(db, {
        userId: row.user_id,
        orderId: row.order_id,
        eventId: row.event_id,
        type: window.type,
        dedupeKey: `${window.type}:${row.order_id}`,
        title: `Nhắc lịch ${window.label}: ${row.title}`,
        body: `Sự kiện diễn ra sau ${window.label}. Mở Vé của tôi để xem mã QR.`,
        payload: { eventTitle: row.title },
      });
    }
  }
  kickNotificationWorker();
}

async function sendMail(
  to: string,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!resend) {
    console.warn(`[ConsoleMailer] ${title} for ${to}`);
    return;
  }
  const ticketPayload = payload as unknown as Partial<TicketMailPayload>;
  const tickets = Array.isArray(ticketPayload.tickets) ? ticketPayload.tickets : [];
  const attachments = await Promise.all(
    tickets.map(async (ticket, index) => ({
      filename: `tixhub-ticket-${index + 1}.png`,
      content: (
        await QRCode.toBuffer(ticket.code, { type: "png", width: 480, margin: 2 })
      ).toString("base64"),
      inlineContentId: `tixhub-ticket-qr-${index + 1}`,
    })),
  );
  const additionalTickets = tickets.slice(1);
  const details = additionalTickets.length
    ? additionalTickets
        .map(
          (ticket, index) => `<tr>
              <td style="padding:16px 0;border-bottom:1px solid #e6e3dc;vertical-align:top">
                <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>
                  <td style="padding-right:16px;vertical-align:top">
                    <img src="cid:tixhub-ticket-qr-${index + 2}" width="112" height="112" alt="QR vé ${index + 2}" style="display:block;width:112px;height:112px;border:1px solid #e6e3dc;border-radius:6px;background:#ffffff" />
                  </td>
                  <td style="vertical-align:top">
                    <div style="font-size:14px;font-weight:700;color:#1c3d3a">${escapeHtml(ticket.tier)}${ticket.seat ? ` · Ghế ${escapeHtml(ticket.seat)}` : ""}</div>
                    <div style="margin-top:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#7a2f35;word-break:break-all">${escapeHtml(ticket.code)}</div>
                    <div style="margin-top:8px;font-size:12px;color:#6b7280">Quét QR này khi check-in.</div>
                  </td>
                </tr></table>
              </td>
            </tr>`,
        )
        .join("")
    : "";
  const eventTime = ticketPayload.startsAt ? formatVietnamTime(ticketPayload.startsAt) : "";
  const primaryTicketCode = tickets[0]?.code ?? "";
  const formattedTotal =
    typeof ticketPayload.totalAmount === "number"
      ? `${ticketPayload.totalAmount.toLocaleString("vi-VN")}₫`
      : "";
  const ticketUrl = ticketPayload.ticketUrl ?? "";
  const context = ticketPayload.eventTitle
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
         <tr>
           <td style="padding:0 18px 0 0;vertical-align:top">
             <div style="display:inline-block;padding:4px 8px;border:2px solid #e0e2ca;border-radius:4px;background:#d97690;color:#ffffff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700">TIXHUB PASS</div>
             <div style="margin-top:10px;font-size:27px;font-weight:800;line-height:33px;color:#7a2f35">${escapeHtml(ticketPayload.eventTitle)}</div>
             <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;border-collapse:collapse;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px">
               <tr>
                 <td style="padding:0 12px 12px 0;color:#6b7280">THỜI GIAN<br><strong style="display:inline-block;margin-top:4px;color:#12312f">${eventTime ? `${escapeHtml(eventTime)} (UTC+7)` : "Chưa xác định"}</strong></td>
                 <td style="padding:0 0 12px;color:#6b7280">KHÁN GIẢ<br><strong style="display:inline-block;margin-top:4px;color:#12312f">${escapeHtml(ticketPayload.customerName ?? "Khách TixHub")}</strong></td>
               </tr>
               <tr><td colspan="2" style="color:#6b7280">ĐỊA ĐIỂM<br><strong style="display:inline-block;margin-top:4px;color:#12312f;line-height:18px">${escapeHtml(ticketPayload.venue ?? "Chưa xác định")}</strong></td></tr>
             </table>
             ${formattedTotal ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #b9b8aa;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#6b7280">TỔNG THANH TOÁN <strong style="float:right;font-size:17px;color:#7a2f35">${formattedTotal}</strong></div>` : ""}
           </td>
           ${primaryTicketCode ? `<td width="132" style="vertical-align:middle;text-align:center"><div style="padding:10px;background:#12312f;border-radius:8px"><img src="cid:tixhub-ticket-qr-1" width="112" height="112" alt="QR vé" style="display:block;width:112px;height:112px;background:#e0e2ca" /></div><div style="margin-top:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;color:#7a2f35">VÉ VÀO CỬA QR</div></td>` : ""}
         </tr>
       </table>`
    : "";
  const refund = ticketPayload.refundPolicy
    ? `<div style="margin-top:20px;padding:14px 16px;border-left:3px solid #ba8248;background:#fff8ed;font-size:13px;line-height:20px;color:#4b5563"><strong style="color:#7a2f35">Chính sách hoàn vé</strong><br>${escapeHtml(ticketPayload.refundPolicy)}</div>`
    : "";
  const plainTickets = tickets
    .map((ticket) => `${ticket.tier}${ticket.seat ? ` - ${ticket.seat}` : ""}: ${ticket.code}`)
    .join("\n");
  const html = `<div style="margin:0;padding:32px 16px;background:#12312f;font-family:Arial,Helvetica,sans-serif;color:#12312f">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;border:4px solid #12312f;border-radius:14px;overflow:hidden;background:#e0e2ca;box-shadow:0 8px 22px rgba(0,0,0,.18)">
      <tr><td style="padding:22px 28px;background:#7a2f35;border-bottom:4px dashed #12312f;color:#ffffff">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>
          <td><div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#e0e2ca">Vé điện tử TixHub</div><div style="margin-top:8px;font-size:27px;font-weight:900;line-height:30px">TIXHUB <span style="display:inline-block;margin-left:6px;padding:3px 6px;border-radius:3px;background:#e0e2ca;color:#7a2f35;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;vertical-align:middle">QR PASS</span></div></td>
          <td style="text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#e0e2ca">MÃ VÉ<br><strong style="display:inline-block;max-width:180px;margin-top:5px;color:#ffffff;font-size:12px;line-height:16px;word-break:break-all">${escapeHtml(primaryTicketCode || title)}</strong></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px;background:#e0e2ca">
        <p style="margin:0 0 22px;font-size:14px;line-height:22px;color:#12312f">${escapeHtml(body)}</p>
        ${context}
        ${details ? `<div style="margin-top:24px;font-size:15px;font-weight:800;color:#7a2f35">VÉ VÀO CỬA QR</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:4px;border-collapse:collapse">${details}</table>` : ""}
        ${ticketUrl ? `<div style="margin-top:26px;text-align:center"><a href="${escapeHtml(ticketUrl)}" style="display:inline-block;padding:13px 22px;border:2px solid #12312f;border-radius:6px;background:#12312f;color:#e0e2ca;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none">MỞ VÉ TRÊN TIXHUB</a></div>` : ""}
        ${refund}
        <div style="margin-top:28px;padding-top:18px;border-top:2px dashed rgba(18,49,47,.35);font-size:13px;line-height:20px;color:#49615c">Cần hỗ trợ? Liên hệ <a href="mailto:support@tixhub.fit" style="color:#7a2f35;font-weight:700">support@tixhub.fit</a>.</div>
      </td></tr>
    </table>
  </div>`;
  const { error } = await resend.emails.send({
    from: config.mailFrom,
    to,
    subject: title,
    text: `${title}\n\n${body}${ticketPayload.eventTitle ? `\n\n${ticketPayload.eventTitle}${eventTime ? `\nThời gian: ${eventTime} (UTC+7)` : ""}${ticketPayload.venue ? `\nĐịa điểm: ${ticketPayload.venue}` : ""}` : ""}${plainTickets ? `\n\n${plainTickets}` : ""}${ticketUrl ? `\n\nMở vé trên TixHub: ${ticketUrl}` : ""}\n\nHỗ trợ: support@tixhub.fit`,
    html,
    attachments,
  });
  if (error)
    throw new Error(`${error.name ?? "send_failed"}: ${error.message ?? "unknown Resend error"}`);
}

/**
 * Append one delivery-attempt log line, and never let that be the thing that fails.
 *
 * The log is a record of what happened, not part of what happened: the mail has been sent or it
 * has not, and nothing about that changes because a row could not be written. The row goes missing
 * for two reasons in practice — the notification was deleted underneath the worker (which is the
 * whole of what the test suite does between cases, via `TRUNCATE users … CASCADE`), or the database
 * is unreachable. Both are worth a line in the log and neither is worth a crash.
 */
async function writeLog(
  notificationId: number,
  attempt: number,
  status: 'sent' | 'failed',
  error?: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notification_logs (notification_id, attempt_no, status, error) VALUES ($1, $2, $3, $4)`,
      [notificationId, attempt, status, error ?? null],
    );
  } catch (logError) {
    console.error('[notifications] could not write attempt log:', {
      notificationId,
      attempt,
      status,
      message: logError instanceof Error ? logError.message : logError,
    });
  }
}

export async function processPendingNotifications(): Promise<number> {
  let processed = 0;
  for (let i = 0; i < MAX_BATCH; i += 1) {
    const claimed = await pool.query<{
      id: number;
      attempts: number;
      title: string;
      body: string;
      payload: Record<string, unknown>;
      email: string;
    }>(
      `WITH next AS (
         SELECT n.id FROM notifications n
          WHERE n.channel = 'email' AND n.sent_at IS NULL AND n.next_attempt_at <= now()
          ORDER BY n.next_attempt_at, n.id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE notifications n SET attempts = n.attempts + 1, next_attempt_at = now() + interval '5 minutes'
        FROM next, users u
       WHERE n.id = next.id AND u.id = n.user_id
       RETURNING n.id, n.attempts, n.title, n.body, n.payload, u.email`,
    );
    const notification = claimed.rows[0];
    if (!notification) break;
    const attempt = notification.attempts;
    try {
      await sendMail(
        notification.email,
        notification.title,
        notification.body,
        notification.payload,
      );
      await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [notification.id]);
      // Outside the try: the mail is already gone, so a failure to *record* that must not be
      // reported as a failure to send. Treating it as one used to send the reader a second copy.
      await writeLog(notification.id, attempt, 'sent');
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "unknown send error";
      /*
       * Error handling that cannot itself throw.
       *
       * Both statements below write to the same database whose failure may be what landed us here,
       * so both were able to throw straight out of the loop — past this catch, past the caller's
       * bare `void`, and into an unhandled rejection. Node terminates the process on those, which
       * meant a database hiccup while emailing a ticket could kill the API moments after a
       * successful checkout.
       */
      try {
        await pool.query(
          `UPDATE notifications SET next_attempt_at = now() + ($2::bigint * interval '1 millisecond') WHERE id = $1`,
          [notification.id, retryDelayMs(attempt)],
        );
      } catch (scheduleError) {
        console.error('[notifications] could not reschedule:', {
          notificationId: notification.id,
          message: scheduleError instanceof Error ? scheduleError.message : scheduleError,
        });
      }
      await writeLog(notification.id, attempt, 'failed', message);
      console.error("[notifications] delivery failed:", {
        notificationId: notification.id,
        message,
      });
    }
    processed += 1;
  }
  return processed;
}

/**
 * Nudge the outbox and forget about it — safely.
 *
 * Callers want delivery attempted soon after a business event, not to wait for it: notification
 * delivery is never on the critical path of a checkout. That intent used to be spelled `void
 * processPendingNotifications()` at five call sites, none of which attached a handler, so any
 * rejection became an unhandled one — and Node terminates the process on those. One named function
 * so the sixth call site cannot get it wrong.
 */
export function kickNotificationWorker(): void {
  void processPendingNotifications().catch((error) =>
    console.error('[notifications] worker run failed:', error instanceof Error ? error.message : error),
  );
}

let timer: NodeJS.Timeout | null = null;

export function startNotificationWorker(): void {
  if (timer) return;
  // Both loops are fire-and-forget on a timer, so both need a handler. `queueDueReminders` always
  // had one; `processPendingNotifications` did not, which is what `kickNotificationWorker` fixes.
  const tick = () => {
    kickNotificationWorker();
    void queueDueReminders().catch((error) =>
      console.error("[notifications] reminder queue failed:", error),
    );
    // Waitlist places whose occasion has begun. Rides this tick rather than owning a timer: it is
    // one UPDATE, and being late costs nothing (see `sweepExpiredWaitlists`).
    void sweepExpiredWaitlists().catch((error) =>
      console.error("[notifications] waitlist expiry sweep failed:", error),
    );
  };
  tick();
  timer = setInterval(tick, 15 * 60_000);
  timer.unref?.();
}

export function stopNotificationWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
