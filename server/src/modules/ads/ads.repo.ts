import type {
  ActiveAdPlacement,
  AdAnalytics,
  AdCampaignRow,
  AdPackage,
  AdPlacement,
  AdPurchase,
} from "@shared/ads/types.js";
import { type Db, pool, withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { VISIBLE_JOIN, VISIBLE_WHERE } from "../catalog/visibility.js";

/*
 * Advertising packages (0033_ads.sql).
 *
 * **An ad purchase is platform revenue in full.** A ticket earns the site 5% and the organizer the
 * rest; a package is sold BY the site, so every đồng of it is the site's. That is why the console's
 * commission figures add ad revenue whole rather than taking a cut of it.
 *
 * **A campaign renders while it is `active` and inside its window.** Nothing sweeps expired rows:
 * the placement feed filters on `now() BETWEEN starts_at AND ends_at`, so a campaign that has run
 * out stops rendering the moment it does, with no job to fall behind. `cancelled` is the refunded
 * state and leaves revenue with it.
 *
 * **Price and placements are read off the PURCHASE, never off the package.** They were snapshotted
 * at sale for the same reason a ticket snapshots its price — re-pricing a package must not restate
 * what past buyers paid or change what a running campaign is owed.
 */

/** A campaign is rendering right now. Written once here so every read agrees on what "live" means. */
const LIVE = `p.status = 'active' AND p.starts_at <= now() AND p.ends_at > now()`;

export async function listPackages(db: Db = pool): Promise<AdPackage[]> {
  const { rows } = await db.query<{
    id: number;
    code: string;
    name: string;
    description: string | null;
    price: string;
    duration_days: number;
    placements: AdPlacement[];
  }>(
    `SELECT id, code, name_vi AS name, description_vi AS description,
            price_amount::text AS price, duration_days, placements
       FROM ad_packages
      WHERE is_active
      ORDER BY display_order, id`,
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    durationDays: row.duration_days,
    placements: row.placements,
  }));
}

interface PurchaseRow {
  id: number;
  event_id: number;
  event_title: string;
  event_slug: string;
  package_code: string;
  package_name: string;
  price: string;
  placements: AdPlacement[];
  status: AdPurchase["status"];
  starts_at: Date;
  ends_at: Date;
  created_at: Date;
  live: boolean;
}

const toPurchase = (row: PurchaseRow): AdPurchase => ({
  id: row.id,
  eventId: row.event_id,
  eventTitle: row.event_title,
  eventSlug: row.event_slug,
  packageCode: row.package_code,
  packageName: row.package_name,
  price: Number(row.price),
  placements: row.placements,
  status: row.status,
  startsAt: row.starts_at.toISOString(),
  endsAt: row.ends_at.toISOString(),
  createdAt: row.created_at.toISOString(),
  live: row.live,
});

const PURCHASE_SELECT = `
  SELECT p.id, p.event_id, e.title AS event_title, e.slug AS event_slug,
         k.code AS package_code, k.name_vi AS package_name,
         p.price_amount::text AS price, p.placements, p.status,
         p.starts_at, p.ends_at, p.created_at,
         (${LIVE}) AS live
    FROM ad_purchases p
    JOIN events e ON e.id = p.event_id
    JOIN ad_packages k ON k.id = p.package_id`;

/** Every campaign this organizer has bought, newest first. */
export async function listPurchases(organizerId: number, db: Db = pool): Promise<AdPurchase[]> {
  const { rows } = await db.query<PurchaseRow>(
    `${PURCHASE_SELECT} WHERE p.organizer_id = $1 ORDER BY p.created_at DESC`,
    [organizerId],
  );
  return rows.map(toPurchase);
}

/**
 * Buy a package for one event, paid from the buyer's wallet.
 *
 * Everything below happens in ONE transaction, and the rows it decides on are locked inside it: the
 * wallet, so two purchases cannot both read the same balance and both pass the affordability check;
 * and the event, so the sellability test cannot go stale between the check and the debit. The
 * partial unique index `uq_ad_purchases_live_per_event` is what actually forbids a second running
 * campaign on one event — the read below only turns that into a sentence the organizer can act on.
 */
export async function purchase(input: {
  userId: number;
  organizerId: number;
  eventId: number;
  packageId: number;
}): Promise<AdPurchase> {
  const id = await withTransaction(async (client) => {
    const pkg = (
      await client.query<{
        id: number;
        price: string;
        duration_days: number;
        placements: string[];
      }>(
        `SELECT id, price_amount::text AS price, duration_days, placements
           FROM ad_packages WHERE id = $1 AND is_active`,
        [input.packageId],
      )
    ).rows[0];
    if (!pkg) throw err.notFound("ad_package_not_found", "Gói quảng cáo không còn được bán.");

    // The event must be the organizer's, and it must be one the public can actually reach — an ad
    // for a draft or a suspended organizer's event is a slot the landing page would refuse to
    // render, sold anyway.
    const event = (
      await client.query<{ owned: boolean; visible: boolean }>(
        `SELECT (e.organizer_id = $2) AS owned, (${VISIBLE_WHERE}) AS visible
           FROM events e ${VISIBLE_JOIN}
          WHERE e.id = $1
          FOR UPDATE OF e, o`,
        [input.eventId, input.organizerId],
      )
    ).rows[0];
    if (!event) throw err.notFound("event_not_found", "Không tìm thấy sự kiện.");
    if (!event.owned) throw err.forbidden("not_owner", "Sự kiện này không thuộc về bạn.");
    if (!event.visible)
      throw err.conflict("event_not_promotable", "Chỉ quảng cáo được sự kiện đang mở bán.");

    /*
     * A campaign that is still running blocks a second one; an expired one does not.
     *
     * The database says the same thing through `ad_purchases_no_overlap`, and that constraint — not
     * this read — is what makes it true under concurrency. This exists to turn the violation into a
     * sentence the organizer can act on rather than a 500.
     */
    const running = (
      await client.query(`SELECT 1 FROM ad_purchases p WHERE p.event_id = $1 AND ${LIVE}`, [
        input.eventId,
      ])
    ).rows[0];
    if (running)
      throw err.conflict(
        "campaign_already_running",
        "Sự kiện này đang chạy một gói quảng cáo khác.",
      );

    const price = Number(pkg.price);
    const wallet = (
      await client.query<{ id: number; balance_amount: number }>(
        `SELECT id, balance_amount FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      )
    ).rows[0];
    if (!wallet) throw err.notFound("wallet_not_found");
    if (wallet.balance_amount < price) {
      // The exact shortfall, so the top-up sheet opens pre-filled rather than making the organizer
      // work out how far short they are — the same contract checkout offers a ticket buyer.
      const shortfall = price - wallet.balance_amount;
      throw err.unprocessable(
        "insufficient_wallet_balance",
        `Số dư ví thiếu ${shortfall.toLocaleString("vi-VN")}₫ để mua gói này.`,
        { required: price, balance: wallet.balance_amount, shortfall },
      );
    }

    const created = (
      await client.query<{ id: number }>(
        `INSERT INTO ad_purchases
           (organizer_id, event_id, package_id, purchased_by, price_amount, placements, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now() + ($7::int * interval '1 day'))
         RETURNING id`,
        [
          input.organizerId,
          input.eventId,
          pkg.id,
          input.userId,
          price,
          pkg.placements,
          pkg.duration_days,
        ],
      )
    ).rows[0]!;

    const balanceAfter = wallet.balance_amount - price;
    await client.query(`UPDATE wallets SET balance_amount = $2 WHERE id = $1`, [
      wallet.id,
      balanceAfter,
    ]);
    await client.query(
      `INSERT INTO wallet_transactions (wallet_id, kind, amount, balance_after, ad_purchase_id)
       VALUES ($1, 'ad_purchase', $2, $3, $4)`,
      [wallet.id, -price, balanceAfter, created.id],
    );

    return created.id;
  });

  const { rows } = await pool.query<PurchaseRow>(`${PURCHASE_SELECT} WHERE p.id = $1`, [id]);
  return toPurchase(rows[0]!);
}

/**
 * What the landing page is currently entitled to render.
 *
 * Public, and composed with the same visibility predicate every other public read uses: a campaign
 * whose event was pulled from sale or whose organizer was suspended stops rendering at once, without
 * anybody having to remember to cancel the campaign too.
 */
export async function activePlacements(db: Db = pool): Promise<ActiveAdPlacement[]> {
  const { rows } = await db.query<{ event_id: number; slug: string; placements: AdPlacement[] }>(
    `SELECT p.event_id, e.slug, p.placements
       FROM ad_purchases p
       JOIN events e ON e.id = p.event_id
       ${VISIBLE_JOIN}
      WHERE ${LIVE} AND ${VISIBLE_WHERE}
      ORDER BY p.created_at DESC`,
  );
  return rows.map((row) => ({ eventId: row.event_id, slug: row.slug, placements: row.placements }));
}

/* ── The admin console's figures ────────────────────────────────────────────────────────────── */

/** Ad money in a window. Cancelled campaigns are refunded and must not count. */
const AD_SOLD = `p.status <> 'cancelled'`;

export async function adRevenueBetween(
  from: string,
  to: string,
  db: Db = pool,
): Promise<{ revenue: number; purchases: number }> {
  const { rows } = await db.query<{ revenue: string; purchases: number }>(
    `SELECT COALESCE(SUM(p.price_amount), 0)::text AS revenue, COUNT(*)::int AS purchases
       FROM ad_purchases p
      WHERE ${AD_SOLD} AND p.created_at >= ${from} AND p.created_at < ${to}`,
  );
  return { revenue: Number(rows[0]?.revenue ?? 0), purchases: rows[0]?.purchases ?? 0 };
}

export async function analytics(db: Db = pool): Promise<AdAnalytics> {
  const [window, previous, live, byWeek, byPackage, campaigns] = await Promise.all([
    adRevenueBetween("now() - interval '30 days'", "now()", db),
    adRevenueBetween("now() - interval '60 days'", "now() - interval '30 days'", db),
    db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ad_purchases p WHERE ${LIVE}`),
    /*
     * A row per week including the quiet ones, for the same reason the ticket chart keeps its empty
     * days: a series drawn only from periods with sales spaces a dead month like a busy one.
     *
     * Weeks rather than days, and twelve of them rather than the KPIs' thirty. A few big packages a
     * month plotted daily is a flat line with spikes on it — the buckets are wide enough to hold a
     * sale and the window long enough for three months of them to have a shape.
     *
     * `date_trunc('week')` is Monday-based in Postgres, which is also how the calendar reads here.
     */
    db.query<{ week_start: string; week_end: string; amount: string; purchases: number }>(
      `WITH weeks AS (
         SELECT generate_series(
           date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - (11 * interval '1 week'),
           date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           interval '1 week') AS week_start
       ),
       sold AS (
         SELECT date_trunc('week', p.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS week_start,
                SUM(p.price_amount) AS amount, COUNT(*) AS purchases
           FROM ad_purchases p
          WHERE ${AD_SOLD}
            AND p.created_at >= now() - interval '12 weeks'
          GROUP BY 1
       )
       SELECT to_char(w.week_start, 'YYYY-MM-DD') AS week_start,
              to_char(w.week_start + interval '6 days', 'YYYY-MM-DD') AS week_end,
              COALESCE(s.amount, 0)::text AS amount,
              COALESCE(s.purchases, 0)::int AS purchases
         FROM weeks w LEFT JOIN sold s ON s.week_start = w.week_start
        ORDER BY w.week_start`,
    ),
    db.query<{ code: string; name: string; purchases: number; revenue: string }>(
      `SELECT k.code, k.name_vi AS name, COUNT(p.id)::int AS purchases,
              COALESCE(SUM(p.price_amount), 0)::text AS revenue
         FROM ad_packages k
         LEFT JOIN ad_purchases p
           ON p.package_id = k.id AND ${AD_SOLD}
          AND p.created_at >= now() - interval '30 days'
        GROUP BY k.code, k.name_vi, k.display_order, k.id
        ORDER BY k.display_order, k.id`,
    ),
    db.query<{
      id: number;
      event_title: string;
      organizer: string;
      package_name: string;
      price: string;
      placements: AdPlacement[];
      status: AdCampaignRow["status"];
      starts_at: Date;
      ends_at: Date;
      live: boolean;
    }>(
      `SELECT p.id, e.title AS event_title, org.display_name AS organizer,
              k.name_vi AS package_name, p.price_amount::text AS price, p.placements, p.status,
              p.starts_at, p.ends_at, (${LIVE}) AS live
         FROM ad_purchases p
         JOIN events e ON e.id = p.event_id
         JOIN organizers org ON org.id = p.organizer_id
         JOIN ad_packages k ON k.id = p.package_id
        ORDER BY (${LIVE}) DESC, p.created_at DESC
        LIMIT 100`,
    ),
  ]);

  return {
    revenue30d: window.revenue,
    revenuePrev30d: previous.revenue,
    purchases30d: window.purchases,
    liveCampaigns: live.rows[0]?.count ?? 0,
    byWeek: byWeek.rows.map((row) => ({
      weekStart: row.week_start,
      weekEnd: row.week_end,
      amount: Number(row.amount),
      purchases: row.purchases,
    })),
    byPackage: byPackage.rows.map((row) => ({
      code: row.code,
      name: row.name,
      purchases: row.purchases,
      revenue: Number(row.revenue),
    })),
    campaigns: campaigns.rows.map((row) => ({
      id: row.id,
      eventTitle: row.event_title,
      organizer: row.organizer,
      packageName: row.package_name,
      price: Number(row.price),
      placements: row.placements,
      status: row.status,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      live: row.live,
    })),
  };
}
