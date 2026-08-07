export type OrganizerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type EventModerationStatus = 'pending_review' | 'approved' | 'flagged' | 'removed';
export type AuditOutcome = 'applied' | 'conflict' | 'rejected';

export interface OrganizerQueueItem {
  id: number;
  userId: number;
  displayName: string;
  description: string | null;
  status: OrganizerStatus;
  reviewNote: string | null;
  appliedAt: string;
}

export interface EventModerationItem {
  id: number;
  slug: string;
  title: string;
  status: string;
  moderation: EventModerationStatus;
  organizer: string;
  reviewNote: string | null;
  createdAt: string;
}

export interface ContentReportItem {
  id: number;
  targetType: 'event' | 'review';
  targetId: number;
  reason: string;
  status: string;
  createdAt: string;
}

export interface AdminModerationQueue {
  organizers: OrganizerQueueItem[];
  events: EventModerationItem[];
  reports: ContentReportItem[];
}

export interface ModerationActionBody {
  reason?: string;
  actionKey?: string;
}

export interface AuditLog {
  id: number;
  actorUserId: number;
  action: string;
  targetType: string;
  targetId: number | null;
  outcome: AuditOutcome;
  detail: Record<string, unknown> | null;
  createdAt: string;
}
