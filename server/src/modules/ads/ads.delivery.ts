import { randomInt, randomUUID } from "node:crypto";
import type { AdDelivery, AdFeed, AdMetricKind, AdPlacement } from "@shared/ads/types.js";
import { playableTrailer } from "@shared/ads/trailer.js";
import { withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { VISIBLE_JOIN } from "../catalog/visibility.js";
import { activePlacements, availability, LIVE, PROMOTABLE } from "./ads.repo.js";
import { AD_LOCK, chooseFair, unavailable } from "./ads.policy.js";

interface Candidate {
  id: number;
  event_id: number;
  slug: string;
  placement: AdPlacement;
  turns: number;
  last: number;
  trailer_url: string | null;
  ends_at: Date;
  eligible: boolean;
}
const ELIGIBLE = `FROM ad_delivery_stats a JOIN ad_purchases p ON p.id = a.purchase_id
  JOIN events e ON e.id = p.event_id ${VISIBLE_JOIN}
  WHERE ${LIVE} AND ${PROMOTABLE} AND p.delivery_policy = 'fair_v1'`;

/** Persistent equal-opportunity rotation across API instances, not per-tab randomness.
 * A half-minute visitor batch is replayed on reload. Counters are delivery opportunities;
 * visible impressions are measured separately and are never inferred from this endpoint.
 */
export async function deliver(visitorHash: string): Promise<AdFeed> {
  return withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock($1)`, [AD_LOCK]);
    const {
      rows: [clock],
    } = await db.query<{ batch: number; now: Date }>(
      `SELECT floor(extract(epoch FROM clock_timestamp()) / 30)::bigint AS batch, clock_timestamp() AS now`,
    );
    const batch = clock!.batch;
    const now = clock!.now;
    const legacy = await activePlacements(db);
    const blocked = new Set(legacy.flatMap((row) => row.placements));
    const cached = await db.query<{
      token: string;
      event_id: number;
      slug: string;
      placement: AdPlacement;
      expires_at: Date;
    }>(
      `SELECT d.token, p.event_id, e.slug, d.placement, d.expires_at
       FROM ad_deliveries d JOIN ad_purchases p ON p.id = d.purchase_id
       JOIN events e ON e.id = p.event_id ${VISIBLE_JOIN}
       WHERE d.visitor_hash = $1 AND d.batch_key = $2 AND d.expires_at > clock_timestamp()
         AND ${LIVE} AND ${PROMOTABLE}`,
      [visitorHash, batch],
    );
    const deliveries: AdDelivery[] = cached.rows.map((r) => ({
      token: r.token,
      eventId: r.event_id,
      slug: r.slug,
      placement: r.placement,
      placements: [r.placement],
      expiresAt: r.expires_at.toISOString(),
    }));
    if (deliveries.length) return { legacy, deliveries };
    const { rows } = await db.query<Candidate>(
      `SELECT p.id, p.event_id, e.slug, e.trailer_url, p.ends_at, a.placement, a.turns,
        a.eligible, (extract(epoch FROM a.last_selected_at) * 1000)::float8 AS last ${ELIGIBLE}`,
    );
    const issued: {
      token: string;
      purchase_id: number;
      placement: AdPlacement;
      expires_at: Date;
    }[] = [];
    for (const placement of ["hero_trailer", "hot_events"] as const) {
      if (blocked.has(placement)) continue;
      const candidates = rows.filter(
        (r) =>
          r.placement === placement &&
          (placement !== "hero_trailer" || playableTrailer(r.trailer_url)),
      );
      const continuing = candidates.filter((r) => r.eligible);
      const floor = continuing.length
        ? Math.min(...continuing.map((r) => r.turns))
        : Math.min(...candidates.map((r) => r.turns), 0);
      for (const r of candidates) if (!r.eligible) r.turns = floor;
      await db.query(
        `UPDATE ad_delivery_stats SET
        turns = CASE WHEN NOT eligible AND purchase_id = ANY($2::bigint[]) THEN $3 ELSE turns END,
        eligible = purchase_id = ANY($2::bigint[]) WHERE placement = $1
        AND eligible IS DISTINCT FROM (purchase_id = ANY($2::bigint[]))`,
        [placement, candidates.map((r) => r.id), floor],
      );
      const chosen = chooseFair(candidates, placement === "hero_trailer" ? 1 : 10);
      // A fair selection must not leave the same campaign at the end of a scrolling rail.
      if (placement === "hot_events")
        for (let i = chosen.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
        }
      for (const r of chosen) {
        const token = randomUUID();
        const expires = new Date(Math.min(now.getTime() + 90_000, r.ends_at.getTime()));
        issued.push({ token, purchase_id: r.id, placement, expires_at: expires });
        deliveries.push({
          eventId: r.event_id,
          slug: r.slug,
          placement,
          placements: [placement],
          token,
          expiresAt: expires.toISOString(),
        });
      }
    }
    if (issued.length) {
      await db.query(
        `INSERT INTO ad_deliveries (token,purchase_id,placement,expires_at,visitor_hash,batch_key)
        SELECT r.token,r.purchase_id,r.placement,r.expires_at,$2,$3 FROM jsonb_to_recordset($1::jsonb)
        AS r(token uuid,purchase_id bigint,placement text,expires_at timestamptz)`,
        [JSON.stringify(issued), visitorHash, batch],
      );
      await db.query(
        `UPDATE ad_delivery_stats a SET turns=turns+1,last_selected_at=clock_timestamp()
        FROM jsonb_to_recordset($1::jsonb) AS r(purchase_id bigint,placement text)
        WHERE a.purchase_id=r.purchase_id AND a.placement=r.placement`,
        [
          JSON.stringify(
            issued.map((r) => ({ purchase_id: r.purchase_id, placement: r.placement })),
          ),
        ],
      );
    }
    // Bounded housekeeping; raw IPs are never stored. Aggregates outlive these dedupe receipts.
    await db.query(`DELETE FROM ad_deliveries WHERE token IN
      (SELECT token FROM ad_deliveries WHERE expires_at < now() - interval '1 day' LIMIT 500)`);
    await db.query(`DELETE FROM ad_observations WHERE (visitor_hash,purchase_id,placement,bucket) IN
      (SELECT visitor_hash,purchase_id,placement,bucket FROM ad_observations
       WHERE created_at < now() - interval '1 day' LIMIT 500)`);
    return { legacy, deliveries };
  });
}

/** UUID receipts bind metrics to an issued creative and an anonymized visitor.
 * Atomic upsert + increment: retries, clones and concurrent requests count at most once.
 * Browser visibility is a best-effort signal, not a fraud-proof measurement standard.
 */
export async function recordMetric(
  visitorHash: string,
  token: string,
  kind: AdMetricKind,
): Promise<void> {
  const column = { impression: "impressions", click: "clicks", play: "plays" }[kind];
  if (!column) throw err.unprocessable("invalid_ad_metric");
  await withTransaction(async (db) => {
    const { rows } = await db.query<{
      purchase_id: number;
      placement: AdPlacement;
      bucket: number;
    }>(
      `SELECT d.purchase_id, d.placement,
        floor(extract(epoch FROM d.issued_at) / 1800)::bigint AS bucket
       FROM ad_deliveries d JOIN ad_purchases p ON p.id = d.purchase_id
       JOIN events e ON e.id = p.event_id ${VISIBLE_JOIN}
       WHERE d.token = $1 AND d.visitor_hash = $2 AND d.expires_at > clock_timestamp()
         AND ($3 = 'click' OR d.issued_at <= clock_timestamp() - interval '1 second')
         AND ($3 <> 'play' OR d.placement = 'hero_trailer')
         AND ${LIVE} AND ${PROMOTABLE}`,
      [token, visitorHash, kind],
    );
    const r = rows[0];
    if (!r) return; // Expired/forged receipts must not become a public campaign lookup oracle.
    const changed = await db.query(
      `INSERT INTO ad_observations
      (visitor_hash,purchase_id,placement,bucket,${kind}) VALUES ($1,$2,$3,$4,true)
      ON CONFLICT (visitor_hash,purchase_id,placement,bucket) DO UPDATE SET ${kind} = true
        WHERE NOT ad_observations.${kind} RETURNING purchase_id`,
      [visitorHash, r.purchase_id, r.placement, r.bucket],
    );
    if (changed.rowCount)
      await db.query(
        `UPDATE ad_delivery_stats SET ${column} = ${column} + 1
        WHERE purchase_id = $1 AND placement = $2`,
        [r.purchase_id, r.placement],
      );
  });
}

/** Explicit admin attestation of an outage, not automatic compensation for low traffic. */
export async function compensate(input: {
  purchaseId: number;
  adminId: number;
  incidentId: string;
  from: string;
  to: string;
  reason: string;
}): Promise<void> {
  await withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock($1)`, [AD_LOCK]);
    const previous = await db.query(
      `SELECT 1 FROM ad_compensations WHERE purchase_id=$1 AND incident_id=$2`,
      [input.purchaseId, input.incidentId],
    );
    if (previous.rowCount) return;
    const {
      rows: [p],
    } = await db.query<{
      starts_at: Date;
      ends_at: Date;
      now: Date;
      event_id: number;
      placements: AdPlacement[];
    }>(
      `SELECT p.starts_at, p.ends_at, clock_timestamp() AS now, p.event_id, p.placements FROM ad_purchases p
       JOIN events e ON e.id=p.event_id ${VISIBLE_JOIN}
       WHERE p.id=$1 AND p.status='active' AND ${PROMOTABLE} AND p.delivery_policy='fair_v1' FOR UPDATE OF p`,
      [input.purchaseId],
    );
    if (!p)
      throw err.conflict(
        "ad_not_compensable",
        "Chỉ bù thời gian cho chiến dịch luân phiên chưa huỷ, có sự kiện đang mở bán.",
      );
    if (Date.parse(input.to) > p.now.getTime() || Date.parse(input.to) <= Date.parse(input.from))
      throw err.unprocessable(
        "invalid_outage",
        "Sự cố phải đã kết thúc và có thứ tự thời gian hợp lệ.",
      );
    if (
      p.ends_at <= p.now &&
      unavailable((await availability(db)).filter((s) => p.placements.includes(s.placement)))
    )
      throw err.conflict(
        "ad_capacity_full",
        "Chưa có chỗ để khởi chạy lại chiến dịch hết hạn. Hãy xử lý bù sau khi có chỗ.",
      );
    const from = Math.max(Date.parse(input.from), p.starts_at.getTime());
    const to = Math.min(Date.parse(input.to), p.ends_at.getTime(), p.now.getTime());
    const seconds = Math.floor((to - from) / 1000);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30 * 86400)
      throw err.unprocessable(
        "invalid_outage",
        "Khoảng sự cố phải thuộc thời gian đã chạy, tối đa 30 ngày.",
      );
    const end = new Date(Math.max(p.ends_at.getTime(), p.now.getTime()) + seconds * 1000);
    const conflict = await db.query(
      `SELECT 1 FROM ad_compensations WHERE purchase_id=$1
      AND tstzrange(outage_start,outage_end,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')`,
      [input.purchaseId, new Date(from), new Date(to)],
    );
    if (conflict.rowCount)
      throw err.conflict("outage_already_compensated", "Khoảng sự cố này đã được bù thời gian.");
    const cover = await db.query(
      `SELECT 1 FROM showtimes WHERE event_id=$1
      AND starts_at > $2 AND status NOT IN ('cancelled','finished') LIMIT 1`,
      [p.event_id, end],
    );
    const overlap = await db.query(
      `SELECT 1 FROM ad_purchases WHERE event_id=$1 AND id<>$2 AND status='active'
      AND tstzrange(starts_at,ends_at,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)')`,
      [p.event_id, input.purchaseId, p.starts_at, end],
    );
    if (!cover.rowCount || overlap.rowCount)
      throw err.conflict(
        "ad_extension_conflict",
        "Không thể gia hạn qua suất diễn cuối hoặc chồng lên chiến dịch khác. Cần xử lý hỗ trợ riêng.",
      );
    await db.query(
      `INSERT INTO ad_compensations
      (purchase_id,incident_id,outage_start,outage_end,seconds,reason,admin_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.purchaseId,
        input.incidentId,
        new Date(from),
        new Date(to),
        seconds,
        input.reason,
        input.adminId,
      ],
    );
    await db.query(
      `UPDATE ad_purchases SET ends_at=$2, compensated_seconds=compensated_seconds+$3 WHERE id=$1`,
      [input.purchaseId, end, seconds],
    );
  });
}
