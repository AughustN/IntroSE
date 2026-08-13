import type { ReplyPage, Review, ReviewPage, ViewerState } from '@shared/reviews/types.js';
import { pool, withTransaction } from '../../db/pool.js';
import { err } from '../../http.js';
import { insertAudit } from '../admin/audit.js';
import * as repo from './reviews.repo.js';

/** How many reviews one page carries, and the most a caller may ask for. */
export const PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

/**
 * Whitespace is not text.
 *
 * "   " is somebody who started typing and thought better of it, not a review body. Stored as null
 * so the rating stands alone rather than the page rendering an empty quotation.
 */
const cleanBody = (body: string | null | undefined): string | null => {
  const trimmed = (body ?? '').trim();
  return trimmed.length ? trimmed : null;
};

/**
 * The gate, and the only place it is decided.
 *
 * Eligibility is re-derived from the caller's own rows every time, so the client cannot assert it
 * and a refund cannot leave a rating standing behind a purchase that no longer exists. Holding a
 * paid ticket is the whole of it — whether the event has happened yet does not come into it.
 */
async function requireEligible(userId: number, eventId: number): Promise<void> {
  const { hasTicket } = await repo.eligibility(userId, eventId);
  if (!hasTicket) {
    throw err.forbidden('no_ticket', 'Bạn cần có vé đã thanh toán cho sự kiện này để đánh giá.');
  }
}

/**
 * Post a comment on an event: the caller's rated first one, a later one, or a reply.
 *
 * One entry point rather than three, because to the writer they are one act — say something here —
 * and which of the three it is follows from facts the server already holds: whether they have rated
 * this event, and whether they aimed at another comment.
 *
 * Replies are gated exactly like comments. A reply is still someone speaking about an event on its
 * page, and letting any signed-in account in would put people who never bought a ticket into the
 * threads under the people who did — the one property this wall is for.
 */
export async function submit(
  userId: number,
  eventId: number,
  input: { rating?: number | null; body?: string | null; parentId?: number | null },
): Promise<Review> {
  await requireEligible(userId, eventId);
  const body = cleanBody(input.body);

  if (input.parentId != null) {
    const parent = await repo.findParent(input.parentId, eventId);
    if (!parent) throw err.notFound('not_found', 'Không tìm thấy bình luận này.');
    if (!body) throw err.badRequest('validation_failed', 'Trả lời phải có nội dung.');
    // Flattened to one level: a reply to a reply joins the thread it was reading, which is what
    // every comment section a buyer has used already does.
    return repo.insert(userId, eventId, null, body, parent.parentId ?? parent.id);
  }

  const rated = await repo.hasRated(userId, eventId);
  if (!rated && input.rating == null) {
    throw err.badRequest('validation_failed', 'Hãy chọn số sao cho bình luận đầu tiên của bạn.');
  }
  if (rated && !body) {
    throw err.badRequest('validation_failed', 'Bình luận phải có nội dung.');
  }

  try {
    // The stars ride on the first comment only. A later one is prose whatever the request says —
    // an author has one vote, and the index below is what actually promises it.
    return await repo.insert(userId, eventId, rated ? null : (input.rating ?? null), body, null);
  } catch (e) {
    // Two devices posting a first comment at the same instant: one wins the vote, and the other's
    // comment is stored without stars rather than lost to a 500 the writer cannot act on.
    if ((e as { code?: string }).code !== repo.DUPLICATE_RATING) throw e;
    if (!body) throw err.badRequest('validation_failed', 'Bạn đã đánh giá sự kiện này rồi.');
    return repo.insert(userId, eventId, null, body, null);
  }
}

export async function edit(
  userId: number,
  reviewId: number,
  input: { rating?: number | null; body?: string | null },
): Promise<Review> {
  const updated = await repo.updateOwn(userId, reviewId, input.rating ?? null, cleanBody(input.body));
  // Not found rather than forbidden: someone else's review answers the same way a nonexistent one
  // does, so walking ids discloses nothing about what exists. An unrated comment edited down to no
  // text lands here too — it would leave a row saying nothing, and the `WHERE` refuses it.
  if (!updated) throw err.notFound('not_found', 'Không tìm thấy đánh giá của bạn.');
  return updated;
}

export async function withdraw(userId: number, reviewId: number): Promise<void> {
  if (!(await repo.deleteOwn(userId, reviewId))) {
    throw err.notFound('not_found', 'Không tìm thấy đánh giá của bạn.');
  }
}

/**
 * Everything the review section needs, in one call.
 *
 * The summary, a page of comments with their threads, and — for a signed-in reader — whether they
 * may write, why not if they may not, and whether their stars are already cast. Three round trips to
 * assemble one section would make the section's loading state the most complicated thing on the page.
 */
export async function forEvent(
  eventId: number,
  viewerId: number | undefined,
  options: { limit?: number; before?: string | null } = {},
): Promise<ReviewPage> {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, options.limit ?? PAGE_SIZE));
  const [summary, page] = await Promise.all([
    repo.summary(eventId),
    repo.listForEvent(eventId, limit, options.before ?? null, viewerId),
  ]);

  if (viewerId === undefined) return { summary, reviews: page.reviews, hasMore: page.hasMore };

  const [{ hasTicket }, hasRated] = await Promise.all([
    repo.eligibility(viewerId, eventId),
    repo.hasRated(viewerId, eventId),
  ]);
  const viewer: ViewerState = {
    canReview: hasTicket,
    reason: hasTicket ? null : 'no_ticket',
    hasRated,
  };
  return { summary, reviews: page.reviews, hasMore: page.hasMore, viewer };
}

/**
 * The rest of one comment's thread, a batch at a time.
 *
 * Public, like the listing it continues: a reply is part of what the wall says about an event, and
 * an account is not needed to read any of it. The parent has to exist and be visible, so a hidden
 * comment does not hand out its thread through a second door.
 */
export async function repliesFor(
  reviewId: number,
  viewerId: number | undefined,
  options: { limit?: number; afterId?: number | null } = {},
): Promise<ReplyPage> {
  if (!(await repo.visibleExists(reviewId))) {
    throw err.notFound('not_found', 'Không tìm thấy bình luận này.');
  }
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, options.limit ?? PAGE_SIZE));
  return repo.listReplies(reviewId, limit, options.afterId ?? null, viewerId);
}

/**
 * Report a review into the moderation queue that already exists.
 *
 * `content_reports.target_type` has permitted `'review'` since feature 004 built the queue, so this
 * is a write into a working system rather than a second reporting concept for admins to watch.
 * A repeat by the same reader is not an error — they did the right thing twice.
 */
export async function report(
  userId: number,
  reviewId: number,
  reason: string,
): Promise<{ alreadyReported: boolean }> {
  if (!(await repo.visibleExists(reviewId))) {
    throw err.notFound('not_found', 'Không tìm thấy đánh giá này.');
  }
  const existing = await pool.query(
    `SELECT 1 FROM content_reports
      WHERE reporter_user_id = $1 AND target_type = 'review' AND target_id = $2`,
    [userId, reviewId],
  );
  if (existing.rows.length) return { alreadyReported: true };

  await pool.query(
    `INSERT INTO content_reports (reporter_user_id, target_type, target_id, reason, status)
     VALUES ($1, 'review', $2, $3, 'open')`,
    [userId, reviewId, reason.trim()],
  );
  return { alreadyReported: false };
}

/**
 * Moderation removal: hide, and record who did it.
 *
 * Hidden rather than deleted, because the report and the audit row must keep a subject an admin can
 * still read. Both writes are one transaction, so a removal can never exist without its audit entry
 * — the property SEC-09 is actually asking for.
 */
export async function removeAsAdmin(adminUserId: number, reviewId: number): Promise<void> {
  await withTransaction(async (db) => {
    if (!(await repo.setStatus(reviewId, 'removed', db))) {
      throw err.notFound('not_found', 'Không tìm thấy đánh giá này.');
    }
    await insertAudit(db, {
      actorUserId: adminUserId,
      action: 'review_removed',
      targetType: 'review',
      targetId: reviewId,
      outcome: 'applied',
    });
  });
}
