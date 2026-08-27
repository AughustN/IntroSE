// Integration only: run against an isolated TEST_DATABASE_URL; the shared suite truncates data.
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { AD_CAPACITY } from "../../src/modules/ads/ads.policy.js";
import { api, auth, makeStudio, type Studio } from "../studio/helpers.js";
import { seedEvent, seedShowtime } from "../helpers/catalogSeed.js";

async function setup() {
  const s = await makeStudio();
  await pool.query(`UPDATE showtimes SET starts_at=now()+interval '90 days' WHERE id=$1`, [
    s.showtimeId,
  ]);
  await pool.query(`UPDATE events SET trailer_url='https://example.test/trailer.mp4' WHERE id=$1`, [
    s.eventId,
  ]);
  await pool.query(`UPDATE wallets SET balance_amount=100000000 WHERE user_id=$1`, [s.userId]);
  const pkg = (await pool.query(`SELECT id FROM ad_packages WHERE code='featured'`)).rows[0];
  return { s, packageId: Number(pkg.id) };
}
async function anotherEvent(s: Studio) {
  const e = await seedEvent({ organizerId: s.organizerId });
  await seedShowtime(e.id, s.venueId, 90 * 86_400_000);
  await pool.query(`UPDATE events SET trailer_url='https://example.test/trailer.mp4' WHERE id=$1`, [
    e.id,
  ]);
  return e.id;
}
const buy = (s: Studio, packageId: number, eventId = s.eventId) =>
  api()
    .post("/api/organizer/ads/purchases")
    .set(auth(s.token))
    .send({ eventId, packageId, acceptedPolicy: "fair_v1" });
const agent = "Mozilla/5.0 fair-delivery-integration";

describe("fair advertising database invariants", () => {
  it("only charges one of two events competing for the final hero slot", async () => {
    const { s, packageId } = await setup();
    for (let i = 0; i < AD_CAPACITY.hero_trailer - 1; i++) {
      const id = await anotherEvent(s);
      await buy(s, packageId, id).expect(201);
    }
    const other = await anotherEvent(s);
    const before = (
      await pool.query(`SELECT balance_amount FROM wallets WHERE user_id=$1`, [s.userId])
    ).rows[0].balance_amount;
    const results = await Promise.all([buy(s, packageId), buy(s, packageId, other)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error).toBe("ad_capacity_full");
    const after = (
      await pool.query(`SELECT balance_amount FROM wallets WHERE user_id=$1`, [s.userId])
    ).rows[0].balance_amount;
    expect(before - after).toBe(results.find((r) => r.status === 201)?.body.price);
    const count = (
      await pool.query(`SELECT count(*)::int AS n FROM ad_purchases WHERE status='active'`)
    ).rows[0].n;
    expect(count).toBe(AD_CAPACITY.hero_trailer);
  }, 120_000);

  it("binds receipts to the visitor and counts concurrent impressions only once", async () => {
    const { s, packageId } = await setup();
    const bought = await buy(s, packageId).expect(201);
    const feed = await api().post("/api/ads/delivery").set("User-Agent", agent).expect(200);
    const receipt = feed.body.deliveries.find(
      (d: { placement: string }) => d.placement === "hero_trailer",
    );
    expect(receipt).toBeTruthy();
    await pool.query(
      `UPDATE ad_deliveries SET issued_at=clock_timestamp()-interval '2 seconds' WHERE token=$1`,
      [receipt.token],
    );
    const metric = (ua = agent) =>
      api()
        .post("/api/ads/metrics")
        .set("User-Agent", ua)
        .send({ token: receipt.token, kind: "impression" })
        .expect(204);
    await metric("Mozilla/5.0 different visitor");
    const totals = async () =>
      (
        await pool.query(
          `SELECT impressions FROM ad_delivery_stats WHERE purchase_id=$1 AND placement='hero_trailer'`,
          [bought.body.id],
        )
      ).rows[0].impressions;
    expect(await totals()).toBe(0);
    await Promise.all([metric(), metric(), metric()]);
    expect(await totals()).toBe(1);
    const replay = await api().post("/api/ads/delivery").set("User-Agent", agent).expect(200);
    expect(replay.body.deliveries).toHaveLength(2);
  }, 120_000);

  it("keeps legacy contracts out of fair delivery and refuses new sales for that placement", async () => {
    const { s, packageId } = await setup();
    const bought = await buy(s, packageId).expect(201);
    await pool.query(`UPDATE ad_purchases SET delivery_policy='legacy' WHERE id=$1`, [
      bought.body.id,
    ]);
    const feed = await api().post("/api/ads/delivery").set("User-Agent", agent).expect(200);
    expect(feed.body.legacy[0].eventId).toBe(s.eventId);
    expect(feed.body.deliveries).toEqual([]);
    const other = await anotherEvent(s);
    await buy(s, packageId, other).expect(409);
  }, 120_000);
});
