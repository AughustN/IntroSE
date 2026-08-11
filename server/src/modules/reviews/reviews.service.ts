import type { Review, ReviewPage, ViewerState } from '@shared/reviews/types.js';
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
 * and a refund cannot leave a rating standing behind a purchase that no longer exists. The two
 * failures are distinct errors on purpose: "get a ticket" and "wait until it happens" are different
 * instructions, and a single generic refusal leaves the reader unable to act.
 */
async function requireEligible(userId: number, eventId: number): Promise<void> {
  const { hasTicket, hasStarted } = await repo.eligibility(userId, eventId);
  if (!hasTicket) {
    throw err.forbidden('no_ticket', 'Bạn cần có vé đã thanh toán cho sự kiện này để đánh giá.');
  }
  if (!hasStarted) {
    throw err.forbidden('event_not_started', 'Sự kiện chưa diễn ra nên chưa thể đánh giá.');
  }
}

/**
 * Write the caller's review of an event, or replace the one they already had.
 *
 * Deliberately not two operations. UC-18 A2 asks that a second attempt edit rather than duplicate,
 * and the repository's upsert against a unique index is what makes that true even when two devices
 * submit at the same instant.
 */
export async function submit(
  userId: number,
  eventId: number,
  input: { rating: number; body?: string | null },
): Promise<Review> {
  await requireEligible(userId, eventId);
  return repo.upsert(userId, eventId, input.rating, cleanBody(input.body));
}

export async function edit(
  userId: number,
  reviewId: number,
  input: { rating: number; body?: string | null },
): Promise<Review> {
  const updated = await repo.updateOwn(userId, reviewId, input.rating, cleanBody(input.body));
  // Not found rather than forbidden: someone else's review answers the same way a nonexistent one
  // does, so walking ids discloses nothing about what exists.
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
 * The summary, a page of reviews, and — for a signed-in reader — whether they may write one, why
 * not if they may not, and the review they already have. Three round trips to assemble one section
 * would make the section's loading state the most complicated thing on the page.
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

  const [{ hasTicket, hasStarted }, myReview] = await Promise.all([
    repo.eligibility(viewerId, eventId),
    repo.findByAuthor(viewerId, eventId),
  ]);
  const viewer: ViewerState = {
    canReview: hasTicket && hasStarted,
    reason: !hasTicket ? 'no_ticket' : !hasStarted ? 'event_not_started' : null,
    myReview,
  };
  return { summary, reviews: page.reviews, hasMore: page.hasMore, viewer };
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
