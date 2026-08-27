import React, { Suspense, lazy, useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  TrendingUp,
  DollarSign,
  Activity,
} from "lucide-react";
import type {
  DatePeriodFilter,
  OrganizerAnalyticsDashboardResponse,
} from "../../../shared/types/analytics";
import { fetchOrganizerAnalytics } from "../../services/organizerAnalyticsClient";
import { KPICards } from "./analytics/KPICards";
import { AnalyticsFilterBar } from "./analytics/AnalyticsFilterBar";
import { TopEventsChart } from "./analytics/TopEventsChart";
import { TicketSalesInsights } from "./analytics/TicketSalesInsights";
import { RecentTransactionsTable } from "./analytics/RecentTransactionsTable";
import { InfoCard } from "./primitives";

/*
 * The charts, and the 1.37MB of `recharts` behind them.
 *
 * Three components in the whole product read that library and all three are analytics; before the
 * split every visitor of the landing page downloaded it to look at concert posters. Both of these
 * sit below the fold of a screen only an organizer opens, so the import can wait for the screen.
 */
const TimeSeriesChart = lazy(() =>
  import("./analytics/TimeSeriesChart").then((m) => ({ default: m.TimeSeriesChart })),
);
const RevenueDonutCharts = lazy(() =>
  import("./analytics/RevenueDonutCharts").then((m) => ({ default: m.RevenueDonutCharts })),
);

function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function OrganizerBusinessAnalytics() {
  const [period, setPeriod] = useState<DatePeriodFilter>("7d");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("all");

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<OrganizerAnalyticsDashboardResponse | null>(
    null,
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOrganizerAnalytics({
        period,
        startDate: period === "custom" ? startDate : undefined,
        endDate: period === "custom" ? endDate : undefined,
        eventId: selectedEventId,
      });
      setDashboardData(data);
    } catch (err: any) {
      setError(err?.message || "Không thể tải báo cáo kinh doanh.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [period, startDate, endDate, selectedEventId]);

  const [eventListOptions, setEventListOptions] = useState<Array<{ id: string; title: string }>>(
    [],
  );

  useEffect(() => {
    if (!dashboardData) return;
    setEventListOptions((prev) => {
      const map = new Map<string, string>();
      prev.forEach((e) => map.set(e.id, e.title));
      if (dashboardData.all_events) {
        dashboardData.all_events.forEach((e) => map.set(e.event_id, e.event_title));
      }
      if (dashboardData.top_events) {
        dashboardData.top_events.forEach((e) => map.set(e.event_id, e.event_title));
      }
      return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
    });
  }, [dashboardData]);

  const grossRevenue = dashboardData?.overview?.gross_revenue_vnd ?? 0;
  const ticketsSold = dashboardData?.overview?.total_tickets_sold ?? 0;

  return (
    <InfoCard
      title="Báo cáo kinh doanh"
      titleClassName="text-burgundy-ink"
      action={
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex h-9 items-center justify-center gap-1.5 border-2 border-beige-kem px-3.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-burgundy" : ""}`} />
          <span>Tải lại</span>
        </button>
      }
    >
      <div className="space-y-6">
        {/* 1. Friendly Greeting Header with Hero Illustration & Today's Sales Quick Stat */}
        <div className="relative overflow-hidden border-2 border-beige-kem/30 bg-surface-2 p-6 text-beige-kem">
          {/* Subtle Background Glow Elements */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 bg-burgundy/15 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 -bottom-16 h-64 w-64 bg-la-co/10 blur-3xl" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            {/* Left: Greeting & Description */}
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center text-la-co">
                <Sparkles className="h-8 w-8" strokeWidth={2} />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-beige-kem sm:text-2xl">
                    Xin chào, Nhà tổ chức!
                  </h2>
                </div>
                <p className="mt-1 text-xs text-beige-kem/70 sm:text-sm max-w-xl">
                  Bảng điều khiển kinh doanh tổng quan — theo dõi xu hướng doanh thu, tiến độ bán
                  vé, và hiệu suất của toàn bộ chuỗi sự kiện.
                </p>
              </div>
            </div>

            {/* Right: Today's Sales / Quick Stat Highlight Widget */}
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <div className="flex items-center gap-3 border border-beige-kem/30 bg-xanh-pho px-4 py-3 backdrop-blur">
                <div className="bg-la-co/20 p-2.5 text-la-co">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-beige-kem/70">
                    <Activity className="h-3 w-3 text-la-co" /> Doanh thu kỳ này
                  </div>
                  <div className="text-lg font-black text-la-co sm:text-xl">
                    {formatVND(grossRevenue)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 border border-beige-kem/30 bg-xanh-pho px-4 py-3 backdrop-blur">
                <div className="bg-cam-dat/20 p-2.5 text-cam-dat-ink">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-beige-kem/70">
                    Vé đã bán
                  </div>
                  <div className="text-lg font-black text-beige-kem sm:text-xl">
                    {ticketsSold.toLocaleString("vi-VN")}{" "}
                    <span className="text-xs text-beige-kem/70 font-normal">vé</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Global Filter Toolbar */}
        <AnalyticsFilterBar
          period={period}
          onPeriodChange={setPeriod}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
          selectedEventId={selectedEventId}
          onEventChange={setSelectedEventId}
          eventList={eventListOptions}
          onRefresh={loadData}
          loading={loading}
        />

        {/* Loading State */}
        {loading && !dashboardData && (
          <div className="flex h-64 flex-col items-center justify-center space-y-3 border-2 border-beige-kem/30 bg-surface-2 p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-burgundy" />
            <p className="text-body font-bold text-beige-kem/80">
              Đang tổng hợp báo cáo kinh doanh…
            </p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-3 border-2 border-burgundy bg-burgundy/20 p-4 text-beige-kem">
            <AlertCircle className="h-5 w-5 shrink-0 text-burgundy" />
            <p className="text-body font-bold">{error}</p>
          </div>
        )}

        {/* 3. Dashboard Analytics Content */}
        {dashboardData && (
          <div className="space-y-6">
            {/* Top Row: 4 Icon-based KPI Stat Cards */}
            <KPICards overview={dashboardData.overview} />

            {/*
              One boundary around the grid, not one per chart: they arrive in the same chunk, so two
              boundaries would only give the reader two separate flickers of the same wait.
            */}
            <Suspense
              fallback={
                <p className="py-16 text-center font-meta text-body text-ink-soft">
                  Đang tải biểu đồ…
                </p>
              }
            >
              {/* Main Content Grid: 2 Columns */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Left Column (Wide): Sales Chart, Ticket Insights, Recent Activity Feed */}
                <div className="space-y-6 lg:col-span-7 xl:col-span-8">
                  {/* Sales Analytics Chart Card */}
                  <TimeSeriesChart data={dashboardData.time_series} />

                  <TicketSalesInsights
                    overview={dashboardData.overview}
                    timeSeries={dashboardData.time_series}
                  />

                  {/* Recent Activity Audit Feed Card */}
                  <RecentTransactionsTable transactions={dashboardData.recent_transactions} />
                </div>

                {/* Right Column (Side Panels): Donut Breakdown Side Panel & Top Events Ranked List */}
                <div className="space-y-6 lg:col-span-5 xl:col-span-4">
                  {/* Conversion Rate / Breakdown Donut Side Panel */}
                  <RevenueDonutCharts breakdowns={dashboardData.breakdowns} />

                  {/* Top Events Ranked List Side Panel */}
                  <TopEventsChart data={dashboardData.top_events} />
                </div>
              </div>
            </Suspense>
          </div>
        )}
      </div>
    </InfoCard>
  );
}

export default OrganizerBusinessAnalytics;
