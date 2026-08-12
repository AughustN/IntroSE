import { useCallback, useEffect, useState } from "react";
import { reviewsClient, type Review, type ReviewPage } from "../../services/reviewsClient";
import { formatEventDate } from "../../services/formatDate";
import ReviewForm from "./ReviewForm";
import StarRating from "./StarRating";

interface ReviewSectionProps {
  eventId: number;
  isSignedIn: boolean;
}

/** Why the form is not offered, in words the reader can act on. */
const BLOCKED: Record<string, string> = {
  no_ticket: "Chỉ người đã mua vé sự kiện này mới đánh giá được.",
  event_not_started: "Sự kiện chưa diễn ra nên chưa thể đánh giá.",
};

/**
 * Ratings and reviews for one event.
 *
 * Reading is open to everyone — a rating exists to inform the next buyer, so gating it behind an
 * account would defeat the point. The write side appears only for someone the server says may use
 * it, and when it does not appear the reason is shown rather than the control silently missing.
 *
 * One request carries the summary, the first page and the viewer's own state, so the section has a
 * single loading condition instead of three that can disagree.
 */
export default function ReviewSection({ eventId, isSignedIn }: ReviewSectionProps) {
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [older, setOlder] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // State is set inside the promise callbacks, not in the effect body — the shape the
    // cascading-render rule asks for, and the shape an asynchronous fetch wants anyway.
    reviewsClient
      .list(eventId)
      .then((next) => {
        if (cancelled) return;
        setPage(next);
        setOlder([]);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Không tải được đánh giá.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  /**
   * Refresh after the reader's own write.
   *
   * No cancellation guard: this only runs from a button the reader just pressed on this event, so
   * there is no second request to lose a race with — unlike the mount fetch above, which can be
   * outlived by the reader opening a different event.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPage(await reviewsClient.list(eventId));
      setOlder([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được đánh giá.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const all = page ? [...page.reviews, ...older] : [];
  const hasMore = older.length ? true : (page?.hasMore ?? false);

  const loadMore = async () => {
    const last = all[all.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      // Keyed on the oldest row we hold, not on an offset: a review posted while the reader scrolls
      // would shift every offset by one and make them see one twice and miss another.
      const next = await reviewsClient.list(eventId, { before: last.createdAt });
      setOlder((prior) => [...prior, ...next.reviews]);
      if (!next.hasMore) setPage((current) => (current ? { ...current, hasMore: false } : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải thêm được.");
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async (rating: number, body: string) => {
    await reviewsClient.submit(eventId, { rating, body });
    await load();
  };

  const withdraw = async () => {
    const mine = page?.viewer?.myReview;
    if (!mine) return;
    await reviewsClient.withdraw(mine.id);
    await load();
  };

  const report = async (review: Review) => {
    const reason = window.prompt("Vì sao bạn báo cáo đánh giá này?");
    if (!reason?.trim()) return;
    try {
      const result = await reviewsClient.report(review.id, reason.trim());
      setNotice(result.alreadyReported ? "Bạn đã báo cáo đánh giá này rồi." : "Đã gửi báo cáo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được báo cáo.");
    }
  };

  const summary = page?.summary;
  const viewer = page?.viewer;

  return (
    <section className="mt-16 border-t border-beige-kem/25 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-display text-title-m font-black uppercase tracking-[0.02em] text-beige-kem">
          Đánh giá
        </h2>
        {summary && summary.rating !== null && (
          <div className="flex items-center gap-3">
            <StarRating value={summary.rating} />
            <span className="font-meta text-body text-beige-kem">
              {summary.rating.toFixed(1)}
              <span className="text-ink-soft"> · {summary.reviewCount} đánh giá</span>
            </span>
          </div>
        )}
      </div>

      {/* An unrated event is not a zero-star event, so it says so in words rather than showing five
          empty stars, which reads as a bad score. */}
      {summary && summary.rating === null && !loading && (
        <p className="mt-3 font-meta text-body text-ink-soft">Chưa có đánh giá nào cho sự kiện này.</p>
      )}

      <div className="mt-6">
        {!isSignedIn ? (
          <p className="font-meta text-meta text-ink-soft">Đăng nhập để đánh giá sự kiện bạn đã tham dự.</p>
        ) : viewer?.canReview || viewer?.myReview ? (
          <ReviewForm
            existing={viewer?.myReview ?? null}
            onSubmit={submit}
            onDelete={viewer?.myReview ? withdraw : undefined}
          />
        ) : viewer?.reason ? (
          <p className="font-meta text-meta text-ink-soft">{BLOCKED[viewer.reason]}</p>
        ) : null}
      </div>

      {notice && <p className="mt-4 font-meta text-meta text-ink-soft">{notice}</p>}
      {error && <p className="mt-4 font-meta text-meta text-burgundy-ink">{error}</p>}

      {loading ? (
        <p className="mt-8 font-meta text-meta text-ink-soft">Đang tải đánh giá…</p>
      ) : (
        <ul className="mt-8 space-y-6">
          {all.map((review) => (
            <li key={review.id} className="border-t border-beige-kem/20 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <StarRating value={review.rating} size={16} />
                  <span className="font-meta text-meta font-bold text-beige-kem">
                    {/* A deleted account keeps its review — the rating is a claim about the event,
                        not about whether its author still has a login. */}
                    {review.author?.nickname ?? "Tài khoản đã xoá"}
                  </span>
                  <span className="font-meta text-eyebrow text-ink-soft">
                    {formatEventDate(review.createdAt.slice(0, 10), true)}
                    {review.edited && " · đã sửa"}
                  </span>
                </div>
                {isSignedIn && !review.mine && (
                  <button
                    type="button"
                    onClick={() => void report(review)}
                    className="font-meta text-eyebrow text-ink-soft transition hover:text-burgundy-ink"
                  >
                    Báo cáo
                  </button>
                )}
              </div>
              {/* Rendered as a text node. React escapes it, which is the whole of the output-encoding
                  story — nothing here may ever reach for `dangerouslySetInnerHTML`. */}
              {review.body && (
                <p className="mt-2 whitespace-pre-wrap font-meta text-body leading-7 text-beige-kem/85">
                  {review.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="label-eyebrow mt-8 border border-beige-kem/30 px-5 py-2 text-beige-kem transition hover:border-burgundy disabled:opacity-50"
        >
          {loadingMore ? "Đang tải…" : "Xem thêm đánh giá"}
        </button>
      )}
    </section>
  );
}
