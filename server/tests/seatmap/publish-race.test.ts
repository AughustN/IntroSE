import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function publishableChart(o: { h: Record<string, string> }) {
  const venue = (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: `V${Date.now()}${Math.random()}`, city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id;
  const layoutId = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/layouts`)
      .set(o.h)
      .send({ name: "Sơ đồ" })
      .expect(201)
  ).body.id;
  const section = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/sections`)
      .set(o.h)
      .send({ layoutId, name: "Khu A" })
      .expect(201)
  ).body.id;
  await request(app)
    .post(`/api/organizer/layouts/${layoutId}/generate-seats`)
    .set(o.h)
    .send({ sectionId: section, rowLabel: "A", count: 4 })
    .expect(201);
  return { layoutId };
}

const read = (o: { h: Record<string, string> }, id: number) =>
  request(app).get(`/api/organizer/layouts/${id}`).set(o.h).expect(200);

/**
 * Publishing judges the version it was shown.
 *
 * Validation and the status flip were separate statements with nothing holding the row between them.
 * A second tab could save a new — and invalid — version in that gap, and the first tab still marked
 * the row ready, having validated a document that no longer existed.
 */
describe("publish refuses a verdict about a version that has moved on", () => {
  it("refuses when another save landed since the version the caller judged", async () => {
    const o = await organizer();
    const { layoutId } = await publishableChart(o);
    const seen = (await read(o, layoutId)).body;

    // Another tab saves. Same document, but the version advances — which is the whole signal.
    await request(app)
      .put(`/api/organizer/layouts/${layoutId}`)
      .set(o.h)
      .send({ version: seen.version, document: seen.document })
      .expect(200);

    const res = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/publish`)
      .set(o.h)
      .send({ expectedVersion: seen.version })
      .expect(409);
    expect(res.body.error).toBe("stale_version");

    // ...and the chart did NOT go on sale on the strength of the stale verdict.
    expect((await read(o, layoutId)).body.status).toBe("draft");
  });

  it("publishes when the caller names the version that is actually current", async () => {
    const o = await organizer();
    const { layoutId } = await publishableChart(o);
    const seen = (await read(o, layoutId)).body;

    const res = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/publish`)
      .set(o.h)
      .send({ expectedVersion: seen.version })
      .expect(200);
    expect(res.body.status).toBe("ready");
  });

  it("still publishes for a caller that names no version, unguarded as before", async () => {
    const o = await organizer();
    const { layoutId } = await publishableChart(o);
    const res = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/publish`)
      .set(o.h)
      .send({})
      .expect(200);
    expect(res.body.status).toBe("ready");
  });
});
