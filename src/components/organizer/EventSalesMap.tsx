import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { ShowtimeMapSeat } from "@/shared/catalog/seatmap";
import type { ManageShowtime } from "../../services/catalogClient";
import { formatShowtimeAt } from "../../services/formatDate";
import { formatVnd } from "../../services/currency";
import { colorForTier } from "@/shared/catalog/tier-palette";
import Select from "../Select";
import SeatCanvas from "../seatmap/SeatCanvas";
import TierLegend from "../seatmap/TierLegend";
import { useLiveShowtimeMap } from "../seatmap/useLiveShowtimeMap";
import { downloadSeatMapPng } from "../seatmap/exportSeatMap";

const button =
  "inline-flex min-h-10 items-center justify-center gap-2 border-2 border-beige-kem/40 px-3 text-sm font-bold text-beige-kem transition hover:border-beige-kem focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy disabled:cursor-not-allowed disabled:opacity-50";
const labels = { available: "Còn trống", held: "Đang giữ", sold: "Đã bán", blocked: "Đang khóa" };
const seatClass = (seat: ShowtimeMapSeat) =>
  ({
    available: "",
    held: "[fill:url(#seat-hatch)] stroke-stone-500",
    sold: "fill-stone-800 stroke-stone-900",
    blocked: "fill-transparent stroke-stone-500 [stroke-dasharray:18]",
  })[seat.status];

export default function EventSalesMap({
  eventTitle,
  showtimes,
  onRetry,
}: {
  eventTitle: string;
  showtimes: ManageShowtime[] | null;
  onRetry: () => void;
}) {
  const headingId = useId();
  const [chosen, setChosen] = useState<number | null>(null);
  const [openedAt] = useState(() => Date.now());
  const ordered = useMemo(
    () => [...(showtimes ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [showtimes],
  );
  const selected =
    ordered.find((row) => row.id === chosen) ??
    ordered.find(
      (row) =>
        row.hasSeatMap &&
        new Date(row.startsAt).getTime() >= openedAt &&
        row.status !== "cancelled",
    ) ??
    ordered.find((row) => row.hasSeatMap) ??
    ordered[0];

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 space-y-4 border-2 border-beige-kem/30 bg-surface-2 p-4 sm:p-5"
    >
      <div>
        <h2 id={headingId} className="font-display text-xl font-bold text-beige-kem">
          Sơ đồ vé đang bán
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Theo dõi trạng thái thật như phía người mua. Xem sơ đồ không giữ chỗ hay thay đổi vé.
        </p>
      </div>
      {showtimes === null ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          <span>Đang chờ danh sách suất diễn.</span>
          <button type="button" className={button} onClick={onRetry}>
            Tải lại danh sách suất
          </button>
        </div>
      ) : !selected ? (
        <p className="text-sm text-ink-soft">
          Thêm suất diễn và áp dụng sơ đồ để theo dõi vé tại đây.
        </p>
      ) : (
        <>
          <div className="min-w-0">
            <Select
              label="Suất diễn"
              value={String(selected.id)}
              options={ordered.map((row) => ({
                value: String(row.id),
                label: `${formatShowtimeAt(row.startsAt)} · ${row.venueName}${row.status === "cancelled" ? " · Đã hủy" : row.status === "finished" ? " · Đã kết thúc" : ""}`,
              }))}
              onChange={(value) => setChosen(Number(value))}
              triggerClassName="min-h-11 w-full border-2 border-beige-kem/40 bg-surface-2 px-3 text-sm text-beige-kem"
            />
          </div>
          {selected.hasSeatMap ? (
            <LiveMap key={selected.id} eventTitle={eventTitle} showtime={selected} />
          ) : (
            <p className="border border-beige-kem/20 p-4 text-sm text-ink-soft">
              Suất này chưa được áp dụng sơ đồ. Mở “Sơ đồ ghế” để thiết kế và áp dụng trước.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function LiveMap({ eventTitle, showtime }: { eventTitle: string; showtime: ManageShowtime }) {
  const live = useLiveShowtimeMap(showtime.id);
  const [floor, setFloor] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const exporting = useRef<AbortController | null>(null);
  const drawing = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      exporting.current?.abort();
      exporting.current = null;
    },
    [],
  );
  const map = live.map;
  const floors = [...(map?.floors ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
  // Name the implicit floor too, if a map also has seats outside its named levels.
  if (floors.length > 0 && map?.seats.some((seat) => !seat.floor))
    floors.push({ name: "", displayOrder: Infinity });
  const activeFloor =
    floors.length > 1
      ? (floors.find((entry) => entry.name === floor)?.name ?? floors[0].name)
      : null;
  const seats = (map?.seats ?? []).filter(
    (seat) => activeFloor === null || (seat.floor ?? "") === activeFloor,
  );
  const elements = (map?.elements ?? []).filter(
    (element) => activeFloor === null || !element.floor || element.floor === activeFloor,
  );
  const seat = seats.find((entry) => entry.id === selectedSeat);
  const counts = { available: 0, held: 0, sold: 0, blocked: 0 };
  for (const entry of map?.seats ?? []) counts[entry.status]++;
  const updated = live.updatedAt?.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  const save = async () => {
    const svg = drawing.current?.querySelector<SVGSVGElement>('svg[aria-label="Sơ đồ chỗ ngồi"]');
    if (!svg || !map || !live.updatedAt || exporting.current) return;
    const controller = new AbortController();
    exporting.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setSaving(true);
    setSaveMessage(null);
    try {
      const style = getComputedStyle(drawing.current!);
      await downloadSeatMapPng(svg, {
        fileName: `so-do-ve-suat-${showtime.id}-${live.updatedAt.toISOString().replace(/[:.]/g, "-")}.png`,
        title: eventTitle,
        subtitle: `${formatShowtimeAt(showtime.startsAt)} · ${showtime.venueName}`,
        notes: [
          `Dữ liệu cập nhật: ${updated} (giờ Việt Nam)${activeFloor !== null ? ` · Tầng: ${activeFloor || "Chưa phân tầng"}` : ""}`,
          `Toàn suất: Còn trống ${counts.available} · Đang giữ ${counts.held} · Đã bán ${counts.sold} · Đang khóa ${counts.blocked}`,
          "Chú giải: màu hạng vé = còn trống; gạch chéo = đang giữ; tô đậm = đã bán; nét đứt = đang khóa.",
          ...map.tierLegend.map((tier) => `${tier.label} — ${formatVnd(tier.price)}`),
        ],
        background: style.backgroundColor,
        ink: style.color,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setSaveMessage("Đã lưu ảnh PNG của khung nhìn hiện tại.");
    } catch (error) {
      if (!controller.signal.aborted)
        setSaveMessage(
          error instanceof Error ? error.message : "Không thể lưu ảnh. Vui lòng thử lại.",
        );
      else if (exporting.current === controller)
        setSaveMessage("Lưu ảnh bị gián đoạn hoặc quá lâu. Vui lòng thử lại.");
    } finally {
      window.clearTimeout(timeout);
      if (exporting.current === controller) {
        exporting.current = null;
        setSaving(false);
      }
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm text-ink-soft">
          <p
            role="status"
            className={
              live.error ? "text-cam-dat-ink" : live.connected ? "text-la-co-ink" : "text-ink-soft"
            }
          >
            {live.error
              ? "Chưa xác nhận được dữ liệu mới nhất"
              : live.connected
                ? "Đang cập nhật trực tiếp"
                : "Đang kết nối trực tiếp · Tự tải lại mỗi 30 giây"}
          </p>
          <p className="mt-1">
            {updated ? `Cập nhật: ${updated} (giờ Việt Nam)` : "Đang tải trạng thái vé…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={live.refreshing} onClick={live.reload}>
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${live.refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            Tải lại
          </button>
          <button
            type="button"
            className={button}
            disabled={!map?.seats.length || !!live.error || live.refreshing || saving}
            onClick={() => void save()}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {saving ? "Đang lưu…" : "Lưu ảnh PNG"}
          </button>
        </div>
      </div>
      {live.error && (
        <p
          role="alert"
          className="border border-cam-dat/50 bg-cam-dat/10 p-3 text-sm text-cam-dat-ink"
        >
          {live.error}
          {map ? " Sơ đồ bên dưới là dữ liệu đã nhận trước đó." : ""}
        </p>
      )}
      {saveMessage && (
        <p role="status" className="text-sm text-ink-soft">
          {saveMessage}
        </p>
      )}
      {map && (
        <>
          <dl
            className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3"
            aria-label="Tình trạng ghế toàn suất"
          >
            {(Object.keys(labels) as (keyof typeof labels)[]).map((status) => (
              <div key={status} className="min-w-0 border border-beige-kem/25 p-3">
                <dt className="text-sm text-ink-soft">{labels[status]}</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums text-beige-kem">
                  {counts[status].toLocaleString("vi-VN")}
                </dd>
              </div>
            ))}
          </dl>
          {floors.length > 1 && (
            <div role="group" aria-label="Chọn tầng sơ đồ" className="flex flex-wrap gap-2">
              {floors.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  aria-pressed={activeFloor === entry.name}
                  className={`${button} ${activeFloor === entry.name ? "bg-burgundy !text-white" : ""}`}
                  onClick={() => {
                    setFloor(entry.name);
                    setSelectedSeat(null);
                  }}
                >
                  {entry.name || "Chưa phân tầng"}
                </button>
              ))}
            </div>
          )}
          {seats.length > 0 ? (
            <div
              ref={drawing}
              className="min-w-0 border border-beige-kem/25 bg-surface-2 text-beige-kem"
            >
              <SeatCanvas<ShowtimeMapSeat>
                key={activeFloor ?? "all"}
                seats={seats}
                elements={elements}
                space={map.space}
                floorPlan={map.floorPlan}
                tables={map.tables}
                seatClass={seatClass}
                seatFill={(entry) =>
                  entry.status === "available"
                    ? colorForTier(map.tierLegend, entry.ticketTierId)
                    : undefined
                }
                seatLabel={(entry) =>
                  `${entry.section ? `${entry.section}, ` : ""}${entry.row}${entry.number} · ${entry.tier} · ${formatVnd(entry.price)} · ${labels[entry.status]}`
                }
                seatTooltip={(entry) =>
                  `${entry.row}${entry.number} · ${entry.tier} · ${labels[entry.status]}`
                }
                interactive
                onSeatActivate={(entry) => setSelectedSeat(entry.id)}
                heightClass="aspect-[3/2] min-h-64 max-h-[480px]"
              />
            </div>
          ) : (
            <p className="border border-beige-kem/20 p-4 text-sm text-ink-soft">
              Sơ đồ này không có ghế riêng lẻ để hiển thị. Vé khu vực không đánh số được theo dõi
              trong danh sách hạng vé.
            </p>
          )}
          <p role="status" className="text-sm text-ink-soft">
            {seat
              ? `${seat.section ? `${seat.section} · ` : ""}Ghế ${seat.row}${seat.number} · ${seat.tier} · ${formatVnd(seat.price)} · ${labels[seat.status]}`
              : "Bấm vào một ghế để xem hạng vé và trạng thái; không tạo giữ chỗ."}
          </p>
          <div
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft"
            aria-label="Chú giải trạng thái ghế"
          >
            <span>Màu hạng vé: còn trống</span>
            <span>Gạch chéo: đang giữ</span>
            <span>Tô đậm: đã bán</span>
            <span>Nét đứt: đang khóa</span>
          </div>
          <TierLegend legend={map.tierLegend} />
          <p className="text-xs text-ink-soft">
            Sơ đồ trên trang tự cập nhật. Ảnh PNG chỉ lưu khung nhìn và trạng thái tại thời điểm
            tải, không tự thay đổi sau đó.
          </p>
        </>
      )}
    </div>
  );
}
