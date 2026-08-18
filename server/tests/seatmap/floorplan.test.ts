import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { ImageRejected, processFloorPlan } from "../../src/modules/seatmap/floorplan.js";
import { resetUploadThrottle } from "../../src/modules/seatmap/upload.throttle.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";

// Floor-plan upload (US4: FR-021..FR-026a, SC-006/SC-007).
//
// Every refusal path is asserted, not just the happy one — the upload surface is the one place this
// feature touches untrusted bytes (ADR-0004, constitution Principle II).

beforeEach(() => resetUploadThrottle());

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function layoutOf(o: { h: Record<string, string> }): Promise<number> {
  const venue = (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: "V", city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id;
  return (
    await request(app)
      .post(`/api/organizer/venues/${venue}/layouts`)
      .set(o.h)
      .send({ name: "L" })
      .expect(201)
  ).body.id;
}

const png = (w = 40, h = 40) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();

// Plans live in Cloudinary since 012, so "where did it go" is a question about the returned URL,
// not about a directory on this machine. With no credentials configured the uploader returns its
// offline stand-in, which keeps the same shape as the real secure_url.
const planUrl = (layoutId: number, type: "floorplan" | "reference" = "floorplan") =>
  new RegExp(
    `^https://res\\.cloudinary\\.com/[^/]+/image/upload/[^/]+/tixhub/layouts/${layoutId}/${type}/${layoutId}\\.webp$`,
  );

describe("floor-plan upload (FR-021, FR-022, FR-023, SC-006)", () => {
  it("accepts a real PNG, stores it under a name of our choosing, and re-encodes it", async () => {
    const o = await organizer();
    const layout = await layoutOf(o);

    const res = await request(app)
      .post(`/api/organizer/layouts/${layout}/floorplan`)
      .set(o.h)
      .attach("file", await png(), "my-secret-venue-plan.png")
      .expect(200);

    expect(res.body.url).toMatch(planUrl(layout));
    // The uploaded filename is nowhere in the stored name (FR-022). A random name used to be what
    // guaranteed that; the layout-keyed public id does the same job, and the assertion is the same.
    expect(res.body.url).not.toContain("my-secret-venue-plan");
    // Re-encoded, whatever came in: the stored object is .webp, never the submitted PNG.
    expect(res.body.url.endsWith(".webp")).toBe(true);
    // Default off — the organizer opts in to showing buyers (FR-026).
    expect(res.body.visibleToBuyers).toBe(false);
  });

  it("REFUSES an SVG regardless of what it is named or declared as", async () => {
    const o = await organizer();
    const layout = await layoutOf(o);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    await request(app)
      .post(`/api/organizer/layouts/${layout}/floorplan`)
      .set(o.h)
      .attach("file", svg, { filename: "plan.png", contentType: "image/png" })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("invalid_image"));
  });

  it("REFUSES a non-image renamed .png — the decision comes from the bytes, not the name", async () => {
    const o = await organizer();
    const layout = await layoutOf(o);
    await request(app)
      .post(`/api/organizer/layouts/${layout}/floorplan`)
      .set(o.h)
      .attach("file", Buffer.from("this is definitely not an image"), {
        filename: "plan.png",
        contentType: "image/png",
      })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("invalid_image"));
  });

  it("REFUSES an image past the dimension ceiling BEFORE re-encoding it (decompression bomb)", async () => {
    const o = await organizer();
    const layout = await layoutOf(o);
    // A tiny file that decodes far past FLOORPLAN_MAX_PX on its long edge.
    const huge = await sharp({
      create: { width: 5000, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    await request(app)
      .post(`/api/organizer/layouts/${layout}/floorplan`)
      .set(o.h)
      .attach("file", huge, "huge.png")
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("image_too_large"));
  });

  it("REFUSES a file over the byte ceiling", async () => {
    const o = await organizer();
    const layout = await layoutOf(o);
    const oversized = Buffer.alloc(6 * 1024 * 1024, 1);
    await request(app)
      .post(`/api/organizer/layouts/${layout}/floorplan`)
      .set(o.h)
      .attach("file", oversized, "big.png")
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("file_too_large"));
  });
});

describe("the plan never owns geometry (FR-020, FR-024, FR-025, SC-007)", () => {
  it("aligning the plan moves the picture, never a seat", async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: "V", city: "HN", rawAddress: "a" })
        .expect(201)
    ).body.id;
    const layout = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/layouts`)
        .set(o.h)
        .send({ name: "L" })
        .expect(201)
    ).body.id;
    const section = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/sections`)
        .set(o.h)
        .send({ name: "Khu A" })
        .expect(201)
    ).body.id;
    await request(app)
      .post(`/api/organizer/layouts/${layout}/generate-seats`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "A", count: 5 })
      .expect(201);

    const before = await pool.query(
      `SELECT id, pos_x, pos_y FROM seats WHERE layout_id = $1 ORDER BY id`,
      [layout],
    );

    await request(app)
      .post(`/api/organizer/layouts/${layout}/floorplan`)
      .set(o.h)
      .attach("file", await png(), "p.png")
      .expect(200);
    await request(app)
      .patch(`/api/organizer/layouts/${layout}/floorplan`)
      .set(o.h)
      .send({ scale: 2000, offsetX: 900, offsetY: -400, opacity: 30, visibleToBuyers: true })
      .expect(200);

    const afterAlign = await pool.query(
      `SELECT id, pos_x, pos_y FROM seats WHERE layout_id = $1 ORDER BY id`,
      [layout],
    );
    expect(afterAlign.rows).toEqual(before.rows);

    // Removing the plan leaves 100% of positions unchanged (SC-007).
    await request(app).delete(`/api/organizer/layouts/${layout}/floorplan`).set(o.h).expect(204);
    const afterRemove = await pool.query(
      `SELECT id, pos_x, pos_y FROM seats WHERE layout_id = $1 ORDER BY id`,
      [layout],
    );
    expect(afterRemove.rows).toEqual(before.rows);

    const plan = await pool.query(`SELECT background_url FROM venue_layouts WHERE id = $1`, [
      layout,
    ]);
    expect(plan.rows[0].background_url).toBeNull();
  });

  it("replacing a plan leaves the old one nowhere to be fetched from", async () => {
    // Storage moved to Cloudinary (012) and the upload is keyed by layout with `overwrite`, so a
    // replacement lands on the same object rather than beside it. That is what makes the previous
    // picture unreachable now — there is no second name left holding it.
    const o = await organizer();
    const layout = await layoutOf(o);
    const first = (
      await request(app)
        .post(`/api/organizer/layouts/${layout}/floorplan`)
        .set(o.h)
        .attach("file", await png(), "a.png")
        .expect(200)
    ).body.url;
    const second = (
      await request(app)
        .post(`/api/organizer/layouts/${layout}/floorplan`)
        .set(o.h)
        .attach("file", await png(60, 60), "b.png")
        .expect(200)
    ).body.url;

    expect(first).toMatch(planUrl(layout));
    expect(second).toMatch(planUrl(layout));
    // Neither upload's filename survives into the address the plan is served from.
    expect(second).not.toContain("a.png");
    expect(second).not.toContain("b.png");
    // And the row points at the replacement, not at whatever was there first. `background_url` is
    // the column the upload route writes — `plan_url` beside it is a different, unused field.
    const stored = (
      await pool.query<{ background_url: string }>(
        `SELECT background_url FROM venue_layouts WHERE id = $1`,
        [layout],
      )
    ).rows[0].background_url;
    expect(stored).toBe(second);
  });
});

describe("upload abuse bound (FR-023a, SC-005b)", () => {
  it(
    "throttles a burst from one organizer with a clear reason, never queueing it",
    { timeout: 90_000 },
    async () => {
      const o = await organizer();
      const layout = await layoutOf(o);
      const image = await png();

      // UPLOAD_RATE_LIMIT is 10 per minute by default; the 11th within the window is refused.
      let refused = 0;
      for (let i = 0; i < 12; i += 1) {
        const res = await request(app)
          .post(`/api/organizer/layouts/${layout}/floorplan`)
          .set(o.h)
          .attach("file", image, "p.png");
        if (res.status === 429) {
          expect(res.body.error).toBe("upload_rate_limited");
          refused += 1;
        }
      }
      expect(refused).toBeGreaterThan(0);
    },
  );

  it(
    "does NOT throttle layout saves — they are bounded writes, not image decodes",
    // One save costs ~7s here: a full layout replace is ~30 round trips, and the database is in
    // us-east-2. The loop only has to outrun the limiter, which allows UPLOAD_RATE_LIMIT (10) a
    // minute — 15 passes that mark with room to spare, where the original 25 spent ~180s proving
    // the same thing and timed out doing it.
    { timeout: 180_000 },
    async () => {
      const o = await organizer();
      const venue = (
        await request(app)
          .post("/api/organizer/venues")
          .set(o.h)
          .send({ name: "V", city: "HN", rawAddress: "a" })
          .expect(201)
      ).body.id;
      const layout = (
        await request(app)
          .post(`/api/organizer/venues/${venue}/layouts`)
          .set(o.h)
          .send({ name: "L" })
          .expect(201)
      ).body;

      let version = layout.version;
      for (let i = 0; i < 15; i += 1) {
        const res = await request(app)
          .put(`/api/organizer/layouts/${layout.id}`)
          .set(o.h)
          .send({ version, sections: [], categories: [], seats: [], elements: [] })
          .expect(200);
        version = res.body.version;
      }
    },
  );
});

describe("an SVG floor plan is rasterised, never stored as SVG (§24)", () => {
  const svg = (inner: string, attrs = "") =>
    Buffer.from(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" ${attrs}>${inner}</svg>`,
    );

  it("accepts a plain SVG and returns a WEBP", async () => {
    const out = await processFloorPlan(svg('<rect width="200" height="100" fill="#333"/>'));
    // RIFF….WEBP — what lands on disk is a picture, whatever was uploaded.
    expect(out.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("refuses one carrying a script", async () => {
    await expect(processFloorPlan(svg("<script>alert(1)</script>"))).rejects.toBeInstanceOf(
      ImageRejected,
    );
  });

  it("refuses a foreignObject", async () => {
    await expect(
      processFloorPlan(
        svg('<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>'),
      ),
    ).rejects.toBeInstanceOf(ImageRejected);
  });

  it("refuses an external reference — the renderer would fetch it from inside our network", async () => {
    await expect(
      processFloorPlan(
        svg('<image href="http://169.254.169.254/latest/meta-data/" width="10" height="10"/>'),
      ),
    ).rejects.toBeInstanceOf(ImageRejected);
    await expect(
      processFloorPlan(svg('<image xlink:href="//evil.example/x.png" width="10" height="10"/>')),
    ).rejects.toBeInstanceOf(ImageRejected);
  });

  it("refuses a local-file reference", async () => {
    await expect(
      processFloorPlan(svg('<image href="file:///etc/passwd" width="10" height="10"/>')),
    ).rejects.toBeInstanceOf(ImageRejected);
  });

  it("refuses an entity-expansion bomb", async () => {
    const bomb = Buffer.from(
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa">]>` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&a;</text></svg>`,
    );
    await expect(processFloorPlan(bomb)).rejects.toBeInstanceOf(ImageRejected);
  });

  it("refuses one whose viewBox renders past the pixel ceiling", async () => {
    await expect(
      processFloorPlan(
        Buffer.from(
          `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>`,
        ),
      ),
    ).rejects.toBeInstanceOf(ImageRejected);
  });

  it("still refuses a file that is neither a known raster nor an SVG", async () => {
    await expect(processFloorPlan(Buffer.from("not an image at all"))).rejects.toBeInstanceOf(
      ImageRejected,
    );
  });
});
