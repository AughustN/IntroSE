import { ValidationPanel } from 'tixhub';

const noop = () => {};
// Seat 508 is in Khu B, matching its issue message — a label that contradicted
// the text it sits under is exactly the kind of thing a real chart never shows.
const labelOfSeat = (id: number) => (id >= 500 ? `Khu B · C${id % 40}` : `Khu A · B${id % 40}`);

// Errors refuse the publish; a warning means the chart will sell tickets but
// will behave in a way the organizer did not choose and cannot observe.
const mixed = [
  { code: 'overlapping_seats' as const, severity: 'error' as const,
    message: 'Hai ghế đang chồng lên nhau ở Khu A.', seatIds: [312, 313] },
  { code: 'duplicate_label' as const, severity: 'error' as const,
    message: 'Khu B có hai ghế cùng nhãn “C7”.', seatIds: [508] },
  { code: 'focal_point_unset' as const, severity: 'warning' as const,
    message: 'Sơ đồ chưa có sân khấu, nên “ghế tốt nhất” sẽ chọn theo tâm hình học.' },
];

const errorsOnly = mixed.filter((i) => i.severity === 'error');
const warningOnly = mixed.filter((i) => i.severity === 'warning');

export const MixedIssues = () => (
  <ValidationPanel
    issues={mixed}
    labelOfSeat={labelOfSeat}
    onFocusSeat={noop}
    onRenumberSection={noop}
    onAddStage={noop}
  />
);

export const BlockingErrors = () => (
  <ValidationPanel issues={errorsOnly} labelOfSeat={labelOfSeat} onFocusSeat={noop} onRenumberSection={noop} />
);

export const WarningOnly = () => (
  <ValidationPanel issues={warningOnly} labelOfSeat={labelOfSeat} onAddStage={noop} />
);

// The clean chart — what the organizer sees just before publishing.
export const NoIssues = () => <ValidationPanel issues={[]} labelOfSeat={labelOfSeat} />;
