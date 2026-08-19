import { describe, it, expect } from "vitest";
import { computeEventStatus } from "../../src/services/organizerClient";

/**
 * What survives of the organizer mock-store suite.
 *
 * This file used to hold ten cases against `organizerClient`'s in-memory store. Nine of them failed —
 * on `main`, not from any change here — because `INITIAL_ORGANIZER_EVENTS` was emptied out of the
 * source ("Hardcoded mock seed dataset disabled & deleted"), so every case asking the store for a
 * seeded event got nothing and threw `NOT_FOUND`. They were not catching a regression; they asserted
 * against data that no longer exists, and their noise made a real failure in the same run easy to
 * miss.
 *
 * The functions they covered are mostly gone too: `getOrganizerEventDetail`, `requestPublication`,
 * `updateEventDetails`, `saveTicketTier`, `deleteOrArchiveTier` and `createOrganizerEvent` have no
 * caller left in the app, which now talks to the server for all of it.
 * `server/tests/studio/event-cancel.test.ts` covers cancellation against a real database, which is
 * what the mock version was only pretending to do.
 *
 * `computeEventStatus` is the exception, and the reason this file still exists: a pure function that
 * genuinely runs in production, inside `getOrganizerEvents`, which `AdPackagesPanel` still calls.
 */
type Event = Parameters<typeof computeEventStatus>[0];

describe("computeEventStatus", () => {
  it("infers Completed once endDatetime has passed", () => {
    const past = {
      eventId: "past-1",
      status: "published",
      endDatetime: "2020-01-01T00:00:00Z",
    } as Event;

    expect(computeEventStatus(past)).toBe("completed");
  });

  it("leaves a future published event alone", () => {
    const future = {
      eventId: "future-1",
      status: "published",
      endDatetime: "2099-01-01T00:00:00Z",
    } as Event;

    expect(computeEventStatus(future)).toBe("published");
  });

  it("does not call a stale draft completed — it was never running", () => {
    const staleDraft = {
      eventId: "draft-1",
      status: "draft",
      endDatetime: "2020-01-01T00:00:00Z",
    } as Event;

    expect(computeEventStatus(staleDraft)).toBe("draft");
  });
});
