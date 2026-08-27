/** @license SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Flame,
  Loader2,
  Megaphone,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import {
  AD_POLICY,
  AD_PLACEMENT_LABELS,
  type AdPackage,
  type AdPlacement,
  type AdPurchase,
} from "@shared/ads/types.js";
import { adsClient } from "../../services/adsClient";
import { organizerApi, type MyEvent } from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";
import Select from "../Select";
import { adDateTime as dateTime, downloadAdTransaction } from "./adTransaction";
import {
  AdComparison,
  AdGuide,
  AdIntroduction,
  adPrimary,
  adSecondary,
  focusAdSection,
} from "./AdPackagesOverview";

const PLACEMENT_ICON: Record<AdPlacement, typeof Flame> = {
  hero_trailer: PlayCircle,
  hot_events: Flame,
};
const fullPackage = (pkg: AdPackage) =>
  pkg.availability?.some((s) => s.legacy || s.reserved >= s.limit) ?? false;
export type AdTab = "discover" | "campaigns";

/** Marketing and reporting share data, but have separate navigation and reading paths. */
export default function AdPackagesPanel({
  activeTab,
  onTabChange,
}: {
  activeTab?: AdTab;
  onTabChange?: (tab: AdTab) => void;
} = {}) {
  const [packages, setPackages] = useState<AdPackage[]>([]);
  const [purchases, setPurchases] = useState<AdPurchase[]>([]);
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [retryKey, setRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localTab, setLocalTab] = useState<AdTab>("discover");
  const tab = activeTab ?? localTab;
  const setTab = (next: AdTab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const [choosing, setChoosing] = useState<AdPackage | null>(null);
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const purchaseLock = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const packageTrigger = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!choosing) return;
    pickerRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    pickerRef.current?.focus({ preventScroll: true });
  }, [choosing]);

  const closePicker = () => {
    setChoosing(null);
    setPurchaseError(null);
    packageTrigger.current?.focus({ preventScroll: true });
    packageTrigger.current?.scrollIntoView({ block: "nearest" });
  };
  const fetchAll = () =>
    Promise.all([adsClient.packages(), adsClient.purchases(), organizerApi.myEvents()]);
  const apply = ([list, mine, portfolio]: Awaited<ReturnType<typeof fetchAll>>) => {
    setPackages(list);
    setPurchases(mine);
    setEvents(portfolio);
    setError(null);
  };
  useEffect(() => {
    let live = true;
    fetchAll()
      .then((data) => {
        if (live) apply(data);
      })
      .catch((cause: unknown) => {
        if (live)
          setError(cause instanceof Error ? cause.message : "Không tải được gói quảng cáo.");
      })
      .finally(() => {
        if (live) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);
  const refresh = () => {
    setRefreshing(true);
    setRetryKey((k) => k + 1);
  };

  const promoted = new Set(purchases.filter((row) => row.live).map((row) => row.eventId));
  const choices = events.filter(
    (event) =>
      event.status === "on_sale" &&
      event.moderation === "approved" &&
      event.hasUpcoming &&
      !promoted.has(event.id),
  );
  const selectedEvent = choices.find((event) => String(event.id) === eventId);
  // A refresh can change capacity or terms. Do not submit a stale displayed package.
  const currentPackage = choosing && packages.find((pkg) => pkg.id === choosing.id);
  const packageChanged =
    !!choosing &&
    (!currentPackage ||
      currentPackage.price !== choosing.price ||
      currentPackage.durationDays !== choosing.durationDays ||
      currentPackage.placements.join() !== choosing.placements.join());
  const canBuy =
    !!selectedEvent &&
    !!currentPackage &&
    !packageChanged &&
    !fullPackage(currentPackage) &&
    accepted &&
    !busy &&
    !refreshing;

  const buy = async () => {
    if (!choosing || !canBuy || purchaseLock.current) return;
    purchaseLock.current = true;
    setBusy(true);
    setPurchaseError(null);
    try {
      const purchase = await adsClient.buy(Number(eventId), choosing.id);
      setPurchases((rows) => [purchase, ...rows.filter((row) => row.id !== purchase.id)]);
      setNotice(
        "Đã thanh toán " +
          formatVnd(purchase.price) +
          ". Chiến dịch bắt đầu " +
          dateTime(purchase.startsAt) +
          " (giờ Việt Nam).",
      );
      setChoosing(null);
      setEventId("");
      setAccepted(false);
      setTab("campaigns");
      // The target tab was disabled while paying; focus after React commits the enabled state.
      try {
        apply(await fetchAll());
      } catch {
        setError(
          "Đã thanh toán thành công, nhưng chưa tải được dữ liệu mới. Hãy tải lại danh sách; không cần thanh toán lần nữa.",
        );
      }
    } catch (cause) {
      setPurchaseError(cause instanceof Error ? cause.message : "Không mua được gói này.");
    } finally {
      purchaseLock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (notice && !busy && tab === "campaigns") {
      tabRefs.current[1]?.focus();
      tabRefs.current[1]?.scrollIntoView({ block: "nearest" });
    }
  }, [notice, busy, tab]);

  const switchTab = (next: AdTab) => {
    if (!busy) setTab(next);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 1
          : ["ArrowLeft", "ArrowRight"].includes(event.key)
            ? 1 - index
            : null;
    if (next === null || busy) return;
    event.preventDefault();
    switchTab(next === 0 ? "discover" : "campaigns");
    tabRefs.current[next]?.focus();
  };

  if (loading)
    return (
      <div role="status" className="flex items-center gap-3 p-8 text-sm text-ink-soft">
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
        Đang tải gói quảng cáo…
      </div>
    );

  return (
    <div className="space-y-8 text-beige-kem">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-3 font-display text-3xl font-black">
            <Megaphone aria-hidden="true" className="h-6 w-6 text-burgundy-ink" />
            Gói quảng cáo
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Không gian quảng bá và quản lý chiến dịch của nhà tổ chức.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || refreshing}
          onClick={refresh}
          className={adSecondary}
        >
          <RefreshCw
            aria-hidden="true"
            className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")}
          />
          {refreshing ? "Đang cập nhật…" : "Cập nhật dữ liệu"}
        </button>
      </header>
      <div
        role="tablist"
        aria-label="Quảng cáo sự kiện"
        className="flex gap-4 border-b border-beige-kem/25 sm:gap-8"
      >
        {(
          [
            ["discover", "Khám phá gói"],
            ["campaigns", "Chiến dịch của bạn"],
          ] as const
        ).map(([value, label], index) => (
          <button
            key={value}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={"ad-tab-" + value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={"ad-panel-" + value}
            tabIndex={tab === value ? 0 : -1}
            disabled={busy}
            onKeyDown={(e) => onTabKey(e, index)}
            onClick={() => switchTab(value)}
            className={
              "min-h-12 border-b-2 pb-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-beige-kem disabled:opacity-50 " +
              (tab === value
                ? "border-burgundy text-beige-kem"
                : "border-transparent text-ink-soft hover:text-beige-kem")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="space-y-3 border border-burgundy/40 bg-burgundy/5 p-5 text-sm">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy || refreshing}
            onClick={refresh}
            className={adSecondary}
          >
            Tải lại danh sách
          </button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="border-l-2 border-la-co bg-la-co/10 p-5 text-sm leading-relaxed"
        >
          {notice}
        </p>
      )}

      <div
        id="ad-panel-discover"
        role="tabpanel"
        aria-labelledby="ad-tab-discover"
        hidden={tab !== "discover"}
        className="space-y-10"
      >
        <AdIntroduction />
        <section
          id="ad-packages"
          tabIndex={-1}
          aria-labelledby="ad-packages-title"
          className="scroll-mt-24 space-y-6 border-t border-beige-kem/20 pt-8"
        >
          <div>
            <p className="text-sm font-semibold text-burgundy-ink">02 — CHỌN GÓI PHÙ HỢP</p>
            <h3 id="ad-packages-title" className="mt-2 font-display text-3xl font-bold">
              Một mức phí. Quyền lợi rõ ràng.
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Chọn theo vị trí và số ngày bạn muốn quảng bá. Thanh toán một lần, không tự động gia
              hạn.
            </p>
          </div>
          {!packages.length && !error && (
            <p className="border border-beige-kem/25 p-6 text-sm text-ink-soft">
              Hiện chưa có gói quảng cáo được mở bán. Vui lòng quay lại sau.
            </p>
          )}
          <div className="grid items-stretch gap-5 sm:grid-cols-2">
            {packages.map((pkg) => {
              const full = fullPackage(pkg);
              const selected = choosing?.id === pkg.id;
              return (
                <article
                  key={pkg.id}
                  aria-labelledby={"ad-package-" + pkg.id}
                  className={
                    "flex min-w-0 flex-col border bg-surface-2 p-5 sm:p-7 " +
                    (selected ? "border-burgundy ring-1 ring-burgundy" : "border-beige-kem/25")
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                      {pkg.placements.length === 2
                        ? "Hai vị trí quảng bá"
                        : pkg.placements.includes("hero_trailer")
                          ? "Quảng bá bằng video"
                          : "Nổi bật trong danh sách"}
                    </p>
                    <span className="text-sm font-semibold text-burgundy-ink">
                      {pkg.durationDays} ngày
                    </span>
                  </div>
                  <h4
                    id={"ad-package-" + pkg.id}
                    className="mt-4 break-words font-display text-3xl font-black"
                  >
                    {pkg.name}
                  </h4>
                  <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">
                    {formatVnd(pkg.price)}
                  </p>
                  <p className="mt-2 text-sm text-ink-soft">Cho một sự kiện · trọn thời hạn gói</p>
                  <ul className="my-6 space-y-3 border-t border-beige-kem/20 pt-5">
                    {pkg.placements.map((slot) => {
                      const Icon = PLACEMENT_ICON[slot];
                      return (
                        <li key={slot} className="flex items-start gap-3 text-sm leading-relaxed">
                          <Icon
                            aria-hidden="true"
                            className="mt-0.5 h-5 w-5 shrink-0 text-burgundy-ink"
                          />
                          {AD_PLACEMENT_LABELS[slot]}
                        </li>
                      );
                    })}
                    <li className="flex items-start gap-3 text-sm leading-relaxed">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 shrink-0 text-la-co-ink"
                      />
                      Luân phiên trong {pkg.durationDays} ngày
                    </li>
                    <li className="flex items-start gap-3 text-sm leading-relaxed">
                      <ChartNoAxesCombined
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 shrink-0 text-burgundy-ink"
                      />
                      Báo cáo lượt hiển thị và lượt nhấp
                    </li>
                  </ul>
                  <div className="mt-auto space-y-4">
                    <div className="space-y-2 text-sm leading-relaxed text-ink-soft">
                      {pkg.availability?.map((slot) => (
                        <p key={slot.placement}>
                          {slot.placement === "hero_trailer" ? "Trailer" : "Sự kiện hot"}:{" "}
                          {slot.legacy
                            ? "Tạm ngừng nhận để phục vụ hợp đồng cũ"
                            : "còn " +
                              Math.max(0, slot.limit - slot.reserved) +
                              "/" +
                              slot.limit +
                              " chỗ chiến dịch"}
                        </p>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={busy || refreshing || full}
                      aria-expanded={selected}
                      aria-controls={selected ? "ad-event-picker" : undefined}
                      onClick={(e) => {
                        packageTrigger.current = e.currentTarget;
                        setChoosing(pkg);
                        setAccepted(false);
                        setEventId("");
                        setPurchaseError(null);
                        setNotice(null);
                      }}
                      className={adPrimary + " w-full"}
                    >
                      {full
                        ? "Tạm hết chỗ — chưa thể mua"
                        : selected
                          ? "Đang chọn gói này"
                          : "Chọn gói này"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="text-sm leading-relaxed text-ink-soft">
            Không độc quyền, không cam kết số lượt xem, nhấp hay vé bán. Tình trạng chỗ được kiểm
            tra lại khi thanh toán.
          </p>
          <AdComparison packages={packages} />
        </section>

        {choosing && (
          <div
            id="ad-event-picker"
            ref={pickerRef}
            tabIndex={-1}
            role="region"
            aria-labelledby="ad-event-picker-title"
            className="scroll-mt-24 border-2 border-beige-kem/35 bg-surface-2 p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-beige-kem sm:p-7"
          >
            <p className="text-sm font-semibold text-burgundy-ink">KIỂM TRA TRƯỚC KHI THANH TOÁN</p>
            <h3 id="ad-event-picker-title" className="mt-2 font-display text-3xl font-bold">
              Chọn sự kiện cho {choosing.name}
            </h3>
            {choices.length === 0 ? (
              <div className="mt-5 space-y-4">
                <p className="text-sm leading-relaxed text-ink-soft">
                  Chưa có sự kiện phù hợp. Sự kiện cần được duyệt, đang mở bán, còn suất sắp diễn và
                  chưa có chiến dịch còn hạn.
                </p>
                <button type="button" onClick={closePicker} className={adSecondary}>
                  Quay lại chọn gói
                </button>
              </div>
            ) : (
              <div className="mt-6 grid gap-8 lg:grid-cols-2">
                <div className="min-w-0 space-y-5 [&_.menu-panel]:w-full [&_.menu-panel]:max-w-full [&_[role=listbox]]:w-full [&_[role=listbox]]:max-w-full">
                  <Select
                    label="Sự kiện cần quảng bá"
                    value={eventId}
                    options={choices.map((event) => ({
                      value: String(event.id),
                      label: event.title,
                    }))}
                    disabled={busy}
                    placeholder="— Chọn sự kiện —"
                    onChange={(value) => {
                      setEventId(value);
                      setAccepted(false);
                      setPurchaseError(null);
                    }}
                    triggerClassName="min-h-12 w-full border border-beige-kem/35 bg-xanh-pho px-4 py-3 text-sm"
                  />
                  <p className="text-sm leading-relaxed text-ink-soft">
                    Suất diễn cuối phải sau thời hạn {choosing.durationDays} ngày của gói.
                    {choosing.placements.includes("hero_trailer") &&
                      " Sự kiện cần có trailer hợp lệ."}{" "}
                    Hệ thống kiểm tra lại điều kiện trước khi thu tiền.
                  </p>
                  <div className="border-l-2 border-burgundy/60 pl-4 text-sm leading-relaxed">
                    <p>
                      Gói bắt đầu ngay sau thanh toán. Thời hạn vẫn tính khi sự kiện bị ẩn hoặc chờ
                      duyệt lại.
                    </p>
                    <p className="mt-2">
                      Các chiến dịch cùng vị trí luân phiên ngang nhau; không cam kết lượt xem hay
                      vé bán.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="min-h-11 text-left text-sm font-semibold text-burgundy-ink underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-beige-kem"
                    onClick={() => focusAdSection("ad-terms")}
                  >
                    Đọc điều khoản quảng cáo
                  </button>
                </div>
                <div className="border-t border-beige-kem/20 pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
                  <h4 className="text-lg font-semibold">Tóm tắt đặt quảng cáo</h4>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-ink-soft">Sự kiện</dt>
                      <dd className="mt-1 break-words font-semibold">
                        {selectedEvent?.title ?? "Chưa chọn sự kiện"}
                      </dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-ink-soft">Gói / thời lượng</dt>
                      <dd>
                        {choosing.name} / {choosing.durationDays} ngày
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-soft">Vị trí hiển thị</dt>
                      <dd className="mt-1 leading-relaxed">
                        {choosing.placements.map((slot) => AD_PLACEMENT_LABELS[slot]).join(" · ")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-beige-kem/20 pt-4">
                      <dt className="font-semibold">Tổng trừ từ ví</dt>
                      <dd className="text-xl font-semibold tabular-nums">
                        {formatVnd(choosing.price)}
                      </dd>
                    </div>
                  </dl>
                  <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
                    <input
                      type="checkbox"
                      checked={accepted}
                      disabled={busy}
                      onChange={(e) => setAccepted(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 accent-burgundy"
                    />
                    <span>
                      Tôi đã đọc và đồng ý điều khoản quảng cáo <strong>{AD_POLICY}</strong>. Gói
                      bắt đầu ngay sau thanh toán.
                    </span>
                  </label>
                  {packageChanged && (
                    <p role="alert" className="mt-4 text-sm text-burgundy-ink">
                      Gói đã thay đổi. Vui lòng chọn lại gói để kiểm tra giá và quyền lợi mới.
                    </p>
                  )}
                  {currentPackage && fullPackage(currentPackage) && (
                    <p role="alert" className="mt-4 text-sm text-burgundy-ink">
                      Gói vừa hết chỗ. Vui lòng chọn gói khác hoặc quay lại sau.
                    </p>
                  )}
                  {purchaseError && (
                    <p
                      role="alert"
                      className="mt-4 border-l-2 border-burgundy pl-3 text-sm text-burgundy-ink"
                    >
                      {purchaseError}
                    </p>
                  )}
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={!canBuy}
                      onClick={() => void buy()}
                      className={adPrimary}
                    >
                      {busy ? "Đang xử lý…" : "Thanh toán " + formatVnd(choosing.price)}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={closePicker}
                      className={adSecondary}
                    >
                      Huỷ
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <AdGuide />
        {choosing && (
          <button
            type="button"
            className={adSecondary}
            onClick={() => focusAdSection("ad-event-picker")}
          >
            Quay lại bước thanh toán
          </button>
        )}
      </div>

      <div
        id="ad-panel-campaigns"
        role="tabpanel"
        aria-labelledby="ad-tab-campaigns"
        hidden={tab !== "campaigns"}
        className="space-y-6"
      >
        <div>
          <h3 className="font-display text-3xl font-bold">Chiến dịch của bạn</h3>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-soft">
            Theo dõi thời gian chạy và kết quả theo từng vị trí. Lượt hiển thị được ghi nhận khi ít
            nhất 50% quảng cáo hiện trong 1 giây, khử trùng mỗi 30 phút theo dấu vết truy cập ẩn
            danh; không phải số người duy nhất.
          </p>
        </div>
        {purchases.length === 0 ? (
          <div className="border border-beige-kem/25 bg-surface-2 px-6 py-12 text-center">
            <ChartNoAxesCombined aria-hidden="true" className="mx-auto h-8 w-8 text-burgundy-ink" />
            <h4 className="mt-4 text-lg font-semibold">Chiến dịch đầu tiên bắt đầu từ đây</h4>
            <p className="mt-2 text-sm text-ink-soft">
              Bạn chưa mua gói quảng cáo nào. Khám phá các vị trí dành cho sự kiện của bạn.
            </p>
            <button
              type="button"
              className={adPrimary + " mt-6"}
              onClick={() => {
                switchTab("discover");
                tabRefs.current[0]?.focus();
              }}
            >
              Khám phá gói <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {purchases.map((row) => (
              <CampaignCard key={row.id} purchase={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignCard({ purchase: row }: { purchase: AdPurchase }) {
  const status =
    row.status === "cancelled"
      ? "Đã huỷ"
      : row.live
        ? row.serving
          ? row.policy === "fair_v1"
            ? "Đủ điều kiện luân phiên"
            : "Đang chạy theo điều khoản cũ"
          : "Tạm dừng hiển thị"
        : "Đã kết thúc";
  return (
    <article className="border border-beige-kem/25 bg-surface-2 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-ink-soft">
            Chiến dịch #{row.id} · {row.packageName}
          </p>
          <h4 className="mt-2 break-words text-xl font-semibold">{row.eventTitle}</h4>
        </div>
        <p
          className={
            "text-sm font-semibold " +
            (row.live && row.serving
              ? "text-la-co-ink"
              : row.live || row.status === "cancelled"
                ? "text-burgundy-ink"
                : "text-ink-soft")
          }
        >
          {status}
        </p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        {dateTime(row.startsAt)} – {dateTime(row.endsAt)} · Giờ Việt Nam
      </p>
      {row.live && !row.serving && (
        <p className="mt-3 border-l-2 border-burgundy pl-3 text-sm leading-relaxed">
          Sự kiện chưa đủ điều kiện hiển thị. Thời hạn gói vẫn tiếp tục tính; hãy kiểm tra trạng
          thái duyệt và mở bán.
        </p>
      )}
      {!!row.compensatedSeconds && (
        <p className="mt-3 text-sm text-ink-soft">
          Đã bù {Math.round(row.compensatedSeconds / 60)} phút do sự cố nền tảng.
        </p>
      )}
      {row.policy === "fair_v1" && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {row.placements.map((placement) => {
            const metric = row.metrics?.find((m) => m.placement === placement);
            const stats: [string, number][] = [
              ["Hiển thị", metric?.impressions ?? 0],
              ["Lượt nhấp", metric?.clicks ?? 0],
            ];
            if (placement === "hero_trailer") stats.push(["Phát video", metric?.plays ?? 0]);
            return (
              <div key={placement} className="border border-beige-kem/20 p-4">
                <p className="text-sm font-semibold">{AD_PLACEMENT_LABELS[placement]}</p>
                <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
                  {stats.map(([label, count]) => (
                    <div key={label}>
                      <dt className="text-xs text-ink-soft">{label}</dt>
                      <dd className="mt-1 text-2xl font-semibold tabular-nums">
                        {count.toLocaleString("vi-VN")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
      <details className="group mt-5 border-t border-beige-kem/20 pt-1">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-beige-kem">
          Chi tiết giao dịch
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 transition-transform group-open:rotate-180"
          />
        </summary>
        <dl className="grid gap-4 pb-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-soft">Mã chiến dịch</dt>
            <dd className="mt-1">#{row.id}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Số tiền đã thanh toán</dt>
            <dd className="mt-1 font-semibold tabular-nums">{formatVnd(row.price)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Ngày đặt</dt>
            <dd className="mt-1">{dateTime(row.createdAt)} · Giờ Việt Nam</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Điều khoản áp dụng</dt>
            <dd className="mt-1">
              {row.policy === "fair_v1"
                ? "fair_v1 · Luân phiên, trọng số ngang nhau"
                : "Điều khoản cũ · không tự chuyển đổi"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-soft">Vị trí đã mua</dt>
            <dd className="mt-1 leading-relaxed">
              {row.placements.map((slot) => AD_PLACEMENT_LABELS[slot]).join(" · ")}
            </dd>
          </div>
        </dl>
        <p className="pb-3 text-xs text-ink-soft">
          Thông tin giao dịch hiện tại, không thay thế hóa đơn hoặc hợp đồng có chữ ký.
        </p>
        <button type="button" onClick={() => downloadAdTransaction(row)} className={adSecondary}>
          Tải thông tin giao dịch
        </button>
      </details>
    </article>
  );
}
