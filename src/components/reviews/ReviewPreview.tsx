import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { reviewsClient, type Review, type ReviewPage } from "../../services/reviewsClient";
import ConfirmDialog from "../ConfirmDialog";
import ReportDialog from "./ReportDialog";
import ReviewItem, { type ReviewItemActions } from "./ReviewItem";
import ReviewNotice from "./ReviewNotice";
import ReviewSummaryPanel from "./ReviewSummaryPanel";

interface ReviewPreviewProps {
  eventId: number;
  isSignedIn: boolean;
  /** Opens `/events/:slug/reviews`, where the whole wall and the box to write in live. */
  onOpenAll: () => void;
}

/** How many of the newest comments the event page carries before handing over to the full page. */
const RECENT = 3;

/**
 * The event page's window onto its comments: the score, the shape of the votes, and the newest few.
 *
 * Bounded, not read-only. Writing, replying and paging belong to `/events/:slug/reviews`, so this
 * section stays a fixed height however busy the event gets and cannot push the showtimes, the
 * lineup and the related events off the bottom of the page. But the three comments it does show are
 * real comments: the author of one can edit or delete it here, and anyone can report one, because a
 * control that is visible on one page and missing on another reads as broken rather than as tidy.
 *
 * That split is also why nothing here is blurred any more. The curtain existed to stop comments
 * about what happened ambushing somebody choosing a ticket for the next night; three comments under
 * a heading that says what they are, with the rest a deliberate press away, is the same consent
 * collected by the layout instead of by a wall of frosted glass.
 */
export default function ReviewPreview({ eventId, isSignedIn, onOpenAll }: ReviewPreviewProps) {
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Both questions are asked in the page — see the dialogs at the foot of the section. */
  const [pendingDelete, setPendingDelete] = useState<Review | null>(null);
  const [reportTarget, setReportTarget] = useState<Review | null>(null);

  /*
   * Keyed on the session as well as the event: this listing is `optionalAuth` and answers 200 to an
   * anonymous caller, so a fetch that beats the in-memory access token being restored comes back
   * without `mine` — and every comment, including the reader's own, is then drawn as somebody
   * else's. See the longer note in `ReviewsPage`.
   */
  useEffect(() => {
    let cancelled = false;
    // Nothing is set in the effect body — only in the callbacks below. A synchronous `setLoading`
    // here is a second render before the request has even left, which is the cascading-render shape
    // the lint rule (and `ReviewsPage`, which is written the same way) exists to keep out.
    reviewsClient
      .list(eventId, { limit: RECENT })
      .then((next) => {
        if (cancelled) return;
        setPage(next);
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
  }, [eventId, isSignedIn]);

  /** Re-read the three after the reader's own edit, deletion or report. */
  const reload = useCallback(async () => {
    try {
      setPage(await reviewsClient.list(eventId, { limit: RECENT }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được bình luận.");
    }
  }, [eventId]);

  const recent = page?.reviews ?? [];
  const total = page?.summary.commentCount ?? 0;

  const actions: ReviewItemActions = {
    isSignedIn,
    // Replying needs the thread it belongs to, and the thread is on the full page.
    canReply: false,
    onReply: async () => onOpenAll(),
    onEdit: async (reviewId, rating, body) => {
      await reviewsClient.edit(reviewId, { rating, body });
      await reload();
    },
    onDelete: (review: Review) => setPendingDelete(review),
    onReport: (review: Review) => {
      // The control is offered to everyone; only sending needs a name to attach the report to.
      if (!isSignedIn) setNotice("Đăng nhập để báo cáo bình luận này.");
      else setReportTarget(review);
    },
  };

  async function deleteComment(review: Review) {
    setPendingDelete(null);
    try {
      await reviewsClient.withdraw(review.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được bình luận.");
    }
  }

  async function report(review: Review, reason: string) {
    const result = await reviewsClient.report(review.id, reason);
    setReportTarget(null);
    setNotice(
      result.alreadyReported
        ? "Bạn đã báo cáo bình luận này rồi."
        : "Đã gửi báo cáo tới quản trị viên.",
    );
  }

  return (
    <section className="mt-16 border-t border-beige-kem/25 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-title-m font-black uppercase tracking-[0.02em] text-beige-kem">
          Đánh giá của người xem
        </h2>
        <button
          type="button"
          onClick={onOpenAll}
          className="flex items-center gap-1 font-meta text-meta font-bold text-cam-dat transition hover:brightness-110"
        >
          {total > 0 ? `Xem tất cả ${total} bình luận` : "Viết bình luận"}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6">
        <ReviewSummaryPanel summary={page?.summary} loading={loading} />
      </div>

      {notice && <ReviewNotice tone="ok">{notice}</ReviewNotice>}
      {error && <ReviewNotice tone="error">{error}</ReviewNotice>}

      {recent.length > 0 && (
        <>
          <p className="label-eyebrow mt-8 text-ink-soft">Bình luận gần đây</p>
          <ul className="mt-4 divide-y divide-beige-kem/15">
            {recent.map((review) => (
              <li key={review.id} className="py-5 first:pt-0">
                <ReviewItem review={review} actions={actions} />
              </li>
            ))}
          </ul>
        </>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Xoá bình luận"
          message={
            pendingDelete.replyCount
              ? `Bình luận này và ${pendingDelete.replyCount} trả lời dưới nó sẽ bị xoá. Không thể hoàn tác.`
              : "Bình luận này sẽ bị xoá. Không thể hoàn tác."
          }
          confirmLabel="Xoá bình luận"
          cancelLabel="Huỷ"
          tone="danger"
          onConfirm={() => void deleteComment(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {reportTarget && (
        <ReportDialog
          authorName={reportTarget.author?.nickname ?? "Tài khoản đã xoá"}
          onSubmit={(reason) => report(reportTarget, reason)}
          onCancel={() => setReportTarget(null)}
        />
      )}
    </section>
  );
}
