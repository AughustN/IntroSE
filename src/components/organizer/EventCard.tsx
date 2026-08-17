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
          <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-la-co/40 text-white border border-la-co backdrop-blur-md">
            ● Đang đăng bán
          </span>
        );
      case "pending_review":
        return (
          <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-cam-dat/25 text-cam-dat border border-cam-dat/60 backdrop-blur-md">
            ▲ Chờ duyệt
          </span>
        );
      case "draft":
        return (
          <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-white/15 text-white border border-white/40 backdrop-blur-md">
            ○ Bản nháp
          </span>
        );
      case "canceled":
        return (
          <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-burgundy/30 text-white border border-burgundy backdrop-blur-md">
            ✕ Đã hủy
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-white/15 text-white border border-white/40 backdrop-blur-md">
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
      className="group relative min-h-[180px] sm:min-h-[200px] w-full overflow-hidden border border-beige-kem/25 hover:border-cam-dat transition-all duration-300 cursor-pointer flex flex-col justify-between p-6"
    >
      {/* Background Image Layer */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
        style={{ backgroundImage: `url(${event.bannerUrl})` }}
      />

      {/* Dark Gradient Overlay for Readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/40 group-hover:via-black/75 transition-colors duration-300" />

      {/* Top Bar: Status & Date */}
      <div className="relative z-10 flex items-center justify-between">
        {getStatusBadge(event.status)}
        <span className="border border-white/30 bg-black/60 px-2.5 py-1 font-meta text-meta text-white backdrop-blur-md">
          📅 {formatDate(event.startDatetime)}
        </span>
      </div>

      {/* Content & Metrics Overlay */}
      <div className="relative z-10 space-y-3 mt-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-bold text-white group-hover:text-cam-dat transition-colors line-clamp-1 drop-">
            {event.title}
          </h3>
          <p className="mt-1 line-clamp-1 flex items-center gap-1 font-meta text-meta text-white/80">
            <span>📍</span> {event.locationName}
          </p>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-4 pt-3 border-t border-white/25 text-xs">
          <div className="border border-white/20 bg-black/55 p-2 backdrop-blur-sm">
            <span className="block font-meta text-meta font-bold uppercase text-white/70">
              Vé đã bán
            </span>
            <span className="font-bold text-white text-sm">
              {event.soldTickets}{" "}
              <span className="font-normal text-white/70">/ {event.totalCapacity}</span>
            </span>
          </div>
          <div className="border border-white/20 bg-black/55 p-2 backdrop-blur-sm">
            <span className="block font-meta text-meta font-bold uppercase text-white/70">
              Còn lại
            </span>
            <span className="text-sm font-bold text-cam-dat">{event.remainingTickets}</span>
          </div>
          <div className="border border-white/20 bg-black/55 p-2 backdrop-blur-sm">
            <span className="block font-meta text-meta font-bold uppercase text-white/70">
              Doanh thu
            </span>
            <span className="text-sm font-bold text-white">{formatVND(event.totalRevenueVnd)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
