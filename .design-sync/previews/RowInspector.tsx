import { RowInspector } from 'tixhub';

const noop = () => {};

export const Editable = () => (
  <RowInspector
    label="B"
    sectionName="Khu A — Tầng trệt"
    seatCount={24}
    canEdit
    onRename={noop}
    onReverse={noop}
    onDuplicate={noop}
    onDelete={noop}
  />
);

// `canEdit` is false when the row's block is locked — the existing
// "do not touch this" signal, so the destructive actions have to go quiet.
export const Locked = () => (
  <RowInspector
    label="VIP-1"
    sectionName="Khu VIP"
    seatCount={8}
    canEdit={false}
    onRename={noop}
    onReverse={noop}
    onDuplicate={noop}
    onDelete={noop}
  />
);
