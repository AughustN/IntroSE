// Reviews & ratings (009, UC-18 + the review half of UC-39), declared once for both sides.
// Mirrors specs/009-event-reviews/contracts/reviews.openapi.yaml.

/** Why a signed-in reader may not write a review. Two rules, reported separately so the interface
 *  can say which one failed rather than just omitting the form. */
export type ReviewBlockReason = 'no_ticket' | 'event_not_started';

export interface ReviewAuthor {
  nickname: string;
  avatarUrl: string | null;
}

export interface Review {
  id: number;
  eventId: number;
  rating: number;
  /** The characters the author typed. Never markup — nothing renders it as any. */
  body: string | null;
  /** Null when the account has been deleted; the review itself survives (FR-016). */
  author: ReviewAuthor | null;
  createdAt: string;
  /** Derived from `updatedAt > createdAt`, so it cannot fall out of step with the row. */
  edited: boolean;
  /** Present only for a signed-in reader; true on their own review. */
  mine?: boolean;
}

export interface ReviewInput {
  /** Whole stars, 1–5. Required: text alone is not a review (UC-18 A3). */
  rating: number;
  body?: string | null;
}

export interface ReviewSummary {
  /** Mean of visible ratings. **Null when there are none** — unrated is not zero-star. */
  rating: number | null;
  reviewCount: number;
}

/**
 * What the signed-in reader may do here.
 *
 * Returned with the listing so the page decides in one call whether to show the form, the reader's
 * existing review, or the reason neither applies — rather than three round trips to assemble one
 * section.
 */
export interface ViewerState {
  canReview: boolean;
  reason: ReviewBlockReason | null;
  myReview: Review | null;
}

export interface ReviewPage {
  summary: ReviewSummary;
  reviews: Review[];
  /** Whether another page exists older than the last item returned. */
  hasMore: boolean;
  /** Absent for a signed-out visitor. */
  viewer?: ViewerState;
}
