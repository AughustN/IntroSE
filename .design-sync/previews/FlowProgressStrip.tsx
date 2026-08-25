import { FlowProgressStrip } from 'tixhub';

const noop = () => {};

// A mid-flight event: showtimes and tiers cleared, the chart is what the
// organizer is being asked to deal with now.
const inProgress = [
  { id: 'showtimes', n: 1, label: 'Suất chiếu', state: 'done' as const, action: 'showtimes' as const },
  { id: 'tiers', n: 2, label: 'Hạng vé', state: 'done' as const, action: 'tiers' as const },
  { id: 'chart', n: 3, label: 'Sơ đồ chỗ ngồi', state: 'todo' as const,
    reason: 'Sơ đồ chưa có khối ghế nào.', action: 'chart' as const },
  { id: 'apply', n: 4, label: 'Áp dụng sơ đồ', state: 'todo' as const, action: 'apply' as const },
  { id: 'submit', n: 5, label: 'Gửi duyệt', state: 'todo' as const, action: 'submit' as const },
];

// `blocked` is a step the server has judged and refused — it carries the
// error contract's own code alongside the reason.
const blocked = [
  { id: 'showtimes', n: 1, label: 'Suất chiếu', state: 'done' as const, action: 'showtimes' as const },
  { id: 'tiers', n: 2, label: 'Hạng vé', state: 'blocked' as const,
    reason: 'Hai hạng vé đang cùng mức giá 500.000đ.', code: 'TIER_PRICE_DUPLICATE', action: 'tiers' as const },
  { id: 'chart', n: 3, label: 'Sơ đồ chỗ ngồi', state: 'todo' as const, action: 'chart' as const },
  { id: 'apply', n: 4, label: 'Áp dụng sơ đồ', state: 'todo' as const, action: 'apply' as const },
  { id: 'submit', n: 5, label: 'Gửi duyệt', state: 'todo' as const, action: 'submit' as const },
];

const allDone = inProgress.map((s) => ({ ...s, state: 'done' as const, reason: undefined }));

export const InProgress = () => <FlowProgressStrip steps={inProgress} onAction={noop} />;
export const Blocked = () => <FlowProgressStrip steps={blocked} onAction={noop} />;
export const Complete = () => <FlowProgressStrip steps={allDone} onAction={noop} />;
