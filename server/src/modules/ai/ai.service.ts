import { createHash } from 'node:crypto';
import type {
  AICandidateEvent,
  ChatResponse,
  ConversationTurn,
  ListingInput,
  ListingResponse,
  RecommendationContext,
} from '@shared/ai/types.js';
import { AI_CACHE_TTL_MS, AI_REQUEST_LIMIT } from '../../config.js';
import { err } from '../../http.js';
import { getSettings } from '../admin/settings.service.js';
import * as repo from './ai.repo.js';
import type { AIProvider } from './providers/ai.provider.js';
import { OpenAIProvider } from './providers/openai.provider.js';

/** How many recent turns reach the model. Bounded here as well as at the route (defence in depth). */
export const HISTORY_LIMIT = 8;

/**
 * The provider, swappable.
 *
 * It used to be a module-level `new OpenAIProvider()`, which meant no test could substitute it and
 * so every degradation path — the whole point of Principle III — was untestable without a network.
 */
let provider: AIProvider = new OpenAIProvider();

/** Test seam only. Returns the previous provider so a suite can restore it. */
export function setAIProvider(next: AIProvider): AIProvider {
  const previous = provider;
  provider = next;
  return previous;
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * The non-AI answer.
 *
 * Only ever built from `candidates`, so a fallback is subject to the same visibility, upcoming, and
 * availability rules an AI answer is: degrading never lowers the bar on what may be shown.
 */
function fallback(list: AICandidateEvent[], reply: string, message?: string): ChatResponse {
  return {
    source: 'fallback',
    reply,
    declined: false,
    recommendations: list.slice(0, 6).map((event) => ({
      event,
      reason: 'Sự kiện sắp diễn ra và vẫn còn vé.',
    })),
    message,
  };
}

const FALLBACK_REPLY = 'Đây là những sự kiện sắp diễn ra và vẫn còn vé. Sự kiện đã diễn ra không nằm trong danh sách này.';

/**
 * Why an answer degraded, in the reader's words — and exported so the tests assert the branch they
 * mean rather than a fragment of its wording.
 *
 * A test matching a substring of the copy fails the next time the copy is edited, which says
 * nothing about whether the code still takes the right branch. That is what happened to
 * `GROUNDED_AWAY`: the phrasing moved on and left a red test behind it.
 */
export const FALLBACK_NOTE = {
  /** The model named events, and grounding discarded every one of them. */
  GROUNDED_AWAY: 'Không có sự kiện nào sắp diễn ra khớp yêu cầu — đây là những lựa chọn gần nhất.',
  /** No events and no prose either. */
  EMPTY_ANSWER: 'AI không đưa ra được câu trả lời, đây là gợi ý thay thế.',
  /** The feature is switched off in settings. */
  DISABLED: 'Tính năng AI hiện đang tắt.',
  /** The platform-wide hourly ceiling is reached. */
  PLATFORM_CEILING: 'Hệ thống đang tạm giới hạn AI, đây là gợi ý thay thế.',
} as const;

/**
 * Answer one turn of a conversation.
 *
 * The order of the steps is the design, not an implementation detail:
 *
 *  1. candidates — an empty catalog is answered without touching anything else;
 *  2. the Admin switch — off means no external call at all;
 *  3. the cache — consulted BEFORE any allowance is spent, because a cache hit costs no model call
 *     and so must cost no part of the ten-per-hour budget (UC-10 A1);
 *  4. the allowance — one unit of the attendee's hour and one of the platform window, together;
 *  5. the provider — under an 8s budget, its ids resolved against the candidate set;
 *  6. anything thrown — timeout, non-2xx, unparseable output, schema violation — becomes a
 *     fallback, never an error. The single exception is the attendee's own rate limit, which is a
 *     429 because it is the one refusal they can act on by waiting.
 */
export async function chat(
  userId: number,
  input: { message: string; history?: ConversationTurn[] },
): Promise<ChatResponse> {
  /*
   * Retrieval is driven by the whole turn, not just the newest line.
   *
   * "rẻ hơn nữa đi" retrieves nothing on its own — the subject was named a turn ago. Joining the
   * reader's own recent words to the new message keeps a follow-up anchored to what it follows.
   * Only their turns: feeding the assistant's own replies back in would let one loose match in an
   * earlier answer drag the whole conversation off course.
   */
  const askedRecently = (input.history ?? [])
    .filter((turn) => turn.role === 'user')
    .slice(-2)
    .map((turn) => turn.content);
  const list = await repo.candidates([...askedRecently, input.message].join(' '));
  if (!list.length) {
    return {
      source: 'fallback',
      reply: 'Hiện chưa có sự kiện nào sắp diễn ra và còn vé. Các sự kiện đã diễn ra vẫn xem được trong mục Sự kiện.',
      declined: false,
      recommendations: [],
    };
  }

  const settings = await getSettings();
  if (!settings.ai_features_enabled) {
    return fallback(list, FALLBACK_REPLY, FALLBACK_NOTE.DISABLED);
  }

  const history = (input.history ?? []).slice(-HISTORY_LIMIT);
  const context: RecommendationContext = {
    message: input.message,
    history,
    purchasedCategories: await repo.categoryContext(userId, 'purchased'),
    savedCategories: await repo.categoryContext(userId, 'saved'),
    viewedCategories: await repo.categoryContext(userId, 'viewed'),
    candidates: list,
    /*
     * The platform's own rules, live.
     *
     * The assistant is told it may answer "how long does a seat hold last" — a question with a real
     * answer that lives in Admin settings and nowhere the model can see. Without this it had two
     * options, both bad: refuse a question it was told to handle, or invent a number and break the
     * grounding rule everything else in this module enforces. Read per request so a changed setting
     * changes the answer, the same way event facts come from live rows.
     */
    platform: {
      seatHoldMinutes: settings.seat_hold_ttl_minutes,
      topupGraceMinutes: settings.topup_grace_minutes,
      absoluteCeilingMinutes: settings.absolute_ceiling_minutes,
      maxTicketsPerBuyer: settings.max_tickets_per_buyer,
      walletTopupMin: settings.wallet_topup_min,
      walletTopupMax: settings.wallet_topup_max,
    },
  };

  // The candidate set is part of the key on purpose: availability changes invalidate the cache, so
  // a stored answer can never outlive the inventory it was grounded in and offer a sold-out event.
  const key = hash(context);
  const cached = await repo.cacheGet<ChatResponse>('chat', userId, key);
  if (cached) return { ...cached, source: 'cache' };

  const allowance = await repo.consumeAllowance(
    userId,
    settings.ai_platform_request_ceiling,
    settings.ai_platform_window_hours,
  );
  if (!allowance.ok) {
    if (allowance.reason === 'user') {
      throw err.tooMany(
        'ai_rate_limited',
        `Bạn đã dùng hết ${AI_REQUEST_LIMIT} yêu cầu AI trong giờ này.`,
      );
    }
    return fallback(list, FALLBACK_REPLY, FALLBACK_NOTE.PLATFORM_CEILING);
  }

  try {
    const completion = await provider.chat(context);

    // A decline is a successful answer, not a failure: it is the domain fence doing its job.
    if (completion.declined) {
      const declined: ChatResponse = {
        source: 'ai',
        reply: completion.reply,
        declined: true,
        recommendations: [],
      };
      await repo.cachePut('chat', userId, key, declined, AI_CACHE_TTL_MS);
      return declined;
    }

    // The grounding step. Ids the model returned are looked up here; anything not in the set the
    // server built is discarded, so an invented event cannot survive into the response.
    const byId = new Map(list.map((event) => [event.id, event]));
    const recommendations = completion.recommendations.flatMap((item) => {
      const event = byId.get(item.eventId);
      return event ? [{ event, reason: item.reason }] : [];
    });

    /*
     * An answer with no events can be fine or useless, and the two need telling apart.
     *
     * Grounded away: the model named events and the filter above discarded every one. The answer is
     * unusable, so the reader gets the non-AI list.
     *
     * Nothing at all: no events *and* no prose. Also unusable, and worth checking here rather than
     * relying on the provider's schema to reject an empty reply — this service must be safe against
     * any implementation of the interface, not just the one that happens to validate.
     *
     * Prose only: no events but real prose. That is a perfectly good reply to "how long does a seat
     * hold last", and labelling it a fallback would tack "AI không chọn được sự kiện phù hợp" onto a
     * correct answer to a question that was never about choosing an event.
     */
    const reply = completion.reply.trim();
    if (!recommendations.length) {
      if (completion.recommendations.length > 0) {
        return fallback(list, reply || FALLBACK_REPLY, FALLBACK_NOTE.GROUNDED_AWAY);
      }
      if (!reply) {
        return fallback(list, FALLBACK_REPLY, FALLBACK_NOTE.EMPTY_ANSWER);
      }
    }

    const result: ChatResponse = {
      source: 'ai',
      // Trimmed, and never empty by this point — the branch above sent that case to the fallback.
      reply: reply || FALLBACK_REPLY,
      declined: false,
      recommendations: recommendations.slice(0, 6),
    };
    await repo.cachePut('chat', userId, key, result, AI_CACHE_TTL_MS);
    return result;
  } catch (error) {
    // Logged for an operator, never surfaced: the reason can name the provider and the request.
    console.warn('AI chat fallback:', error instanceof Error ? error.message : error);
    return fallback(list, FALLBACK_REPLY, degradedBecause(error));
  }
}

/**
 * Say which thing went wrong, because they are not the same problem.
 *
 * One message covered every failure — "không thể kết nối AI" — which is simply untrue when the
 * provider answered and answered correctly, just slower than the budget. Whoever reads that goes
 * looking for a network fault that is not there. A timeout is about speed and is worth a different
 * sentence from an outage.
 */
function degradedBecause(error: unknown): string {
  const timedOut =
    error instanceof Error &&
    (error.name === 'TimeoutError' || /abort|timeout/i.test(error.message));
  return timedOut
    ? 'AI phản hồi chậm hơn thường lệ, đang hiển thị sự kiện gợi ý.'
    : 'Không thể kết nối AI, đang hiển thị sự kiện gợi ý.';
}

/**
 * The organizer's listing assistant (UC-22).
 *
 * Same ordering as `chat` — switch, cache, allowance, call — which is the fix to its own bug: it
 * used to decrement the allowance before reading its cache, so re-generating from an identical
 * brief cost a unit and produced nothing new.
 */
export async function generateEventListing(userId: number, input: ListingInput): Promise<ListingResponse> {
  const settings = await getSettings();
  if (!settings.ai_features_enabled) {
    return { source: 'fallback', suggestion: null, message: 'Tính năng AI hiện đang tắt.' };
  }

  const key = hash(input);
  const cached = await repo.cacheGet<ListingResponse>('listing', userId, key);
  if (cached) return { ...cached, source: 'cache' };

  const allowance = await repo.consumeAllowance(
    userId,
    settings.ai_platform_request_ceiling,
    settings.ai_platform_window_hours,
  );
  if (!allowance.ok) {
    if (allowance.reason === 'user') {
      throw err.tooMany(
        'ai_rate_limited',
        `Bạn đã dùng hết ${AI_REQUEST_LIMIT} yêu cầu AI trong giờ này.`,
      );
    }
    return {
      source: 'fallback',
      suggestion: null,
      message: 'Hệ thống đang tạm giới hạn AI. Bạn vẫn có thể nhập thủ công.',
    };
  }

  try {
    const result: ListingResponse = { source: 'ai', suggestion: await provider.generateEventListing(input) };
    await repo.cachePut('listing', userId, key, result, AI_CACHE_TTL_MS);
    return result;
  } catch (error) {
    console.warn('AI listing fallback:', error instanceof Error ? error.message : error);
    return {
      source: 'fallback',
      suggestion: null,
      message: 'Không thể tạo gợi ý AI. Bạn vẫn có thể nhập thủ công.',
    };
  }
}

export const toggleBookmark = repo.toggleBookmark;
export const listBookmarks = repo.listBookmarks;
export const recordEventView = repo.recordEventView;
