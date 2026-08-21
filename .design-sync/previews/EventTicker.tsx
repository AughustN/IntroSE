import { EventTicker } from 'tixhub';

const noop = () => {};

// The band reads only title, imageUrl, price and dates off each event, so these
// fixtures carry those rather than a full MovieEvent — previews are compiled,
// not typechecked, and a 30-field object would bury what the component uses.
// The poster is an inline SVG so the card never depends on the network.
const poster = (label: string, bg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="${bg}"/><text x="150" y="210" font-family="sans-serif" font-size="22" fill="#fdf6ea" text-anchor="middle">${label}</text></svg>`,
  )}`;

const events = [
  { id: 'trinh-cong-son', eventId: 1, title: 'Đêm nhạc Trịnh Công Sơn',
    price: 650000, dates: ['2026-09-12', '2026-09-13'], imageUrl: poster('Trịnh Công Sơn', '#8a0c24') },
  { id: 'ha-noi-jazz', eventId: 2, title: 'Hà Nội Jazz Festival',
    price: 1200000, dates: ['2026-09-20'], imageUrl: poster('Hà Nội Jazz', '#3d0d1a') },
  { id: 'mua-roi-nuoc', eventId: 3, title: 'Múa rối nước Thăng Long',
    price: 320000, dates: ['2026-09-05', '2026-09-06', '2026-09-07'], imageUrl: poster('Múa rối nước', '#5c9e7a') },
  { id: 'workshop-anh', eventId: 4, title: 'Workshop Nhiếp ảnh Đường phố',
    price: 480000, dates: ['2026-10-02'], imageUrl: poster('Nhiếp ảnh', '#7b8cde') },
];

export const Trending = () => (
  <EventTicker events={events as never} onSelect={noop} onViewAll={noop} />
);

export const TwoEvents = () => (
  <EventTicker events={events.slice(0, 2) as never} onSelect={noop} onViewAll={noop} />
);
