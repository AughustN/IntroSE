import { CategoryPanel } from 'tixhub';

const noop = () => {};

// A category's colour is required, unlike a section's: the whole point of a
// price class is being recognised by colour on the buyer's map.
const categories = [
  { id: 10, name: 'Hạng Kim Cương', color: '#e8613c' },
  { id: 11, name: 'Hạng Vàng', color: '#e9a13b' },
  { id: 12, name: 'Phổ thông', color: '#5c9e7a' },
];

const seats = ([[12, 48], [11, 30], [10, 12]] as const).flatMap(([categoryId, count]) =>
  Array.from({ length: count }, (_, i) => ({
    sectionId: 1,
    categoryId,
    rowLabel: 'A',
    seatNumber: i + 1,
    seatType: 'standard' as const,
    x: 40 + i * 22,
    y: 60,
    rotation: 0,
  })),
);

const base = {
  categories,
  seats,
  selectedCount: 0,
  activeCategoryId: 12,
  onActivate: noop,
  onAdd: noop,
  onRename: noop,
  onRecolor: noop,
  onRemove: noop,
  onAssign: noop,
};

export const Default = () => <CategoryPanel {...base} />;
export const WithSelection = () => <CategoryPanel {...base} selectedCount={8} activeCategoryId={10} />;
