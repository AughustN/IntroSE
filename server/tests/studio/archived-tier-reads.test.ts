import { describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { registerUser, bearer } from "../helpers/authFixture.js";
import { seedTier } from "../helpers/catalogSeed.js";
import { api, auth, makeStudio } from "./helpers.js";

/**
 * Archiving must bite everywhere a tier can be reached, not only where it is displayed
 * (contracts/catalog-read-impact.md).
 *
 * These assertions live against feature 002's and 003's behaviour on purpose: that is where the
 * behaviour lives, so a future change to those reads fails here rather than silently re-offering a
 * retired tier.
 */

async function archive(s: {
  token: string;
  tierId: number;
  showtimeId: number;
  eventId: number;
}): Promise<void> {
  // Keep a second tier so the sold one is not the showtime's last active tier.
  await seedTier(s.showtimeId, { label: "Còn bán", price: 90_000 });
  await api().delete(`/api/organizer/tiers/${s.tierId}`).set(auth(s.token)).expect(200);
  // Archiving is a material edit, so the event has just gone back to pending_review and left the
  // public catalog (FR-021). Re-approve it the way an admin would, so what these cases observe is the
  // ARCHIVE rule and not the re-moderation rule — the latter is pinned in re-moderation.test.ts.
  await pool.query(`UPDATE events SET moderation_status = 'approved' WHERE id = $1`, [s.eventId]);
}

describe("archived tiers disappear from buyer-facing reads", () => {
  it("is absent from the public event detail payload (#1, FR-006)", async () => {
    const s = await makeStudio({ sold: 2 });
    await pool.query(`UPDATE ticket_tiers SET label = 'Đã ngừng bán' WHERE id = $1`, [s.tierId]);
    await archive(s);

    const res = await request(app).get(`/api/events/${s.slug}`).expect(200);
    const labels = res.body.tiers.map((t: { label: string }) => t.label);
    expect(labels).not.toContain("Đã ngừng bán");
    expect(labels).toContain("Còn bán");
  });

  it("does not keep a showtime looking available when it is the only tier (#2)", async () => {
    // A sold-out-by-archive showtime must not advertise availability, or the buyer lands on a dead end.
    const s = await makeStudio({ sold: 2 });
    await archive(s);
    // Now retire the replacement too, leaving nothing purchasable.
    const other = (
      await pool.query(
        `SELECT id FROM ticket_tiers WHERE showtime_id = $1 AND archived_at IS NULL`,
        [s.showtimeId],
      )
    ).rows[0].id;
    await pool.query(`UPDATE ticket_tiers SET archived_at = now() WHERE id = $1`, [other]);

    const res = await request(app).get("/api/events").expect(200);
    const found = res.body.events.find((e: { slug: string }) => e.slug === s.slug);
    // Either dropped from the list or shown as sold out — never as freely available.
    expect(found === undefined || found.soldOut === true).toBe(true);
  });

  it("refuses a NEW general-admission hold against an archived tier (#3, FR-006)", async () => {
    // The one that matters: excluding it from the catalog makes it invisible, not unpurchasable. A
    // stale tab still carries the id.
    const s = await makeStudio({ sold: 2 });
    await archive(s);

    const buyer = await registerUser();
    const res = await request(app)
      .post("/api/reservations")
      .set(bearer(buyer.token))
      .send({ showtimeId: s.showtimeId, ticketTierId: s.tierId, quantity: 1 })
      .expect(422);

    expect(res.body.error).toBe("tier_archived");
  });

  it("lets a hold placed BEFORE the archive stand (#3)", async () => {
    // Archiving stops new purchases; it never disturbs live hold state, which feature 003 owns.
    const s = await makeStudio();
    await seedTier(s.showtimeId, { label: "Còn bán", price: 90_000 });

    const buyer = await registerUser();
    const held = await request(app)
      .post("/api/reservations")
      .set(bearer(buyer.token))
      .send({ showtimeId: s.showtimeId, ticketTierId: s.tierId, quantity: 2 })
      .expect(201);
    const reservationId = held.body.reservation?.id ?? held.body.id;

    await pool.query(`UPDATE ticket_tiers SET archived_at = now() WHERE id = $1`, [s.tierId]);

    const after = await pool.query(
      `SELECT r.status, ri.quantity, ri.unit_price_amount
         FROM reservations r JOIN reservation_items ri ON ri.reservation_id = r.id
        WHERE r.id = $1`,
      [reservationId],
    );
    expect(after.rows[0].status).toBe("active");
    expect(after.rows[0].quantity).toBe(2);
  });

  it("stays visible to its organizer, flagged, so it can be restored (#4, FR-009)", async () => {
    const s = await makeStudio({ sold: 2 });
    await archive(s);

    const res = await api()
      .get(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .expect(200);
    const archived = res.body.tiers.find((t: { id: number }) => t.id === s.tierId);
    expect(archived).toBeDefined();
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).not.toBeNull();
  });
});
