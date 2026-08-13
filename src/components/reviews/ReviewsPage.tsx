import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, MapPin } from "lucide-react";
import type { MovieEvent } from "../../types";
import { formatEventDate } from "../../services/formatDate";
import { formatVnd } from "../../services/currency";
import { reviewsClient, type Review, type ReviewPage } from "../../services/reviewsClient";
import ConfirmDialog from "../ConfirmDialog";
import ReportDialog from "./ReportDialog";
import ReviewForm from "./ReviewForm";
import ReviewItem, { type ReviewItemActions } from "./ReviewItem";
import ReviewNotice from "./ReviewNotice";
import ReviewSummaryPanel from "./ReviewSummaryPanel";

interface ReviewsPageProps {
  /** The catalogue event this page belongs to. Its `eventId` is the numeric id the API takes. */
  event: MovieEvent;
  eventId: number;
  isSignedIn: boolean;
  /** Same list the event page shows under "sự kiện tương tự" — the aside is the second column. */
  relatedEvents: MovieEvent[];
  onBack: () => void;
  onOpenEvent: (event: MovieEvent) => void;
}

/**
 * A section heading, marked by a rule in the accent colour rather than by size alone.
 *
 * Borrowed from the reference layout, and it earns its place on a two-column page: with content on
 * both sides of the fold the eye needs a repeated mark that says "a new block starts here", and a
 * heading a few points larger than the text under it does not carry that far.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
      <span aria-hidden className="h-5 w-1 shrink-0 bg-cam-dat" />
      {children}
    </h2>
  );
}

/**
 * Every comment on one event, on a page of its own (`/events/:slug/reviews`).
 *
 * Split out of the event page for the reason IMDb splits it: a wall that grows without bound was
 * living underneath the thing people came to buy, so a busy event pushed its own showtimes, its
 * lineup and its related events off the bottom of a page nobody scrolls to the end of. The event
 * page now carries a summary and the newest few (see `ReviewPreview`); everything else is here,
 * where paging is the page's whole job.
 *
 * It is also what let the spoiler curtain go. A blur existed because comments about what happened
 * sat on the page selling tickets to the next night; reaching this page is a deliberate press on a
 * link that says what it opens, which is the same consent the curtain was collecting and one fewer
 * thing between a reader and the text.
 *
 * One request carries the summary, the first page and the viewer's own state, so the page has a
 * single loading condition instead of three that can disagree.
 */
export default function ReviewsPage({
  event,
  eventId,
  isSignedIn,
  relatedEvents,
  onBack,
  onOpenEvent,
}: ReviewsPageProps) {
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [older, setOlder] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The comment awaiting a "yes, delete it", and the one awaiting a reason. Both are in-page. */
  const [pendingDelete, setPendingDelete] = useState<Review | null>(null);
  const [reportTarget, setReportTarget] = useState<Review | null>(null);

  /*
   * Re-read when the session appears, not only when the event does.
   *
   * This listing is `optionalAuth`: without a token it answers 200 with everybody's comments and no
   * `mine`, no `viewer`. The access token lives in memory and is restored asynchronously on load, so
   * a page opened by URL or by F5 fetches *before* that finishes and gets the anonymous answer —
   * which is why your own comments came back offering "báo cáo" instead of "sửa / xoá", and why the
   * box to write in was missing. `withAuthRetry` cannot save this one: it retries on 401, and the
   * anonymous answer here is a perfectly good 200.
   */
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
  }, [eventId, isSignedIn]);

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

  const submit = async (rating: number | null, body: string) => {
    await reviewsClient.submit(eventId, { rating, body });
    await load();
  };

  const replyTo = async (parentId: number, body: string) => {
    await reviewsClient.submit(eventId, { body, parentId });
    await load();
  };

  const saveEdit = async (reviewId: number, rating: number | null, body: string) => {
    await reviewsClient.edit(reviewId, { rating, body });
    await load();
  };

  /** Confirmed in `ConfirmDialog`, not by the browser — see the dialogs at the foot of the page. */
  const withdraw = async (review: Review) => {
    setPendingDelete(null);
    try {
      await reviewsClient.withdraw(review.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được bình luận.");
    }
  };

  const report = async (review: Review, reason: string) => {
    const result = await reviewsClient.report(review.id, reason);
    setReportTarget(null);
    setNotice(
      result.alreadyReported
        ? "Bạn đã báo cáo bình luận này rồi."
        : "Đã gửi báo cáo tới quản trị viên.",
    );
  };

  /** The report control is offered to everyone; only sending it needs a name to attach. */
  const askToReport = (review: Review) => {
    if (!isSignedIn) {
      setNotice("Đăng nhập để báo cáo bình luận này.");
      return;
    }
    setReportTarget(review);
  };

  const viewer = page?.viewer;
  const canWrite = Boolean(viewer?.canReview);
  /* The stars are asked for once — on the first thing this reader says about the event. */
  const needsRating = canWrite && !viewer?.hasRated;

  const itemActions: ReviewItemActions = {
    isSignedIn,
    canReply: canWrite,
    onReply: replyTo,
    onEdit: saveEdit,
    onDelete: (review) => setPendingDelete(review),
    onReport: askToReport,
  };

  return (
    // A plain `div`: the app shell already owns the page's one `<main>`, and a second inside it
    // would be invalid and would give assistive tech two "main content" landmarks to choose from.
    <div className="w-full">
      {/*
        The masthead: one dark band across the full width, with the event's own artwork behind it.

        It is doing the job a breadcrumb cannot. This page is reachable from a link, from a Back
        button and from a pasted URL, and in the last two cases the reader arrives at a wall of
        strangers' opinions with nothing on screen saying which event they are about. The poster and
        the title answer that above the fold, and the band's darkness is what lets the artwork sit
        under live text without fighting it.
      */}
      <header className="relative isolate overflow-hidden bg-black">
        {event.imageUrl && (
          <>
            <img
              src={event.imageUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 -z-10 h-full w-full object-cover opacity-25"
            />
            {/* Two washes, not one: the flat tint keeps the text legible over a bright poster and
                the gradient keeps the right-hand end dark enough for the nav that sits there. */}
            <div aria-hidden className="absolute inset-0 -z-10 bg-black/65" />
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/70 to-black/85"
            />
          </>
        )}

        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
          {/*
            Fixed whites here, not the theme's ink tokens.

            Everything else on the page follows the reader's light or dark setting, and it has to:
            those tokens are defined against the page's own background. This band is black in both
            themes, so a token that resolves to near-black ink in light mode would print the title
            invisibly on it — which is exactly what it did.
          */}
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 font-meta text-body text-white/70 transition hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
            Quay về trang chủ
          </button>

          <div className="mt-6 flex items-end gap-5">
            {event.imageUrl && (
              <img
                src={event.imageUrl}
                alt={event.title}
                referrerPolicy="no-referrer"
                className="h-[132px] w-[92px] shrink-0 border border-white/20 object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="truncate font-meta text-body font-bold text-white/70">{event.title}</p>
              <h1 className="mt-1 font-display text-title-m font-black uppercase tracking-[0.02em] text-white">
                Bình luận &amp; đánh giá
              </h1>
            </div>
          </div>
        </div>
      </header>

      {/*
        Two columns from `lg` up, and one below it.

        The aside is not a sidebar of controls — it is the way out. A reader who came for opinions
        about this event and decided against it has somewhere to go that is not the Back button, and
        on a page with no purchase controls of its own that is the only forward path there is.
      */}
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <div className="min-w-0">
          <ReviewSummaryPanel summary={page?.summary} loading={loading} />

          {notice && <ReviewNotice tone="ok">{notice}</ReviewNotice>}
          {error && <ReviewNotice tone="error">{error}</ReviewNotice>}

          <div className="mt-10">
            <SectionHeading>
              {page?.summary.commentCount
                ? `${page.summary.commentCount} bình luận`
                : "Bình luận"}
            </SectionHeading>
          </div>

          {loading ? (
            <p className="mt-6 font-meta text-meta text-ink-soft">Đang tải bình luận…</p>
          ) : all.length === 0 ? (
            <p className="mt-6 font-meta text-body text-ink-soft">
              Chưa có bình luận nào. Hãy là người đầu tiên.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-beige-kem/15">
              {all.map((review) => (
                <li key={review.id} className="py-6 first:pt-0">
                  <ReviewItem review={review} actions={itemActions} />
                </li>
              ))}
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

          {/*
            The composer, last in the column and staying there.

            Writing at the foot of a thread is the shape every comment section has, and it makes the
            send visible — the new comment lands directly above the box it came out of. It stays
            after a send, blank and ready: a buyer may come back with a second thought as often as
            they like. Only the stars are once, which is what `needsRating` turns off from their
            first comment onwards.
          */}
          {canWrite && (
            <div className="mt-10">
              <SectionHeading>{needsRating ? "Viết đánh giá" : "Viết bình luận"}</SectionHeading>
              <div className="mt-4">
                <ReviewForm
                  withStars={needsRating}
                  onSubmit={submit}
                  placeholder={
                    needsRating
                      ? "Bạn thấy sự kiện thế nào? (không bắt buộc)"
                      : "Viết bình luận của bạn…"
                  }
                />
              </div>
            </div>
          )}
        </div>

        <aside className="min-w-0">
          <SectionHeading>Sự kiện tương tự</SectionHeading>

          {relatedEvents.length === 0 ? (
            <p className="mt-4 font-meta text-meta text-ink-soft">
              Chưa có gợi ý nào cho sự kiện này.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {relatedEvents.slice(0, 6).map((related) => (
                <li key={related.id}>
                  {/*
                    The whole card is the control, not a link buried in it. A 320px column has room
                    for one target per row and splitting it into a picture, a title and a button
                    would make three ways to do one thing.
                  */}
                  <button
                    type="button"
                    onClick={() => onOpenEvent(related)}
                    className="flex w-full items-stretch gap-3 border border-beige-kem/20 bg-surface-2 p-2 text-left transition hover:border-cam-dat"
                  >
                    <img
                      src={related.imageUrl}
                      alt=""
                      aria-hidden="true"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="h-[84px] w-[60px] shrink-0 object-cover"
                    />
                    {/*
                      Date, city and price, and nothing else.

                      These cards come from the catalogue *listing*, which carries a card's worth of
                      fields; rating, venue and the rest arrive only with an event's own detail
                      request. Printing them here would show every suggestion as unrated at zero
                      stars in a venue called nothing.
                    */}
                    <div className="flex min-w-0 flex-col justify-center gap-1.5">
                      <p className="line-clamp-2 font-display text-body font-bold uppercase leading-tight tracking-[0.02em] text-beige-kem">
                        {related.title}
                      </p>
                      {related.dates[0] && (
                        <span className="flex items-center gap-1.5 font-meta text-eyebrow text-ink-soft">
                          <CalendarDays className="h-3 w-3 shrink-0" />
                          <span className="truncate">{formatEventDate(related.dates[0])}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 font-meta text-eyebrow text-ink-soft">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{related.city}</span>
                        {related.price > 0 && (
                          <span className="ml-auto shrink-0 tabular-nums text-beige-kem/80">
                            {formatVnd(related.price)}
                          </span>
                        )}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/*
        Both questions are asked in the page, in the same dialog the rest of the site uses.

        `window.confirm` and `window.prompt` are the browser's, not this site's: unstyled, unlimited
        in length, unable to say what happens next, and on repeat use some browsers offer to
        suppress them entirely — which would silently turn "delete?" into "deleted".
      */}
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
          onConfirm={() => void withdraw(pendingDelete)}
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
    </div>
  );
}
