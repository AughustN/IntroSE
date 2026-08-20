import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import * as seed from "../helpers/catalogSeed.js";
import { pool } from "../../src/db/pool.js";
import { moveShowtime } from "../helpers/salesSeed.js";

/**
 * A bought ticket owned by a registered organizer user (so we have a token to auth with).
 *
 * The showtime/event/venue are seeded directly (the organizer write API leaves events in `draft`,
 * which cannot be purchased) but the organizer row belongs to `o`, so `o` owns the event and can
 * check the ticket in.
 */
async function boughtTicket() {
  const o = await registerUser();
  const orgId = await makeApprovedOrganizer(o.userId);
  const venue = await seed.seedVenue(o.userId);
  const ev = await seed.seedEvent({ organizerId: orgId, eventType: "general_admission", title: "Check-in Gig" });
  const showtimeId = await seed.seedShowtime(ev.id, venue);
  const tierId = await seed.seedTier(showtimeId, { total: 5, price: 100_000 });

  const buyer = await registerUser();
  await pool.query(`UPDATE wallets SET balance_amount = 200_000 WHERE user_id = $1`, [buyer.userId]);
  const reservation = await request(app)
    .post("/api/reservations")
    .set(bearer(buyer.token))
    .send({ showtimeId, ticketTierId: tierId, quantity: 1 })
    .expect(201);
  const order = await request(app)
    .post("/api/checkout")
    .set(bearer(buyer.token))
    .send({ reservationId: reservation.body.id })
    .expect(201);

  return {
    organizer: o,
    showtimeId,
    ticketCode: order.body.tickets[0].ticketCode as string,
  };
}

describe("organizer ticket check-in (US6)", () => {
  it("looks up a ticket by its QR code within the organizer's own events", async () => {
    const { organizer, ticketCode } = await boughtTicket();

    const res = await request(app)
      .get(`/api/organizer/tickets/lookup?code=${encodeURIComponent(ticketCode)}`)
      .set(bearer(organizer.token))
      .expect(200);

    expect(res.body.code).toBe(ticketCode);
    expect(res.body.eventTitle).toBe("Check-in Gig");
    expect(res.body.status).toBe("unused");
    expect(res.body.customerName).toBeTruthy();
  });

  it("refuses a code that does not belong to the caller's events", async () => {
    const { ticketCode } = await boughtTicket();
    const other = await registerUser();
    await makeApprovedOrganizer(other.userId);

    await request(app)
      .get(`/api/organizer/tickets/lookup?code=${encodeURIComponent(ticketCode)}`)
      .set(bearer(other.token))
      .expect(404);
  });

  it("checks a ticket in once, and reports already on a rescan", async () => {
    const { organizer, showtimeId, ticketCode } = await boughtTicket();
    await moveShowtime(showtimeId, 60 * 60 * 1000);

    const first = await request(app)
      .post("/api/organizer/tickets/check-in")
      .set(bearer(organizer.token))
      .send({ code: ticketCode })
      .expect(200);
    expect(first.body.already).toBe(false);
    expect(first.body.ticket.status).toBe("checked_in");

    const again = await request(app)
      .post("/api/organizer/tickets/check-in")
      .set(bearer(organizer.token))
      .send({ code: ticketCode })
      .expect(200);
    expect(again.body.already).toBe(true);
    expect(again.body.ticket.status).toBe("checked_in");
  });

  it("applies the canonical opening window to manual code entry", async () => {
    const { organizer, ticketCode } = await boughtTicket();

    const res = await request(app)
      .post("/api/organizer/tickets/check-in")
      .set(bearer(organizer.token))
      .send({ code: ticketCode });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("too_early");
  });
});
