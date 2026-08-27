import { describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeAdmin, registerUser } from "../helpers/authFixture.js";
import { seedTier } from "../helpers/catalogSeed.js";
import { api, auth, eventStatusOf, makeStudio, moderationOf, type Studio } from "./helpers.js";

/**
 * UC-24 A6 (US3). This is a SECURITY story, not a convenience one.
 *
 * Feature 002 built a pre-publish moderation gate. Without this rule the gate is bypassable end to
 * end: get an innocuous empty shell approved, then edit it into whatever you actually wanted to
 * publish, and no moderator ever sees the result. A gate that can be walked around is not a gate.
 */

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

/** Every organizer write endpoint, with a minimal valid payload and its expected moderation outcome. */
interface Case {
  name: string;
  material: boolean;
  run: (s: Studio) => Promise<unknown>;
}

const CASES: Case[] = [
  {
    name: "event title",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .send({ title: "Tên mới" })
        .expect(200),
  },
  {
    name: "event description",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .send({ description: "Mô tả mới" })
        .expect(200),
  },
  {
    name: "event image",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .send({ imageUrl: "https://img/y.jpg" })
        .expect(200),
  },
  {
    name: "event refund policy",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .send({ refundPolicy: "Không hoàn" })
        .expect(200),
  },
  {
    name: "event age restriction",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .send({ ageRestriction: "18+" })
        .expect(200),
  },
  {
    name: "tier label",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/tiers/${s.tierId}`)
        .set(auth(s.token))
        .send({ label: "Hạng mới" })
        .expect(200),
  },
  {
    name: "tier price",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/tiers/${s.tierId}`)
        .set(auth(s.token))
        .send({ price: 321_000 })
        .expect(200),
  },
  {
    name: "tier add",
    material: true,
    run: (s) =>
      api()
        .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
        .set(auth(s.token))
        .send({ label: "Thêm", price: 10_000 })
        .expect(201),
  },
  {
    name: "tier remove",
    material: true,
    run: async (s) => {
      await seedTier(s.showtimeId, { label: "Còn lại" });
      return api().delete(`/api/organizer/tiers/${s.tierId}`).set(auth(s.token)).expect(200);
    },
  },
  {
    name: "showtime reschedule",
    material: true,
    run: (s) =>
      api()
        .patch(`/api/organizer/showtimes/${s.showtimeId}`)
        .set(auth(s.token))
        .send({ startsAt: iso(9 * 86_400_000) })
        .expect(200),
  },
  {
    name: "showtime create (venue stays bound to the event)",
    material: true,
    run: async (s) => {
      return api()
        .post(`/api/organizer/events/${s.eventId}/showtimes`)
        .set(auth(s.token))
        .send({ venueId: s.venueId, startsAt: iso(9 * 86_400_000), tiers: [{ label: "Vé mới", price: 100000 }] })
        .expect(201);
    },
  },
  {
    name: "showtime remove",
    material: true,
    run: (s) =>
      api().delete(`/api/organizer/showtimes/${s.showtimeId}`).set(auth(s.token)).expect(200),
  },
  // The one exemption: inventory count cannot misrepresent an event to a buyer.
  {
    name: "tier capacity (the ONLY exemption)",
    material: false,
    run: (s) =>
      api()
        .patch(`/api/organizer/tiers/${s.tierId}`)
        .set(auth(s.token))
        .send({ capacity: 250 })
        .expect(200),
  },
];

describe("re-moderation on material edit", () => {
  it.each(CASES.map((c) => [c.name, c] as const))(
    "editing %s on an approved event → the expected moderation state (SC-009, FR-021)",
    async (_name, testCase) => {
      const s = await makeStudio({ moderation: "approved", status: "on_sale" });
      expect(await moderationOf(s.eventId)).toBe("approved");

      await testCase.run(s);

      expect(await moderationOf(s.eventId)).toBe(testCase.material ? "pending_review" : "approved");
      // The on-sale lifecycle is never touched: a return to review removes the listing from
      // discovery, it does not cancel anything (FR-024).
      expect(await eventStatusOf(s.eventId)).toBe("on_sale");
    },
  );

  it("disappears from catalog, search and its own page on the VERY NEXT request (SC-008, FR-022)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });

    const before = await request(app).get("/api/events").expect(200);
    expect(before.body.events.some((e: { slug: string }) => e.slug === s.slug)).toBe(true);
    await request(app).get(`/api/events/${s.slug}`).expect(200);

    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Tên đã sửa" })
      .expect(200);

    const after = await request(app).get("/api/events").expect(200);
    expect(after.body.events.some((e: { slug: string }) => e.slug === s.slug)).toBe(false);
    await request(app).get(`/api/events/${s.slug}`).expect(404);
    const searched = await request(app)
      .get("/api/events?q=" + encodeURIComponent("Tên đã sửa"))
      .expect(200);
    expect(searched.body.events.some((e: { slug: string }) => e.slug === s.slug)).toBe(false);

    // …and returns only when an admin re-approves.
    const admin = await registerUser();
    await makeAdmin(admin.userId);
    await request(app)
      .post(`/api/admin/events/${s.eventId}/approve`)
      .set(bearer(admin.token))
      .expect(200);

    const restored = await request(app).get("/api/events").expect(200);
    expect(restored.body.events.some((e: { slug: string }) => e.slug === s.slug)).toBe(true);
  });

  it("carries a reason the organizer and the admin queue can both read (FR-025)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });
    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Sửa" })
      .expect(200);

    const mine = await api().get("/api/organizer/events").set(auth(s.token)).expect(200);
    const row = mine.body.find((e: { id: number }) => e.id === s.eventId);
    expect(row.moderation).toBe("pending_review");
    expect(row.reviewNote).toContain("chỉnh sửa");

    const admin = await registerUser();
    await makeAdmin(admin.userId);
    const queue = await request(app)
      .get("/api/admin/moderation")
      .set(bearer(admin.token))
      .expect(200);
    expect(queue.body.some((e: { id: number }) => e.id === s.eventId)).toBe(true);
  });

  it.each([["pending_review"], ["flagged"], ["removed"]])(
    "leaves a %s event’s moderation state alone — only an admin moves those (FR-025)",
    async (state) => {
      const s = await makeStudio({ moderation: state, status: "on_sale" });
      await api()
        .patch(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .send({ title: "Sửa" })
        .expect(200);
      expect(await moderationOf(s.eventId)).toBe(state);
    },
  );

  it("changes NO inventory: holds, expiries and sold counts survive intact (SC-010, FR-024)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale", sold: 5 });

    const buyer = await registerUser();
    await request(app)
      .post("/api/reservations")
      .set(bearer(buyer.token))
      .send({ showtimeId: s.showtimeId, ticketTierId: s.tierId, quantity: 2 })
      .expect(201);

    const snapshot = async () =>
      (
        await pool.query(
          `SELECT r.id, r.status, r.expires_at, ri.quantity, ri.unit_price_amount, tt.sold_quantity, tt.reserved_quantity
             FROM reservations r
             JOIN reservation_items ri ON ri.reservation_id = r.id
             JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
            WHERE r.showtime_id = $1 ORDER BY r.id`,
          [s.showtimeId],
        )
      ).rows;

    const before = await snapshot();
    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Sửa nội dung" })
      .expect(200);

    expect(await snapshot()).toEqual(before);
    expect(await moderationOf(s.eventId)).toBe("pending_review");
  });

  it("a REFUSED edit does not change the moderation state (US3 scenario 7, FR-019)", async () => {
    // A rejected edit must not be able to pull a live event from the catalog.
    const s = await makeStudio({
      moderation: "approved",
      status: "on_sale",
      sold: 12,
      reserved: 3,
      capacity: 100,
    });

    await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 1 })
      .expect(409);
    expect(await moderationOf(s.eventId)).toBe("approved");

    await api().delete(`/api/organizer/showtimes/${s.showtimeId}`).set(auth(s.token)).expect(409);
    expect(await moderationOf(s.eventId)).toBe("approved");

    await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ startsAt: iso(-1000) })
      .expect(400);
    expect(await moderationOf(s.eventId)).toBe("approved");
  });

  it("reports returnedToReview so the console can say what happened (FR-042 depends on it)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });

    const material = await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ price: 111_000 })
      .expect(200);
    expect(material.body.returnedToReview).toBe(true);

    const exempt = await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 300 })
      .expect(200);
    expect(exempt.body.returnedToReview).toBe(false);
  });
});
