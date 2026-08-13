// Reviews & ratings (009, UC-18 + the review half of UC-39), declared once for both sides.
// Mirrors specs/009-event-reviews/contracts/reviews.openapi.yaml.

/** Why a signed-in reader may not write a review. One rule: a paid, non-void ticket to this event.
 *  Kept as a union rather than collapsed to a boolean so a second rule can be named later without
 *  changing the shape of `ViewerState`. */
export type ReviewBlockReason = 'no_ticket';

export interface ReviewAuthor {
  nickname: string;
  avatarUrl: string | null;
}

export interface Review {
  id: number;
  eventId: number;
  /**
   * Whole stars, or null.
   *
   * Only an author's *first* comment on an event carries stars — that is the vote, and the unique
   * index makes it one per person. Later comments and every reply are prose, so the average cannot
   * be moved by talking more.
   */
  rating: number | null;
  /** The characters the author typed. Never markup — nothing renders it as any. */
  body: string | null;
  /** The comment this answers, or null for one on the wall itself. */
  parentId: number | null;
  /** Null when the account has been deleted; the review itself survives (FR-016). */
  author: ReviewAuthor | null;
  createdAt: string;
  /** Derived from `updatedAt > createdAt`, so it cannot fall out of step with the row. */
  edited: boolean;
  /** Present only for a signed-in reader; true on their own review. */
  mine?: boolean;
  /**
   * How many visible replies this comment has. Present on a listing's top-level comments.
   *
   * The replies themselves never travel with the listing — the wall is comments, and a thread is
   * opened by the reader who wants it, a batch at a time, from `GET /reviews/:id/replies`. So one
   * argument under one comment cannot decide the size of the page everybody else's comments arrive
   * in, and ten comments stay ten rows.
   */
  replyCount?: number;
}

/** One batch of a thread, read oldest-first from a cursor. */
export interface ReplyPage {
  replies: Review[];
  /** Whether more remain after the last one returned. */
  hasMore: boolean;
}

export interface ReviewInput {
  /**
   * Whole stars, 1–5. Required on an author's first comment about an event and refused on every
   * one after it, because the rating is already cast; replies never carry one.
   */
  rating?: number | null;
  body?: string | null;
  /** Post as a reply to this comment. A reply must carry text and may not carry stars. */
  parentId?: number | null;
}

export interface ReviewSummary {
  /** Mean of visible ratings. **Null when there are none** — unrated is not zero-star. */
  rating: number | null;
  /** How many people rated it — rated comments only, so it is a count of votes, not of talk. */
  reviewCount: number;
  /** Everything visible on the wall, replies included. Displayed beside the comments, not the score. */
  commentCount: number;
  /**
   * How the votes fell, as five counts: `[1★, 2★, 3★, 4★, 5★]`.
   *
   * The mean alone hides the shape. "3.0 from two people" is a five and a one — an event that
   * divides its audience — and reads identically to "3.0 from twenty", which is an event nobody
   * minded. The histogram is what tells those apart, and it sums to `reviewCount`.
   */
  distribution: [number, number, number, number, number];
}

/**
 * What the signed-in reader may do here.
 *
 * Returned with the listing so the page decides in one call whether to show the box and what shape
 * it takes, rather than three round trips to assemble one section.
 */
export interface ViewerState {
  canReview: boolean;
  reason: ReviewBlockReason | null;
  /** They have already cast their stars, so the box asks for text alone from here on. */
  hasRated: boolean;
}

export interface ReviewPage {
  summary: ReviewSummary;
  reviews: Review[];
  /** Whether another page exists older than the last item returned. */
  hasMore: boolean;
  /** Absent for a signed-out visitor. */
  viewer?: ViewerState;
}
