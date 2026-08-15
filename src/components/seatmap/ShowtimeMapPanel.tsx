/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyPreview, ShowtimeMap, ShowtimeMapSeat } from "@/shared/catalog/seatmap";
import { NEUTRAL_TIER_COLOR, colorForTier } from "@/shared/catalog/tier-palette";
import { layoutApi } from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";
import SeatCanvas, { type CanvasBlock, type SeatCanvasHandle } from "./SeatCanvas";
import { seatsInRect } from "./layoutOps";

/**
 * The inventory-aware actions on a showtime that already has a generated map (FR-027a, FR-033, FR-034).
 *
 * **Seats are picked ON THE MAP.** They used to be picked by typing `showtime_seats` ids into a
 * comma-separated text box — ids that appear nowhere in the interface, so blocking the back row meant
 * reading them out of a database client first. The same renderer the buyer selects seats in now does
 * the organizer's selecting too, which is also why the two cannot disagree about which seat is which.
 *
 * Re-apply is deliberately two steps: the organizer sees exactly what would change and what would be
 * refused, and nothing runs until they confirm. The preview is advisory — the server re-checks inside
 * the transaction, so a sale or hold landing in between refuses the whole apply rather than being
 * overwritten.
 */

const btn =
  " border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const primary =
  " bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-40";

const KIND_LABEL: Record<string, string> = {
  add: "Thêm",
  move: "Dời chỗ",
  relabel: "Đổi nhãn",
  retier: "Đổi hạng vé",
  remove: "Xoá",
};

const STATUS_LABEL: Record<ShowtimeMapSeat["status"], string> = {
  available: "còn trống",
  held: "khách đang giữ",
  sold: "đã bán",
  blocked: "đang khoá",
};

export default function ShowtimeMapPanel({
  showtimeId,
  tiers,
  onDone,
}: {
  showtimeId: number;
  tiers: { id: number; label: string; price: number }[];
  onDone?: () => void;
}) {
  const [map, setMap] = useState<ShowtimeMap | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<ApplyPreview | null>(null);
  const [tierId, setTierId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canvas = useRef<SeatCanvasHandle>(null);
  /** Wrapped so the ref is read when a chip is pressed, not while the key is being built. */
  const zoomToBlock = useCallback((id: string | number) => canvas.current?.zoomToBlock(id), []);

  const load = useCallback(
    () =>
      layoutApi
        .showtimeMap(showtimeId)
        .then(setMap)
        .catch((e) => setError((e as Error).message)),
    [showtimeId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /** Refusals arrive as a structured list on the 409 body, so we can name the seats (FR-029). */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seats = useMemo(() => map?.seats ?? [], [map]);
  const ids = [...selected];

  /**
   * Section hulls are drawn NEUTRAL, not in a section colour.
   *
   * This map colours by price tier, and two colour meanings on one picture is exactly what FR-064
   * keeps apart — so a hull contributes a name and an outline and no hue at all.
   */
  const blocks = useMemo<CanvasBlock[]>(() => {
    const names = [...new Set(seats.map((s) => s.section).filter((n): n is string => !!n))];
    return names.map((name) => ({ id: name, name, color: NEUTRAL_TIER_COLOR }));
  }, [seats]);

  /**
   * Status first, price second. An organizer scanning for what is still sellable must not have to
   * tell a sold seat from a cheap one by hue, so this yields for anything the classes below claim.
   */
  const seatFill = useCallback(
    (seat: ShowtimeMapSeat) => {
      if (selected.has(seat.id) || seat.status !== "available") return undefined;
      return colorForTier(map?.tierLegend ?? [], seat.ticketTierId);
    },
    [selected, map],
  );

  const seatClass = useCallback(
    (seat: ShowtimeMapSeat) => {
      if (selected.has(seat.id)) return "fill-burgundy stroke-burgundy";
      // A blocked seat is dark like a sold one but outlined, because the two mean different things:
      // sold is somebody's ticket, blocked is a decision the organizer can take back.
      if (seat.status === "blocked") return "fill-stone-800 stroke-bubblegum";
      if (seat.status === "sold") return "fill-stone-800 stroke-stone-800";
      if (seat.status === "held") return "fill-stone-700/60 stroke-stone-700";
      return "";
    },
    [selected],
  );

  const counts = useMemo(() => {
    const out: Record<ShowtimeMapSeat["status"], number> = {
      available: 0,
      held: 0,
      sold: 0,
      blocked: 0,
    };
    for (const s of seats) out[s.status] += 1;
    return out;
  }, [seats]);

  const toggleSeat = useCallback(
    (seat: ShowtimeMapSeat, additive: boolean) =>
      setSelected((cur) => {
        const next = new Set(additive ? cur : []);
        if (additive && cur.has(seat.id)) next.delete(seat.id);
        else next.add(seat.id);
        return next;
      }),
    [],
  );

  /** Selecting only the seats an action can actually touch would hide WHY it refused; selecting
   *  freely and letting the server refuse keeps the reason visible (FR-029). */
  const selectByStatus = (status: ShowtimeMapSeat["status"]) =>
    setSelected(new Set(seats.filter((s) => s.status === status).map((s) => s.id)));

  const statusKey = [
    { key: "available", label: "Còn trống", cls: "border-beige-kem/60", n: counts.available },
    { key: "held", label: "Khách đang giữ", cls: "bg-stone-700/60 border-stone-700", n: counts.held },
    { key: "sold", label: "Đã bán", cls: "bg-stone-800 border-stone-800", n: counts.sold },
    { key: "blocked", label: "Đang khoá", cls: "bg-stone-800 border-bubblegum", n: counts.blocked },
  ];

  /** Every action here acts on the CURRENT selection, then re-reads the map — the statuses it just
   *  changed are the whole point of the picture. */
  const act = (fn: () => Promise<unknown>, ok: string) =>
    run(async () => {
      await fn();
      setNotice(ok);
      await load();
      onDone?.();
    });

  return (
    <div className="space-y-3 border-2 border-beige-kem bg-surface-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          Sơ đồ của suất chiếu
        </h3>
        <span className="font-mono text-[11px] text-beige-kem/50">
          {seats.length} ghế · đã chọn {selected.size}
        </span>
      </div>

      {error && (
        <div className="border-2 border-beige-kem bg-bubblegum p-3 text-xs text-on-tint">
          {error}
        </div>
      )}
      {notice && (
        <div className="border-2 border-beige-kem bg-la-co p-3 text-xs text-on-tint">
          {notice}
        </div>
      )}

      {map && seats.length > 0 && (
        <>
          <div className="border-2 border-beige-kem/40 p-2">
            <SeatCanvas<ShowtimeMapSeat>
              ref={canvas}
              seats={seats}
              elements={map.elements}
              tables={map.tables}
              space={map.space}
              blocks={blocks}
              seatBlockId={(s) => s.section}
              seatClass={seatClass}
              seatFill={seatFill}
              seatLabel={(s) =>
                `${s.section ? `${s.section}, ` : ""}hàng ${s.row}, ghế ${s.number} — ${
                  STATUS_LABEL[s.status]
                } (${s.tier}, ${formatVnd(s.price)})`
              }
              seatTooltip={(s) => (
                <>
                  <span className="font-bold">
                    {s.row}
                    {s.number}
                  </span>{" "}
                  · {s.tier} · {formatVnd(s.price)} · {STATUS_LABEL[s.status]}
                </>
              )}
              // `editable` here buys the marquee and press-to-select, not authoring: no drag handler
              // is passed, so a seat cannot be moved from this screen — its position belongs to the
              // layout, and changing it is what "áp dụng lại" is for.
              editable
              interactive
              heightClass="max-h-[52vh]"
              selectedIds={selected}
              onSeatPointerDown={toggleSeat}
              // A keyboard never fires the press gesture that selects by pointer, so without this a
              // tabbed-to seat could be read out but never chosen (FR-039a).
              onSeatActivate={(seat) => toggleSeat(seat, true)}
              onMarquee={(rect, additive) => {
                const hit = seatsInRect(seats, rect);
                setSelected((cur) => (additive ? new Set([...cur, ...hit]) : new Set(hit)));
              }}
              onBackgroundClick={(_p, additive) => !additive && setSelected(new Set())}
            />
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] text-beige-kem/80">
            {statusKey.map((e) => (
              <span key={e.key} className="flex items-center gap-2">
                <span aria-hidden="true" className={`h-4 w-4 shrink-0 border-2 ${e.cls}`} />
                {e.label} <span className="text-beige-kem/45">({e.n})</span>
              </span>
            ))}
            {/* Price categories, in the same cheapest-first order and the same colours the buyer sees. */}
            {(map.tierLegend ?? []).map((t) => (
              <span key={t.tierId} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 border-2"
                  style={{ borderColor: t.color, backgroundColor: t.color }}
                />
                {t.label} — {formatVnd(t.price)}
                <span className="text-beige-kem/45">
                  ({seats.filter((s) => s.ticketTierId === t.tierId).length})
                </span>
              </span>
            ))}
            {blocks.map((b) => (
              <button
                key={String(b.id)}
                type="button"
                onClick={() => zoomToBlock(b.id)}
                className="flex items-center gap-2 px-1 py-0.5 transition hover:text-beige-kem"
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 border-2"
                  style={{ borderColor: b.color }}
                />
                {b.name}
                <span className="text-beige-kem/45">
                  ({seats.filter((s) => s.section === b.name).length})
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => selectByStatus("available")}>
              Chọn ghế trống
            </button>
            <button className={btn} onClick={() => selectByStatus("blocked")}>
              Chọn ghế đang khoá
            </button>
            <button
              className={btn}
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              Bỏ chọn
            </button>
          </div>
        </>
      )}

      {/* Say which of the three it is. A silent panel while the map loads reads as an empty map, and
          an empty map reads as a broken one. */}
      {!map && !error && (
        <p className="font-mono text-[11px] text-beige-kem/60">Đang tải sơ đồ ghế…</p>
      )}
      {map && seats.length === 0 && (
        <p className="font-mono text-[11px] text-beige-kem/60">
          Suất này chưa có ghế nào trong sơ đồ.
        </p>
      )}

      {/* --- Block / unblock and tier assignment on the current selection (FR-033, FR-034) --- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={btn}
          disabled={busy || ids.length === 0}
          onClick={() =>
            act(() => layoutApi.blockSeats(showtimeId, ids, true), `Đã khoá ${ids.length} ghế.`)
          }
        >
          Khoá ghế
        </button>
        <button
          className={btn}
          disabled={busy || ids.length === 0}
          onClick={() =>
            act(() => layoutApi.blockSeats(showtimeId, ids, false), `Đã mở khoá ${ids.length} ghế.`)
          }
        >
          Mở khoá
        </button>

        <select
          value={tierId}
          onChange={(e) => setTierId(Number(e.target.value) || "")}
          className="h-9 border-2 border-beige-kem bg-surface-2 px-2 text-xs text-beige-kem outline-none"
        >
          <option value="" className="bg-xanh-pho">
            Hạng vé
          </option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id} className="bg-xanh-pho">
              {t.label} — {t.price.toLocaleString("vi-VN")}đ
            </option>
          ))}
        </select>
        <button
          className={btn}
          disabled={busy || ids.length === 0 || tierId === ""}
          onClick={() =>
            act(
              () => layoutApi.assignTier(showtimeId, ids, Number(tierId)),
              `Đã gán hạng vé cho ${ids.length} ghế.`,
            )
          }
        >
          Gán hạng vé
        </button>
      </div>

      {/* --- Re-apply, previewed (FR-027a) --- */}
      <div className="flex flex-wrap gap-2 border-t border-beige-kem/20 pt-3">
        <button
          className={btn}
          disabled={busy}
          onClick={() => run(async () => setPreview(await layoutApi.reapplyPreview(showtimeId)))}
        >
          Xem trước áp dụng lại
        </button>
        <button
          className={primary}
          disabled={busy || !preview?.wouldSucceed}
          onClick={() =>
            run(async () => {
              await layoutApi.reapply(showtimeId);
              setPreview(null);
              setSelected(new Set());
              setNotice("Đã áp dụng lại bố cục cho suất chiếu này.");
              await load();
              onDone?.();
            })
          }
        >
          Xác nhận áp dụng
        </button>
      </div>

      {preview && (
        <div className="border-2 border-beige-kem/40 p-3">
          <p className="font-mono text-[11px] text-beige-kem/60">
            {preview.changes.length} thay đổi · {preview.refusals.length} bị từ chối
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-beige-kem/80">
            {preview.changes.map((c, i) => (
              <li key={`c${i}`}>
                <span className="font-bold">{KIND_LABEL[c.kind] ?? c.kind}</span> — {c.seatLabel}
              </li>
            ))}
            {preview.refusals.map((r, i) => (
              <li key={`r${i}`} className="text-on-tint">
                — {r.message}
              </li>
            ))}
          </ul>
          {!preview.wouldSucceed && (
            <p className="mt-2 text-[11px] text-beige-kem/60">
              Không thể áp dụng khi còn ghế bị từ chối — sơ đồ sẽ được giữ nguyên.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] leading-4 text-beige-kem/45">
        Bấm hoặc kéo khoanh vùng để chọn ghế · Shift+bấm để chọn thêm · giữ Ctrl (hoặc ⌘) và kéo để
        di chuyển khung nhìn · lăn chuột để phóng to. Ghế đã bán chỉ đổi được vị trí hiển thị; ghế
        đang được khách giữ thì không đổi được gì cho tới khi lượt giữ hết hạn. Mọi thay đổi bị từ
        chối sẽ giữ nguyên toàn bộ sơ đồ.
      </p>
    </div>
  );
}
