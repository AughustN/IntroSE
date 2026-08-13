import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { reviewsClient, type Review } from "../../services/reviewsClient";
import { formatEventDate } from "../../services/formatDate";
import CommenterAvatar from "./CommenterAvatar";
import ReviewForm from "./ReviewForm";
import ReviewMenu, { type ReviewMenuItem } from "./ReviewMenu";
import StarRating from "./StarRating";

export interface ReviewItemActions {
  isSignedIn: boolean;
  /** Whether this reader holds a ticket, which is what the reply box needs as much as the composer. */
  canReply: boolean;
  onReply: (parentId: number, body: string) => Promise<void>;
  onEdit: (reviewId: number, rating: number | null, body: string) => Promise<void>;
  onDelete: (review: Review) => void;
  onReport: (review: Review) => void;
}

/** How many more of a thread each press of "xem thêm" fetches. */
const REPLY_BATCH = 5;

/**
 * One comment, its thread, and everything that can be done to it.
 *
 * Replies are one level deep and no more: the server flattens a reply to a reply onto the comment
 * both are under, so this never has to render a tree, only a comment and a list. That is the shape
 * every reader already knows from every comment section they have used, and it is the shape that
 * survives a phone screen — nesting past one level spends the width on indentation.
 *
 * A long thread opens a batch at a time, and the batches come from the server. The listing carries
 * the first couple of replies and a count; the rest are fetched here on request, so a comment with
 * fifty answers costs the page two rows and one button until somebody actually wants the argument.
 */
export default function ReviewItem({
  review,
  actions,
  reply = false,
}: {
  review: Review;
  /**
   * What this reader may do to this comment. Omitted on the event page's preview, which is a
   * window and not a wall: with no actions there is no menu, no reply control and no editor, so a
   * read-only rendering needs no second set of branches through the component.
   */
  actions?: ReviewItemActions;
  /** This is itself a reply: smaller, and its own replies belong to its parent. */
  reply?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  /*
   * The thread, once somebody opens it — tagged with the count it was read against.
   *
   * A refreshed listing (after a reply, an edit or a deletion) hands this comment down with a new
   * `replyCount`, and what was on screen was paged against the old one: keeping it could repeat a
   * reply or hide the one just posted. Comparing the tag during render collapses the thread exactly
   * then, which an effect would do a frame later and one render too late — and is what the
   * cascading-render rule is about.
   */
  const [thread, setThread] = useState<{ against?: number; items: Review[]; done: boolean }>({
    items: [],
    done: false,
  });
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const total = review.replyCount ?? 0;
  const open = thread.against === total;
  const shown = open ? thread.items : [];
  /*
   * What the button offers, from the server's own count rather than a guess: a control promising
   * "3 more" that turns out to have none is worse than no control. `done` covers the last press,
   * where the batch came back short and the count cannot say so on its own.
   */
  const remaining = thread.done ? 0 : Math.max(total - shown.length, 0);

  const loadMoreReplies = async () => {
    if (loadingThread) return;
    setLoadingThread(true);
    setThreadError(null);
    try {
      const last = shown[shown.length - 1];
      const next = await reviewsClient.replies(review.id, { limit: REPLY_BATCH, after: last?.id });
      setThread({ against: total, items: [...shown, ...next.replies], done: !next.hasMore });
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Không tải được trả lời.");
    } finally {
      setLoadingThread(false);
    }
  };

  /* A deleted account keeps its comment — the rating is a claim about the event, not about whether
     its author still has a login. */
  const nickname = review.author?.nickname ?? "Tài khoản đã xoá";

  /*
   * The menu is on every comment, top level or reply, and holds what this reader may actually do
   * to *this* comment.
   *
   * Its contents differ because the server's do: editing and deleting are scoped to the author in
   * SQL (`user_id` is in the `WHERE`), so offering them on somebody else's comment would be two
   * options that answer 404. What is left there is reporting — the same action the button beside
   * the menu performs, which is its shortcut rather than its replacement. A control that vanishes
   * from half the comments reads as a bug; one that changes what it offers reads as a menu.
   */
  const menu: ReviewMenuItem[] = !actions
    ? []
    : review.mine
      ? [
          { label: "Sửa bình luận", onSelect: () => setEditing(true) },
          { label: "Xoá bình luận", onSelect: () => actions.onDelete(review), danger: true },
        ]
      : [{ label: "Báo cáo bình luận", onSelect: () => actions.onReport(review), danger: true }];

  /*
   * Anybody's comment but your own, signed in or not.
   *
   * Gating the button on a session hid it from the person most likely to want it — somebody reading
   * a hostile comment before they have logged in — and left no trace that reporting exists at all.
   * The handler says "sign in first" instead, which is a sentence, where a missing button is not.
   */
  const canReport = Boolean(actions && !review.mine);

  return (
    <div className="flex gap-3">
      <CommenterAvatar
        nickname={nickname}
        avatarUrl={review.author?.avatarUrl ?? null}
        size={reply ? 32 : 40}
      />

      <div className="min-w-0 flex-1">
        {/* Not `flex-wrap`: the menu is anchored to the top right corner of the comment at every
            width, and wrapping would drop it under the name on a phone. */}
        <div className="flex items-start justify-between gap-x-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span
                className={`font-display font-bold uppercase tracking-[0.04em] text-beige-kem ${
                  reply ? "text-meta" : "text-body"
                }`}
              >
                {nickname}
              </span>
              {review.mine && (
                <span className="label-eyebrow border border-beige-kem/40 px-2 py-0.5 text-ink-soft">
                  Bạn
                </span>
              )}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {/* Stars only where there are any: a later comment and every reply carry none, and
                  five empty ones would read as nought out of five rather than as no vote. */}
              {review.rating !== null && <StarRating value={review.rating} size={15} />}
              <span className="font-meta text-meta text-ink-soft">
                {formatEventDate(review.createdAt.slice(0, 10), true)}
                {review.edited && " · đã sửa"}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {canReport && (
              <button
                type="button"
                onClick={() => actions?.onReport(review)}
                aria-label="Báo cáo bình luận"
                title="Báo cáo bình luận"
                className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-burgundy/15 hover:text-burgundy-ink"
              >
                <CircleAlert className="h-4 w-4" />
              </button>
            )}
            <ReviewMenu items={menu} />
          </div>
        </div>

        {editing && actions ? (
          <div className="mt-3">
            <ReviewForm
              existing={review}
              withStars={review.rating !== null}
              onSubmit={async (rating, body) => {
                await actions.onEdit(review.id, rating, body);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          /* Rendered as a text node. React escapes it, which is the whole of the output-encoding
             story — nothing here may ever reach for `dangerouslySetInnerHTML`. */
          review.body && (
            <p className="mt-2 whitespace-pre-wrap font-meta text-body leading-7 text-beige-kem/85">
              {review.body}
            </p>
          )
        )}

        {actions?.canReply && !editing && (
          <button
            type="button"
            onClick={() => setReplying((open) => !open)}
            className="mt-2 font-meta text-meta font-bold text-ink-soft transition hover:text-beige-kem"
          >
            {replying ? "Đóng" : "Trả lời"}
          </button>
        )}

        {replying && actions && (
          <div className="mt-3">
            <ReviewForm
              compact
              placeholder={`Trả lời ${nickname}…`}
              submitLabel="Gửi"
              onSubmit={async (_rating, body) => {
                await actions.onReply(review.id, body);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          </div>
        )}

        {/*
          The thread lives entirely behind this one control.

          Closed, a comment with fifty answers is one line saying so. Opened, it is a hairline down
          the left and nothing else — a boxed or tinted thread reads as a different kind of content
          from the comment above it, when it is the same thing said in answer. The rule plus the
          smaller avatar carry the relationship on their own, and cost 17px of width instead of a
          panel's worth.
        */}
        {total > 0 && (
          <div
            className={
              shown.length > 0 ? "mt-4 space-y-5 border-l border-beige-kem/20 pl-4" : "mt-2"
            }
          >
            {shown.map((child) => (
              <ReviewItem key={child.id} review={child} actions={actions} reply />
            ))}

            {/* Under the replies, not above them: it continues the conversation the reader is
                already reading downwards, the way the wall's own "load more" does. */}
            <div className="flex flex-wrap items-center gap-4">
              {remaining > 0 && (
                <button
                  type="button"
                  onClick={() => void loadMoreReplies()}
                  disabled={loadingThread}
                  className="font-meta text-meta font-bold text-ink-soft transition hover:text-beige-kem disabled:opacity-50"
                >
                  {loadingThread
                    ? "Đang tải…"
                    : open
                      ? `Xem thêm ${remaining} trả lời`
                      : `Xem ${remaining} trả lời`}
                </button>
              )}

              {/* Only once something is open, and only worth offering when there is enough on
                  screen to be in the way. */}
              {shown.length > 0 && (
                <button
                  type="button"
                  onClick={() => setThread({ items: [], done: false })}
                  className="font-meta text-meta text-ink-soft transition hover:text-beige-kem"
                >
                  Ẩn trả lời
                </button>
              )}
            </div>

            {threadError && (
              <p className="font-meta text-meta text-burgundy-ink">{threadError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
