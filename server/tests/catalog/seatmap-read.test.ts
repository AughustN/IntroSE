import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import * as seed from "../helpers/catalogSeed.js";

describe("showtimes & read-only seat map (US3)", () => {
  it("returns a seated seat map with row/number/tier/status and integer price (FR-010)", async () => {
    const { showtimeId, seatCount } = await seed.seedSeatedEventWithMap();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(res.body.eventType).toBe("seated");
    expect(res.body.seats).toHaveLength(seatCount);
    expect(res.body.seats[0]).toMatchObject({ row: "A", tier: "VIP", status: "available" });
    expect(Number.isInteger(res.body.seats[0].price)).toBe(true);
  });

  // --- feature 005: the buyer read now carries geometry (contracts/seatmap-read-contract.md) ---

  it("carries seat geometry, the coordinate space and the section name (FR-008, FR-038)", async () => {
    const { showtimeId } = await seed.seedSeatedEventWithMap();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);

    expect(res.body.space).toMatchObject({ width: 30_000, height: 30_000, seatDiameter: 100 });
    for (const seat of res.body.seats) {
      expect(Number.isInteger(seat.x)).toBe(true);
      expect(Number.isInteger(seat.y)).toBe(true);
      expect(seat.x).toBeGreaterThanOrEqual(0);
      expect(seat.x).toBeLessThanOrEqual(30_000);
      expect(seat.rotation).toBeGreaterThanOrEqual(0);
      expect(seat.rotation).toBeLessThan(360);
      expect(seat.section).toBe("Khu A");
      // FR-046 / STD-03: money stays a whole VND integer through the geometry rewrite.
      expect(Number.isInteger(seat.price)).toBe(true);
    }
    // Distinct positions — not every seat stacked at the origin.
    expect(new Set(res.body.seats.map((s: { x: number }) => s.x)).size).toBeGreaterThan(1);
  });

  it("orders seats section → row → number, which IS the buyer map tab order (FR-039a)", async () => {
    const { showtimeId } = await seed.seedSeatedEventWithMap();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    const key = (s: { section: string | null; row: string; number: number }) =>
      `${s.section ?? ""}|${s.row}|${String(s.number).padStart(5, "0")}`;
    const keys = res.body.seats.map(key);
    expect(keys).toEqual([...keys].sort());
  });

  it("omits the floor plan unless the organizer made it buyer-visible (FR-026)", async () => {
    const { showtimeId } = await seed.seedSeatedEventWithMap();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    // Default is off, so the buyer payload carries no plan at all.
    expect(res.body.floorPlan).toBeNull();
    expect(Array.isArray(res.body.elements)).toBe(true);
  });

  it("exposes standing capacity zones as quantity tiers on a seated map (0027)", async () => {
    const { showtimeId } = await seed.seedSeatedEventWithMap();
    // The map's seat tier is seat-backed (null total) and must not double as a zone; the zone is a
    // separate tier with a headcount, sold by quantity like GA.
    await seed.seedTier(showtimeId, { label: "Vé đứng", price: 250_000, total: 200, reserved: 30 });

    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(res.body.eventType).toBe("seated");
    expect(res.body.zoneTiers).toEqual([
      { id: expect.any(Number), label: "Vé đứng", price: 250_000, remaining: 170 },
    ]);
  });

  it("returns an empty zone list when the seated chart has no capacity zone", async () => {
    const { showtimeId } = await seed.seedSeatedEventWithMap();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(res.body.zoneTiers).toEqual([]);
  });

  it("adds nothing to the general-admission path (US2 scenario 5)", async () => {
    const { showtimeId } = await seed.seedVisibleGaEvent();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(res.body.seats).toBeUndefined();
    expect(res.body.space).toBeUndefined();
    expect(res.body.elements).toBeUndefined();
  });

  it("returns GA tier remaining (FR-011)", async () => {
    const { showtimeId } = await seed.seedVisibleGaEvent();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(res.body.eventType).toBe("general_admission");
    expect(res.body.tiers[0].remaining).toBe(100);
  });

  it("lists upcoming showtimes with availability (FR-007/013)", async () => {
    const { eventId } = await seed.seedVisibleGaEvent();
    const res = await request(app).get(`/api/events/${eventId}/showtimes`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].availability).toBe("available");
  });

  it("404s the seat map of a hidden (draft) event — no leak (SC-004)", async () => {
    const org = await seed.seedOrganizer(await seed.seedUser());
    const venue = await seed.seedVenue(await seed.seedUser());
    const ev = await seed.seedEvent({
      organizerId: org,
      status: "draft",
      moderation: "pending_review",
    });
    const st = await seed.seedShowtime(ev.id, venue);
    await request(app).get(`/api/showtimes/${st}/seat-map`).expect(404);
  });
});
