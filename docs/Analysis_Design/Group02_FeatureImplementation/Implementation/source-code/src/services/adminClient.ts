import type { AdminModerationQueue, AuditLog, ModerationActionBody } from '@shared/admin/types.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? 'admin_request_failed');
  return body;
}

const post = <T>(path: string, body?: ModerationActionBody) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const adminClient = {
  queue: () => request<AdminModerationQueue>('/moderation'),
  auditLogs: () => request<AuditLog[]>('/audit-logs'),
  approveOrganizer: (id: number) => post(`/organizers/${id}/approve`),
  rejectOrganizer: (id: number, reason: string) => post(`/organizers/${id}/reject`, { reason }),
  suspendOrganizer: (id: number, reason: string) => post(`/organizers/${id}/suspend`, { reason }),
  approveEvent: (id: number) => post(`/events/${id}/approve`),
  rejectEvent: (id: number, reason: string) => post(`/events/${id}/reject`, { reason }),
  flagEvent: (id: number, reason?: string) => post(`/events/${id}/flag`, reason ? { reason } : undefined),
  removeEvent: (id: number, reason?: string) => post(`/events/${id}/remove`, reason ? { reason } : undefined),
  dismissReport: (id: number, reason?: string) => post(`/reports/${id}/dismiss`, reason ? { reason } : undefined),
};
