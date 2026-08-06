import type { ListingResponse, ListingSuggestion } from "@shared/catalog/types.js";
import { AI_TIMEOUT_MS } from "../../../config.js";
import { pool } from "../../../db/pool.js";
import { err } from "../../../http.js";
import {
  allowRequest,
  cacheGet,
  cacheKey,
  cacheSet,
  consumeQuota,
  quotaAvailable,
} from "./ai.throttle.js";
import { getListingModel, type ListingDraft } from "./listing.model.js";
import { suggestPrice } from "./comparables.repo.js";

/**
 * The AI listing assistant (UC-22).
 *
 * The guard order in `contracts/ai-listing.md` is load-bearing and is asserted by tests. Two steps
 * are only correct in this position:
 *
 *   - the rate limit precedes the CACHE, because eleven identical calls are ten cache hits and a
 *     cache checked first would make SEC-08 unverifiable;
 *   - the live-event refusal precedes both, because it is a property of the target rather than of the
 *     caller's usage, so a doomed request should not spend the organizer's hourly allowance.
 *
 * Degradation is a SUCCESSFUL response with `available: false`, never an error status. The
 * constitution forbids AI producing "an error that blocks a user", and a 5xx would be rendered by the
 * shared client error handler as exactly that.
 */

export interface ListingInput {
  eventId?: number;
  topic: string;
  keywords?: string[];
  categoryCode?: string;
  city?: string;
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * Everything the model returns passes through validation, and a field that fails is DROPPED, not
 * escalated — a malformed tag must never cost the organizer their description.
 */
function normalise(
  draft: ListingDraft,
  price: { price: number; basis: number } | null,
): ListingSuggestion {
  const titles = draft.titles
    .map(clean)
    .filter((t) => t.length > 0 && t.length <= 200)
    .slice(0, 3);
  const description = draft.description ? clean(draft.description) : "";
  const tags = [
    ...new Set(draft.tags.map(clean).filter((t) => t.length > 0 && t.length <= 40)),
  ].slice(0, 8);

  return {
    titles,
    description: description.length > 0 ? description : null,
    tags,
    price: price ? price.price : null,
    priceBasis: price ? price.basis : null,
  };
}

/** An all-dropped suggestion is a failed one — indistinguishable to the client from a timeout. */
function isUsable(s: ListingSuggestion): boolean {
  return s.titles.length > 0 || s.description !== null || s.tags.length > 0;
}

/**
 * Step 3 of the guard order: the assistant is refused on an approved, on-sale event (FR-027).
 * Redrafting a listing that is already live is both risky and pointless — accepting a suggestion
 * there would knock the organizer's own event out of the public catalog via a click they never
 * thought of as an edit.
 */
async function assertAssistable(
  eventId: number,
  actorUserId: number,
  isAdmin: boolean,
): Promise<string | undefined> {
  const { rows } = await pool.query<{
    user_id: number;
    status: string;
    moderation_status: string;
    category: string;
  }>(
    `SELECT o.user_id, e.status, e.moderation_status, ec.code AS category
       FROM events e
       JOIN organizers o ON o.id = e.organizer_id
       JOIN event_categories ec ON ec.id = e.category_id
      WHERE e.id = $1`,
    [eventId],
  );
  const row = rows[0];
  if (!row) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  if (row.user_id !== actorUserId && !isAdmin) {
    throw err.forbidden("not_owner", "Bạn không sở hữu sự kiện này.");
  }
  if (row.moderation_status === "approved" && row.status === "on_sale") {
    throw err.conflict(
      "ai_unavailable_live_event",
      "Sự kiện đang được duyệt và mở bán nên không dùng trợ lý AI. Hãy chỉnh sửa thủ công.",
    );
  }
  return row.category;
}

export async function draftListing(
  actorUserId: number,
  isAdmin: boolean,
  input: ListingInput,
): Promise<ListingResponse> {
  // 2–3. Ownership, then the live-event refusal.
  let categoryCode = input.categoryCode;
  if (input.eventId !== undefined) {
    categoryCode = (await assertAssistable(input.eventId, actorUserId, isAdmin)) ?? categoryCode;
  }

  // 4. Per-user fairness (SEC-08). Before the cache, deliberately.
  const gate = allowRequest(actorUserId);
  if (!gate.allowed) {
    const minutes = Math.max(1, Math.ceil(gate.retryAfterMs / 60_000));
    throw err.tooMany(
      "ai_rate_limited",
      `Bạn đã dùng hết lượt gợi ý trong giờ này. Vui lòng thử lại sau ${minutes} phút.`,
    );
  }

  // 5. Cache (SCAL-02).
  const key = cacheKey({
    topic: input.topic,
    keywords: input.keywords,
    categoryCode,
    city: input.city,
  });
  const cached = cacheGet(key);
  if (cached) return { available: true, cached: true, suggestion: cached };

  // 6. Platform-wide quota guard (SCAL-03) — a degradation, not an error.
  if (!quotaAvailable()) return { available: false, reason: "quota_exhausted" };

  // 7. The price comes from platform data, never from the model (FR-033).
  const price = await suggestPrice(categoryCode, input.city);

  // 8. Prose, under a hard timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    consumeQuota();
    const draft = await getListingModel().draft(
      {
        topic: input.topic,
        keywords: input.keywords ?? [],
        city: input.city,
        categoryLabel: categoryCode,
      },
      controller.signal,
    );
    const suggestion = normalise(draft, price);
    if (!isUsable(suggestion)) return { available: false, reason: "error" };

    cacheSet(key, suggestion);
    return { available: true, cached: false, suggestion };
  } catch (e) {
    // Timeout and upstream failure look the same to the organizer: manual entry, no error.
    const reason = controller.signal.aborted ? "timeout" : "error";
    return { available: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
