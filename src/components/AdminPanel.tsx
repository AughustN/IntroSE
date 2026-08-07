/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Booking, MovieEvent } from "../types";
import { adminClient } from "../services/adminClient";
import type { AdminModerationQueue } from "@shared/admin/types.js";
import { formatVnd } from "../services/currency";

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
];

export default function AdminPanel({ events, bookings, onBack }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState("events");
  const [scanCode, setScanCode] = useState(bookings[0]?.id || "TB123456");
  const [moderation, setModeration] = useState<AdminModerationQueue | null>(null);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [auditLogs, setAuditLogs] = useState<import("@shared/admin/types.js").AuditLog[]>([]);

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
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-beige-kem/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 font-mono text-sm text-la-co transition hover:text-beige-kem"
        >
          Quay lại trang bán vé
        </button>
        <div className="text-left lg:text-right">
          <h1 className="font-display text-4xl font-black text-beige-kem">Admin Console Mock</h1>
          <p className="mt-1 text-sm text-beige-kem/65">
            Frontend-only dashboard cho đội backend nối API và phân quyền sau.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Doanh thu mock" value={formatVnd(revenue)} />
        <Metric label="Đơn đã tạo" value={`${bookings.length}`} />
        <Metric label="Vé đã bán" value={`${soldSeats}`} />
        <Metric label="Tỷ lệ lấp đầy" value={`${fillRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <nav className="rounded-2xl border border-beige-kem/10 bg-white/[0.025] p-2">
          {adminTabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold transition ${
                  selected
                    ? "bg-beige-kem text-xanh-pho"
                    : "text-beige-kem/70 hover:bg-white/[0.05] hover:text-beige-kem"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <section className="min-h-[520px] rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
          {activeTab === "events" && (
            <div className="space-y-5">
              <PanelTitle title="Quản lý sự kiện, suất diễn, địa điểm, sơ đồ ghế" />
              {moderationError && (
                <div className="rounded-xl border border-burgundy/40 bg-burgundy/10 p-3 text-sm text-beige-kem">
                  {moderationError}
                </div>
              )}
              {moderation && (
                <div className="space-y-4 rounded-xl border border-beige-kem/10 p-4">
                  <p className="font-mono text-xs uppercase text-beige-kem/60">
                    Hàng chờ kiểm duyệt: {moderation.events.length} sự kiện ·{" "}
                    {moderation.organizers.length} ban tổ chức
                  </p>
                  {moderation.organizers.map((organizer) => (
                    <div
                      key={`organizer-${organizer.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-beige-kem/10 pb-3"
                    >
                      <div>
                        <p className="font-bold text-beige-kem">{organizer.displayName}</p>
                        <p className="text-xs text-beige-kem/60">
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
                            className="rounded-lg bg-la-co/20 px-3 py-2 text-xs font-bold text-la-co"
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
                            className="rounded-lg bg-burgundy/20 px-3 py-2 text-xs font-bold text-beige-kem"
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
                          className="rounded-lg bg-burgundy/20 px-3 py-2 text-xs font-bold text-beige-kem"
                        >
                          Đình chỉ
                        </button>
                      )}
                    </div>
                  ))}
                  {moderation.events.map((event) => (
                    <div
                      key={`moderation-event-${event.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-beige-kem/10 pb-3"
                    >
                      <div>
                        <p className="font-bold text-beige-kem">{event.title}</p>
                        <p className="text-xs text-beige-kem/60">
                          {event.organizer} · {event.moderation}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={moderationBusy}
                          onClick={() => moderate(() => adminClient.approveEvent(event.id))}
                          className="rounded-lg bg-la-co/20 px-3 py-2 text-xs font-bold text-la-co"
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
                          className="rounded-lg bg-burgundy/20 px-3 py-2 text-xs font-bold text-beige-kem"
                        >
                          Gỡ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-beige-kem/10 font-mono text-xs uppercase text-beige-kem/50">
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
                      <tr key={event.id} className="border-b border-beige-kem/5">
                        <td className="py-4 pr-4">
                          <p className="font-display font-bold text-beige-kem">{event.title}</p>
                          <p className="font-mono text-xs text-cam-dat">{event.venueName}</p>
                        </td>
                        <td className="py-4 pr-4 text-beige-kem/75">{event.city}</td>
                        <td className="py-4 pr-4 font-mono text-xs text-beige-kem/75">
                          {event.dates.length} ngày / {event.times.length} giờ
                        </td>
                        <td className="py-4 pr-4">
                          <span className="rounded-full border border-cam-dat/30 bg-cam-dat/10 px-2.5 py-1 font-mono text-[10px] uppercase text-cam-dat">
                            {event.status}
                          </span>
                        </td>
                        <td className="py-4 pr-4 font-mono text-xs text-la-co">
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
                <EmptyState text="Chưa có đơn mock. Hãy đặt thử một vé ở frontend để bảng này có dữ liệu." />
              ) : (
                <div className="grid gap-4">
                  {bookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="rounded-xl border border-beige-kem/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-display text-xl font-bold text-beige-kem">
                            {booking.movie.title}
                          </p>
                          <p className="font-mono text-xs text-cam-dat">
                            {booking.id} / {booking.paymentMethod} / {booking.status}
                          </p>
                        </div>
                        <div className="font-display text-2xl font-black text-burgundy-ink">
                          {formatVnd(booking.finalPrice || booking.totalPrice)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-beige-kem/65">
                        <span className="rounded border border-beige-kem/10 px-2 py-1">
                          Ghế {booking.selectedSeats.map((seat) => seat.id).join(", ")}
                        </span>
                        <span className="rounded border border-beige-kem/10 px-2 py-1">
                          Email {booking.customerEmail}
                        </span>
                        <span className="rounded border border-burgundy/30 px-2 py-1 text-burgundy-ink">
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
                  <div
                    key={code}
                    className="rounded-2xl border border-beige-kem/10 bg-white/[0.035] p-5"
                  >
                    <p className="font-display text-3xl font-black text-beige-kem">{code}</p>
                    <p className="mt-2 text-sm text-beige-kem/65">
                      {index === 0 ? "Cuối tuần" : index === 1 ? "Khách mới" : "Nhóm bạn"}
                    </p>
                    <p className="mt-4 font-mono text-xs text-cam-dat">
                      Còn hiệu lực / cần API validate
                    </p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-la-co/20 bg-la-co/5 p-4 text-sm leading-6 text-la-co">
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
                  className="h-12 rounded-xl border border-beige-kem/20 bg-xanh-pho px-4 font-mono text-sm text-beige-kem outline-none focus:border-cam-dat"
                />
                <button className="rounded-xl bg-burgundy px-6 py-3 text-sm font-black text-beige-kem">
                  Xác nhận check-in
                </button>
              </div>
              <div className="rounded-2xl border border-la-co/20 bg-la-co/5 p-5">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg border border-la-co/30 bg-la-co/10 px-3 py-2 font-mono text-xs font-black uppercase text-la-co">
                    QR
                  </span>
                  <div>
                    <p className="font-display text-2xl font-black text-beige-kem">Mã {scanCode}</p>
                    <p className="text-sm text-la-co">
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
              <div className="rounded-2xl border border-beige-kem/10 p-5">
                <div className="mb-3 flex items-center justify-between font-mono text-xs text-beige-kem/60">
                  <span>Biểu đồ mock</span>
                  <span>7 ngày gần nhất</span>
                </div>
                <div className="flex h-56 items-end gap-3">
                  {[40, 72, 56, 88, 64, 92, 76].map((height, index) => (
                    <div key={index} className="flex flex-1 flex-col items-center gap-2">
                      <div
                        className="w-full rounded-t-xl bg-cam-dat"
                        style={{ height: `${height}%` }}
                      />
                      <span className="font-mono text-[10px] text-beige-kem/45">D{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
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
                      className="rounded-xl border border-beige-kem/10 p-3 text-xs text-beige-kem/75"
                    >
                      <span className="font-mono">{log.createdAt}</span> ·{" "}
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
                  <div
                    key={role}
                    className="rounded-2xl border border-beige-kem/10 bg-white/[0.035] p-5"
                  >
                    <p className="font-display text-2xl font-black text-beige-kem">{role}</p>
                    <p className="mt-2 text-sm leading-6 text-beige-kem/65">{desc}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-la-co/20 bg-la-co/5 p-4 text-sm leading-6 text-la-co">
                <span>
                  Audit log chỉ đọc. Backend thực thi RBAC và PostgreSQL chặn UPDATE/DELETE.
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-beige-kem/10 bg-white/[0.03] p-5">
      <p className="font-mono text-xs uppercase text-beige-kem/50">{label}</p>
      <p className="mt-2 font-display text-3xl font-black text-beige-kem">{value}</p>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return (
    <div>
      <h2 className="font-display text-3xl font-black text-beige-kem">{title}</h2>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-beige-kem/15 p-12 text-center text-sm text-beige-kem/55">
      {text}
    </div>
  );
}
