import { expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, auth, makeStudio } from "../studio/helpers.js";

it("refuses past events before debit, and reports hidden campaigns without offering another purchase", async () => {
  const s = await makeStudio();
  const packages = await api().get("/api/ads/packages").expect(200);
  const pkg = packages.body[0];
  await pool.query(`UPDATE wallets SET balance_amount=$2 WHERE user_id=$1`, [
    s.userId,
    pkg.price * 3,
  ]);
  await pool.query(`UPDATE showtimes SET starts_at=now()-interval '1 hour' WHERE id=$1`, [
    s.showtimeId,
  ]);
  await api()
    .post("/api/organizer/ads/purchases")
    .set(auth(s.token))
    .send({ eventId: s.eventId, packageId: pkg.id, acceptedPolicy: "fair_v1" })
    .expect(409);
  expect(
    (await pool.query(`SELECT balance_amount::int AS n FROM wallets WHERE user_id=$1`, [s.userId]))
      .rows[0].n,
  ).toBe(pkg.price * 3);
  await pool.query(`UPDATE showtimes SET starts_at=now()+interval '90 days' WHERE id=$1`, [
    s.showtimeId,
  ]);
  const bought = await api()
    .post("/api/organizer/ads/purchases")
    .set(auth(s.token))
    .send({ eventId: s.eventId, packageId: pkg.id, acceptedPolicy: "fair_v1" })
    .expect(201);
  expect(bought.body).toMatchObject({ live: true, serving: true });
  await api()
    .patch(`/api/organizer/events/${s.eventId}`)
    .set(auth(s.token))
    .send({ title: "Nội dung cần duyệt lại" })
    .expect(200);
  const mine = await api().get("/api/organizer/ads/purchases").set(auth(s.token)).expect(200);
  expect(mine.body[0]).toMatchObject({ live: true, serving: false });
  const feed = await api()
    .post("/api/ads/delivery")
    .set("User-Agent", "Mozilla/5.0 workflow-test")
    .expect(200);
  expect(feed.body.deliveries).toEqual([]);
  await pool.query(`UPDATE events SET moderation_status='approved' WHERE id=$1`, [s.eventId]);
  await api()
    .post("/api/organizer/ads/purchases")
    .set(auth(s.token))
    .send({ eventId: s.eventId, packageId: pkg.id, acceptedPolicy: "fair_v1" })
    .expect(409);
  expect(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE kind='ad_purchase'`,
      )
    ).rows[0].n,
  ).toBe(1);
});
