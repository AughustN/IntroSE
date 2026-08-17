import React from "react";
import { TrendingUp, TrendingDown, DollarSign, Ticket, Calendar, Users } from "lucide-react";
import type { OrganizerAnalyticsOverview } from "../../../../shared/types/analytics";

interface Props {
  overview: OrganizerAnalyticsOverview;
}

function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function KPICards({ overview }: Props) {
  const {
    gross_revenue_vnd,
    total_refund_amount_vnd,
    net_revenue_vnd,
    total_tickets_sold,
    capacity_fill_rate,
    event_counts_by_status,
    period_comparison,
  } = overview;

  const totalEvents =
    (event_counts_by_status?.draft || 0) +
    (event_counts_by_status?.pending_approval || 0) +
    (event_counts_by_status?.published || 0) +
    (event_counts_by_status?.canceled || 0) +
    (event_counts_by_status?.completed || 0);

  const grossRevenuePct = period_comparison?.gross_revenue_change_pct ?? 0;
  const ticketsSoldPct = period_comparison?.tickets_sold_change_pct ?? 0;
  const netRevenuePct = period_comparison?.net_revenue_change_pct ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Card 1: Total Revenue */}
      <div className="group relative flex flex-col justify-between overflow-hidden border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem transition hover:border-beige-kem/60 hover:">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow font-bold uppercase tracking-wider text-beige-kem/70">
            Tổng doanh thu
          </span>
          <div className="bg-burgundy/20 p-2.5 text-burgundy transition group-hover:scale-105">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <h3 className="text-2xl font-black tracking-tight text-beige-kem sm:text-3xl">
            {formatVND(gross_revenue_vnd)}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {grossRevenuePct >= 0 ? (
              <span className="inline-flex items-center gap-1 bg-la-co/20 px-2 py-0.5 font-bold text-la-co">
                <TrendingUp className="h-3.5 w-3.5" /> +{grossRevenuePct}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-cam-dat/20 px-2 py-0.5 font-bold text-cam-dat">
                <TrendingDown className="h-3.5 w-3.5" /> {grossRevenuePct}%
              </span>
            )}
            <span className="text-beige-kem/60 font-medium">so với kỳ trước</span>
          </div>
          <div className="mt-3 border-t border-beige-kem/10 pt-2 text-[11px] text-beige-kem/60">
            Thực nhận: <strong className="text-la-co">{formatVND(net_revenue_vnd)}</strong>
          </div>
        </div>
      </div>

      {/* Card 2: Tickets Sold */}
      <div className="group relative flex flex-col justify-between overflow-hidden border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem transition hover:border-beige-kem/60 hover:">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow font-bold uppercase tracking-wider text-beige-kem/70">
            Vé đã bán
          </span>
          <div className="bg-la-co/20 p-2.5 text-la-co transition group-hover:scale-105">
            <Ticket className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <h3 className="text-2xl font-black tracking-tight text-beige-kem sm:text-3xl">
            {total_tickets_sold.toLocaleString("vi-VN")}{" "}
            <span className="text-lg font-bold text-beige-kem/70">vé</span>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {ticketsSoldPct >= 0 ? (
              <span className="inline-flex items-center gap-1 bg-la-co/20 px-2 py-0.5 font-bold text-la-co">
                <TrendingUp className="h-3.5 w-3.5" /> +{ticketsSoldPct}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-cam-dat/20 px-2 py-0.5 font-bold text-cam-dat">
                <TrendingDown className="h-3.5 w-3.5" /> {ticketsSoldPct}%
              </span>
            )}
            <span className="text-beige-kem/60 font-medium">so với kỳ trước</span>
          </div>
          <div className="mt-3 border-t border-beige-kem/10 pt-2 text-[11px] text-beige-kem/60">
            Tỷ lệ lấp đầy: <strong className="text-cam-dat">{capacity_fill_rate}%</strong>
          </div>
        </div>
      </div>

      {/* Card 3: Active Events */}
      <div className="group relative flex flex-col justify-between overflow-hidden border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem transition hover:border-beige-kem/60 hover:">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow font-bold uppercase tracking-wider text-beige-kem/70">
            Sự kiện hoạt động
          </span>
          <div className="bg-cam-dat/20 p-2.5 text-cam-dat transition group-hover:scale-105">
            <Calendar className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <h3 className="text-2xl font-black tracking-tight text-beige-kem sm:text-3xl">
            {event_counts_by_status.published}{" "}
            <span className="text-lg font-bold text-beige-kem/70">đang mở bán</span>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 bg-la-co/20 px-2 py-0.5 font-bold text-la-co">
              <TrendingUp className="h-3.5 w-3.5" /> Đã đăng
            </span>
            <span className="text-beige-kem/60 font-medium">
              trên tổng số {totalEvents} sự kiện
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-beige-kem/10 pt-2 text-[11px] text-beige-kem/60">
            <span>
              Chờ duyệt:{" "}
              <strong className="text-cam-dat">{event_counts_by_status.pending_approval}</strong>
            </span>
            <span>
              Nháp: <strong className="text-beige-kem/90">{event_counts_by_status.draft}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Card 4: Total Customers / Net Revenue */}
      <div className="group relative flex flex-col justify-between overflow-hidden border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem transition hover:border-beige-kem/60 hover:">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow font-bold uppercase tracking-wider text-beige-kem/70">
            Doanh thu thực nhận
          </span>
          <div className="bg-bubblegum/20 p-2.5 text-bubblegum transition group-hover:scale-105">
            <Users className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <h3 className="text-2xl font-black tracking-tight text-la-co sm:text-3xl">
            {formatVND(net_revenue_vnd)}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {netRevenuePct >= 0 ? (
              <span className="inline-flex items-center gap-1 bg-la-co/20 px-2 py-0.5 font-bold text-la-co">
                <TrendingUp className="h-3.5 w-3.5" /> +{netRevenuePct}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-cam-dat/20 px-2 py-0.5 font-bold text-cam-dat">
                <TrendingDown className="h-3.5 w-3.5" /> {netRevenuePct}%
              </span>
            )}
            <span className="text-beige-kem/60 font-medium">so với kỳ trước</span>
          </div>
          <div className="mt-3 border-t border-beige-kem/10 pt-2 text-[11px] text-beige-kem/60">
            Đã trừ <strong className="text-cam-dat">{formatVND(total_refund_amount_vnd)}</strong>{" "}
            tiền hoàn vé
          </div>
        </div>
      </div>
    </div>
  );
}
