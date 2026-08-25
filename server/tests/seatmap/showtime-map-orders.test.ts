import request from "supertest";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { bindAndGenerate, defaultLayoutOf } from "../helpers/seatmapSeed.js";

// The organizer chart's order-awareness: GET /api/organizer/showtimes/:id/seat-map names who a sold
// seat belongs to, and whether that person has walked through the door.
//
// The chain under test is the attendees export's own (ticket -> order -> reservation_item -> seat):
// a seat stays anonymous while merely held, gains the buyer's registered nickname once paid for, and
// loses it again if the only live ticket is voided (a refund un-names the seat). The check-in time
// exists on the TICKET, so it must come through that same join.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** A buyer with a registered nickname — the name the map must print, not an order snapshot. */
async function buyer(nickname: string) {
  const email = `buyer-${randomUUID()}@example.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, nickname, password_hash, provider)
     VALUES ($1, $2, 'x', 'email') RETURNING id`,
    [email, nickname],
  );
  return { id: rows[0].id as number, nickname };
}

/** A seated showtime with a generated map of `count` seats. Same shape apply-rules builds. */
async function liveMap(o: { h: Record<string, string> }, count = 3) {
  const venue = (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: "V", city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id;
  const section = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/sections`)
      .set(o.h)
      .send({ name: "Khu A" })
      .expect(201)
  ).body.id;
  await request(app)
    .post(`/api/organizer/venues/${venue}/seats`)
    .set(o.h)
    .send({ sectionId: section, rowLabel: "A", count })
    .expect(201);
  const ev = (
    await request(app)
      .post("/api/organizer/events")
      .set(o.h)
      .send({ title: "S", categoryCode: "theatre", description: "d", eventType: "seated" })
      .expect(201)
  ).body.id;
  const showtime = (
    await request(app)
      .post(`/api/organizer/events/${ev}/showtimes`)
      .set(o.h)
      .send({
        venueId: venue,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        tiers: [
          { label: "VIP", price: 500_000 },
          { label: "Thường", price: 200_000 },
        ],
      })
      .expect(201)
  ).body.id;
  await bindAndGenerate(o.h, { showtime, layoutId: await defaultLayoutOf(venue) });

  const seats = (
    await pool.query<{ id: number; ticket_tier_id: number }>(
      `SELECT id, ticket_tier_id FROM showtime_seats WHERE showtime_id = $1 ORDER BY seat_number`,
      [showtime],
    )
  ).rows;
  return { showtime, seats };
}

/**
 * One completed purchase for one seat, built the way checkout leaves the database: a converted
 * reservation over the item, a paid order carrying the buyer's nickname snapshot, and the ticket.
 */
async function sellSeat(
  showtime: number,
  seat: { id: number; ticket_tier_id: number },
  b: { id: number; nickname: string },
  qrStatus: "unused" | "checked_in" | "void" = "unused",
) {
  const reservation = (
    await pool.query(
      `INSERT INTO reservations (user_id, showtime_id, expires_at, status)
       VALUES ($1, $2, now() + interval '14 minutes', 'converted') RETURNING id`,
      [b.id, showtime],
    )
  ).rows[0].id as number;
  const item = (
    await pool.query(
      `INSERT INTO reservation_items (reservation_id, ticket_tier_id, showtime_seat_id, quantity, unit_price_amount)
       VALUES ($1, $2, $3, 1, 500000) RETURNING id`,
      [reservation, seat.ticket_tier_id, seat.id],
    )
  ).rows[0].id as number;
  // customer_name is checkout's snapshot of the buyer's registered handle — the exact column the
  // attendees CSV prints, and the one the map must agree with.
  const order = (
    await pool.query(
      `INSERT INTO orders (order_code, user_id, reservation_id, customer_name, customer_email, customer_phone,
                           subtotal_cents, service_fee_cents, discount_cents, final_total_cents, payment_method, payment_status)
       VALUES ($1, $2, $3, $4, 'b@example.com', '', 500000, 0, 0, 500000, 'wallet', 'paid') RETURNING id`,
      [`ORD${randomUUID().replaceAll("-", "").slice(0, 16)}`, b.id, reservation, b.nickname],
    )
  ).rows[0].id as number;
  await pool.query(
    `INSERT INTO tickets (order_id, reservation_item_id, price_cents, refundable_amount, qr_token_hash, barcode_value, qr_status, checked_in_at)
     VALUES ($1, $2, 500000, 500000, $3, $4, $5, ${qrStatus === "checked_in" ? "now()" : "NULL"})`,
    [order, item, randomUUID(), `BC${randomUUID().replaceAll("-", "").slice(0, 16)}`, qrStatus],
  );
  await pool.query(`UPDATE showtime_seats SET status = 'sold' WHERE id = $1`, [seat.id]);
}

async function mapOf(o: { h: Record<string, string> }, showtime: number) {
  const res = await request(app)
    .get(`/api/organizer/showtimes/${showtime}/seat-map`)
    .set(o.h)
    .expect(200);
  return res.body as {
    seats: { id: number; buyerName: string | null; checkedInAt: string | null }[];
  };
}

describe("order-awareness on the organizer showtime map", () => {
  it("names a sold seat by the buyer's registered nickname and reports no check-in yet", async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const bought = await buyer("Anh Khoai");
    await sellSeat(m.showtime, m.seats[0], bought);

    const map = await mapOf(o, m.showtime);
    const named = map.seats.find((s) => s.id === m.seats[0].id)!;
    const others = map.seats.filter((s) => s.id !== m.seats[0].id);

    expect(named.buyerName).toBe("Anh Khoai");
    expect(named.checkedInAt).toBeNull();
    for (const s of others) {
      expect(s.buyerName).toBeNull();
      expect(s.checkedInAt).toBeNull();
    }
  });

  it("carries the check-in time through once the ticket is scanned", async () => {
    const o = await organizer();
    const m = await liveMap(o, 2);
    const bought = await buyer("Chị Hành");
    await sellSeat(m.showtime, m.seats[0], bought, "checked_in");

    const map = await mapOf(o, m.showtime);
    const named = map.seats.find((s) => s.id === m.seats[0].id)!;

    expect(named.buyerName).toBe("Chị Hành");
    expect(named.checkedInAt).not.toBeNull();
    expect(Number.isNaN(new Date(named.checkedInAt!).getTime())).toBe(false);
  });

  it("keeps a held seat anonymous — no name without a purchase", async () => {
    const o = await organizer();
    const m = await liveMap(o, 1);
    const holder = await buyer("Người Giữ");
    await pool.query(
      `UPDATE showtime_seats SET status = 'held', hold_owner_id = $2, hold_expires_at = now() + interval '5 minutes'
        WHERE id = $1`,
      [m.seats[0].id, holder.id],
    );

    const map = await mapOf(o, m.showtime);
    expect(map.seats[0].buyerName).toBeNull();
    expect(map.seats[0].checkedInAt).toBeNull();
  });

  it("un-names a seat whose only ticket was voided", async () => {
    const o = await organizer();
    const m = await liveMap(o, 1);
    const refunded = await buyer("Đã Hoàn Tiền");
    await sellSeat(m.showtime, m.seats[0], refunded, "void");

    const map = await mapOf(o, m.showtime);
    expect(map.seats[0].buyerName).toBeNull();
    expect(map.seats[0].checkedInAt).toBeNull();
  });

  it("reads the newest non-void ticket when a seat was refunded and reissued", async () => {
    const o = await organizer();
    const m = await liveMap(o, 1);
    const first = await buyer("Người Đầu Tiên");
    const second = await buyer("Người Thứ Hai");
    await sellSeat(m.showtime, m.seats[0], first, "void");
    await sellSeat(m.showtime, m.seats[0], second, "checked_in");

    const map = await mapOf(o, m.showtime);
    expect(map.seats[0].buyerName).toBe("Người Thứ Hai");
    expect(map.seats[0].checkedInAt).not.toBeNull();
    // One row per seat regardless of ticket history — the LIMIT 1 in the join is what guards this.
    expect(map.seats.filter((s) => s.id === m.seats[0].id)).toHaveLength(1);
  });
});
