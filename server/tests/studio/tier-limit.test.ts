import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, auth, makeStudio } from "./helpers.js";

const tiers = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ label: `Hạng ${i + 1}`, price: (i + 1) * 100_000 }));

describe("20 active tiers per showtime", () => {
  it.each(["general_admission", "seated"] as const)(
    "creates 20 tiers for %s; refuses 0 or 21 without creating a partial showtime",
    async (eventType) => {
      const s = await makeStudio({ eventType });
      const url = `/api/organizer/events/${s.eventId}/showtimes`;
      const body = {
        venueId: s.venueId,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      };

      const limits = await api().get("/api/organizer/limits").set(auth(s.token)).expect(200);
      expect(limits.body.maxTiersPerShowtime).toBe(20);
      for (const count of [0, 21]) {
        await api()
          .post(url)
          .set(auth(s.token))
          .send({ ...body, tiers: tiers(count) })
          .expect(400);
      }
      const before = await api()
        .get(`/api/organizer/events/${s.eventId}/showtimes-manage`)
        .set(auth(s.token))
        .expect(200);
      expect(before.body).toHaveLength(1);

      const created = await api()
        .post(url)
        .set(auth(s.token))
        .send({ ...body, tiers: tiers(20) })
        .expect(201);
      const list = await api()
        .get(`/api/organizer/showtimes/${created.body.id}/tiers`)
        .set(auth(s.token))
        .expect(200);
      expect(list.body.tiers).toHaveLength(20);
      expect(list.body.tiers.map((t: { label: string }) => t.label)).toContain("Hạng 20");
      if (eventType === "seated") {
        expect(list.body.tiers.every((t: { capacity: number | null }) => t.capacity === null)).toBe(
          true,
        );
      }
    },
  );

  it("returns all 20 tiers to buyers and permits a hold on the twentieth", async () => {
    const s = await makeStudio();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity)
       SELECT $1, 'Hạng ' || n, n * 100000, 100 FROM generate_series(2, 20) AS n RETURNING id`,
      [s.showtimeId],
    );
    const lastId = rows[18].id;
    const detail = await api().get(`/api/events/${s.slug}`).expect(200);
    expect(detail.body.tiers).toHaveLength(20);
    const map = await api().get(`/api/showtimes/${s.showtimeId}/seat-map`).expect(200);
    expect(map.body.tiers).toHaveLength(20);
    expect(map.body.tiers).toContainEqual(
      expect.objectContaining({ id: lastId, label: "Hạng 20" }),
    );
    const hold = await api()
      .post("/api/reservations")
      .set(auth(s.token))
      .send({ showtimeId: s.showtimeId, ticketTierId: lastId, quantity: 1 })
      .expect(201);
    expect(hold.body).toBeDefined();
    const after = await api().get(`/api/showtimes/${s.showtimeId}/seat-map`).expect(200);
    expect(after.body.tiers.find((t: { id: number }) => t.id === lastId).remaining).toBe(99);
  });

  it.each(["add", "restore"] as const)(
    "serializes a concurrent add and %s competing for the last slot",
    async (otherOperation) => {
      const s = await makeStudio();
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, archived_at)
         SELECT $1, 'Hạng ' || n, 100000, 100, CASE WHEN n = 20 THEN now() ELSE NULL END
         FROM generate_series(2, 20) AS n RETURNING id`,
        [s.showtimeId],
      );
      const archivedId = rows[18].id;
      const add = (label: string) =>
        api()
          .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
          .set(auth(s.token))
          .send({ label, price: 100_000 });
      const other =
        otherOperation === "add"
          ? add("Thêm B")
          : api().post(`/api/organizer/tiers/${archivedId}/restore`).set(auth(s.token));
      const results = await Promise.all([add("Thêm A"), other]);
      expect(results.map((r) => r.status).sort()).toEqual(
        otherOperation === "add" ? [201, 409] : expect.arrayContaining([409]),
      );
      expect(results.filter((r) => r.status < 300)).toHaveLength(1);
      expect(results.find((r) => r.status === 409)!.body.error).toBe("tier_limit_reached");
      const list = await api()
        .get(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
        .set(auth(s.token))
        .expect(200);
      expect(list.body.tiers.filter((t: { archived: boolean }) => !t.archived)).toHaveLength(20);
    },
  );
});
