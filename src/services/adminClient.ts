import type { AdminCategory, AdminModerationQueue, AuditLog, FeaturedEvent, FeaturedEventInput, ModerationActionBody, SystemSettings } from '@shared/admin/types.js';
import { getAccessToken, withAuthRetry } from './authClient';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const send = (token: string | null) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> ?? {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`/api/admin${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  };

  const response = await withAuthRetry(send);
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as T & { message?: string; error?: string; fields?: Record<string, string> };
  if (!response.ok) {
    const msg = body.message ?? body.error ?? 'admin_request_failed';
    const fieldErrors = body.fields ? Object.entries(body.fields).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
    throw new Error(fieldErrors ? `${msg} (${fieldErrors})` : msg);
  }
  return body;
}

const post = <T>(path: string, body?: ModerationActionBody) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const json = <T>(path: string, method: 'PUT' | 'DELETE', body?: unknown) => request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const adminClient = {
  queue: () => request<AdminModerationQueue>('/moderation/queue'),
  auditLogs: () => request<AuditLog[]>('/audit-logs'),
  approveOrganizer: (id: number) => post(`/organizers/${id}/approve`),
  rejectOrganizer: (id: number, reason: string) => post(`/organizers/${id}/reject`, { reason }),
  suspendOrganizer: (id: number, reason: string) => post(`/organizers/${id}/suspend`, { reason }),
  approveEvent: (id: number) => post(`/events/${id}/approve`),
  rejectEvent: (id: number, reason: string) => post(`/events/${id}/reject`, { reason }),
  flagEvent: (id: number, reason?: string) => post(`/events/${id}/flag`, reason ? { reason } : undefined),
  removeEvent: (id: number, reason?: string) => post(`/events/${id}/remove`, reason ? { reason } : undefined),
  dismissReport: (id: number, reason?: string) => post(`/reports/${id}/dismiss`, reason ? { reason } : undefined),
  categories: () => request<AdminCategory[]>('/categories'),
  createCategory: (body: Pick<AdminCategory, 'labelVi' | 'labelEn'>) => request<AdminCategory>('/categories', { method: 'POST', body: JSON.stringify(body) }),
  renameCategory: (id: number, body: Pick<AdminCategory, 'labelVi' | 'labelEn'>) => json<AdminCategory>(`/categories/${id}`, 'PUT', body),
  deleteCategory: (id: number) => json<void>(`/categories/${id}`, 'DELETE'),
  featured: () => request<FeaturedEvent[]>('/homepage/featured'),
  replaceFeatured: (events: FeaturedEventInput[]) => json<FeaturedEvent[]>('/homepage/featured', 'PUT', { events }),
  settings: () => request<SystemSettings>('/settings'),
  updateSettings: (settings: SystemSettings) => json<SystemSettings>('/settings', 'PUT', settings),
};
