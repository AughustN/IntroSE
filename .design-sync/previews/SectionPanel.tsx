import { SectionPanel } from 'tixhub';

const noop = () => {};

const sections = [
  { id: 1, name: 'Khu A — Tầng trệt', color: '#e8613c' },
  { id: 2, name: 'Khu B — Ban công', color: '#7b8cde' },
  { id: 3, name: 'Khu VIP', color: '#e9a13b' },
];

// Seats exist here only so the panel can show a real per-section count —
// generated rather than spelled out, the way a chart of this size actually is.
const seats = ([[1, 48, 'A'], [2, 30, 'B'], [3, 12, 'V']] as const).flatMap(
  ([sectionId, count, row]) =>
    Array.from({ length: count }, (_, i) => ({
      sectionId,
      categoryId: null,
      rowLabel: row,
      seatNumber: i + 1,
      seatType: 'standard' as const,
      x: 40 + i * 22,
      y: sectionId * 60,
      rotation: 0,
    })),
);

const base = {
  sections,
  seats,
  selectedCount: 0,
  activeSectionId: 1,
  onActivate: noop,
  onAdd: noop,
  onRename: noop,
  onRemove: noop,
  onAssign: noop,
  onZoom: noop,
};

export const Default = () => <SectionPanel {...base} />;

// With blocks selected, the rows become assignment targets rather than filters.
export const WithSelection = () => <SectionPanel {...base} selectedCount={12} activeSectionId={3} />;
