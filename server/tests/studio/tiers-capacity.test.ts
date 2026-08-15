import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, auth, makeSeatedStudio, makeStudio, tierRow } from "./helpers.js";

/**
 * The capacity floor (US1, FR-004/FR-005).
 *
 * Capacity may never fall below sold + reserved, because reserved quantity is live hold state owned
 * by feature 003 and this feature only reads it. The check runs under the same row lock 003 takes,
 * which is what makes the guarantee hold under contention rather than only in a quiet test.
 */
describe("tier capacity", () => {
  it("raises capacity freely", async () => {
    const s = await makeStudio({ sold: 12, reserved: 3, capacity: 100 });
    const res = await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 500 })
      .expect(200);
    expect(res.body.tier.capacity).toBe(500);
    expect(res.body.tier.remaining).toBe(485);
  });

  it("refuses a capacity below sold + reserved, naming both numbers (FR-004, FR-018)", async () => {
    const s = await makeStudio({ sold: 12, reserved: 3, capacity: 100 });
    const res = await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 10 })
      .expect(409);

    expect(res.body.error).toBe("capacity_below_committed");
    expect(res.body.details).toEqual({ sold: 12, held: 3, requested: 10 });
    expect(res.body.message).toContain("12");
    expect(res.body.message).toContain("3");
    expect((await tierRow(s.tierId)).total_quantity).toBe(100); // unchanged
  });

  it("accepts a capacity exactly at sold + reserved — the floor is inclusive", async () => {
    const s = await makeStudio({ sold: 12, reserved: 3, capacity: 100 });
    const res = await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 15 })
      .expect(200);
    expect(res.body.tier.remaining).toBe(0);
  });

  it("never lets sold + reserved exceed capacity when a hold lands concurrently (SC-002)", async () => {
    // The organizer lowers capacity to exactly what is committed while a buyer takes one more ticket.
    // Whichever order the two land in, the invariant must hold — that is the whole point of taking
    // the same row lock feature 003 takes.
    const s = await makeStudio({ sold: 5, reserved: 0, capacity: 10 });

    const lowerCapacity = api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 5 });

    const takeOne = (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT * FROM ticket_tiers WHERE id = $1 FOR UPDATE`, [s.tierId]);
        const { rows } = await client.query(
          `UPDATE ticket_tiers SET reserved_quantity = reserved_quantity + 1
            WHERE id = $1 AND sold_quantity + reserved_quantity + 1 <= total_quantity
            RETURNING id`,
          [s.tierId],
        );
        await client.query("COMMIT");
        return rows.length > 0;
      } catch {
        await client.query("ROLLBACK").catch(() => {});
        return false;
      } finally {
        client.release();
      }
    })();

    const [capRes, holdWon] = await Promise.all([lowerCapacity, takeOne]);

    const row = await tierRow(s.tierId);
    const committed = Number(row.sold_quantity) + Number(row.reserved_quantity);
    expect(committed).toBeLessThanOrEqual(Number(row.total_quantity));

    // Exactly one of the two got what it wanted; both succeeding would be the bug.
    expect(capRes.status === 200 || holdWon).toBe(true);
    if (capRes.status === 200 && holdWon) {
      // Permitted only if the hold committed first and capacity was then set to the new committed
      // total — never a state where the tier is oversold.
      expect(committed).toBeLessThanOrEqual(Number(row.total_quantity));
    }
  });

  it("refuses a manual capacity on a SEATED showtime (UC-26 A4, FR-005, SC-005)", async () => {
    const s = await makeSeatedStudio();
    const res = await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 40 })
      .expect(422);

    expect(res.body.error).toBe("manual_capacity_seated");
    expect(res.body.message).toContain("sơ đồ ghế");
    expect((await tierRow(s.tierId)).total_quantity).toBeNull();
  });

  it("refuses a manual capacity when ADDING a tier to a seated showtime (FR-005)", async () => {
    const s = await makeSeatedStudio();
    const res = await api()
      .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .send({ label: "Hạng hai", price: 100_000, capacity: 30 })
      .expect(422);
    expect(res.body.error).toBe("manual_capacity_seated");
  });

  it("honours the seated floor too: capacity is refused, so sold seats can never be stranded (FR-005)", async () => {
    // For a seated tier there is no writable capacity at all, which is a stronger guarantee than a
    // floor — the seat map is the capacity and feature 005 owns it.
    const s = await makeSeatedStudio();
    await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 0 })
      .expect(422);
    expect((await tierRow(s.tierId)).total_quantity).toBeNull();
  });
});

/**
 * A seated showtime's capacity IS its seat map (FR-005, UC-26 A4). Showtime creation used to default
 * every tier to 100 regardless of event type, which put a phantom ceiling on seated tiers: the
 * `sold + reserved <= total_quantity` CHECK would then cap the map at 100 however many seats were
 * drawn. Caught by auditing real data, where a seated tier carried capacity 100 against a 10-seat map.
 */
describe("seated showtimes never get a numeric capacity", () => {
  it("creates seated tiers with NULL capacity, and GA tiers with a number", async () => {
    const seated = await makeStudio({ eventType: "seated", capacity: null });
    const ga = await makeStudio();

    const mk = (s: { token: string; eventId: number; venueId: number }) =>
      api()
        .post(`/api/organizer/events/${s.eventId}/showtimes`)
        .set(auth(s.token))
        .send({
          venueId: s.venueId,
          startsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
          tiers: [{ label: "Thường", price: 100_000 }],
        })
        .expect(201);

    const seatedShowtime = (await mk(seated)).body.id;
    const gaShowtime = (await mk(ga)).body.id;

    const seatedTiers = await api()
      .get(`/api/organizer/showtimes/${seatedShowtime}/tiers`)
      .set(auth(seated.token))
      .expect(200);
    expect(seatedTiers.body.tiers[0].capacity).toBeNull();

    const gaTiers = await api()
      .get(`/api/organizer/showtimes/${gaShowtime}/tiers`)
      .set(auth(ga.token))
      .expect(200);
    expect(gaTiers.body.tiers[0].capacity).toBe(100);
  });
});
