import { BlockPalette } from 'tixhub';

const noop = () => {};

const sections = [
  { id: 1, name: 'Khu A — Tầng trệt' },
  { id: 2, name: 'Khu B — Ban công' },
  { id: 3, name: 'Khu VIP' },
];

const categories = [
  { id: 10, name: 'Hạng Kim Cương' },
  { id: 11, name: 'Hạng Vàng' },
  { id: 12, name: 'Phổ thông' },
];

const base = {
  onAdd: noop,
  onDraw: noop,
  drawing: false,
  color: '#e8613c',
  onColor: noop,
  colorTarget: 0,
  disabled: false,
  remaining: 1840,
  sections,
  categories,
  // `undefined` is "Tự động" — the organizer has not pinned a target, so a new
  // block follows the selection. `resolved` says where that lands right now.
  pinned: { sectionId: undefined, categoryId: undefined },
  resolved: { sectionId: 1, categoryId: 12 },
  onPin: noop,
};

export const Default = () => <BlockPalette {...base} />;

// Drawing mode: the organizer is placing a free-hand outline point by point.
export const Drawing = () => <BlockPalette {...base} drawing color="#7b8cde" />;

// With blocks selected, the swatches recolour those blocks instead of setting
// the default for the next one — `colorTarget` is how many that would hit.
export const WithSelection = () => (
  <BlockPalette
    {...base}
    colorTarget={3}
    pinned={{ sectionId: 3, categoryId: 10 }}
    resolved={{ sectionId: 3, categoryId: 10 }}
  />
);

// Near the seat ceiling, so the limit is visible before it bites.
export const NearSeatLimit = () => <BlockPalette {...base} remaining={12} />;

export const Disabled = () => <BlockPalette {...base} disabled remaining={0} />;
