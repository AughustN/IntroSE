import type {
  AdminAnalytics,
  AdminCategory,
  AdminOrganizerDetail,
  AdminModerationQueue,
  AdminOrderPage,
  AdminOverview,
  AdminWalletPage,
  AttendeeList,
  AttendeeShowtime,
  AuditLog,
  FeaturedEvent,
  FeaturedEventInput,
  ContentReportDetail,
  ContentReportPage,
  ModerationActionBody,
  ReportedEvent,
  ReviewReportPage,
  SystemSettings,
} from "@shared/admin/types.js";
import type { AdAnalytics } from "@shared/ads/types.js";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const send = (token: string | null) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(apiUrl(`/api/admin${path}`), {
      ...init,
      headers,
      credentials: "include",
    });
  };

  const response = await withAuthRetry(send);
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as T & {
    message?: string;
    error?: string;
    fields?: Record<string, string>;
  };
  if (!response.ok) {
    const msg = body.message ?? body.error ?? "admin_request_failed";
    const fieldErrors = body.fields
      ? Object.entries(body.fields)
          .map(([k, v]) => `${k}: ${v}`)
          .join("; ")
      : "";
    throw new Error(fieldErrors ? `${msg} (${fieldErrors})` : msg);
  }
  return body;
}

const post = <T>(path: string, body?: ModerationActionBody) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const json = <T>(path: string, method: "PUT" | "DELETE", body?: unknown) =>
  request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const adminClient = {
  queue: () => request<AdminModerationQueue>("/moderation/queue"),
  auditLogs: () => request<AuditLog[]>("/audit-logs"),
  approveOrganizer: (id: number) => post(`/organizers/${id}/approve`),
  rejectOrganizer: (id: number, reason: string) => post(`/organizers/${id}/reject`, { reason }),
  suspendOrganizer: (id: number, reason: string) => post(`/organizers/${id}/suspend`, { reason }),
  approveEvent: (id: number) => post(`/events/${id}/approve`),
  rejectEvent: (id: number, reason: string) => post(`/events/${id}/reject`, { reason }),
  flagEvent: (id: number, reason?: string) =>
    post(`/events/${id}/flag`, reason ? { reason } : undefined),
  removeEvent: (id: number, reason: string) => post(`/events/${id}/remove`, { reason }),
  dismissReport: (id: number, reason?: string) =>
    post(`/reports/${id}/dismiss`, reason ? { reason } : undefined),
  categories: () => request<AdminCategory[]>("/categories"),
  createCategory: (body: Pick<AdminCategory, "labelVi" | "labelEn">) =>
    request<AdminCategory>("/categories", { method: "POST", body: JSON.stringify(body) }),
  renameCategory: (id: number, body: Pick<AdminCategory, "labelVi" | "labelEn">) =>
    json<AdminCategory>(`/categories/${id}`, "PUT", body),
  deleteCategory: (id: number) => json<void>(`/categories/${id}`, "DELETE"),
  featured: () => request<FeaturedEvent[]>("/homepage/featured"),
  replaceFeatured: (events: FeaturedEventInput[]) =>
    json<FeaturedEvent[]>("/homepage/featured", "PUT", { events }),
  settings: () => request<SystemSettings>("/settings"),
  updateSettings: (settings: SystemSettings) => json<SystemSettings>("/settings", "PUT", settings),

  /*
   * Upholding a report was reachable from the server and from nowhere else: the console could only
   * dismiss. Same for hiding a reported review — the route existed, the client never called it.
   */
  resolveReport: (id: number, decision: "flag" | "remove", reason: string) =>
    request<{ ok: true }>(`/reports/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    }),
  deleteReview: (id: number) => json<void>(`/reviews/${id}`, "DELETE"),

  // ── Read models ──
  overview: () => request<AdminOverview>("/overview"),
  analytics: (
    params: { from?: string; to?: string; organizerId?: number; category?: string } = {},
  ) => request<AdminAnalytics>(`/analytics${qs(params)}`),
  ads: () => request<AdAnalytics>("/ads"),
  /* The two moderation previews: what is waiting, read in full before it is decided on. */
  eventDetail: (id: number) => request<ReportedEvent>(`/events/${id}/detail`),
  organizerDetail: (id: number) => request<AdminOrganizerDetail>(`/organizers/${id}/detail`),
  orders: (params: { q?: string; status?: string; limit?: number; offset?: number } = {}) =>
    request<AdminOrderPage>(`/orders${qs(params)}`),
  contentReports: (
    params: {
      q?: string;
      status?: "open" | "flagged" | "resolved" | "dismissed";
      limit?: number;
      offset?: number;
    } = {},
  ) => request<ContentReportPage>(`/content-reports${qs(params)}`),
  contentReport: (id: number) => request<ContentReportDetail>(`/content-reports/${id}`),
  reviewReports: (
    params: { q?: string; status?: "open" | "done"; limit?: number; offset?: number } = {},
  ) => request<ReviewReportPage>(`/review-reports${qs(params)}`),
  walletTransactions: (params: { kind?: string; limit?: number } = {}) =>
    request<AdminWalletPage>(`/wallet-transactions${qs(params)}`),

  // ── The door ──
  attendees: (
    eventId: number,
    params: {
      showtimeId?: number;
      q?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => request<AttendeeList>(`/events/${eventId}/attendees${qs(params)}`),
  /** The event's showtimes, for narrowing the door list to one night. */
  eventShowtimes: (eventId: number) =>
    request<AttendeeShowtime[]>(`/events/${eventId}/showtimes`),
  /**
   * The same list as a file.
   *
   * Fetched with the session's own credentials and handed to the browser as a blob rather than
   * linked directly: a plain `<a href>` carries no Authorization header, so the link would download
   * a 401 page named like a spreadsheet.
   */
  attendeesCsv: async (
    eventId: number,
    params: { showtimeId?: number; q?: string; status?: string } = {},
  ): Promise<Blob> => {
    const response = await withAuthRetry((token) =>
      fetch(apiUrl(`/api/admin/events/${eventId}/attendees${qs({ ...params, format: "csv" })}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      }),
    );
    if (!response.ok) throw new Error("Không tải được tệp danh sách khách.");
    return response.blob();
  },
};

/** Query string from the parameters that were actually given. */
function qs(params: Record<string, string | number | undefined>): string {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
  return pairs.length
    ? `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join("&")}`
    : "";
}
