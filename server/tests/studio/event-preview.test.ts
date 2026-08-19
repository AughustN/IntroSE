import { describe, expect, it } from "vitest";
import { api, auth, makeStudio } from "./helpers.js";

/**
 * Previewing an unpublished event.
 *
 * The point of the endpoint is that it bypasses `VISIBLE_WHERE` — so the cases that matter are the
 * ones proving the bypass stays behind the ownership guard, and that the public route it sits beside
 * is unchanged. A preview that leaked a rival's unannounced show would be a far worse bug than the
 * missing feature it replaced.
 */
describe("GET /api/organizer/events/:id/preview", () => {
  it("shows the owner their event before it is on sale", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });

    const res = await api()
      .get(`/api/organizer/events/${s.eventId}/preview`)
      .set(auth(s.token))
      .expect(200);

    expect(res.body.slug).toBe(s.slug);
    expect(res.body.title).toBeTruthy();
  });

  it("still 404s that same event on the public route", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });

    // The anti-leak control (SC-004) is untouched: the preview is an organizer-only door, not a
    // loosening of the public one.
    await api().get(`/api/events/${s.slug}`).expect(404);
  });

  it("does not let one organizer preview another's unpublished event", async () => {
    const mine = await makeStudio({ moderation: "pending_review", status: "draft" });
    const stranger = await makeStudio();

    await api()
      .get(`/api/organizer/events/${mine.eventId}/preview`)
      .set(auth(stranger.token))
      .expect(403);
  });

  it("refuses an anonymous caller", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });

    await api().get(`/api/organizer/events/${s.eventId}/preview`).expect(401);
  });
});
