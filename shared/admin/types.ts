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

export interface AdminCategory {
  id: number;
  code: string;
  labelVi: string;
  labelEn: string | null;
}

export interface FeaturedEvent {
  eventId: number;
  displayOrder: number;
  slug: string;
  title: string;
  imageUrl: string | null;
}

export interface FeaturedEventInput {
  eventId: number;
  displayOrder: number;
}

export interface SystemSettings {
  seat_hold_ttl_minutes: number;
  topup_grace_minutes: number;
  absolute_ceiling_minutes: number;
  max_tickets_per_buyer: number;
  wallet_topup_min: number;
  wallet_topup_max: number;
  wallet_balance_ceiling: number;
  ai_features_enabled: boolean;
}

export type SystemSettingKey = keyof SystemSettings;

export interface AdminValidationError {
  error: string;
  message: string;
  fields?: Record<string, string>;
}
