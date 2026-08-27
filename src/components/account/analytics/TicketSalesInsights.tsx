import { Ticket } from "lucide-react";
import type {
  OrganizerAnalyticsOverview,
  TimeSeriesSalesPoint,
} from "../../../../shared/types/analytics";

interface Props {
  overview: Pick<OrganizerAnalyticsOverview, "gross_revenue_vnd" | "total_tickets_sold">;
  timeSeries: TimeSeriesSalesPoint[];
}

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

export function TicketSalesInsights({ overview, timeSeries }: Props) {
  const sellingDays = timeSeries.filter((day) => day.current_tickets_sold > 0);
  // Dates arrive as Vietnam calendar dates, so compare them without timezone conversion.
  const peakDay = sellingDays.reduce<TimeSeriesSalesPoint | null>((best, day) => {
    if (
      !best ||
      day.current_tickets_sold > best.current_tickets_sold ||
      (day.current_tickets_sold === best.current_tickets_sold && day.date < best.date)
    ) {
      return day;
    }
    return best;
  }, null);
  const tiedDays = peakDay
    ? sellingDays.filter((day) => day.current_tickets_sold === peakDay.current_tickets_sold)
        .length - 1
    : 0;
  const hasSales = overview.total_tickets_sold > 0;

  return (
    <div className="min-w-0 border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
      <div className="border-b border-beige-kem/20 pb-3">
        <h4 className="font-display text-base font-black">Hiệu quả bán vé trong kỳ</h4>
        <p className="mt-1 text-sm text-ink-soft">Theo thời gian và sự kiện đang chọn.</p>
      </div>

      {!hasSales ? (
        <div className="flex items-start gap-3 py-5">
          <Ticket aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft" />
          <div className="min-w-0">
            <p className="text-sm font-bold">Chưa có vé bán trong kỳ này</p>
            <p className="mt-1 text-sm text-ink-soft">
              Thử chọn khoảng thời gian khác hoặc tất cả sự kiện để xem hiệu quả bán vé.
            </p>
          </div>
        </div>
      ) : (
        <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4">
          <div className="min-w-0 border border-beige-kem/20 p-4">
            <dt className="text-sm font-bold text-ink-soft">Doanh thu bình quân / vé</dt>
            <dd className="mt-2 break-words text-xl font-bold tabular-nums text-la-co-ink">
              {currency.format(overview.gross_revenue_vnd / overview.total_tickets_sold)}
            </dd>
            <dd className="mt-2 text-sm text-ink-soft">
              Tổng doanh thu chia số vé đã bán, trước khi trừ hoàn vé.
            </dd>
          </div>
          <div className="min-w-0 border border-beige-kem/20 p-4">
            <dt className="text-sm font-bold text-ink-soft">Ngày bán nhiều vé nhất</dt>
            <dd className="mt-2 text-xl font-bold tabular-nums">
              {peakDay ? (
                <time dateTime={peakDay.date}>{peakDay.date.split("-").reverse().join("/")}</time>
              ) : (
                "—"
              )}
            </dd>
            <dd className="mt-2 text-sm text-ink-soft">
              {peakDay
                ? `${peakDay.current_tickets_sold.toLocaleString("vi-VN")} vé đã bán`
                : "Chưa có dữ liệu theo ngày"}
              {tiedDays > 0 &&
                ` · Cùng mức cao nhất với ${tiedDays.toLocaleString("vi-VN")} ngày khác.`}
            </dd>
          </div>
          <div className="min-w-0 border border-beige-kem/20 p-4">
            <dt className="text-sm font-bold text-ink-soft">Ngày có lượt bán</dt>
            <dd className="mt-2 text-xl font-bold tabular-nums">
              {timeSeries.length > 0 ? sellingDays.length.toLocaleString("vi-VN") : "—"}
            </dd>
            <dd className="mt-2 text-sm text-ink-soft">
              {timeSeries.length > 0
                ? `Trên ${timeSeries.length.toLocaleString("vi-VN")} ngày trong kỳ, kể cả ngày không bán được vé.`
                : "Chưa có dữ liệu theo ngày"}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
