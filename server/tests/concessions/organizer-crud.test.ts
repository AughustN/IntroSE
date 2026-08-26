import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import * as seed from "../helpers/catalogSeed.js";

/*
 * Feature 014 US2 — the organizer manages their event's snack menu over the API.
 *
 * Every rule here is enforced server-side: ownership comes from events.organizer_id, never from
 * what the client claims; an edit reaches only future purchases; and delete is refused the moment
 * history references the item.
 */

const listUrl = (eventId: number) => `/api/organizer/events/${eventId}/concessions`;
const itemUrl = (eventId: number, itemId: number) => `${listUrl(eventId)}/${itemId}`;

/** A visible GA event with one upcoming showtime + tier and its approved organizer. */
async function seedScenario() {
  const organizerUser = await registerUser();
  const organizerId = await makeApprovedOrganizer(organizerUser.userId);
  const venue = await seed.seedVenue(organizerUser.userId);
  const event = await seed.seedEvent({ organizerId });
  const showtimeId = await seed.seedShowtime(event.id, venue);
  await seed.seedTier(showtimeId, { total: 50, price: 250_000 });
  return { organizerUser, eventId: event.id };
}

async function seedItem(eventId: number, label: string, price: number): Promise<number> {
  const { rows } = await poolInsert(eventId, label, price);
  return rows[0].id;
}

function poolInsert(eventId: number, label: string, price: number) {
  // Small indirection so both helpers share one INSERT shape.
  return import("../../src/db/pool.js").then(({ pool }) =>
    pool.query<{ id: number }>(
      `INSERT INTO concession_items (event_id, label, price_amount) VALUES ($1, $2, $3) RETURNING id`,
      [eventId, label, price],
    ),
  );
}

describe("POST /api/organizer/events/:eventId/concessions", () => {
  it("creates a listed item and returns it", async () => {
    const s = await seedScenario();

    const res = await request(app)
      .post(listUrl(s.eventId))
      .set(bearer(s.organizerUser.token))
      .send({ label: "Bắp rang bơ", description: "Vừa", priceAmount: 50_000 })
      .expect(201);

    expect(res.body.item).toMatchObject({
      eventId: s.eventId,
      label: "Bắp rang bơ",
      description: "Vừa",
      priceAmount: 50_000,
      state: "listed",
    });
  });

  it("refuses a negative or non-integer price with invalid_price", async () => {
    const s = await seedScenario();

    for (const priceAmount of [-1, 10.5]) {
      const res = await request(app)
        .post(listUrl(s.eventId))
        .set(bearer(s.organizerUser.token))
        .send({ label: "Bắp", priceAmount });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("invalid_price");
    }
  });

  it("answers a non-owner organizer with not_owner and hides existence behind not_found", async () => {
    const s = await seedScenario();
    const stranger = await registerUser();
    await makeApprovedOrganizer(stranger.userId);

    const denied = await request(app)
      .post(listUrl(s.eventId))
      .set(bearer(stranger.token))
      .send({ label: "Chôm", priceAmount: 1_000 })
      .expect(403);
    expect(denied.body.error).toBe("not_owner");

    const missing = await request(app)
      .post(listUrl(999_999_999))
      .set(bearer(s.organizerUser.token))
      .send({ label: "Bắp", priceAmount: 1_000 })
      .expect(404);
    expect(missing.body.error).toBe("not_found");
  });

  it("refuses an account that is not an organizer at all", async () => {
    const s = await seedScenario();
    const plain = await registerUser();

    const res = await request(app)
      .post(listUrl(s.eventId))
      .set(bearer(plain.token))
      .send({ label: "Bắp", priceAmount: 1_000 })
      .expect(403);

    expect(res.body.error).toBe("forbidden");
  });
});

describe("PUT /api/organizer/events/:eventId/concessions/:concessionId", () => {
  it("edits label and price wholesale and future carts see the new price", async () => {
    const s = await seedScenario();
    const itemId = await seedItem(s.eventId, "Nước suối", 10_000);

    const res = await request(app)
      .put(itemUrl(s.eventId, itemId))
      .set(bearer(s.organizerUser.token))
      .send({ label: "Nước suối 500ml", description: null, priceAmount: 15_000 })
      .expect(200);

    expect(res.body.item).toMatchObject({
      id: itemId,
      label: "Nước suối 500ml",
      description: null,
      priceAmount: 15_000,
    });

    // The buyer-facing menu serves the edited row immediately — the cart reprices live.
    const menu = await request(app).get(`/api/catalog/events/${s.eventId}/concessions`).expect(200);
    expect(menu.body.items[0]).toMatchObject({ id: itemId, priceAmount: 15_000 });
  });

  it("refuses an item that belongs to a different event", async () => {
    const s = await seedScenario();
    const otherEvent = await seed.seedEvent({
      organizerId: await seed.seedOrganizer(await seed.seedUser()),
    });
    const foreignItem = await seedItem(otherEvent.id, "Món nơi khác", 5_000);

    const res = await request(app)
      .put(itemUrl(s.eventId, foreignItem))
      .set(bearer(s.organizerUser.token))
      .send({ label: "Đổi tên", priceAmount: 6_000 })
      .expect(404);

    expect(res.body.error).toBe("concession_unavailable");
  });
});

describe("PATCH /api/organizer/events/:eventId/concessions/:concessionId", () => {
  it("stops selling immediately and can re-list later", async () => {
    const s = await seedScenario();
    const itemId = await seedItem(s.eventId, "Bắp caramel", 60_000);

    const stopped = await request(app)
      .patch(itemUrl(s.eventId, itemId))
      .set(bearer(s.organizerUser.token))
      .send({ state: "stopped" })
      .expect(200);
    expect(stopped.body.item.state).toBe("stopped");

    // Gone from every buyer-facing read the moment the state flips (FR-010).
    const menu = await request(app).get(`/api/catalog/events/${s.eventId}/concessions`).expect(200);
    expect(menu.body.items).toHaveLength(0);

    const relisted = await request(app)
      .patch(itemUrl(s.eventId, itemId))
      .set(bearer(s.organizerUser.token))
      .send({ state: "listed" })
      .expect(200);
    expect(relisted.body.item.state).toBe("listed");

    const again = await request(app).get(`/api/catalog/events/${s.eventId}/concessions`).expect(200);
    expect(again.body.items).toHaveLength(1);
  });
});

describe("DELETE /api/organizer/events/:eventId/concessions/:concessionId", () => {
  it("deletes outright when nothing ever referenced it", async () => {
    const s = await seedScenario();
    const itemId = await seedItem(s.eventId, "Khoai lang chiên", 25_000);

    await request(app)
      .delete(itemUrl(s.eventId, itemId))
      .set(bearer(s.organizerUser.token))
      .expect(204);

    const list = await request(app)
      .get(listUrl(s.eventId))
      .set(bearer(s.organizerUser.token))
      .expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it("refuses with concession_in_use once a cart has touched it", async () => {
    const s = await seedScenario();
    const itemId = await seedItem(s.eventId, "Trà tắc", 12_000);

    // Someone picked it up — the row is now part of reservation history.
    const buyer = await registerUser();
    const showtimeRow = await import("../../src/db/pool.js").then(({ pool }) =>
      pool.query<{ id: number }>(
        `SELECT id FROM showtimes WHERE event_id = $1 ORDER BY id LIMIT 1`,
        [s.eventId],
      ),
    );
    const tierRow = await import("../../src/db/pool.js").then(({ pool }) =>
      pool.query<{ id: number }>(
        `SELECT id FROM ticket_tiers WHERE showtime_id = $1 ORDER BY id LIMIT 1`,
        [showtimeRow.rows[0].id],
      ),
    );
    const reservation = await request(app)
      .post("/api/reservations")
      .set(bearer(buyer.token))
      .send({ showtimeId: showtimeRow.rows[0].id, ticketTierId: tierRow.rows[0].id, quantity: 1 })
      .expect(201);
    await request(app)
      .put(`/api/reservations/${reservation.body.id}/concessions`)
      .set(bearer(buyer.token))
      .send({ items: [{ concessionItemId: itemId, quantity: 2 }] })
      .expect(200);

    const res = await request(app)
      .delete(itemUrl(s.eventId, itemId))
      .set(bearer(s.organizerUser.token))
      .expect(409);
    expect(res.body.error).toBe("concession_in_use");

    // The way out is stopping sales, not deleting history.
    await request(app)
      .patch(itemUrl(s.eventId, itemId))
      .set(bearer(s.organizerUser.token))
      .send({ state: "stopped" })
      .expect(200);
  });
});

describe("GET /api/organizer/events/:eventId/concessions", () => {
  it("lists the owned menu including stopped items", async () => {
    const s = await seedScenario();
    await seedItem(s.eventId, "Còn bán", 10_000);
    const stopped = await seedItem(s.eventId, "Ngừng bán", 20_000);

    const res = await request(app)
      .get(listUrl(s.eventId))
      .set(bearer(s.organizerUser.token))
      .expect(200);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.find((i: { id: number }) => i.id === stopped)?.state).toBe("listed");
  });

  it("hides another organizer's menu behind not_found", async () => {
    const s = await seedScenario();
    const stranger = await registerUser();
    await makeApprovedOrganizer(stranger.userId);

    const res = await request(app)
      .get(listUrl(s.eventId))
      .set(bearer(stranger.token))
      .expect(403);
    expect(res.body.error).toBe("not_owner");
  });
});
