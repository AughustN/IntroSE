import type {
  AnalyticsFilterParams,
  OrganizerAnalyticsDashboardResponse,
} from "../../shared/types/analytics";
import { withAuthRetry } from "./authClient";

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

    return fetch(`/api/organizer/analytics/dashboard?${query.toString()}`, {
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


  const json = await res.json();
  return json.data;
}

