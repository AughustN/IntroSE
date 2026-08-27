import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import AdPackagesPanel from '../src/components/organizer/AdPackagesPanel';
import { adsClient } from '../src/services/adsClient';
import { organizerApi } from '../src/services/catalogClient';
const packages = [
  { id: 1, code: 'basic', name: 'Cơ Bản', price: 2000000, durationDays: 7, placements: ['hot_events'] },
  { id: 2, code: 'trailer', name: 'Trailer', price: 3500000, durationDays: 10, placements: ['hero_trailer'] },
  { id: 3, code: 'featured', name: 'Nổi Bật', price: 5000000, durationDays: 14, placements: ['hot_events', 'hero_trailer'] },
  { id: 4, code: 'complete', name: 'Toàn Diện', price: 9000000, durationDays: 30, placements: ['hot_events', 'hero_trailer'] },
].map(p => ({ ...p, description: null, availability: p.placements.map(placement => ({ placement, limit: placement === 'hot_events' ? 20 : 4, reserved: 1, legacy: false })) }));
adsClient.packages = async () => packages as never;
adsClient.purchases = async () => [{ id: 98, eventId: 98, eventTitle: 'Đêm nhạc — dữ liệu kiểm thử', eventSlug: 'demo', packageName: 'Toàn Diện', packageCode: 'complete', price: 9000000, placements: ['hot_events', 'hero_trailer'], policy: 'fair_v1', startsAt: '2026-08-28T00:00:00Z', endsAt: '2026-09-27T00:00:00Z', createdAt: '2026-08-28T00:00:00Z', status: 'active', live: true, serving: true, metrics: [{ placement: 'hot_events', impressions: 1240, clicks: 88, plays: 0 }] }] as never;
organizerApi.myEvents = async () => [{ id: 101, title: 'Sự kiện xem trước — không thanh toán thật', status: 'on_sale', moderation: 'approved', hasUpcoming: true }] as never;
adsClient.buy = async () => { throw new Error('Chế độ kiểm thử: không thực hiện thanh toán.'); };
function Preview() {
  return <main className="mx-auto min-h-screen max-w-7xl bg-xanh-pho p-4 text-beige-kem sm:p-6 lg:p-8"><div className="mb-6 flex gap-4 border-b border-beige-kem/20 pb-4 text-sm"><span>DỮ LIỆU KIỂM THỬ</span><button onClick={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'}>Đổi nền sáng / tối</button></div><AdPackagesPanel /></main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
