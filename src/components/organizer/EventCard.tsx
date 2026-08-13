import React from "react";
import { OrganizerPortfolioSummary } from "../../types";

interface EventCardProps {
  event: OrganizerPortfolioSummary;
  onSelect: (eventId: string) => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, onSelect }) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 backdrop-blur-md">
            ● Đang đăng bán
          </span>
        );
      case "pending_review":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 backdrop-blur-md">
            ▲ Chờ duyệt
          </span>
        );
      case "draft":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-zinc-500/20 text-zinc-300 border border-zinc-500/40 backdrop-blur-md">
            ○ Bản nháp
          </span>
        );
      case "canceled":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 backdrop-blur-md">
            ✕ Đã hủy
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40 backdrop-blur-md">
            ✓ Đã kết thúc
          </span>
        );
      default:
        return null;
    }
  };

  const formatVND = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return isoStr;
    }
  };

  return (
    <div
      onClick={() => onSelect(event.eventId)}
      className="group relative min-h-[180px] sm:min-h-[200px] w-full rounded-2xl overflow-hidden border border-zinc-800 hover:border-amber-500/60 shadow-xl transition-all duration-300 cursor-pointer flex flex-col justify-between p-6"
    >
      {/* Background Image Layer */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
        style={{ backgroundImage: `url(${event.bannerUrl})` }}
      />

      {/* Dark Gradient Overlay for Readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/85 to-zinc-950/40 group-hover:via-zinc-950/75 transition-colors duration-300" />

      {/* Top Bar: Status & Date */}
      <div className="relative z-10 flex items-center justify-between">
        {getStatusBadge(event.status)}
        <span className="text-xs font-medium text-zinc-300 bg-zinc-900/80 px-2.5 py-1 rounded-lg border border-zinc-700/60 backdrop-blur-md">
          📅 {formatDate(event.startDatetime)}
        </span>
      </div>

      {/* Content & Metrics Overlay */}
      <div className="relative z-10 space-y-3 mt-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-bold text-white group-hover:text-amber-400 transition-colors line-clamp-1 drop-shadow-md">
            {event.title}
          </h3>
          <p className="text-xs text-zinc-300 mt-1 line-clamp-1 flex items-center gap-1">
            <span>📍</span> {event.locationName}
          </p>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-4 pt-3 border-t border-zinc-700/50 text-xs">
          <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/60 backdrop-blur-sm">
            <span className="text-zinc-400 block text-[10px] uppercase font-semibold">Vé đã bán</span>
            <span className="font-bold text-white text-sm">
              {event.soldTickets} <span className="text-zinc-400 font-normal text-xs">/ {event.totalCapacity}</span>
            </span>
          </div>
          <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/60 backdrop-blur-sm">
            <span className="text-zinc-400 block text-[10px] uppercase font-semibold">Còn lại</span>
            <span className="font-bold text-amber-400 text-sm">{event.remainingTickets}</span>
          </div>
          <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/60 backdrop-blur-sm">
            <span className="text-zinc-400 block text-[10px] uppercase font-semibold">Doanh thu</span>
            <span className="font-bold text-emerald-400 text-sm">{formatVND(event.totalRevenueVnd)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
