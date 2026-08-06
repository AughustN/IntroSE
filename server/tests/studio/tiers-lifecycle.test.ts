import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { seedTier } from "../helpers/catalogSeed.js";
import {
  api,
  auth,
  attachSeatMap,
  makeSeatedStudio,
  makeStudio,
  setSeatStatus,
  tierRow,
} from "./helpers.js";

/**
 * The tier lifecycle (US1, UC-26). Every refusal below gets its own assertion — the feature's stated
 * testing bar is that refusal paths, not only happy paths, are pinned (Principle IV).
 */
describe("ticket tier lifecycle", () => {
  it("adds a tier to an existing showtime without recreating it (FR-001, SC-001)", async () => {
    const s = await makeStudio();
    const res = await api()
      .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .send({ label: "VIP", price: 250_000, capacity: 50 })
      .expect(201);

    expect(res.body.tier).toMatchObject({
      label: "VIP",
      price: 250_000,
      capacity: 50,
      archived: false,
    });
    expect(res.body.tier.remaining).toBe(50);
  });

  it("refuses a fifth ACTIVE tier, naming the limit (FR-002, SC-004)", async () => {
    const s = await makeStudio();
    for (const label of ["A", "B", "C"]) {
      await api()
        .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
        .set(auth(s.token))
        .send({ label, price: 100_000 })
        .expect(201);
    }
    const res = await api()
      .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .send({ label: "Thứ năm", price: 100_000 })
      .expect(409);

    expect(res.body.error).toBe("tier_limit_reached");
    expect(res.body.message).toContain("4");
  });

  it("renames and reprices a tier (FR-003)", async () => {
    const s = await makeStudio();
    const res = await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ label: "Hạng thường", price: 175_000 })
      .expect(200);

    expect(res.body.tier).toMatchObject({ label: "Hạng thường", price: 175_000 });
  });

  it.each([
    ["fractional", 150_000.5],
    ["negative", -1],
    ["non-numeric", "nhiều tiền"],
  ])("refuses a %s price and changes nothing (FR-003, STD-03)", async (_kind, price) => {
    const s = await makeStudio();
    const before = await tierRow(s.tierId);
    await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ price })
      .expect(400);
    expect(await tierRow(s.tierId)).toEqual(before);
  });

  it("keeps an existing hold at its captured price when the tier is repriced (FR-010)", async () => {
    // FR-010 is free from feature 003 capturing unit price at hold time — but free is not the same as
    // proven, and a later change to the hold path could silently reprice a buyer mid-checkout.
    const s = await makeStudio({ reserved: 2 });
    const user = (await pool.query(`SELECT id FROM users LIMIT 1`)).rows[0].id;
    const reservation = (
      await pool.query(
        `INSERT INTO reservations (user_id, showtime_id, status, expires_at)
         VALUES ($1, $2, 'active', now() + interval '7 minutes') RETURNING id`,
        [user, s.showtimeId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO reservation_items (reservation_id, ticket_tier_id, quantity, unit_price_amount)
       VALUES ($1, $2, 2, 100000)`,
      [reservation, s.tierId],
    );

    await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ price: 400_000 })
      .expect(200);

    const item = (
      await pool.query(
        `SELECT unit_price_amount FROM reservation_items WHERE reservation_id = $1`,
        [reservation],
      )
    ).rows[0];
    expect(Number(item.unit_price_amount)).toBe(100_000); // the captured price, not the new one
    expect(Number((await tierRow(s.tierId)).price_amount)).toBe(400_000); // later holds get this
  });

  it("archives rather than deletes a tier that has sales, keeping label and price resolvable (FR-006, SC-003)", async () => {
    const s = await makeStudio({ sold: 3 });
    await seedTier(s.showtimeId, { label: "Còn lại" }); // so the sold tier is not the last active one

    const res = await api()
      .delete(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .expect(200);
    expect(res.body.outcome).toBe("archived");

    const row = await tierRow(s.tierId);
    expect(row).not.toBeNull();
    expect(row.archived_at).not.toBeNull();
    expect(row.label).toBe("Thường");
    expect(Number(row.price_amount)).toBe(100_000);
  });

  it("refuses to delete a tier with live holds and offers archiving instead (FR-008)", async () => {
    const s = await makeStudio({ reserved: 2 });
    await seedTier(s.showtimeId, { label: "Còn lại" });

    const res = await api()
      .delete(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .expect(409);
    expect(res.body.error).toBe("tier_has_holds");
    expect(res.body.message).toContain("lưu trữ");
    expect(await tierRow(s.tierId)).not.toBeNull();
  });

  it("refuses to remove the last active tier of an on-sale showtime (FR-007)", async () => {
    const s = await makeStudio();
    const res = await api()
      .delete(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .expect(409);
    expect(res.body.error).toBe("tier_last_active");
  });

  it("deletes outright a tier with no sales, no holds and no seats (FR-007)", async () => {
    const s = await makeStudio();
    const extra = (
      await api()
        .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
        .set(auth(s.token))
        .send({ label: "Bỏ đi", price: 50_000 })
        .expect(201)
    ).body.tier.id;

    const res = await api().delete(`/api/organizer/tiers/${extra}`).set(auth(s.token)).expect(200);
    expect(res.body.outcome).toBe("deleted");
    expect(await tierRow(extra)).toBeNull();
  });

  it("refuses to delete a seated price class that still prices bookable seats, pointing at 005 (FR-007)", async () => {
    const s = await makeSeatedStudio();
    await seedTier(s.showtimeId, { label: "Hạng hai", total: null });

    const res = await api()
      .delete(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .expect(409);
    expect(res.body.error).toBe("tier_has_seats");
    expect(res.body.message).toContain("sơ đồ");
  });

  it("restores an archived tier, and refuses the restore at four active tiers (FR-006, SC-004)", async () => {
    const s = await makeStudio({ sold: 1 });
    await seedTier(s.showtimeId, { label: "Giữ chỗ" });
    await api().delete(`/api/organizer/tiers/${s.tierId}`).set(auth(s.token)).expect(200);

    // Archived tiers do not consume a slot — proving it by filling all four with new ones.
    for (const label of ["B", "C", "D"]) {
      await api()
        .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
        .set(auth(s.token))
        .send({ label, price: 90_000 })
        .expect(201);
    }

    const refused = await api()
      .post(`/api/organizer/tiers/${s.tierId}/restore`)
      .set(auth(s.token))
      .expect(409);
    expect(refused.body.error).toBe("tier_limit_reached");
    expect((await tierRow(s.tierId)).archived_at).not.toBeNull();

    // Free a slot and the same restore now succeeds — archiving is a shelf, not a delete.
    const victim = (await pool.query(`SELECT id FROM ticket_tiers WHERE label = 'D'`)).rows[0].id;
    await api().delete(`/api/organizer/tiers/${victim}`).set(auth(s.token)).expect(200);

    const ok = await api()
      .post(`/api/organizer/tiers/${s.tierId}/restore`)
      .set(auth(s.token))
      .expect(200);
    expect(ok.body.tier.archived).toBe(false);
    expect((await tierRow(s.tierId)).archived_at).toBeNull();
  });

  it("reports live sold/held/remaining per tier so a refusal can be anticipated (FR-009)", async () => {
    const s = await makeStudio({ sold: 12, reserved: 3, capacity: 100 });
    const res = await api()
      .get(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .expect(200);

    expect(res.body.eventType).toBe("general_admission");
    expect(res.body.tiers[0]).toMatchObject({ capacity: 100, sold: 12, held: 3, remaining: 85 });
  });

  it("reports seated capacity as null and derives counts from the seat map (FR-005, FR-009)", async () => {
    const s = await makeSeatedStudio();
    await setSeatStatus(s.seatIds[0], "sold");
    await setSeatStatus(s.seatIds[1], "held");

    const res = await api()
      .get(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .expect(200);
    expect(res.body.eventType).toBe("seated");
    expect(res.body.tiers[0]).toMatchObject({ capacity: null, sold: 1, held: 1, remaining: 1 });
  });

  it("counts seated inventory per tier, not per showtime (FR-009)", async () => {
    const s = await makeSeatedStudio();
    const second = await seedTier(s.showtimeId, { label: "Hạng hai", total: null });
    const moreSeats = await attachSeatMap(s.showtimeId, s.venueId, second, 2);
    await setSeatStatus(moreSeats[0], "sold");

    const res = await api()
      .get(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .expect(200);
    const bySeatTier = Object.fromEntries(
      res.body.tiers.map((t: { id: number; sold: number }) => [t.id, t.sold]),
    );
    expect(bySeatTier[s.tierId]).toBe(0);
    expect(bySeatTier[second]).toBe(1);
  });
});
