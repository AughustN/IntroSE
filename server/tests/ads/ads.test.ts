import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import { adminSession, seedSale } from "../helpers/salesSeed.js";

/*
 * Advertising packages (0033_ads.sql).
 *
 * The money here is the platform's in full, not at 5%, and it is spent from the organizer's own
 * wallet — so the cases that matter are the ones where a debit could go missing, double, or be
 * charged for a placement that will never render.
 */

/** Fund an organizer's wallet so they can afford a package. */
async function fund(userId: number, amount: number): Promise<void> {
  await pool.query(
    `INSERT INTO wallets (user_id, balance_amount) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance_amount = EXCLUDED.balance_amount`,
    [userId, amount],
  );
}

const packageByCode = async (code: string) =>
  (
    await pool.query<{ id: number; price_amount: number }>(
      `SELECT id, price_amount FROM ad_packages WHERE code = $1`,
      [code],
    )
  ).rows[0]!;

const balance = async (userId: number) =>
  Number(
    (
      await pool.query<{ balance_amount: number }>(
        `SELECT balance_amount FROM wallets WHERE user_id = $1`,
        [userId],
      )
    ).rows[0]!.balance_amount,
  );

describe("the package catalogue", () => {
  it("is public, and every package sells at least one real placement", async () => {
    const res = await request(app).get("/api/ads/packages").expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(3);
    for (const pkg of res.body) {
      expect(pkg.price).toBeGreaterThan(0);
      expect(pkg.durationDays).toBeGreaterThan(0);
      expect(pkg.placements.length).toBeGreaterThan(0);
      // A package that named a slot the landing page cannot render would be sold and never shown.
      for (const slot of pkg.placements) expect(["hero_trailer", "hot_events"]).toContain(slot);
    }
  });
});

describe("buying a package", () => {
  it("debits the wallet once and starts a campaign that renders", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("featured");
    await fund(sale.organizer.userId, pkg.price_amount + 500_000);

    const res = await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);

    expect(res.body.price).toBe(pkg.price_amount);
    expect(res.body.live).toBe(true);
    expect(await balance(sale.organizer.userId)).toBe(500_000);

    // Exactly one ledger row, pointing at the purchase and at no order.
    const ledger = await pool.query(
      `SELECT wt.kind, wt.amount, wt.order_id, wt.ad_purchase_id
         FROM wallet_transactions wt
         JOIN wallets w ON w.id = wt.wallet_id
        WHERE w.user_id = $1 AND wt.kind = 'ad_purchase'`,
      [sale.organizer.userId],
    );
    expect(ledger.rowCount).toBe(1);
    expect(Number(ledger.rows[0].amount)).toBe(-pkg.price_amount);
    expect(ledger.rows[0].order_id).toBeNull();
    expect(Number(ledger.rows[0].ad_purchase_id)).toBe(res.body.id);

    // The landing page can now see it.
    const feed = await request(app).get("/api/ads/placements").expect(200);
    const mine = feed.body.find((row: { eventId: number }) => row.eventId === sale.eventId);
    expect(mine.placements).toContain("hero_trailer");
  });

  it("refuses a second campaign on an event that is already running one", async () => {
    const sale = await seedSale();
    const basic = await packageByCode("basic");
    await fund(sale.organizer.userId, basic.price_amount * 3);

    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: basic.id })
      .expect(201);

    const after = await balance(sale.organizer.userId);
    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: basic.id })
      .expect(409);

    // The refusal must cost nothing — a rejected purchase that still debited would be theft.
    expect(await balance(sale.organizer.userId)).toBe(after);
  });

  it("refuses when the wallet cannot cover it, and says how far short", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("premium");
    await fund(sale.organizer.userId, 1_000_000);

    const res = await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(422);

    expect(res.body.details.shortfall).toBe(pkg.price_amount - 1_000_000);
    expect(await balance(sale.organizer.userId)).toBe(1_000_000);
  });

  it("refuses somebody else's event", async () => {
    const mine = await seedSale();
    const theirs = await seedSale();
    const pkg = await packageByCode("basic");
    await fund(mine.organizer.userId, pkg.price_amount * 2);

    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(mine.organizer.token))
      .send({ eventId: theirs.eventId, packageId: pkg.id })
      .expect(403);

    expect(await balance(mine.organizer.userId)).toBe(pkg.price_amount * 2);
  });

  it("refuses an event the public cannot reach", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("basic");
    await fund(sale.organizer.userId, pkg.price_amount * 2);
    await pool.query(`UPDATE events SET status = 'draft' WHERE id = $1`, [sale.eventId]);

    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(409);
  });

  it("refuses an ordinary account", async () => {
    const user = await registerUser();
    const pkg = await packageByCode("basic");
    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(user.token))
      .send({ eventId: 1, packageId: pkg.id })
      .expect(403);
  });
});

describe("a campaign stops rendering when its event does", () => {
  it("drops out of the placement feed once the event leaves sale", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("basic");
    await fund(sale.organizer.userId, pkg.price_amount);
    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);

    await pool.query(`UPDATE events SET moderation_status = 'removed' WHERE id = $1`, [
      sale.eventId,
    ]);

    const feed = await request(app).get("/api/ads/placements").expect(200);
    expect(feed.body.some((row: { eventId: number }) => row.eventId === sale.eventId)).toBe(false);
  });
});

describe("what advertising does to the platform's revenue", () => {
  it("counts whole into the overview, not at the ticket commission rate", async () => {
    const admin = await adminSession();
    const before = await request(app)
      .get("/api/admin/overview")
      .set(bearer(admin.token))
      .expect(200);

    const sale = await seedSale();
    const pkg = await packageByCode("premium");
    await fund(sale.organizer.userId, pkg.price_amount);
    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);

    const after = await request(app)
      .get("/api/admin/overview")
      .set(bearer(admin.token))
      .expect(200);

    // `seedSale` also sells tickets, so the total moves by the commission on those PLUS the whole
    // package price. The ad half is isolated by `adRevenue30d`.
    expect(after.body.adRevenue30d - before.body.adRevenue30d).toBe(pkg.price_amount);
    expect(after.body.revenue30d - before.body.revenue30d).toBeGreaterThanOrEqual(pkg.price_amount);

    /*
     * The daily series carries the ad money too, or the chart would contradict the tile above it.
     * Checked on today's point rather than by summing the series: the series spans 30 calendar days
     * from local midnight while the headline spans the last 30×24 hours, so the two windows differ
     * by a part-day at the far end and are not required to sum equal.
     */
    const today = (rows: Array<{ amount: number }>) => rows[rows.length - 1]!.amount;
    expect(today(after.body.revenueByDay) - today(before.body.revenueByDay)).toBeGreaterThanOrEqual(
      pkg.price_amount,
    );
  });

  it("reports the ad half on its own screen", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("featured");
    await fund(sale.organizer.userId, pkg.price_amount);
    await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);

    const admin = await adminSession();
    const res = await request(app).get("/api/admin/ads").set(bearer(admin.token)).expect(200);

    expect(res.body.revenue30d).toBeGreaterThanOrEqual(pkg.price_amount);
    expect(res.body.liveCampaigns).toBeGreaterThanOrEqual(1);
    // Twelve buckets, quiet weeks included — the chart needs a baseline to show a spike against.
    expect(res.body.byWeek).toHaveLength(12);
    expect(res.body.byWeek.at(-1).amount).toBeGreaterThanOrEqual(pkg.price_amount);
    expect(
      res.body.byPackage.find((row: { code: string }) => row.code === "featured").purchases,
    ).toBeGreaterThanOrEqual(1);
    expect(res.body.campaigns.some((row: { live: boolean }) => row.live)).toBe(true);
  });

  it("refuses an ordinary account", async () => {
    const user = await registerUser();
    await request(app).get("/api/admin/ads").set(bearer(user.token)).expect(403);
  });
});

/*
 * Campaign lifecycle without a sweeper (0033/0034).
 *
 * Expiry is read off `ends_at` — a campaign that has run out stays `status = 'active'` and falls out
 * of the feed by time alone. That choice is what makes the exclusion constraint the right rule: it
 * must forbid OVERLAP, never history, or an organizer whose 7-day package ended could never buy
 * another. These cases pin that behaviour at the API level.
 */
describe("campaign lifecycle without a sweeper", () => {
  it("stops rendering past ends_at and lets the event be advertised again (0034)", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("basic");
    await fund(sale.organizer.userId, pkg.price_amount * 2);

    const first = await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);
    expect(first.body.live).toBe(true);

    // Age the campaign past its term directly — expiry needs no sweeper to be correct. Both bounds
    // move together: the table's own CHECK keeps ends_at after starts_at.
    await pool.query(
      `UPDATE ad_purchases
          SET starts_at = now() - interval '8 days', ends_at = now() - interval '1 hour'
        WHERE id = $1`,
      [first.body.id],
    );

    const feed = await request(app).get("/api/ads/placements").expect(200);
    expect(feed.body.some((row: { eventId: number }) => row.eventId === sale.eventId)).toBe(false);

    // The expired campaign is history, not a blocker: a second purchase must succeed.
    const second = await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);
    expect(second.body.live).toBe(true);

    // Both debits stand; exactly one campaign renders.
    expect(await balance(sale.organizer.userId)).toBe(0);
    const ledger = await pool.query(
      `SELECT count(*)::int AS n FROM wallet_transactions wt
        JOIN wallets w ON w.id = wt.wallet_id
       WHERE w.user_id = $1 AND wt.kind = 'ad_purchase'`,
      [sale.organizer.userId],
    );
    expect(ledger.rows[0].n).toBe(2);
    const live = await pool.query(
      `SELECT count(*)::int AS n FROM ad_purchases
       WHERE event_id = $1 AND status = 'active' AND starts_at <= now() AND ends_at > now()`,
      [sale.eventId],
    );
    expect(live.rows[0].n).toBe(1);
  });

  it("lets a cancelled campaign coexist with a new active one (exclusion applies only to active)", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("basic");
    await fund(sale.organizer.userId, pkg.price_amount);

    // A refunded campaign overlapping right now, inserted the way an admin refund would leave it.
    await pool.query(
      `INSERT INTO ad_purchases
         (organizer_id, event_id, package_id, purchased_by, price_amount, placements, status, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, ARRAY['hot_events']::text[], 'cancelled', now(), now() + interval '7 days')`,
      [sale.organizer.organizerId, sale.eventId, pkg.id, sale.organizer.userId, pkg.price_amount],
    );

    // The cancelled row overlaps in time, but `ad_purchases_no_overlap` only guards active rows.
    const res = await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);
    expect(res.body.live).toBe(true);
  });

  it("charges exactly one debit when two purchases for one event race", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("basic");
    await fund(sale.organizer.userId, pkg.price_amount * 2);

    const [a, b] = await Promise.all([
      request(app)
        .post("/api/organizer/ads/purchases")
        .set(bearer(sale.organizer.token))
        .send({ eventId: sale.eventId, packageId: pkg.id }),
      request(app)
        .post("/api/organizer/ads/purchases")
        .set(bearer(sale.organizer.token))
        .send({ eventId: sale.eventId, packageId: pkg.id }),
    ]);

    // Whichever path refuses — the pre-read or the constraint — the loser pays nothing.
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await balance(sale.organizer.userId)).toBe(pkg.price_amount);

    const ledger = await pool.query(
      `SELECT count(*)::int AS n FROM wallet_transactions wt
        JOIN wallets w ON w.id = wt.wallet_id
       WHERE w.user_id = $1 AND wt.kind = 'ad_purchase'`,
      [sale.organizer.userId],
    );
    expect(ledger.rows[0].n).toBe(1);
  });
});

/** Price and placements are snapshotted onto the purchase at buy time (0033). */
describe("what a purchase remembers about its package", () => {
  it("keeps the snapshotted price and placements when the package later changes", async () => {
    const sale = await seedSale();
    const pkg = await packageByCode("basic");
    await fund(sale.organizer.userId, pkg.price_amount);

    const bought = await request(app)
      .post("/api/organizer/ads/purchases")
      .set(bearer(sale.organizer.token))
      .send({ eventId: sale.eventId, packageId: pkg.id })
      .expect(201);

    try {
      await pool.query(
        `UPDATE ad_packages SET price_amount = $2, placements = ARRAY['hero_trailer']::text[] WHERE id = $1`,
        [pkg.id, pkg.price_amount * 10],
      );

      const list = await request(app)
        .get("/api/organizer/ads/purchases")
        .set(bearer(sale.organizer.token))
        .expect(200);
      const mine = list.body.find((row: { id: number }) => row.id === bought.body.id);
      expect(mine.price).toBe(pkg.price_amount);
      expect(mine.placements).toEqual(["hot_events"]);
    } finally {
      // Catalogue rows are shared seed data — put the package back whatever the assertions did.
      await pool.query(
        `UPDATE ad_packages SET price_amount = $2, placements = ARRAY['hot_events']::text[] WHERE id = $1`,
        [pkg.id, pkg.price_amount],
      );
    }
  });
});
