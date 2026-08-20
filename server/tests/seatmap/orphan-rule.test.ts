import { describe, expect, it } from "vitest";
import { api, auth, makeStudio, type Studio } from "../studio/helpers.js";

/**
 * The chart-level orphan-seat rule (0037).
 *
 * "Best available" used to be free to strand a lone seat between two sold ones — the seat nobody
 * then buys. Whether that is worth preventing is a venue's judgement, so it is a property of the
 * chart. What matters here is that the setting is DURABLE and OWNED: it survives a read, only the
 * organizer who owns the chart can change it, and nothing outside the two allowed words gets in.
 *
 * Fixtures come from the studio helpers rather than a hand-rolled register-then-create-venue chain.
 * That chain is shared with `floorplan.test.ts`, which fails wholesale in this environment on `main`
 * too — inheriting its flakiness would make this suite untrustworthy about the very rule it exists
 * to pin down. `makeStudio` seeds the organizer and venue directly, and is stable.
 */
async function layoutOf(s: Studio): Promise<number> {
  const res = await api()
    .post(`/api/organizer/venues/${s.venueId}/layouts`)
    .set(auth(s.token))
    .send({ name: "L" })
    .expect(201);
  return res.body.id;
}

describe("PATCH /api/organizer/layouts/:id/orphan-rule", () => {
  it("defaults to balanced on a new chart", async () => {
    const s = await makeStudio();
    const id = await layoutOf(s);

    const res = await api().get(`/api/organizer/layouts/${id}`).set(auth(s.token)).expect(200);
    expect(res.body.orphanRule).toBe("balanced");
  });

  it("stores strict and reads it back", async () => {
    const s = await makeStudio();
    const id = await layoutOf(s);

    await api()
      .patch(`/api/organizer/layouts/${id}/orphan-rule`)
      .set(auth(s.token))
      .send({ orphanRule: "strict" })
      .expect(200);

    const res = await api().get(`/api/organizer/layouts/${id}`).set(auth(s.token)).expect(200);
    expect(res.body.orphanRule).toBe("strict");
  });

  it("refuses a value outside the two the picker understands", async () => {
    const s = await makeStudio();
    const id = await layoutOf(s);

    await api()
      .patch(`/api/organizer/layouts/${id}/orphan-rule`)
      .set(auth(s.token))
      .send({ orphanRule: "whatever" })
      .expect(400);

    const res = await api().get(`/api/organizer/layouts/${id}`).set(auth(s.token)).expect(200);
    expect(res.body.orphanRule).toBe("balanced");
  });

  it("does not let another organizer retune someone else's chart", async () => {
    const mine = await makeStudio();
    const id = await layoutOf(mine);
    const stranger = await makeStudio();

    await api()
      .patch(`/api/organizer/layouts/${id}/orphan-rule`)
      .set(auth(stranger.token))
      .send({ orphanRule: "strict" })
      .expect(403);

    const res = await api().get(`/api/organizer/layouts/${id}`).set(auth(mine.token)).expect(200);
    expect(res.body.orphanRule).toBe("balanced");
  });
});
