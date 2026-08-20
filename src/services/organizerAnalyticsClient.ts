import type {
  AnalyticsFilterParams,
  OrganizerAnalyticsDashboardResponse,
} from "../../shared/types/analytics";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";

/**
 * Fetch Organizer Business Analytics Dashboard Data (UC-31)
 */
export async function fetchOrganizerAnalytics(
  filters: AnalyticsFilterParams = {},
): Promise<OrganizerAnalyticsDashboardResponse> {
  const query = new URLSearchParams();
  if (filters.period) query.set("period", filters.period);
  if (filters.startDate) query.set("startDate", filters.startDate);
  if (filters.endDate) query.set("endDate", filters.endDate);
  if (filters.eventId && filters.eventId !== "all") query.set("eventId", filters.eventId);

  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetch(apiUrl(`/api/organizer/analytics/dashboard?${query.toString()}`), {
      method: "GET",
      headers,
      credentials: "include",
    });
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new Error(body?.message || "Bạn chưa đăng nhập hoặc phiên làm việc đã hết hạn.");
    }
    if (res.status === 403) {
      throw new Error(
        body?.message || "Tài khoản của bạn chưa được phê duyệt quyền Nhà tổ chức (Organizer).",
      );
    }
    const serverMsg =
      body?.message || (typeof body?.error === "string" ? body.error : body?.error?.message);
    throw new Error(serverMsg || "Không thể tải dữ liệu báo cáo kinh doanh.");
  }


  /*
   * The envelope is checked rather than assumed.
   *
   * `return json.data` handed back `undefined` whenever the response was not the shape expected — a
   * proxy's HTML error page, an envelope rename, a 200 carrying `{ error }`. The dashboard then read
   * `overview` off nothing and rendered zeroes, so a broken endpoint looked exactly like an organizer
   * who had sold no tickets. A thrown error is the honest answer: the caller already shows one.
   */
  const json: unknown = await res.json();
  const data = (json as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object") {
    throw new Error("Dữ liệu báo cáo trả về không đúng định dạng.");
  }
  return data as OrganizerAnalyticsDashboardResponse;
}

