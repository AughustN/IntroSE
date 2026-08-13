import type { ReviewSummary } from "../../services/reviewsClient";
import StarRating from "./StarRating";

/**
 * The score, and the shape behind it.
 *
 * A mean on its own is a lossy summary of an audience: 3.0 out of two people is a five and a one,
 * an event that split the room, and it prints identically to 3.0 out of twenty, an event nobody
 * minded. The bars are what separate those, so they sit beside the number rather than on a page of
 * their own.
 *
 * An unrated event says so in words. Five empty bars and a 0.0 read as a bad score, which is a
 * different and much worse claim than "nobody has rated this yet".
 */
export default function ReviewSummaryPanel({
  summary,
  loading,
}: {
  summary: ReviewSummary | undefined;
  loading: boolean;
}) {
  if (!summary || summary.rating === null) {
    return (
      <div className="border border-beige-kem/25 bg-surface-2 p-5 sm:p-6">
        <p className="font-meta text-body text-ink-soft">
          {loading ? "Đang tải bình luận…" : "Chưa có đánh giá nào cho sự kiện này."}
        </p>
      </div>
    );
  }

  const total = summary.reviewCount;

  return (
    <div className="grid gap-6 border border-beige-kem/25 bg-surface-2 p-5 sm:grid-cols-[auto_1fr] sm:gap-10 sm:p-6">
      <div className="flex items-center gap-5 sm:flex-col sm:items-start sm:gap-2">
        <span className="font-display text-title-l font-black leading-none tabular-nums text-beige-kem">
          {summary.rating.toFixed(1)}
        </span>
        <div>
          <StarRating value={summary.rating} size={22} />
          {/* Two numbers, because they are two facts: how many people voted, and how much has been
              said under them. One figure covering both would move when an argument broke out in a
              thread and read as if the event had been rated again. */}
          <p className="mt-1.5 font-meta text-meta text-ink-soft">
            {total} đánh giá
            {summary.commentCount > total && ` · ${summary.commentCount} bình luận`}
          </p>
        </div>
      </div>

      {/*
        Five rows, always all five, high to low.
        Dropping the empty ones would make the bars a different chart per event and stop the eye
        comparing two of them; a star nobody gave is a fact worth its row.
      */}
      <ul className="flex flex-col justify-center gap-1.5">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = summary.distribution[star - 1] ?? 0;
          const share = total === 0 ? 0 : (count / total) * 100;
          return (
            <li key={star} className="flex items-center gap-3">
              <span className="w-8 shrink-0 font-meta text-meta tabular-nums text-ink-soft">
                {star} ★
              </span>
              <span
                className="h-2 min-w-0 flex-1 bg-beige-kem/10"
                role="img"
                aria-label={`${star} sao: ${count} đánh giá`}
              >
                <span
                  style={{ width: `${share}%` }}
                  className="block h-full bg-cam-dat transition-[width] duration-500"
                />
              </span>
              <span className="w-8 shrink-0 text-right font-meta text-meta tabular-nums text-ink-soft">
                {count}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
