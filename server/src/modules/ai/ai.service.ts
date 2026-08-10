import { createHash } from "node:crypto";
import { pool, withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { AI_CACHE_TTL_MS, AI_REQUEST_LIMIT } from "../../config.js";
import { getSettings } from "../admin/settings.service.js";
import { SHOWTIME_HAS_AVAILABILITY, UPCOMING_SHOWTIME, VISIBLE_JOIN, VISIBLE_WHERE } from "../catalog/visibility.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import type { AICandidateEvent, ListingInput, ListingSuggestion } from "./providers/ai.provider.js";

type Recommendation = { event: AICandidateEvent; reason: string };
type RecommendationResult = { source: "ai" | "cache" | "fallback"; recommendations: Recommendation[]; message?: string };
type ListingResult = { source: "ai" | "cache" | "fallback"; suggestion: ListingSuggestion | null; message?: string };

const provider = new OpenAIProvider();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function consumeRequest(userId: number): Promise<void> {
  await withTransaction(async (db) => {
    await db.query("INSERT INTO ai_request_limits (user_id, window_started_at, request_count) VALUES ($1, date_trunc('hour', now()), 0) ON CONFLICT (user_id) DO NOTHING", [userId]);
    const { rows } = await db.query<{ window_started_at: string; request_count: number }>("SELECT window_started_at, request_count FROM ai_request_limits WHERE user_id = $1 FOR UPDATE", [userId]);
    const current = rows[0]!;
    const sameWindow = new Date(current.window_started_at).getTime() >= new Date(new Date().setMinutes(0, 0, 0)).getTime();
    if (sameWindow && current.request_count >= AI_REQUEST_LIMIT) throw err.tooMany("ai_rate_limited", "Bạn đã dùng hết 10 yêu cầu AI trong giờ này.");
    await db.query("UPDATE ai_request_limits SET window_started_at = CASE WHEN $2 THEN window_started_at ELSE date_trunc('hour', now()) END, request_count = CASE WHEN $2 THEN request_count + 1 ELSE 1 END WHERE user_id = $1", [userId, sameWindow]);
  });
}

async function cacheGet<T>(kind: "recommendation" | "listing", userId: number, key: string): Promise<T | null> {
  const { rows } = await pool.query<{ response: T }>("SELECT response FROM ai_response_cache WHERE kind = $1 AND user_id = $2 AND cache_key = $3 AND expires_at > now()", [kind, userId, key]);
  return rows[0]?.response ?? null;
}

async function cachePut(kind: "recommendation" | "listing", userId: number, key: string, response: unknown): Promise<void> {
  await pool.query("INSERT INTO ai_response_cache (kind, user_id, cache_key, response, expires_at) VALUES ($1, $2, $3, $4::jsonb, now() + $5 * interval '1 millisecond') ON CONFLICT (kind, user_id, cache_key) DO UPDATE SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at, created_at = now()", [kind, userId, key, JSON.stringify(response), AI_CACHE_TTL_MS]);
}

async function candidates(limit = 20): Promise<AICandidateEvent[]> {
  const { rows } = await pool.query<AICandidateEvent>(
    `SELECT e.id, e.slug, e.title, ec.code AS category, v.city, min(s.starts_at)::text AS "startsAt", min(tt.price_amount)::bigint AS "startingPrice"
       FROM events e ${VISIBLE_JOIN}
       JOIN event_categories ec ON ec.id = e.category_id
       JOIN showtimes s ON ${UPCOMING_SHOWTIME}
       JOIN venues v ON v.id = s.venue_id
       LEFT JOIN ticket_tiers tt ON tt.showtime_id = s.id
      WHERE ${VISIBLE_WHERE} AND ${SHOWTIME_HAS_AVAILABILITY}
      GROUP BY e.id, e.slug, e.title, ec.code, v.city
      ORDER BY min(s.starts_at), e.id
      LIMIT $1`, [limit],
  );
  return rows.map((row) => ({ ...row, startingPrice: row.startingPrice === null ? null : Number(row.startingPrice) }));
}

async function categoryContext(userId: number, source: "purchased" | "saved" | "viewed"): Promise<string[]> {
  const sql = source === "purchased"
    ? `SELECT ec.code FROM tickets t JOIN orders o ON o.id = t.order_id JOIN reservation_items ri ON ri.id = t.reservation_item_id JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id JOIN showtimes s ON s.id = tt.showtime_id JOIN events e ON e.id = s.event_id JOIN event_categories ec ON ec.id = e.category_id WHERE o.user_id = $1 GROUP BY ec.code ORDER BY count(*) DESC`
    : source === "saved"
      ? `SELECT ec.code FROM user_event_bookmarks b JOIN events e ON e.id = b.event_id JOIN event_categories ec ON ec.id = e.category_id WHERE b.user_id = $1 GROUP BY ec.code ORDER BY max(b.created_at) DESC`
      : `SELECT ec.code FROM user_event_views h JOIN events e ON e.id = h.event_id JOIN event_categories ec ON ec.id = e.category_id WHERE h.user_id = $1 GROUP BY ec.code ORDER BY max(h.viewed_at) DESC`;
  return (await pool.query<{ code: string }>(sql, [userId])).rows.map((row) => row.code);
}

function fallback(list: AICandidateEvent[], message?: string): RecommendationResult {
  return { source: "fallback", recommendations: list.slice(0, 6).map((event) => ({ event, reason: "Sự kiện đang mở bán và sắp diễn ra." })), message };
}

export async function recommendEvents(userId: number, message: string): Promise<RecommendationResult> {
  const list = await candidates();
  if (!list.length) {
    return { source: "fallback", recommendations: [], message: "Hiện chưa có sự kiện đang mở bán và còn vé để gợi ý." };
  }
  if (!(await getSettings()).ai_features_enabled) return fallback(list, "Tính năng AI hiện đang tắt.");
  await consumeRequest(userId);
  const context = { message, purchasedCategories: await categoryContext(userId, "purchased"), savedCategories: await categoryContext(userId, "saved"), viewedCategories: await categoryContext(userId, "viewed"), candidates: list };
  const key = hash(context);
  const cached = await cacheGet<RecommendationResult>("recommendation", userId, key);
  if (cached) return { ...cached, source: "cache" };
  try {
    const ranked = await provider.recommendEvents(context);
    const byId = new Map(list.map((event) => [event.id, event]));
    const recommendations = ranked.flatMap((item) => {
      const event = byId.get(item.eventId);
      return event ? [{ event, reason: item.reason }] : [];
    });
    const result: RecommendationResult = recommendations.length ? { source: "ai", recommendations } : fallback(list, "AI không chọn được sự kiện phù hợp.");
    await cachePut("recommendation", userId, key, result);
    return result;
  } catch (error) {
    console.warn("AI recommendation fallback:", error instanceof Error ? error.message : error);
    return fallback(list, "Không thể kết nối AI, đang hiển thị sự kiện gợi ý.");
  }
}

export async function generateEventListing(userId: number, input: ListingInput): Promise<ListingResult> {
  if (!(await getSettings()).ai_features_enabled) return { source: "fallback", suggestion: null, message: "Tính năng AI hiện đang tắt." };
  await consumeRequest(userId);
  const key = hash(input);
  const cached = await cacheGet<ListingResult>("listing", userId, key);
  if (cached) return { ...cached, source: "cache" };
  try {
    const result: ListingResult = { source: "ai", suggestion: await provider.generateEventListing(input) };
    await cachePut("listing", userId, key, result);
    return result;
  } catch (error) {
    console.warn("AI listing fallback:", error instanceof Error ? error.message : error);
    return { source: "fallback", suggestion: null, message: "Không thể tạo gợi ý AI. Bạn vẫn có thể nhập thủ công." };
  }
}

async function visibleEventId(slug: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(`SELECT e.id FROM events e ${VISIBLE_JOIN} WHERE e.slug = $1 AND ${VISIBLE_WHERE}`, [slug]);
  if (!rows[0]) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  return rows[0].id;
}

export async function toggleBookmark(userId: number, slug: string): Promise<{ saved: boolean }> {
  const eventId = await visibleEventId(slug);
  const removed = await pool.query("DELETE FROM user_event_bookmarks WHERE user_id = $1 AND event_id = $2 RETURNING event_id", [userId, eventId]);
  if (removed.rowCount) return { saved: false };
  await pool.query("INSERT INTO user_event_bookmarks (user_id, event_id) VALUES ($1, $2)", [userId, eventId]);
  return { saved: true };
}

export async function listBookmarks(userId: number): Promise<string[]> {
  return (await pool.query<{ slug: string }>(
    `SELECT e.slug FROM user_event_bookmarks b JOIN events e ON e.id = b.event_id ${VISIBLE_JOIN}
      WHERE b.user_id = $1 AND ${VISIBLE_WHERE} ORDER BY b.created_at DESC`, [userId],
  )).rows.map((row) => row.slug);
}

export async function recordEventView(userId: number, slug: string): Promise<void> {
  const eventId = await visibleEventId(slug);
  await pool.query("INSERT INTO user_event_views (user_id, event_id, viewed_at) VALUES ($1, $2, now()) ON CONFLICT (user_id, event_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at", [userId, eventId]);
}
