import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import { adminSession, moveShowtime, seedSale } from "../helpers/salesSeed.js";

/*
 * The door (UC-27, UC-28) and the list behind it (UC-29).
 *
 * `tickets.qr_status`, `checked_in_at` and `checked_in_by` have existed since migration 0004 and
 * nothing had ever written to them: the console's scan box announced "mock result" in the page, and
 * so every check-in figure in the product was structurally zero.
 */

const scan = (token: string, barcode: string) =>
  request(app).post("/api/organizer/tickets/check-in").set(bearer(token)).send({ barcode });

/** Doors open six hours before the start, so a fixture must sit inside that window to be scannable. */
const AT_THE_DOOR = 60 * 60 * 1000;

describe("scanning a ticket at the door (UC-27)", () => {
  it("admits the holder and records who scanned them", async () => {
    const sale = await seedSale({ quantity: 1 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);

    const res = await scan(sale.organizer.token, sale.barcodes[0]).expect(200);

    expect(res.body.admitted).toBe(true);
    expect(res.body.barcode).toBe(sale.barcodes[0]);
    const { rows } = await pool.query<{ qr_status: string; checked_in_by: number }>(
      `SELECT qr_status, checked_in_by FROM tickets WHERE barcode_value = $1`,
      [sale.barcodes[0]],
    );
    expect(rows[0].qr_status).toBe("checked_in");
    expect(rows[0].checked_in_by).toBe(sale.organizer.userId);
  });

  it("answers a second scan with “already inside”, not with an error", async () => {
    // Staff scan the same wristband twice constantly. A red failure there makes them doubt a
    // genuine ticket, so the honest answer is the time the holder came in.
    const sale = await seedSale({ quantity: 1 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);
    const first = await scan(sale.organizer.token, sale.barcodes[0]).expect(200);

    const second = await scan(sale.organizer.token, sale.barcodes[0]).expect(200);

    expect(second.body.admitted).toBe(false);
    expect(second.body.checkedInAt).toBe(first.body.checkedInAt);
  });

  it("refuses a cancelled ticket", async () => {
    const sale = await seedSale({ quantity: 1 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);
    await pool.query(`UPDATE tickets SET qr_status = 'void' WHERE barcode_value = $1`, [
      sale.barcodes[0],
    ]);

    const res = await scan(sale.organizer.token, sale.barcodes[0]);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ticket_void");
  });

  it("refuses a ticket to an occasion that has not opened yet", async () => {
    const sale = await seedSale({ quantity: 1, startsInMs: 5 * 86_400_000 });

    const res = await scan(sale.organizer.token, sale.barcodes[0]);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("too_early");
  });

  it("refuses a ticket to a cancelled showtime", async () => {
    const sale = await seedSale({ quantity: 1 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);
    await pool.query(`UPDATE showtimes SET status = 'cancelled' WHERE id = $1`, [sale.showtimeId]);

    const res = await scan(sale.organizer.token, sale.barcodes[0]);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("showtime_cancelled");
  });

  it("answers another organizer’s ticket the way it answers an invented code", async () => {
    // A scanner is a public-facing device. Distinguishing "not yours" from "no such code" would
    // turn it into an oracle for which codes exist.
    const sale = await seedSale({ quantity: 1 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);
    const stranger = await seedSale({ quantity: 1 });

    const foreign = await scan(stranger.organizer.token, sale.barcodes[0]);
    const invented = await scan(stranger.organizer.token, "KHONG-CO-MA-NAY");

    expect(foreign.status).toBe(404);
    expect(invented.status).toBe(404);
    expect(foreign.body.error).toBe(invented.body.error);
  });

  it("lets an admin scan any door", async () => {
    const sale = await seedSale({ quantity: 1 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);
    const admin = await adminSession();

    const res = await request(app)
      .post("/api/admin/tickets/check-in")
      .set(bearer(admin.token))
      .send({ barcode: sale.barcodes[0] })
      .expect(200);

    expect(res.body.admitted).toBe(true);
  });

  it("refuses an ordinary account entirely", async () => {
    const sale = await seedSale({ quantity: 1 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);
    const user = await registerUser();

    await request(app)
      .post("/api/organizer/tickets/check-in")
      .set(bearer(user.token))
      .send({ barcode: sale.barcodes[0] })
      .expect(403);
  });
});

describe("the attendee list (UC-29)", () => {
  it("lists everybody who paid, with their arrival state", async () => {
    const sale = await seedSale({ quantity: 3 });
    await moveShowtime(sale.showtimeId, AT_THE_DOOR);
    await scan(sale.organizer.token, sale.barcodes[0]).expect(200);

    const res = await request(app)
      .get(`/api/organizer/events/${sale.eventId}/attendees`)
      .set(bearer(sale.organizer.token))
      .expect(200);

    expect(res.body.counts).toEqual({ total: 3, checkedIn: 1, void: 0 });
    expect(res.body.rows.filter((row: { status: string }) => row.status === "valid")).toHaveLength(
      2,
    );
  });

  it("keeps a cancelled ticket in the list rather than hiding it", async () => {
    // A door list that silently drops a refunded seat leaves staff unable to explain why the
    // numbers do not add up.
    const sale = await seedSale({ quantity: 2 });
    await pool.query(`UPDATE tickets SET qr_status = 'void' WHERE barcode_value = $1`, [
      sale.barcodes[0],
    ]);

    const res = await request(app)
      .get(`/api/organizer/events/${sale.eventId}/attendees`)
      .set(bearer(sale.organizer.token))
      .expect(200);

    expect(res.body.counts.total).toBe(2);
    expect(res.body.counts.void).toBe(1);
  });

  it("exports the same list as a spreadsheet Excel can read", async () => {
    const sale = await seedSale({ quantity: 1 });

    const res = await request(app)
      .get(`/api/organizer/events/${sale.eventId}/attendees?format=csv`)
      .set(bearer(sale.organizer.token))
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    // The byte-order mark is what stops Excel on a Vietnamese Windows install from turning every
    // accented name into mojibake.
    expect(res.text.startsWith("﻿")).toBe(true);
    expect(res.text).toContain(sale.barcodes[0]);
  });

  it("refuses somebody else’s event", async () => {
    const sale = await seedSale({ quantity: 1 });
    const stranger = await seedSale({ quantity: 1 });

    await request(app)
      .get(`/api/organizer/events/${sale.eventId}/attendees`)
      .set(bearer(stranger.organizer.token))
      .expect(403);
  });
});
