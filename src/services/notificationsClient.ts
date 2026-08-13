import type { NotificationItem, NotificationType } from "@/shared/notifications/types";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

export type { NotificationItem, NotificationType };

async function call<T>(path: string, init: { method?: string } = {}): Promise<T> {
  const response = await withAuthRetry((token) =>
    fetch(apiUrl(`/api${path}`), {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    }),
  );
  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error.message ?? error.code ?? "Không tải được thông báo.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** How many of a list are still unread — the number the navigation shows. */
export function unreadCount(items: NotificationItem[]): number {
  return items.reduce((count, item) => (item.readAt === null ? count + 1 : count), 0);
}

export const notificationsClient = {
  /** The 50 newest in-app messages for the signed-in reader, newest first. */
  list: () => call<NotificationItem[]>("/notifications"),
  markRead: (id: number) => call<void>(`/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => call<{ updated: number }>("/notifications/read-all", { method: "POST" }),
};
