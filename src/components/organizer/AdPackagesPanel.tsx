/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Flame, Loader2, Megaphone, PlayCircle } from "lucide-react";
import {
  AD_PLACEMENT_LABELS,
  type AdPackage,
  type AdPlacement,
  type AdPurchase,
} from "@shared/ads/types.js";
import { adsClient } from "../../services/adsClient";
import { organizerApi, type MyEvent } from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";
import Select from "../Select";

/**
 * Buying promotion for an event (the organizer half of the advertising feature).
 *
 * The card follows the upgrade-sheet pattern buyers already know from every subscription UI: plan
 * name, the PRICE as the loudest element with its run length beside it, a one-line tagline, the CTA
 * button, and only then the itemised benefits. The priciest package carries a "Phổ biến nhất" badge
 * and the accented frame — one recommended card, like Plus in ChatGPT's sheet, rather than three
 * equally shouty ones.
 *
 * A package is a COMBO of placements plus a run length; those are the two slots the landing page
 * really has, so nothing here promises a position that renders nowhere.
 *
 * The money leaves the same wallet the organizer already tops up — there is no second payment
 * surface to learn, and an empty balance fails with the exact shortfall rather than a generic
 * refusal.
 */

const PLACEMENT_ICON: Record<AdPlacement, typeof Flame> = {
  hero_trailer: PlayCircle,
  hot_events: Flame,
};

/**
 * Only a published event can be promoted.
 *
 * The server decides this for real — it re-checks the full public-visibility predicate, which also
 * covers the organizer being approved. This filter exists so the dropdown does not offer a draft it
 * knows the purchase would be refused for.
 */

const day = (iso: string) => new Date(iso).toLocaleDateString("vi-VN");

export default function AdPackagesPanel() {
  const [packages, setPackages] = useState<AdPackage[]>([]);
  const [purchases, setPurchases] = useState<AdPurchase[]>([]);
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [retryKey, setRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Which package's event picker is open. Null means none — the grid is just a price list. */
  const [choosing, setChoosing] = useState<AdPackage | null>(null);
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const packageTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!choosing) return;
    pickerRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
    pickerRef.current?.focus({ preventScroll: true });
  }, [choosing]);
  const closePicker = () => {
    setChoosing(null);
    packageTrigger.current?.focus({ preventScroll: true });
    packageTrigger.current?.scrollIntoView({ block: "nearest" });
  };

  /**
   * Everything the panel shows, fetched together.
   *
   * Split from the state it feeds so the first load and the reload after a purchase can share one
   * request without sharing a lifetime: the mount path has to drop a response that arrives after
   * unmount, and the purchase path does not.
   */
  const fetchAll = () =>
    Promise.all([adsClient.packages(), adsClient.purchases(), organizerApi.myEvents()]);

  const apply = ([list, mine, portfolio]: Awaited<ReturnType<typeof fetchAll>>) => {
    setPackages(list);
    setPurchases(mine);
    setEvents(portfolio);
    setError(null);
  };

  // Every write below sits in a promise callback rather than in the effect body: `loading` already
  // starts true, so there is nothing to synchronise before the request goes out.
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
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // An event with a campaign STILL RUNNING cannot buy a second one, so it is not offered: the
  // server refuses it either way, and a dropdown listing a choice it will reject wastes the click.
  // Keyed on `live`, not on `status` — a finished campaign leaves the event free to advertise again.
  const promoted = new Set(purchases.filter((row) => row.live).map((row) => row.eventId));
  const choices = events.filter(
    (event) =>
      event.status === "on_sale" &&
      event.moderation === "approved" &&
      event.hasUpcoming &&
      !promoted.has(event.id),
  );

  /** The upgrade-sheet's one highlighted plan: the priciest package, recomputed only when they load. */
  const recommendedId = useMemo(
    () =>
      packages.length === 0
        ? null
        : packages.reduce((best, p) => (p.price > best.price ? p : best), packages[0]).id,
    [packages],
  );

  const buy = async () => {
    if (!choosing || !eventId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const purchase = await adsClient.buy(Number(eventId), choosing.id);
      setPurchases((rows) => [purchase, ...rows.filter((row) => row.id !== purchase.id)]);
      setNotice(`Đã mua ${choosing.name}. Chiến dịch chạy theo thời hạn hiển thị bên dưới.`);
      setChoosing(null);
      setEventId("");
      try {
        apply(await fetchAll());
      } catch {
        setError(
          "Đã thanh toán thành công, nhưng chưa tải được dữ liệu mới. Hãy tải lại danh sách; không cần thanh toán lần nữa.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không mua được gói này.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang tải gói quảng cáo…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Megaphone className="mt-1 h-5 w-5 shrink-0 text-burgundy-ink" />
        <div>
          <h2 className="font-display text-lg font-black text-beige-kem">Gói quảng cáo</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Đưa sự kiện của bạn lên trang chủ. Phí được trừ trực tiếp từ số dư ví.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="space-y-2 border border-burgundy/50 bg-burgundy/10 px-4 py-3 text-sm text-beige-kem"
        >
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRetryKey((k) => k + 1)}
            className="border border-current px-3 py-2 font-bold"
          >
            Tải lại danh sách
          </button>
        </div>
      )}
      {notice && (
        <p className="border border-la-co/60 bg-la-co/10 px-4 py-3 text-sm text-beige-kem">
          {notice}
        </p>
      )}

      {/* Four packages, two-by-two: the upgrade-sheet grid reads as a ladder, cheapest first. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {packages.map((pkg) => {
          const recommended = pkg.id === recommendedId;
          return (
            <div
              key={pkg.id}
              className={`flex flex-col border p-6 transition ${
                recommended
                  ? "border-burgundy bg-burgundy/5 shadow-lg shadow-burgundy/25"
                  : "border-beige-kem/25 bg-surface-2 hover:border-beige-kem/60"
              }`}
            >
              {/*
                Solid burgundy with white type — the one fill this palette reserves for "press me /
                look here". The old olive pill sat on an olive-tinted card and vanished into it.
              */}
              {recommended && (
                <span className="mb-3 w-fit bg-burgundy px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white shadow-md shadow-burgundy/30">
                  Phổ biến nhất
                </span>
              )}

              <h3 className="font-display text-lg font-black text-beige-kem">{pkg.name}</h3>

              {/*
                The ChatGPT-sheet hierarchy: the price is the loudest line, its duration rides
                beside it like "/month", and everything else on the card is quieter than it.
              */}
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-4xl font-black tabular-nums text-beige-kem">
                  {formatVnd(pkg.price)}
                </span>
                <span className="font-mono text-[11px] text-ink-soft">
                  / {pkg.durationDays} ngày
                </span>
              </p>

              <p className="mt-2 text-xs leading-relaxed text-ink-soft">{pkg.description}</p>

              <button
                type="button"
                disabled={busy}
                aria-expanded={choosing?.id === pkg.id}
                aria-controls={choosing?.id === pkg.id ? "ad-event-picker" : undefined}
                onClick={(e) => {
                  packageTrigger.current = e.currentTarget;
                  setError(null);
                  setChoosing(pkg);
                  setEventId("");
                  setNotice(null);
                }}
                className={`mt-5 w-full px-4 py-2.5 text-xs font-bold transition ${
                  recommended
                    ? "bg-burgundy text-white hover:brightness-110"
                    : "border-2 border-burgundy/70 text-burgundy-ink hover:bg-burgundy hover:text-white"
                }`}
              >
                {choosing?.id === pkg.id ? "Đang chọn gói này" : "Chọn gói này"}
              </button>

              {/* Benefits BELOW the button, checkmarked — what the plan includes, not why to buy. */}
              <ul className="mt-6 space-y-2.5 border-t border-beige-kem/15 pt-5">
                {pkg.placements.map((slot) => {
                  const Icon = PLACEMENT_ICON[slot];
                  return (
                    <li key={slot} className="flex items-start gap-2 text-sm text-beige-kem">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-la-co" />
                      <span>{AD_PLACEMENT_LABELS[slot]}</span>
                    </li>
                  );
                })}
                <li className="flex items-start gap-2 text-sm text-beige-kem">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-la-co" />
                  <span>Hiển thị trong {pkg.durationDays} ngày</span>
                </li>
              </ul>
            </div>
          );
        })}
      </div>

      {choosing && (
        <div
          id="ad-event-picker"
          ref={pickerRef}
          tabIndex={-1}
          role="region"
          aria-labelledby="ad-event-picker-title"
          className="scroll-mt-24 space-y-3 border-2 border-beige-kem/40 bg-surface-2 p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <h3 id="ad-event-picker-title" className="font-display text-lg font-black text-beige-kem">
            Chọn sự kiện cho {choosing.name}
          </h3>
          {choices.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">
                Chưa có sự kiện phù hợp. Sự kiện cần được duyệt, đang mở bán, còn suất sắp diễn và
                chưa có chiến dịch còn hạn.
              </p>
              <button
                type="button"
                onClick={closePicker}
                className="min-h-11 border border-beige-kem/40 px-4 text-sm font-bold text-ink-soft"
              >
                Quay lại chọn gói
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full min-w-0 sm:w-64">
                <Select
                  value={eventId}
                  options={choices.map((event) => ({
                    value: String(event.id),
                    label: event.title,
                  }))}
                  disabled={busy}
                  placeholder="— Chọn sự kiện —"
                  onChange={setEventId}
                  triggerClassName="w-full border-2 border-beige-kem/30 bg-xanh-pho px-3 py-2 text-xs"
                />
              </div>
              <button
                type="button"
                disabled={!eventId || busy}
                onClick={() => void buy()}
                className="bg-burgundy px-4 py-2 text-xs font-bold text-white transition hover:bg-burgundy/85 disabled:opacity-40"
              >
                {busy ? "Đang xử lý…" : `Thanh toán ${formatVnd(choosing.price)}`}
              </button>
              <button
                type="button"
                onClick={closePicker}
                disabled={busy}
                className="text-xs font-bold text-ink-soft transition hover:text-beige-kem"
              >
                Huỷ
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h3 className="font-display text-lg font-black text-beige-kem">Chiến dịch của bạn</h3>
        <p className="text-xs leading-relaxed text-ink-soft">
          Quảng cáo chỉ hiển thị khi sự kiện đã duyệt, đang mở bán và còn suất chưa diễn. Khi sự
          kiện bị ẩn hoặc chờ duyệt lại, thời hạn gói vẫn tiếp tục tính.
        </p>
        {purchases.length === 0 ? (
          <p className="text-xs text-ink-soft">Bạn chưa mua gói quảng cáo nào.</p>
        ) : (
          <div className="space-y-2">
            {purchases.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-beige-kem/20 bg-surface-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-beige-kem">{row.eventTitle}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {row.packageName} ·{" "}
                    {row.placements.map((s) => AD_PLACEMENT_LABELS[s]).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-ink-soft">
                    {day(row.startsAt)} – {day(row.endsAt)}
                  </span>
                  <span className="tabular-nums text-beige-kem">{formatVnd(row.price)}</span>
                  <span
                    className={` px-2.5 py-1 font-bold ${
                      row.status === "cancelled"
                        ? "bg-burgundy text-white"
                        : row.live
                          ? "bg-la-co/25 text-beige-kem"
                          : "border border-beige-kem/30 text-ink-soft"
                    }`}
                  >
                    {row.status === "cancelled"
                      ? "Đã huỷ"
                      : row.live
                        ? row.serving
                          ? "Đang hiển thị"
                          : "Tạm dừng hiển thị"
                        : "Đã kết thúc"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
