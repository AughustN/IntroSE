/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import Section from "../Section";
import AnalyticsScreen from "./screens/AnalyticsScreen";
import AttendeesScreen from "./screens/AttendeesScreen";
import AuditScreen from "./screens/AuditScreen";
import CategoriesScreen from "./screens/CategoriesScreen";
import EventListScreen from "./screens/EventListScreen";
import FeaturedScreen from "./screens/FeaturedScreen";
import ModerationScreen from "./screens/ModerationScreen";
import OrdersScreen from "./screens/OrdersScreen";
import OrganizersScreen from "./screens/OrganizersScreen";
import OverviewScreen from "./screens/OverviewScreen";
import ReportsScreen from "./screens/ReportsScreen";
import ReviewReportsScreen from "./screens/ReviewReportsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import WalletScreen from "./screens/WalletScreen";

/**
 * The admin console.
 *
 * Two things were wrong with what this replaces, and only one of them was the look.
 *
 * The look: eight tabs in a horizontal rail, which was full. Anything added had to displace
 * something already there, so the console had stopped growing with the product.
 *
 * The truth: six of those eight tabs were drawn from `SAMPLE_MOVIES` and the browser's own booking
 * history. An admin read a revenue figure that belonged to their own session and a check-in panel
 * that said "mock result" in the page. A console that reports numbers nobody else can see is worse
 * than one that reports none.
 *
 * So the rail became a grouped sidebar — thirteen screens fit, and the fourteenth will — and every
 * screen behind it reads from the server or says plainly that it has nothing yet.
 */

type ScreenId =
  | "overview"
  | "analytics"
  | "moderation"
  | "event-list"
  | "organizers"
  | "reports"
  | "review-reports"
  | "orders"
  | "wallet"
  | "attendees"
  | "categories"
  | "featured"
  | "settings"
  | "audit";

interface NavGroup {
  label: string;
  items: Array<{ id: ScreenId; label: string }>;
}

/**
 * Five groups, ordered by how often a duty comes up rather than by which module owns it.
 *
 * "Kiểm duyệt" sits second because it is the work with a queue attached: everything in it is
 * somebody waiting for an answer.
 */
const NAV: NavGroup[] = [
  {
    label: "Tổng quan",
    items: [
      { id: "overview", label: "Bảng tổng quan" },
      { id: "analytics", label: "Doanh thu" },
    ],
  },
  {
    label: "Kiểm duyệt",
    items: [
      { id: "moderation", label: "Hàng chờ sự kiện" },
      { id: "event-list", label: "Danh sách sự kiện" },
      { id: "organizers", label: "Ban tổ chức" },
      { id: "reports", label: "Tố cáo nội dung" },
      { id: "review-reports", label: "Kiểm duyệt bình luận" },
    ],
  },
  {
    label: "Vận hành",
    items: [
      { id: "orders", label: "Đơn hàng" },
      { id: "wallet", label: "Ví & hoàn tiền" },
      { id: "attendees", label: "Khách tham dự" },
    ],
  },
  {
    label: "Nội dung",
    items: [
      { id: "categories", label: "Danh mục" },
      { id: "featured", label: "Trang chủ nổi bật" },
    ],
  },
  {
    label: "Hệ thống",
    items: [
      { id: "settings", label: "Cấu hình" },
      { id: "audit", label: "Nhật ký thao tác" },
    ],
  },
];

export default function AdminConsole({ onBack }: { onBack: () => void }) {
  const [screen, setScreen] = useState<ScreenId>("overview");

  return (
    <Section divided={false}>
      <div className="space-y-6">
        {/*
          The top bar: where you are, and the way out. The way out is a quiet text control, like
          every other "back" on the site.
        */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-beige-kem/40 pb-4">
          <div className="space-y-1">
            <p className="label-eyebrow text-ink-soft">TixHub · Điều hành</p>
            <h1 className="font-display text-title-m font-black uppercase tracking-[0.04em] text-beige-kem">
              Sảnh điều hành
            </h1>
          </div>
          <button
            onClick={onBack}
            className="label-eyebrow inline-flex items-center gap-2 text-ink-soft transition hover:text-beige-kem"
          >
            <span aria-hidden="true">&lt;</span>
            Quay về trang chủ
          </button>
        </div>

        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          {/*
            The rail. Sticky for the same reason the filter rail on `/events` is: the screens beside
            it run long, and a nav that scrolls away is a nav you have to scroll back for.
          */}
          <nav className="space-y-6 lg:sticky lg:top-24 lg:h-fit">
            {NAV.map((group) => (
              <div key={group.label} className="space-y-px">
                <p className="label-eyebrow pb-2 text-ink-soft">{group.label}</p>
                {group.items.map((item) => {
                  const selected = screen === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setScreen(item.id)}
                      aria-current={selected ? "page" : undefined}
                      className={`flex w-full items-center border-l-2 px-3 py-2 text-left font-meta text-body transition ${
                        selected
                          ? "border-burgundy bg-surface-2 font-bold text-beige-kem"
                          : "border-transparent text-ink-soft hover:bg-bubblegum/20 hover:text-beige-kem"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <section className="min-w-0 space-y-5">
            {screen === "overview" && <OverviewScreen onOpen={(next) => setScreen(next)} />}
            {screen === "analytics" && <AnalyticsScreen />}
            {screen === "moderation" && <ModerationScreen />}
            {screen === "event-list" && <EventListScreen />}
            {screen === "organizers" && <OrganizersScreen />}
            {screen === "reports" && <ReportsScreen />}
            {screen === "review-reports" && <ReviewReportsScreen />}
            {screen === "orders" && <OrdersScreen />}
            {screen === "wallet" && <WalletScreen />}
            {screen === "attendees" && <AttendeesScreen />}
            {screen === "categories" && <CategoriesScreen />}
            {screen === "featured" && <FeaturedScreen />}
            {screen === "settings" && <SettingsScreen />}
            {screen === "audit" && <AuditScreen />}
          </section>
        </div>
      </div>
    </Section>
  );
}

export type { ScreenId };
