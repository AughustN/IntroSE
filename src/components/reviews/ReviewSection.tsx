import { useCallback, useEffect, useState } from "react";
import { reviewsClient, type Review, type ReviewPage } from "../../services/reviewsClient";
import { formatEventDate } from "../../services/formatDate";
import { DEFAULT_AVATAR_FG, avatarColor } from "../../services/defaultAvatar";
import ReviewForm from "./ReviewForm";
import StarRating from "./StarRating";

interface ReviewSectionProps {
  eventId: number;
  isSignedIn: boolean;
}

/** Why the form is not offered, in words the reader can act on. */
const BLOCKED: Record<string, string> = {
  no_ticket: "Chỉ tài khoản đã mua vé sự kiện này mới bình luận được.",
  event_not_started: "Sự kiện chưa diễn ra. Bình luận mở sau khi sự kiện bắt đầu.",
};

/**
 * The commenter's picture, or their initial on a colour.
 *
 * Seeded from the nickname rather than from the email the rest of the app uses, because a review
 * carries no address — the API deliberately does not hand one out. The consequence is that renaming
 * yourself recolours your past comments, which is a fair trade for not publishing an email.
 */
function CommenterAvatar({ nickname, avatarUrl }: { nickname: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        loading="lazy"
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-bold"
      style={{ backgroundColor: avatarColor(nickname), color: DEFAULT_AVATAR_FG }}
    >
      {nickname.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The comment wall for one event: what other buyers said, and a box for anyone holding a ticket.
 *
 * Reading is open to everyone — a comment exists to inform the next buyer, so gating it behind an
 * account would defeat the point. Writing is not: the server only accepts a comment from an account
 * with a ticket to this event, and only once the event has started, and it says which of the two
 * rules stopped you. So when the box is missing the page prints the reason instead of leaving a
 * hole where a control should be.
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
        setError(e instanceof Error ? e.message : "Không tải được bình luận.");
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
      setError(e instanceof Error ? e.message : "Không tải được bình luận.");
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
      // Keyed on the oldest row we hold, not on an offset: a comment posted while the reader scrolls
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
    const reason = window.prompt("Vì sao bạn báo cáo bình luận này?");
    if (!reason?.trim()) return;
    try {
      const result = await reviewsClient.report(review.id, reason.trim());
      setNotice(result.alreadyReported ? "Bạn đã báo cáo bình luận này rồi." : "Đã gửi báo cáo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được báo cáo.");
    }
  };

  const summary = page?.summary;
  const viewer = page?.viewer;
  const canWrite = Boolean(viewer?.canReview || viewer?.myReview);

  return (
    <section className="mt-16 border-t border-beige-kem/25 pt-10">
      <h2 className="font-display text-title-m font-black uppercase tracking-[0.02em] text-beige-kem">
        Bình luận
      </h2>

      {/*
        The score, at the size a score is worth reading.

        The average used to sit on the same baseline as the heading, in body type, next to a count —
        the one number a buyer scans a comment section for, set smaller than the section's title. It
        now leads the block, with the stars and the count as its caption.

        An unrated event says so in words rather than showing five empty stars, which reads as a bad
        score rather than as no score.
      */}
      <div className="mt-6 flex flex-col gap-6 border border-beige-kem/25 bg-surface-2 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        {summary && summary.rating !== null ? (
          <div className="flex items-center gap-5">
            <span className="font-display text-title-l font-black leading-none tabular-nums text-beige-kem">
              {summary.rating.toFixed(1)}
            </span>
            <div>
              <StarRating value={summary.rating} size={22} />
              <p className="mt-1.5 font-meta text-meta text-ink-soft">
                {summary.reviewCount} bình luận từ người đã mua vé
              </p>
            </div>
          </div>
        ) : (
          <p className="font-meta text-body text-ink-soft">
            {loading ? "Đang tải bình luận…" : "Chưa có bình luận nào cho sự kiện này."}
          </p>
        )}

        {/*
          What this reader may do, said in one line beside the score rather than as a control that
          silently is or is not there. The box itself opens underneath.
        */}
        {!isSignedIn ? (
          <p className="font-meta text-meta text-ink-soft sm:max-w-[18rem] sm:text-right">
            Đăng nhập bằng tài khoản đã mua vé để bình luận.
          </p>
        ) : !canWrite && viewer?.reason ? (
          <p className="font-meta text-meta text-ink-soft sm:max-w-[18rem] sm:text-right">
            {BLOCKED[viewer.reason]}
          </p>
        ) : null}
      </div>

      {canWrite && (
        <div className="mt-5">
          <ReviewForm
            existing={viewer?.myReview ?? null}
            onSubmit={submit}
            onDelete={viewer?.myReview ? withdraw : undefined}
          />
        </div>
      )}

      {notice && <p className="mt-4 font-meta text-meta text-ink-soft">{notice}</p>}
      {error && <p className="mt-4 font-meta text-meta text-burgundy-ink">{error}</p>}

      {loading ? (
        <p className="mt-8 font-meta text-meta text-ink-soft">Đang tải bình luận…</p>
      ) : (
        <ul className="mt-10">
          {all.map((review) => {
            /* A deleted account keeps its comment — the rating is a claim about the event, not
               about whether its author still has a login. */
            const nickname = review.author?.nickname ?? "Tài khoản đã xoá";
            return (
              <li
                key={review.id}
                className="flex gap-4 border-t border-beige-kem/20 py-6 first:border-t-0 first:pt-0"
              >
                <CommenterAvatar nickname={nickname} avatarUrl={review.author?.avatarUrl ?? null} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-body font-bold uppercase tracking-[0.04em] text-beige-kem">
                          {nickname}
                        </span>
                        {review.mine && (
                          <span className="label-eyebrow border border-beige-kem/40 px-2 py-0.5 text-ink-soft">
                            Bạn
                          </span>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        <StarRating value={review.rating} size={15} />
                        <span className="font-meta text-meta text-ink-soft">
                          {formatEventDate(review.createdAt.slice(0, 10), true)}
                          {review.edited && " · đã sửa"}
                        </span>
                      </div>
                    </div>

                    {isSignedIn && !review.mine && (
                      <button
                        type="button"
                        onClick={() => void report(review)}
                        className="font-meta text-meta text-ink-soft transition hover:text-burgundy-ink"
                      >
                        Báo cáo
                      </button>
                    )}
                  </div>

                  {/* Rendered as a text node. React escapes it, which is the whole of the
                      output-encoding story — nothing here may ever reach for
                      `dangerouslySetInnerHTML`. */}
                  {review.body && (
                    <p className="mt-3 whitespace-pre-wrap font-meta text-body leading-7 text-beige-kem/85">
                      {review.body}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="label-eyebrow mt-6 border border-beige-kem/30 px-5 py-2.5 text-beige-kem transition hover:border-burgundy hover:bg-bubblegum/20 disabled:opacity-50"
        >
          {loadingMore ? "Đang tải…" : "Xem thêm bình luận"}
        </button>
      )}
    </section>
  );
}
