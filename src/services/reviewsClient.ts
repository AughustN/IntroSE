import type {
  ReplyPage,
  Review,
  ReviewInput,
  ReviewPage,
  ReviewSummary,
} from "@/shared/reviews/types";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

// Types are imported, never re-declared: the server builds these responses from the same file, so a
// shape change that breaks this client fails at compile time rather than in the browser.
export type { ReplyPage, Review, ReviewInput, ReviewPage, ReviewSummary };

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await withAuthRetry((token) =>
    fetch(apiUrl(`/api${path}`), {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  if (!response.ok) {
    const error = await readApiError(response);
    // The code travels with the message: the caller distinguishes "no ticket" from "not started"
    // to explain which rule was missed, and a bare message string cannot be switched on.
    const thrown = new Error(error.message ?? error.code ?? "Không thể thực hiện thao tác.");
    (thrown as Error & { code?: string }).code = error.code;
    throw thrown;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const reviewsClient = {
  /** Public. `before` pages backwards through time; omit it for the newest page. */
  list: (eventId: number, options: { limit?: number; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.before) query.set("before", options.before);
    const suffix = query.toString();
    return call<ReviewPage>(`/events/${eventId}/reviews${suffix ? `?${suffix}` : ""}`);
  },
  /**
   * The rest of one comment's thread. Public. `after` is the **id** of the last reply already on
   * screen — a listing carries only the opening of each thread.
   */
  replies: (reviewId: number, options: { limit?: number; after?: number } = {}) => {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.after) query.set("after", String(options.after));
    const suffix = query.toString();
    return call<ReplyPage>(`/reviews/${reviewId}/replies${suffix ? `?${suffix}` : ""}`);
  },
  /** Creates, or replaces the caller's existing review of this event. */
  submit: (eventId: number, input: ReviewInput) =>
    call<Review>(`/events/${eventId}/reviews`, { method: "POST", body: input }),
  edit: (reviewId: number, input: ReviewInput) =>
    call<Review>(`/reviews/${reviewId}`, { method: "PATCH", body: input }),
  withdraw: (reviewId: number) => call<void>(`/reviews/${reviewId}`, { method: "DELETE" }),
  report: (reviewId: number, reason: string) =>
    call<{ alreadyReported?: boolean }>(`/reviews/${reviewId}/report`, {
      method: "POST",
      body: { reason },
    }),
};
