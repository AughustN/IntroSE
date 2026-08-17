import type {
  AttendeeList,
  AttendeeRow,
  AttendeeShowtime,
  CheckinResult,
} from "@shared/admin/types.js";
import { pool, withTransaction } from "../../db/pool.js";
import { likePattern } from "../../db/like.js";
import { err } from "../../http.js";

/*
 * The door (UC-27, UC-28) and the list behind it (UC-29).
 *
 * The columns this writes — `qr_status`, `checked_in_at`, `checked_in_by` — have existed since
 * migration 0004 and nothing has ever written to them. The console showed a scan box that said
 * "mock result" in the page, and every check-in figure elsewhere was therefore zero.
 */

/** Who is scanning. Ownership is a property of the request, not of the ticket. */
export interface Actor {
  userId: number;
  isAdmin: boolean;
}

/**
 * How far either side of the start a ticket may be scanned.
 *
 * Doors open before the occasion and stragglers arrive after it, so a window that is exactly the
 * showtime would refuse most real scans. It is bounded on both sides all the same: without it, a
 * ticket to a concert in three months scans clean at the door of tonight's play, which is precisely
 * the mistake a scanner is there to prevent.
 */
const OPENS_HOURS_BEFORE = 6;
const CLOSES_HOURS_AFTER = 12;

interface TicketRow {
  id: number;
  barcode_value: string;
  qr_status: "unused" | "checked_in" | "void";
  checked_in_at: Date | null;
  organizer_user_id: number;
  event_title: string;
  starts_at: Date;
  showtime_status: string;
  tier: string;
  seat: string | null;
  buyer_name: string;
  payment_status: string;
}

const TICKET_LOOKUP = `
  SELECT t.id, t.barcode_value, t.qr_status, t.checked_in_at,
         org.user_id AS organizer_user_id, e.title AS event_title, s.starts_at,
         s.status AS showtime_status, tt.label AS tier,
         CASE WHEN ss.id IS NULL THEN NULL ELSE se.row_label || se.seat_number::text END AS seat,
         o.customer_name AS buyer_name, o.payment_status
    FROM tickets t
    JOIN orders o ON o.id = t.order_id
    JOIN reservation_items ri ON ri.id = t.reservation_item_id
    JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
    LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
    LEFT JOIN seats se ON se.id = ss.seat_id
    JOIN reservations r ON r.id = o.reservation_id
    JOIN showtimes s ON s.id = r.showtime_id
    JOIN events e ON e.id = s.event_id
    JOIN organizers org ON org.id = e.organizer_id`;

/**
 * Admit one ticket, or say why not.
 *
 * Everything happens under `FOR UPDATE` on the ticket row: two scanners on two doors reading the
 * same code at the same moment is the ordinary case at a venue, and both must not be told "admitted"
 * — exactly one writes the timestamp and the other is told the holder is already inside.
 *
 * A second scan is not an error. The door's question is "may this person come in", and for somebody
 * who is already inside the honest answer is "they are already inside, since 19:42" — a 409 would
 * make staff wonder whether the ticket is fake.
 */
export async function checkIn(actor: Actor, barcode: string): Promise<CheckinResult> {
  return withTransaction(async (db) => {
    const { rows } = await db.query<TicketRow>(
      `${TICKET_LOOKUP} WHERE t.barcode_value = $1 FOR UPDATE OF t`,
      [barcode.trim()],
    );
    const ticket = rows[0];
    // Unknown code and somebody else's ticket answer the same way: a scanner is a public-facing
    // device, and telling it which codes exist turns it into an oracle.
    if (!ticket) throw err.notFound("ticket_not_found", "Không tìm thấy vé với mã này.");
    if (!actor.isAdmin && ticket.organizer_user_id !== actor.userId)
      throw err.notFound("ticket_not_found", "Không tìm thấy vé với mã này.");

    if (ticket.qr_status === "void")
      throw err.conflict("ticket_void", "Vé này đã bị huỷ hoặc hoàn tiền.");
    if (!["paid", "partially_refunded"].includes(ticket.payment_status))
      throw err.conflict("order_not_paid", "Đơn hàng của vé này chưa thanh toán xong.");
    if (ticket.showtime_status === "cancelled")
      throw err.conflict("showtime_cancelled", "Suất diễn này đã bị huỷ.");

    const startsAt = ticket.starts_at.getTime();
    const now = Date.now();
    if (now < startsAt - OPENS_HOURS_BEFORE * 3_600_000)
      throw err.conflict(
        "too_early",
        `Chưa tới giờ vào cửa. Cửa mở trước giờ diễn ${OPENS_HOURS_BEFORE} tiếng.`,
      );
    if (now > startsAt + CLOSES_HOURS_AFTER * 3_600_000)
      throw err.conflict("too_late", "Suất diễn này đã kết thúc.");

    const already = ticket.qr_status === "checked_in";
    const checkedInAt = already
      ? ticket.checked_in_at!
      : (
          await db.query<{ checked_in_at: Date }>(
            `UPDATE tickets SET qr_status = 'checked_in', checked_in_at = now(), checked_in_by = $2
              WHERE id = $1 RETURNING checked_in_at`,
            [ticket.id, actor.userId],
          )
        ).rows[0].checked_in_at;

    return {
      ticketId: ticket.id,
      barcode: ticket.barcode_value,
      eventTitle: ticket.event_title,
      startsAt: ticket.starts_at.toISOString(),
      tier: ticket.tier,
      seat: ticket.seat,
      buyerName: ticket.buyer_name,
      checkedInAt: checkedInAt.toISOString(),
      admitted: !already,
    };
  });
}

/**
 * How the caller wants the door list narrowed.
 *
 * `limit: null` means "every row", which only the CSV export asks for. Everything with a screen
 * behind it passes a page.
 */
export interface AttendeeFilter {
  showtimeId?: number;
  /** Matched against buyer name, buyer email and order code. */
  query?: string;
  status?: "valid" | "checked_in" | "void";
  limit: number | null;
  offset: number;
}

/**
 * Who is coming, and who has arrived (UC-29).
 *
 * Void tickets stay in the list rather than being filtered out: a cancelled seat is part of the
 * story of an event, and a door list that silently drops it leaves staff unable to explain why the
 * numbers do not add up.
 *
 * **The list is paged; the counts are not.** A sold-out arena is tens of thousands of tickets, and
 * this used to answer with all of them in one array — then derive the KPI figures by counting that
 * array in JavaScript. Paging alone would therefore have turned "Tổng vé" into "vé trên trang này".
 * So the totals come from their own aggregate over the whole event, and only the rows are windowed.
 *
 * The counts deliberately ignore `query` and `status` and honour only `showtimeId`: they answer
 * "how full is this door", which is a fact about the event, not about what the reader typed. The
 * matching row count travels separately as `total`.
 */
export async function attendees(
  actor: Actor,
  eventId: number,
  filter: AttendeeFilter,
): Promise<AttendeeList> {
  const owner = await pool.query<{ user_id: number; title: string }>(
    `SELECT org.user_id, e.title FROM events e JOIN organizers org ON org.id = e.organizer_id
      WHERE e.id = $1`,
    [eventId],
  );
  const event = owner.rows[0];
  if (!event) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  if (!actor.isAdmin && event.user_id !== actor.userId)
    throw err.forbidden("not_owner", "Bạn không sở hữu sự kiện này.");

  /*
   * One FROM, three readers: the page, the matching-row count, and the event-wide totals. Written
   * once so a ticket can never be counted by one and missed by another.
   *
   * `qr_status = 'unused'` is what the API calls `valid`, so the status filter translates rather
   * than passing the caller's word through to the column.
   */
  const FROM = `
       FROM tickets t
       JOIN orders o ON o.id = t.order_id
       JOIN reservation_items ri ON ri.id = t.reservation_item_id
       JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
       LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
       LEFT JOIN seats se ON se.id = ss.seat_id
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
      WHERE s.event_id = $1 AND ($2::bigint IS NULL OR s.id = $2)
        AND o.payment_status IN ('paid', 'partially_refunded')`;

  const scope = [eventId, filter.showtimeId ?? null];

  const narrowed = `${FROM}
        AND ($3::text IS NULL OR o.customer_name ILIKE $3
             OR o.customer_email ILIKE $3
             OR o.order_code ILIKE $3)
        AND ($4::text IS NULL OR t.qr_status = (CASE WHEN $4 = 'valid' THEN 'unused' ELSE $4 END))`;

  const narrowedParams = [...scope, likePattern(filter.query), filter.status ?? null];

  // `LIMIT NULL` is "no limit" in Postgres, so the CSV path needs no second statement.
  const { rows } = await pool.query<{
    ticket_id: number;
    barcode: string;
    order_code: string;
    buyer_name: string;
    buyer_email: string;
    tier: string;
    seat: string | null;
    qr_status: "unused" | "checked_in" | "void";
    checked_in_at: Date | null;
  }>(
    `SELECT t.id AS ticket_id, t.barcode_value AS barcode, o.order_code, o.customer_name AS buyer_name,
            o.customer_email AS buyer_email, tt.label AS tier,
            CASE WHEN ss.id IS NULL THEN NULL ELSE se.row_label || se.seat_number::text END AS seat,
            t.qr_status, t.checked_in_at
     ${narrowed}
      ORDER BY o.customer_name, t.id
      LIMIT $5 OFFSET $6`,
    [...narrowedParams, filter.limit, filter.offset],
  );

  const matching = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total ${narrowed}`,
    narrowedParams,
  );

  const totals = await pool.query<{ total: number; checked_in: number; void: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE t.qr_status = 'checked_in')::int AS checked_in,
            count(*) FILTER (WHERE t.qr_status = 'void')::int AS void
     ${FROM}`,
    scope,
  );

  const list: AttendeeRow[] = rows.map((row) => ({
    ticketId: row.ticket_id,
    barcode: row.barcode,
    orderCode: row.order_code,
    buyerName: row.buyer_name,
    buyerEmail: row.buyer_email,
    tier: row.tier,
    seat: row.seat,
    status: row.qr_status === "unused" ? "valid" : row.qr_status,
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
  }));

  return {
    eventId,
    eventTitle: event.title,
    showtimeId: filter.showtimeId ?? null,
    rows: list,
    total: matching.rows[0]?.total ?? 0,
    counts: {
      total: totals.rows[0]?.total ?? 0,
      checkedIn: totals.rows[0]?.checked_in ?? 0,
      void: totals.rows[0]?.void ?? 0,
    },
  };
}

/**
 * The event's showtimes, for the picker.
 *
 * A door list is per-showtime in reality: a three-night run shown as one merged list tells the
 * person on the door nothing about tonight. The count rides along so the picker can say how big
 * each night is before it is chosen.
 */
export async function attendeeShowtimes(
  actor: Actor,
  eventId: number,
): Promise<AttendeeShowtime[]> {
  const owner = await pool.query<{ user_id: number }>(
    `SELECT org.user_id FROM events e JOIN organizers org ON org.id = e.organizer_id
      WHERE e.id = $1`,
    [eventId],
  );
  const event = owner.rows[0];
  if (!event) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  if (!actor.isAdmin && event.user_id !== actor.userId)
    throw err.forbidden("not_owner", "Bạn không sở hữu sự kiện này.");

  const { rows } = await pool.query<{
    id: number;
    starts_at: Date;
    venue: string;
    tickets: number;
  }>(
    `SELECT s.id, s.starts_at, v.name AS venue,
            (SELECT count(*)::int
               FROM tickets t
               JOIN orders o ON o.id = t.order_id
               JOIN reservations r ON r.id = o.reservation_id
              WHERE r.showtime_id = s.id
                AND o.payment_status IN ('paid', 'partially_refunded')) AS tickets
       FROM showtimes s
       JOIN venues v ON v.id = s.venue_id
      WHERE s.event_id = $1
      ORDER BY s.starts_at`,
    [eventId],
  );

  return rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at.toISOString(),
    venue: row.venue,
    tickets: row.tickets,
  }));
}

/**
 * The same list as a file (UC-29 step 3).
 *
 * Excel on a Vietnamese Windows install reads a bare UTF-8 CSV as Latin-1 and turns every accented
 * name into mojibake, so the byte-order mark is not decoration — it is the difference between a
 * usable door list and one the venue retypes by hand.
 */
export function toCsv(list: AttendeeList): string {
  const cell = (value: string | null): string => {
    const text = value ?? "";
    // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula. Names do not begin
    // that way; injected cells do.
    const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const header = [
    "Mã vé",
    "Mã đơn",
    "Khách",
    "Email",
    "Hạng vé",
    "Ghế",
    "Trạng thái",
    "Giờ check-in",
  ];
  const status = { valid: "Chưa vào", checked_in: "Đã vào", void: "Đã huỷ" };
  const lines = list.rows.map((row) =>
    [
      row.barcode,
      row.orderCode,
      row.buyerName,
      row.buyerEmail,
      row.tier,
      row.seat,
      status[row.status],
      row.checkedInAt,
    ]
      .map(cell)
      .join(","),
  );
  // The byte-order mark is written as an escape, not as an invisible character in the source: a
  // literal BOM mid-file is indistinguishable from a stray space to everyone reading the code.
  return `\uFEFF${header.map(cell).join(",")}\n${lines.join("\n")}\n`;
}
