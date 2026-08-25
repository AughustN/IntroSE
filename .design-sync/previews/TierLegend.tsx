import { TierLegend } from 'tixhub';

// Colours and price ordering follow the server's own derivation: tiers are
// ranked by price, so the legend reads top-down as most to least expensive.
const tiers = [
  { tierId: 1, label: 'Hạng Kim Cương', price: 2500000, color: '#e8613c' },
  { tierId: 2, label: 'Hạng Vàng', price: 1200000, color: '#e9a13b' },
  { tierId: 3, label: 'Hạng Bạc', price: 650000, color: '#7b8cde' },
  { tierId: 4, label: 'Phổ thông', price: 320000, color: '#5c9e7a' },
];

export const FourTiers = () => <TierLegend legend={tiers} />;

export const TwoTiers = () => <TierLegend legend={tiers.slice(0, 2)} />;

// The component returns null for an empty or absent legend — a chart with no
// priced tiers renders nothing rather than an empty rail.
export const SingleTier = () => <TierLegend legend={[tiers[0]]} />;
