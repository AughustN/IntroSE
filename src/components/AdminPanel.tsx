/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Booking, MovieEvent } from "../types";
import { adminClient } from "../services/adminClient";
import type {
  AdminCategory,
  AdminModerationQueue,
  FeaturedEvent,
  FeaturedEventInput,
  SystemSettings,
} from "@shared/admin/types.js";
import { formatVnd } from "../services/currency";
import Section, { SectionHead } from "./Section";

/**
 * The console's controls, in the site's own vocabulary.
 *
 * This screen was built with a different rulebook from the rest of the app — rounded-2xl panels,
 * `bg-white/[0.03]` fills, tinted pill buttons, its own hairline opacities — so an admin moving
 * between `/events` and `/admin` crossed into what looked like a second product. The site's own
 * language is flat and ruled: square corners, one hairline weight, small-caps controls, and exactly
 * one filled button (burgundy) per group of actions.
 *
 * These four strings are that language written down once, so a control added later cannot quietly
 * invent a fifth style.
 */
/** The one filled action in a group: save, confirm, apply. */
const ACTION_PRIMARY =
  "label-eyebrow inline-flex h-9 items-center gap-1.5 bg-burgundy px-4 text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
/** Everything else: outlined, quiet, as many per group as needed. */
const ACTION_GHOST =
  "label-eyebrow inline-flex h-9 items-center gap-1.5 border border-beige-kem/40 px-3 text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-40";
/** A text field. Square, hairline, burgundy on focus — the same treatment the filter rail uses. */
const FIELD =
  "h-9 border border-beige-kem/25 bg-xanh-pho px-3 font-meta text-body text-beige-kem outline-none transition placeholder:text-ink-soft/60 focus:border-burgundy";
/** A panel inside the console: ruled, unfilled, square. */
const PANEL = "border border-beige-kem/25 p-4";

interface AdminPanelProps {
  events: MovieEvent[];
  bookings: Booking[];
  onBack: () => void;
}

const adminTabs = [
  { id: "events", label: "Sự kiện" },
  { id: "orders", label: "Đơn hàng" },
  { id: "promos", label: "Voucher" },
  { id: "checkin", label: "Check-in" },
  { id: "reports", label: "Báo cáo" },
  { id: "roles", label: "Phân quyền" },
  { id: "categories", label: "Danh mục" },
  { id: "settings", label: "Cấu hình" },
];

const SETTINGS_META: Record<string, { label: string; hint: string; min?: number; max?: number }> = {
  seat_hold_ttl_minutes: { label: "Thời gian giữ chỗ (phút)", hint: "1–30", min: 1, max: 30 },
  topup_grace_minutes: {
    label: "Gia hạn nạp tiền (phút)",
    hint: "1–15; ≤ giới hạn tuyệt đối",
    min: 1,
    max: 15,
  },
  absolute_ceiling_minutes: {
    label: "Giới hạn tuyệt đối (phút)",
    hint: "2–30; ≥ gia hạn",
    min: 2,
    max: 30,
  },
  max_tickets_per_buyer: { label: "Vé tối đa / người mua", hint: "1–50", min: 1, max: 50 },
  wallet_topup_min: { label: "Nạp tối thiểu (VND)", hint: "≥ 0; ≤ nạp tối đa", min: 0 },
  wallet_topup_max: { label: "Nạp tối đa (VND)", hint: "≥ nạp tối thiểu; ≤ số dư tối đa", min: 0 },
  wallet_balance_ceiling: { label: "Số dư tối đa (VND)", hint: "≥ nạp tối đa", min: 0 },
  ai_features_enabled: { label: "Bật tính năng AI", hint: "Bật/Tắt" },
  ai_platform_request_ceiling: {
    label: "Trần yêu cầu AI / kỳ",
    hint: "Toàn nền tảng; 0 = ngừng gọi AI",
    min: 0,
  },
  ai_platform_window_hours: {
    label: "Độ dài kỳ tính trần AI (giờ)",
    hint: "1–720",
    min: 1,
    max: 720,
  },
};

export default function AdminPanel({ events, bookings, onBack }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState("events");
  const [scanCode, setScanCode] = useState(bookings[0]?.id || "TB123456");
  const [moderation, setModeration] = useState<AdminModerationQueue | null>(null);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [auditLogs, setAuditLogs] = useState<import("@shared/admin/types.js").AuditLog[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [featured, setFeatured] = useState<FeaturedEvent[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSuccess, setCatalogSuccess] = useState<string | null>(null);

  // Category form state
  const [newCatVi, setNewCatVi] = useState("");
  const [newCatEn, setNewCatEn] = useState("");
  const [catBusy, setCatBusy] = useState(false);

  // Featured form state
  const [featuredDraft, setFeaturedDraft] = useState<FeaturedEventInput[]>([]);
  const [newFeaturedId, setNewFeaturedId] = useState("");
  const [featuredBusy, setFeaturedBusy] = useState(false);

  // Settings form state
  const [settingsDraft, setSettingsDraft] = useState<SystemSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);

  const loadModeration = async () => {
    setModerationError(null);
    try {
      const [data, logs] = await Promise.all([adminClient.queue(), adminClient.auditLogs()]);
      setModeration(data);
      setAuditLogs(logs);
    } catch (error) {
      setModerationError(
        error instanceof Error ? error.message : "Không tải được hàng chờ kiểm duyệt.",
      );
    }
  };

  const moderate = async (action: () => Promise<unknown>) => {
    setModerationBusy(true);
    setModerationError(null);
    try {
      await action();
      await loadModeration();
    } catch (error) {
      setModerationError(error instanceof Error ? error.message : "Thao tác kiểm duyệt thất bại.");
    } finally {
      setModerationBusy(false);
    }
  };
  const revenue = bookings.reduce(
    (sum, booking) => sum + (booking.finalPrice || booking.totalPrice),
    0,
  );
  const soldSeats = bookings.reduce((sum, booking) => sum + booking.selectedSeats.length, 0);
  const capacity = events.length * 84;
  const fillRate = capacity ? Math.round((soldSeats / capacity) * 100) : 0;

  useEffect(() => {
    void loadModeration();
    void Promise.all([adminClient.categories(), adminClient.featured(), adminClient.settings()])
      .then(([nextCategories, nextFeatured, nextSettings]) => {
        setCategories(nextCategories);
        setFeatured(nextFeatured);
        setFeaturedDraft(
          nextFeatured.map((f) => ({ eventId: f.eventId, displayOrder: f.displayOrder })),
        );
        setSettingsDraft(nextSettings);
      })
      .catch((error) =>
        setCatalogError(error instanceof Error ? error.message : "Không tải được cấu hình admin."),
      );
  }, []);

  const flash = (msg: string) => {
    setCatalogSuccess(msg);
    setTimeout(() => setCatalogSuccess(null), 3000);
  };

  // ─── Category actions ───
  const handleCreateCategory = async () => {
    if (!newCatVi.trim()) return;
    setCatBusy(true);
    setCatalogError(null);
    try {
      const created = await adminClient.createCategory({
        labelVi: newCatVi.trim(),
        labelEn: newCatEn.trim() || null,
      });
      setCategories((prev) => [...prev, created]);
      setNewCatVi("");
      setNewCatEn("");
      flash("Đã tạo danh mục.");
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Không tạo được danh mục.");
    } finally {
      setCatBusy(false);
    }
  };

  const handleRenameCategory = async (cat: AdminCategory) => {
    const label = window.prompt("Tên mới (Tiếng Việt)", cat.labelVi);
    if (!label || label.trim() === cat.labelVi) return;
    setCatalogError(null);
    try {
      const updated = await adminClient.renameCategory(cat.id, {
        labelVi: label.trim(),
        labelEn: cat.labelEn,
      });
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      flash("Đã đổi tên danh mục.");
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Không đổi tên được danh mục.");
    }
  };

  const handleDeleteCategory = async (cat: AdminCategory) => {
    if (!window.confirm(`Xóa danh mục "${cat.labelVi}"?`)) return;
    setCatalogError(null);
    try {
      await adminClient.deleteCategory(cat.id);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      flash("Đã xóa danh mục.");
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "Không xóa được danh mục (có thể đang có sự kiện sử dụng).",
      );
    }
  };

  // ─── Featured actions ───
  const handleAddFeatured = () => {
    const id = Number(newFeaturedId);
    if (!Number.isInteger(id) || id < 1) return;
    if (featuredDraft.some((f) => f.eventId === id)) return;
    const nextOrder =
      featuredDraft.length === 0 ? 0 : Math.max(...featuredDraft.map((f) => f.displayOrder)) + 1;
    setFeaturedDraft([...featuredDraft, { eventId: id, displayOrder: nextOrder }]);
    setNewFeaturedId("");
  };

  const handleRemoveFeatured = (eventId: number) => {
    setFeaturedDraft(
      featuredDraft.filter((f) => f.eventId !== eventId).map((f, i) => ({ ...f, displayOrder: i })),
    );
  };

  const handleMoveFeatured = (index: number, direction: -1 | 1) => {
    const next = [...featuredDraft];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFeaturedDraft(next.map((f, i) => ({ ...f, displayOrder: i })));
  };

  const handleSaveFeatured = async () => {
    setFeaturedBusy(true);
    setCatalogError(null);
    try {
      const result = await adminClient.replaceFeatured(featuredDraft);
      setFeatured(result);
      setFeaturedDraft(result.map((f) => ({ eventId: f.eventId, displayOrder: f.displayOrder })));
      flash("Đã cập nhật sự kiện nổi bật.");
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : "Không cập nhật được sự kiện nổi bật.",
      );
    } finally {
      setFeaturedBusy(false);
    }
  };

  // ─── Settings actions ───
  const handleSettingChange = (key: string, value: number | boolean) => {
    if (!settingsDraft) return;
    setSettingsDraft({ ...settingsDraft, [key]: value } as SystemSettings);
    setSettingsError(null);
  };

  const handleSaveSettings = async () => {
    if (!settingsDraft) return;
    setSettingsBusy(true);
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      const saved = await adminClient.updateSettings(settingsDraft);
      setSettingsDraft(saved);
      setSettingsSuccess("Đã lưu cấu hình thành công.");
      setTimeout(() => setSettingsSuccess(null), 3000);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Không lưu được cấu hình.");
    } finally {
      setSettingsBusy(false);
    }
  };

  return (
    /*
      The spacing goes on a wrapper inside, not on `Section`: its `className` lands on the outer
      band element, whose only child is the measure — `space-y-*` there would have nothing to space.
    */
    <Section divided={false}>
      <div className="space-y-8">
        {/*
        The same stroked masthead the landing bands carry, so the console reads as a room in this
        building rather than as a separate tool. The way out is a quiet text control on the left,
        like every other "back" on the site — it used to be lavender, a colour nothing else here
        uses for a link.
      */}
        <div className="space-y-5">
          <button
            onClick={onBack}
            className="label-eyebrow inline-flex items-center gap-2 text-ink-soft transition hover:text-beige-kem"
          >
            <span aria-hidden="true">&lt;</span>
            Quay về trang chủ
          </button>
          <SectionHead
            variant="bar"
            eyebrow="Quản trị"
            title="Admin Console"
            meta="Danh mục · nổi bật · cấu hình · kiểm duyệt"
          />
        </div>

        <div className="grid gap-px border border-beige-kem/25 bg-beige-kem/25 md:grid-cols-4">
          <Metric label="Doanh thu mock" value={formatVnd(revenue)} />
          <Metric label="Đơn đã tạo" value={`${bookings.length}`} />
          <Metric label="Vé đã bán" value={`${soldSeats}`} />
          <Metric label="Tỷ lệ lấp đầy" value={`${fillRate}%`} />
        </div>

        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          {/*
          The tab rail, built like the filter rail on `/events`: rows of small caps over hairlines,
          the selected one filled. Sticky for the same reason that one is — the panels beside it run
          long, and a nav that scrolls away is a nav you have to scroll back for.
        */}
          <nav className="border-t border-beige-kem/25 lg:sticky lg:top-24 lg:h-fit">
            {adminTabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={selected ? "page" : undefined}
                  className={`label-eyebrow flex w-full items-center border-b border-beige-kem/25 px-3 py-3 text-left transition ${
                    selected
                      ? "bg-beige-kem text-xanh-pho"
                      : "text-ink-soft hover:bg-bubblegum/20 hover:text-beige-kem"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <section className="min-w-0">
            {activeTab === "events" && (
              <div className="space-y-5">
                <PanelTitle title="Quản lý sự kiện, suất diễn, địa điểm, sơ đồ ghế" />
                {moderationError && (
                  <div className="border-l-2 border-burgundy bg-bubblegum/25 px-4 py-3 font-meta text-body text-beige-kem">
                    {moderationError}
                  </div>
                )}
                {moderation && (
                  <div className={`${PANEL} space-y-4`}>
                    <p className="label-eyebrow text-ink-soft">
                      Hàng chờ kiểm duyệt: {moderation.events.length} sự kiện ·{" "}
                      {moderation.organizers.length} ban tổ chức
                    </p>
                    {moderation.organizers.map((organizer) => (
                      <div
                        key={`organizer-${organizer.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-beige-kem/25 pb-3"
                      >
                        <div>
                          <p className="font-bold text-beige-kem">{organizer.displayName}</p>
                          <p className="font-meta text-meta text-ink-soft">
                            {organizer.status} · {organizer.reviewNote ?? "Chưa có ghi chú"}
                          </p>
                        </div>
                        {organizer.status === "pending" && (
                          <div className="flex gap-2">
                            <button
                              disabled={moderationBusy}
                              onClick={() =>
                                moderate(() => adminClient.approveOrganizer(organizer.id))
                              }
                              className={ACTION_GHOST}
                            >
                              Duyệt
                            </button>
                            <button
                              disabled={moderationBusy}
                              onClick={() => {
                                const value = window.prompt("Lý do từ chối:");
                                if (value)
                                  void moderate(() =>
                                    adminClient.rejectOrganizer(organizer.id, value),
                                  );
                              }}
                              className={ACTION_GHOST}
                            >
                              Từ chối
                            </button>
                          </div>
                        )}
                        {organizer.status === "approved" && (
                          <button
                            disabled={moderationBusy}
                            onClick={() => {
                              const value = window.prompt("Lý do đình chỉ:");
                              if (value)
                                void moderate(() =>
                                  adminClient.suspendOrganizer(organizer.id, value),
                                );
                            }}
                            className={ACTION_GHOST}
                          >
                            Đình chỉ
                          </button>
                        )}
                      </div>
                    ))}
                    {moderation.events.map((event) => (
                      <div
                        key={`moderation-event-${event.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-beige-kem/25 pb-3"
                      >
                        <div>
                          <p className="font-bold text-beige-kem">{event.title}</p>
                          <p className="font-meta text-meta text-ink-soft">
                            {event.organizer} · {event.moderation}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            disabled={moderationBusy}
                            onClick={() => moderate(() => adminClient.approveEvent(event.id))}
                            className={ACTION_GHOST}
                          >
                            Duyệt
                          </button>
                          <button
                            disabled={moderationBusy}
                            onClick={() => {
                              const value = window.prompt("Lý do gỡ:");
                              if (value)
                                void moderate(() => adminClient.removeEvent(event.id, value));
                            }}
                            className={ACTION_GHOST}
                          >
                            Gỡ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-body">
                    <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                      <tr>
                        <th className="py-3 pr-4">Sự kiện</th>
                        <th className="py-3 pr-4">Thành phố</th>
                        <th className="py-3 pr-4">Suất diễn</th>
                        <th className="py-3 pr-4">Trạng thái</th>
                        <th className="py-3 pr-4">Sơ đồ ghế</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((event) => (
                        <tr
                          key={event.id}
                          className="border-b border-beige-kem/15 transition hover:bg-bubblegum/20"
                        >
                          <td className="py-4 pr-4">
                            <p className="font-display font-bold text-beige-kem">{event.title}</p>
                            <p className="label-eyebrow text-burgundy-ink">{event.venueName}</p>
                          </td>
                          <td className="py-4 pr-4 font-meta text-body text-ink-soft">
                            {event.city}
                          </td>
                          <td className="py-4 pr-4 font-meta text-meta text-ink-soft">
                            {event.dates.length} ngày / {event.times.length} giờ
                          </td>
                          <td className="py-4 pr-4">
                            <span className="label-eyebrow border border-beige-kem/25 px-2.5 py-1 text-ink-soft">
                              {event.status}
                            </span>
                          </td>
                          <td className="py-4 pr-4 font-meta text-meta text-ink-soft">
                            84 ghế mock / row A-H
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "orders" && (
              <div className="space-y-5">
                <PanelTitle title="Quản lý đơn hàng, thanh toán, hoàn tiền" />
                {bookings.length === 0 ? (
                  <EmptyState text="Chưa có đơn hàng. Hãy đặt thử một vé ở frontend để bảng này có dữ liệu." />
                ) : (
                  <div className="grid gap-4">
                    {bookings.map((booking) => (
                      <div key={booking.id} className={`${PANEL} bg-surface-2`}>
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-display text-title-s font-bold text-beige-kem">
                              {booking.movie.title}
                            </p>
                            <p className="label-eyebrow text-burgundy-ink">
                              {booking.id} / {booking.paymentMethod} / {booking.status}
                            </p>
                          </div>
                          <div className="font-display text-title-m font-black text-burgundy-ink">
                            {formatVnd(booking.finalPrice || booking.totalPrice)}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 font-meta text-meta text-ink-soft">
                          <span className="border border-beige-kem/25 px-2 py-1">
                            Ghế {booking.selectedSeats.map((seat) => seat.id).join(", ")}
                          </span>
                          <span className="border border-beige-kem/25 px-2 py-1">
                            Email {booking.customerEmail}
                          </span>
                          <span className="border border-burgundy/50 px-2 py-1 text-burgundy-ink">
                            Hoàn tiền mock
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "promos" && (
              <div className="space-y-5">
                <PanelTitle title="Quản lý mã giảm giá, combo vé, affiliate" />
                <div className="grid gap-4 md:grid-cols-3">
                  {["WEEKEND50", "FIRSTBOOK", "GROUP4"].map((code, index) => (
                    <div key={code} className="border border-beige-kem/25 bg-surface-2 p-5">
                      <p className="font-display text-title-m font-black text-beige-kem">{code}</p>
                      <p className="mt-2 font-meta text-body text-ink-soft">
                        {index === 0 ? "Cuối tuần" : index === 1 ? "Khách mới" : "Nhóm bạn"}
                      </p>
                      <p className="mt-4 label-eyebrow text-burgundy-ink">
                        Còn hiệu lực / cần API validate
                      </p>
                    </div>
                  ))}
                </div>
                <div className="border-l-2 border-la-co bg-surface-2 px-4 py-3 font-meta text-body leading-6 text-ink-soft">
                  Combo vé và affiliate hiện đang là mock field trên từng event. Backend cần quản lý
                  campaign, usage limit, min order và commission.
                </div>
              </div>
            )}

            {activeTab === "checkin" && (
              <div className="space-y-5">
                <PanelTitle title="Check-in vé bằng QR" />
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <input
                    value={scanCode}
                    onChange={(event) => setScanCode(event.target.value)}
                    className={FIELD}
                  />
                  <button className={ACTION_PRIMARY}>Xác nhận check-in</button>
                </div>
                <div className="border border-beige-kem/25 bg-surface-2 p-5">
                  <div className="flex items-center gap-3">
                    <span className="label-eyebrow border border-beige-kem/25 px-3 py-2 text-burgundy-ink">
                      QR
                    </span>
                    <div>
                      <p className="font-display text-title-m font-black text-beige-kem">
                        Mã {scanCode}
                      </p>
                      <p className="font-meta text-body text-ink-soft">
                        Mock result: hợp lệ nếu mã khớp booking id trong local history.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "reports" && (
              <div className="space-y-5">
                <PanelTitle title="Báo cáo doanh thu, số vé bán, tỷ lệ lấp đầy" />
                <div className="grid gap-4 md:grid-cols-3">
                  <Metric label="GMV" value={formatVnd(revenue)} />
                  <Metric label="Seats sold" value={`${soldSeats}`} />
                  <Metric label="Fill rate" value={`${fillRate}%`} />
                </div>
                <div className="border border-beige-kem/25 p-5">
                  <div className="mb-4 flex items-center justify-between label-eyebrow text-ink-soft">
                    <span>Biểu đồ doanh thu</span>
                    <span>7 ngày gần nhất</span>
                  </div>
                  <div className="flex h-56 items-end gap-3">
                    {[40, 72, 56, 88, 64, 92, 76].map((height, index) => (
                      <div key={index} className="flex flex-1 flex-col items-center gap-2">
                        <div className="w-full bg-burgundy" style={{ height: `${height}%` }} />
                        <span className="font-meta text-meta text-ink-soft">D{index + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "categories" && (
              <div className="space-y-5">
                <PanelTitle title="Danh mục và sự kiện nổi bật" />
                {catalogError && (
                  <div className="border-l-2 border-burgundy bg-bubblegum/25 px-4 py-3 font-meta text-body text-beige-kem">
                    {catalogError}
                  </div>
                )}
                {catalogSuccess && (
                  <div className="border-l-2 border-la-co bg-la-co/10 px-4 py-3 font-meta text-body text-beige-kem">
                    {catalogSuccess}
                  </div>
                )}

                {/* Create Category Form */}
                <div className={`${PANEL} space-y-3`}>
                  <p className="label-eyebrow text-ink-soft">Tạo danh mục mới</p>
                  <div className="flex flex-wrap gap-3">
                    <input
                      value={newCatVi}
                      onChange={(e) => setNewCatVi(e.target.value)}
                      placeholder="Tên tiếng Việt *"
                      className={`${FIELD} min-w-[180px] flex-1`}
                    />
                    <input
                      value={newCatEn}
                      onChange={(e) => setNewCatEn(e.target.value)}
                      placeholder="Tên tiếng Anh (tuỳ chọn)"
                      className={`${FIELD} min-w-[180px] flex-1`}
                    />
                    <button
                      disabled={catBusy || !newCatVi.trim()}
                      onClick={handleCreateCategory}
                      className={ACTION_PRIMARY}
                    >
                      Tạo
                    </button>
                  </div>
                </div>

                {/* Category List */}
                <div className="space-y-3">
                  {categories.map((category) => (
                    <div key={category.id} className={`${PANEL} flex items-center justify-between`}>
                      <div>
                        <p className="font-bold text-beige-kem">
                          {category.labelVi}
                          {category.labelEn ? (
                            <span className="ml-2 font-meta text-meta text-ink-soft">
                              ({category.labelEn})
                            </span>
                          ) : null}
                        </p>
                        <p className="font-meta text-meta text-ink-soft">{category.code}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className={ACTION_GHOST}
                          onClick={() => handleRenameCategory(category)}
                        >
                          Đổi tên
                        </button>
                        <button
                          className={ACTION_GHOST}
                          onClick={() => handleDeleteCategory(category)}
                        >
                          Xóa
                        </button>
                      </div>
                    </div>
                  ))}
                  {categories.length === 0 && <EmptyState text="Chưa có danh mục." />}
                </div>

                {/* Featured Events Section */}
                <div className="space-y-3 border-t border-beige-kem/25 pt-5">
                  <p className="label-eyebrow text-ink-soft">Sự kiện nổi bật</p>
                  {featuredDraft.map((f, index) => {
                    const info = featured.find((fe) => fe.eventId === f.eventId);
                    return (
                      <div
                        key={f.eventId}
                        className={`${PANEL} flex items-center justify-between py-3 text-body text-beige-kem`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="label-eyebrow tabular-nums text-ink-soft">
                            #{f.displayOrder}
                          </span>
                          <span>{info?.title ?? `Event #${f.eventId}`}</span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleMoveFeatured(index, -1)}
                            disabled={index === 0}
                            className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => handleMoveFeatured(index, 1)}
                            disabled={index === featuredDraft.length - 1}
                            className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:opacity-30"
                          >
                            ▼
                          </button>
                          <button
                            onClick={() => handleRemoveFeatured(f.eventId)}
                            className="label-eyebrow px-2 py-1 text-burgundy-ink transition hover:text-beige-kem"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {featuredDraft.length === 0 && <EmptyState text="Chưa có sự kiện nổi bật." />}
                  <div className="flex gap-2">
                    <input
                      value={newFeaturedId}
                      onChange={(e) => setNewFeaturedId(e.target.value)}
                      placeholder="Event ID"
                      type="number"
                      className={`${FIELD} w-32`}
                    />
                    <button onClick={handleAddFeatured} className={ACTION_GHOST}>
                      Thêm
                    </button>
                    <button
                      disabled={featuredBusy}
                      onClick={handleSaveFeatured}
                      className={ACTION_PRIMARY}
                    >
                      Lưu featured
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "settings" && (
              <div className="space-y-5">
                <PanelTitle title="Cấu hình vận hành" />
                {settingsError && (
                  <div className="border-l-2 border-burgundy bg-bubblegum/25 px-4 py-3 font-meta text-body text-beige-kem">
                    {settingsError}
                  </div>
                )}
                {settingsSuccess && (
                  <div className="border-l-2 border-la-co bg-la-co/10 px-4 py-3 font-meta text-body text-beige-kem">
                    {settingsSuccess}
                  </div>
                )}
                {settingsDraft ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {Object.entries(settingsDraft).map(([key, value]) => {
                      const meta = SETTINGS_META[key] ?? { label: key, hint: "" };
                      const isBoolean = typeof value === "boolean";
                      return (
                        <label key={key} className="space-y-1.5 text-body text-beige-kem">
                          <span className="block font-bold">{meta.label}</span>
                          <span className="block font-meta text-meta text-ink-soft">
                            {meta.hint}
                          </span>
                          {isBoolean ? (
                            <div className="flex items-center gap-3 pt-1">
                              <button
                                type="button"
                                onClick={() => handleSettingChange(key, !value)}
                                role="switch"
                                aria-checked={value}
                                aria-label={meta.label}
                                /*
                                Square, like every other control on the site — a pill switch was the
                                only rounded object left on the page. The knob is burgundy when on,
                                so the state is carried by colour and by position rather than by
                                position alone.
                              */
                                className={`relative h-7 w-12 border transition ${
                                  value
                                    ? "border-burgundy bg-burgundy/15"
                                    : "border-beige-kem/25 bg-surface-2"
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 h-5 w-5 transition-transform ${
                                    value
                                      ? "translate-x-6 bg-burgundy"
                                      : "translate-x-0.5 bg-ink-soft"
                                  }`}
                                />
                              </button>
                              <span className="font-meta text-meta text-ink-soft">
                                {value ? "Bật" : "Tắt"}
                              </span>
                            </div>
                          ) : (
                            <input
                              type="number"
                              value={value as number}
                              min={meta.min}
                              max={meta.max}
                              onChange={(e) => handleSettingChange(key, Number(e.target.value))}
                              className={`${FIELD} w-full`}
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState text="Đang tải cấu hình..." />
                )}
                {settingsDraft && (
                  <button
                    disabled={settingsBusy}
                    onClick={handleSaveSettings}
                    className={ACTION_PRIMARY}
                  >
                    {settingsBusy ? "Đang lưu..." : "Lưu cấu hình"}
                  </button>
                )}
              </div>
            )}

            {activeTab === "roles" && (
              <div className="space-y-5">
                <PanelTitle title="Phân quyền admin, nhân viên, đối tác" />
                {auditLogs.length === 0 ? (
                  <EmptyState text="Chưa có audit log kiểm duyệt." />
                ) : (
                  <div className="space-y-2">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className={`${PANEL} py-3 font-meta text-meta text-ink-soft`}
                      >
                        <span className="font-meta">{log.createdAt}</span> ·{" "}
                        <strong>{log.action}</strong> · {log.targetType} #{log.targetId ?? "-"} ·{" "}
                        {log.outcome}
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    ["Admin", "Toàn quyền sự kiện, thanh toán, hoàn tiền, báo cáo"],
                    ["Nhân viên", "Check-in QR, xem đơn, gửi lại email/SMS"],
                    ["Đối tác", "Quản lý sự kiện và xem báo cáo của chính mình"],
                  ].map(([role, desc]) => (
                    <div key={role} className="border border-beige-kem/25 bg-surface-2 p-5">
                      <p className="font-display text-title-m font-black text-beige-kem">{role}</p>
                      <p className="mt-2 font-meta text-body leading-6 text-ink-soft">{desc}</p>
                    </div>
                  ))}
                </div>
                <div className="border-l-2 border-la-co bg-surface-2 px-4 py-3 font-meta text-body leading-6 text-ink-soft">
                  <span>
                    Audit log chỉ đọc. Backend thực thi RBAC và PostgreSQL chặn UPDATE/DELETE.
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </Section>
  );
}

/*
 * One figure per cell, and the cells share their rules.
 *
 * `gap-px` over a tinted parent, so four metrics read as one ruled strip rather than as four boxes
 * — the same construction the card grids use. Safe here where it is not on the card grids: this row
 * is always exactly four cells, so there is no partial last row for the tint to show through.
 */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 p-5">
      <p className="label-eyebrow text-ink-soft">{label}</p>
      <p className="mt-2 font-display text-title-m font-black text-beige-kem">{value}</p>
    </div>
  );
}

/** The heading of a tab's panel — over a rule, so each panel opens the way a section does. */
function PanelTitle({ title }: { title: string }) {
  return (
    <h2 className="border-b border-beige-kem/25 pb-3 font-display text-title-s font-black uppercase leading-tight text-beige-kem">
      {title}
    </h2>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="hud-dashed p-12 text-center font-meta text-body text-ink-soft">{text}</div>
  );
}
