import { describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, auth, makeStudio, moderationOf, eventStatusOf, attachSeatMap } from "./helpers.js";

vi.mock("../../src/modules/media/eventMedia.js", () => ({
  uploadEventBanner: vi.fn(async () => "https://example.com/banner.webp"),
  uploadEventTrailer: vi.fn(async () => "https://example.com/trailer.mp4"),
  deleteEventTrailer: vi.fn(async () => undefined),
}));

describe("organizer workflow integrity", () => {
  it("saves the venue with the draft before any showtime exists", async () => {
    const s = await makeStudio();
    const created = await api()
      .post("/api/organizer/events")
      .set(auth(s.token))
      .send({
        title: "Bản nháp có địa điểm",
        description: "Mô tả",
        categoryCode: "music",
        eventType: "seated",
        venue: { name: "Địa điểm đã chọn", city: "Hà Nội", rawAddress: "123 Phố Huế" },
      })
      .expect(201);
    expect(created.body.venueId).toBeGreaterThan(0);
    const events = await api().get("/api/organizer/events").set(auth(s.token)).expect(200);
    expect(events.body.find((e: { id: number }) => e.id === created.body.id)).toMatchObject({
      venueId: created.body.venueId,
      venueName: "Địa điểm đã chọn",
      status: "draft",
    });
  });

  it("refuses past showtimes without writing and re-moderates a valid new showtime", async () => {
    const s = await makeStudio();
    const payload = {
      venueId: s.venueId,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      tiers: [{ label: "Vé", price: 100000 }],
    };
    await api()
      .post(`/api/organizer/events/${s.eventId}/showtimes`)
      .set(auth(s.token))
      .send(payload)
      .expect(400);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM showtimes WHERE event_id=$1`, [s.eventId]))
        .rows[0].n,
    ).toBe(1);
    expect(await moderationOf(s.eventId)).toBe("approved");
    const res = await api()
      .post(`/api/organizer/events/${s.eventId}/showtimes`)
      .set(auth(s.token))
      .send({ ...payload, startsAt: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);
    expect(res.body.returnedToReview).toBe(true);
    expect(await moderationOf(s.eventId)).toBe("pending_review");
  });

  it("requires every future seated showtime to have applied inventory, independent of source edits", async () => {
    const s = await makeStudio({
      status: "draft",
      moderation: "pending_review",
      eventType: "seated",
      capacity: null,
    });
    await api().post(`/api/organizer/events/${s.eventId}/publish`).set(auth(s.token)).expect(422);
    await attachSeatMap(s.showtimeId, s.venueId, s.tierId);
    // Source chart edits do not invalidate the already-copied showtime inventory.
    await pool.query(`UPDATE venue_layouts SET status='draft' WHERE venue_id=$1`, [s.venueId]);
    const next = await api()
      .post(`/api/organizer/events/${s.eventId}/showtimes`)
      .set(auth(s.token))
      .send({
        venueId: s.venueId,
        startsAt: new Date(Date.now() + 172800000).toISOString(),
        tiers: [{ label: "Vé", price: 100000 }],
      })
      .expect(201);
    await api().post(`/api/organizer/events/${s.eventId}/publish`).set(auth(s.token)).expect(422);
    await pool.query(`UPDATE showtimes SET status='cancelled' WHERE id=$1`, [next.body.id]);
    await api().post(`/api/organizer/events/${s.eventId}/publish`).set(auth(s.token)).expect(200);
  });

  it("cannot finish a future event, bypass moderation, or reopen terminal events", async () => {
    const s = await makeStudio();
    await api().post(`/api/organizer/events/${s.eventId}/complete`).set(auth(s.token)).expect(409);
    for (const state of ["flagged", "removed"]) {
      await pool.query(`UPDATE events SET moderation_status=$2 WHERE id=$1`, [s.eventId, state]);
      await api().post(`/api/organizer/events/${s.eventId}/publish`).set(auth(s.token)).expect(409);
      expect(await moderationOf(s.eventId)).toBe(state);
    }
    for (const status of ["cancelled", "finished"]) {
      await pool.query(`UPDATE events SET status=$2 WHERE id=$1`, [s.eventId, status]);
      for (const action of ["publish", "unpublish"]) {
        await api()
          .post(`/api/organizer/events/${s.eventId}/${action}`)
          .set(auth(s.token))
          .expect(409);
      }
      await api()
        .patch(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .send({ title: "Đổi tên" })
        .expect(409);
      await api()
        .post(`/api/organizer/events/${s.eventId}/showtimes`)
        .set(auth(s.token))
        .send({
          venueId: s.venueId,
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          tiers: [{ label: "Vé", price: 0 }],
        })
        .expect(409);
      expect(await eventStatusOf(s.eventId)).toBe(status);
    }
  });

  it("banner upload, trailer upload and removal all re-moderate the event", async () => {
    const s = await makeStudio();
    for (const field of ["banner", "trailer"]) {
      await pool.query(`UPDATE events SET moderation_status='approved' WHERE id=$1`, [s.eventId]);
      const res = await api()
        .post(`/api/organizer/events/${s.eventId}/${field}`)
        .set(auth(s.token))
        .attach(field, Buffer.from("mock media"), `${field}.bin`)
        .expect(200);
      expect(res.body.returnedToReview).toBe(true);
      expect(await moderationOf(s.eventId)).toBe("pending_review");
    }
    await pool.query(`UPDATE events SET moderation_status='approved' WHERE id=$1`, [s.eventId]);
    const removed = await api()
      .delete(`/api/organizer/events/${s.eventId}/trailer`)
      .set(auth(s.token))
      .expect(200);
    expect(removed.body.returnedToReview).toBe(true);
  });
});
