import { EventFlowRail } from 'tixhub';

const noop = () => {};

// The rail shows the whole dependency chain at once, where FlowProgressStrip
// collapses it to the one step being asked for — same FlowStep[] either way.
const steps = [
  { id: 'showtimes', n: 1, label: 'Suất chiếu', state: 'done' as const, action: 'showtimes' as const },
  { id: 'tiers', n: 2, label: 'Hạng vé', state: 'done' as const, action: 'tiers' as const },
  { id: 'chart', n: 3, label: 'Sơ đồ chỗ ngồi', state: 'todo' as const,
    reason: 'Sơ đồ chưa có khối ghế nào.', action: 'chart' as const },
  { id: 'apply', n: 4, label: 'Áp dụng sơ đồ', state: 'todo' as const,
    reason: 'Cần một sơ đồ hợp lệ trước khi áp dụng.', action: 'apply' as const },
  { id: 'submit', n: 5, label: 'Gửi duyệt', state: 'todo' as const, action: 'submit' as const },
];

const blocked = steps.map((s) =>
  s.id === 'tiers'
    ? { ...s, state: 'blocked' as const, reason: 'Hai hạng vé đang cùng mức giá 500.000đ.', code: 'TIER_PRICE_DUPLICATE' }
    : s);

const ready = steps.map((s) => ({ ...s, state: 'done' as const, reason: undefined }));

export const MidFlow = () => <EventFlowRail steps={steps} onAction={noop} />;
export const ServerBlocked = () => <EventFlowRail steps={blocked} onAction={noop} />;
export const ReadyToSubmit = () => <EventFlowRail steps={ready} onAction={noop} />;
