import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../helpers/app.js";
import { registerUser } from "../helpers/authFixture.js";
import { auth, makeOtherOrganizer, makeStudio, type Studio } from "./helpers.js";

/**
 * Cross-organizer access (SC-011, FR-035/FR-036).
 *
 * Written as a MATRIX over every endpoint this feature adds, so an endpoint added later without
 * ownership resolution fails here rather than shipping. Another organizer's resource is a refusal,
 * never a row the client could unfilter — hiding it in the UI is not access control (SEC-04).
 */

type Call = (s: Studio) => request.Test;

const ENDPOINTS: Array<{ name: string; call: Call }> = [
  {
    name: "GET showtime tiers",
    call: (s) => request(app).get(`/api/organizer/showtimes/${s.showtimeId}/tiers`),
  },
  {
    name: "POST showtime tiers",
    call: (s) =>
      request(app)
        .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
        .send({ label: "X", price: 1000 }),
  },
  {
    name: "PATCH tier",
    call: (s) => request(app).patch(`/api/organizer/tiers/${s.tierId}`).send({ price: 1000 }),
  },
  { name: "DELETE tier", call: (s) => request(app).delete(`/api/organizer/tiers/${s.tierId}`) },
  {
    name: "POST tier restore",
    call: (s) => request(app).post(`/api/organizer/tiers/${s.tierId}/restore`),
  },
  {
    name: "PATCH showtime",
    call: (s) =>
      request(app)
        .patch(`/api/organizer/showtimes/${s.showtimeId}`)
        .send({ startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }),
  },
  {
    name: "DELETE showtime",
    call: (s) => request(app).delete(`/api/organizer/showtimes/${s.showtimeId}`),
  },
  {
    name: "PATCH event",
    call: (s) => request(app).patch(`/api/organizer/events/${s.eventId}`).send({ title: "X" }),
  },
  { name: "DELETE event", call: (s) => request(app).delete(`/api/organizer/events/${s.eventId}`) },
];

describe("cross-organizer access is refused on every endpoint", () => {
  it.each(ENDPOINTS.map((e) => [e.name, e.call] as const))(
    "%s → 403 not_owner for a different organizer (SC-011)",
    async (_name, call) => {
      const s = await makeStudio();
      const other = await makeOtherOrganizer();

      const res = await call(s).set(auth(other.token));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("not_owner");
    },
  );

  it.each(ENDPOINTS.map((e) => [e.name, e.call] as const))(
    "%s → 401 without a session",
    async (_name, call) => {
      const s = await makeStudio();
      const res = await call(s);
      expect(res.status).toBe(401);
    },
  );

  it.each(ENDPOINTS.map((e) => [e.name, e.call] as const))(
    "%s → 403 for a signed-in NON-organizer (SEC-04)",
    async (_name, call) => {
      const s = await makeStudio();
      const attendee = await registerUser(); // no organizer row at all
      const res = await call(s).set(auth(attendee.token));
      expect(res.status).toBe(403);
    },
  );

  it("never leaks another organizer’s tiers as a filtered list — it refuses (FR-035)", async () => {
    const s = await makeStudio();
    const other = await makeOtherOrganizer();

    const res = await request(app)
      .get(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(other.token));
    expect(res.status).toBe(403);
    expect(res.body.tiers).toBeUndefined(); // not an empty array — a refusal
  });

  it("cannot be steered by a client-supplied organizer id (FR-037)", async () => {
    // The session identity is authoritative; nothing in the body can widen it.
    const s = await makeStudio();
    const other = await makeOtherOrganizer();

    const res = await request(app)
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(other.token))
      .send({ title: "X", organizerId: s.organizerId, userId: s.userId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_owner");
  });
});
