/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isMaterialEdit } from "@/shared/catalog/material-edit";
import {
  type ManageShowtime,
  MyEvent,
  MyVenue,
  organizerApi,
  studioApi,
} from "../../services/catalogClient";
import { useEventCategories } from "../../hooks/useEventCategories";
import { sectionOfCategory } from "../../services/eventSections";
import Select from "../Select";
import AiListingPanel from "./AiListingPanel";
import { CancelEventModal } from "./CancelEventModal";
import CheckInPanel from "./CheckInPanel";
import EventPreviewOverlay from "./EventPreviewOverlay";
import EventFlowRail from "./EventFlowRail";
import { flowSteps, type FlowStep } from "./flowSteps";
import ShowtimeList from "./ShowtimeList";
import { Refusal } from "./states";

const input =
  "h-10 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
const label = "mb-1 block font-mono text-[11px] text-beige-kem/70";
const btn =
  " bg-burgundy px-4 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50";
const ghost = " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80";

/**
 * Level 2 of the console: one event.
 *
 * The confirmation before a material edit (FR-042) is the piece worth reading. It fires on
 * `isMaterialEdit` from the SHARED module — the same function the server's moderation guard uses — so
 * the warning an organizer sees and the decision the server makes cannot drift apart (R-9). Deriving
 * the rule locally would be a small copy, which is exactly what makes it dangerous.
 */
export default function EventEditor({
  event,
  venues,
  onBack,
  onRefresh,
  onOpenSeatMap,
}: {
  event: MyEvent;
  venues: MyVenue[];
  onBack: () => void;
  onRefresh: () => void;
  /** Hand off to feature 005's designer — seat geometry is not this feature's business. */
  onOpenSeatMap: (eventId: number) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState("");
  const [categoryCode, setCategoryCode] = useState(event.category);
  const [isHighDemand, setIsHighDemand] = useState(event.isHighDemand ?? false);
  const [releasePhase, setReleasePhase] = useState(event.releasePhase ?? "now_showing");
  const categories = useEventCategories();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** An approved, on-sale event is the only one a save can pull out of the public catalog. */
  const isLive = event.moderation === "approved" && event.status === "on_sale";

  /*
   * Whether this event lands in the cinema band, asked of the same function the band asks.
   *
   * Not `categoryCode === "movie"`: the band collects several of the catalogue's categories under
   * one heading, so a hand-written test here would offer the control on some films and withhold it
   * on others — and the mismatch would show up as an organizer unable to move a film they can see
   * sitting in the band. Read from the live `categoryCode` rather than `event.category`, so
   * switching an event's category updates the form without a round trip.
   */
  const isCinema =
    sectionOfCategory(
      categoryCode,
      categories.find((c) => c.code === categoryCode)?.labelVi ?? "",
    ) === "movie";

  /**
   * Submitting for review, and withdrawing.
   *
   * The console shipped without either: the server route, the API client method and even the hint
   * "Thêm suất chiếu để có thể gửi duyệt" all existed, but nothing called them — so an organizer
   * could build a whole event and had no way to put it in front of an admin, which left every event
   * stranded in draft forever.
   *
   * Publishing is a REQUEST, not a state change the organizer controls: it moves the event to
   * pending review, and an admin decides. The button says so, because "Phát hành" would promise
   * something this action cannot deliver.
   */
  const onSale = event.status === "on_sale";
  /** Terminal. The server spells it with two Ls (`events.status = 'cancelled'`); match it exactly
   *  rather than adding a third spelling to a codebase that already carries two. */
  const cancelled = event.status === "cancelled";

  const [cancelOpen, setCancelOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const submitForReview = async () => {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      await organizerApi.publish(event.id);
      setNotice("Đã gửi duyệt. Sự kiện sẽ hiển thị sau khi admin duyệt.");
      onRefresh();
    } catch (e) {
      // The server refuses with `needs_showtime_and_tier` when there is nothing sellable yet; its
      // message already names the missing piece, so it is shown rather than replaced.
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      await organizerApi.unpublish(event.id);
      setNotice("Đã ngừng bán. Sự kiện không còn hiển thị công khai.");
      onRefresh();
    } catch (e) {
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Cancel, and settle every ticket sold.
   *
   * The dialog is closed on FAILURE as well as success. `CancelEventModal` latches its own
   * `isSubmitting` and has no path back out of it, so leaving it open after a refusal would strand
   * the organizer on a permanently disabled "Đang xử lý hủy…" button. Closing hands the refusal to
   * `Refusal`, which is where every other server no in this screen already appears.
   */
  const cancel = async (reason: string) => {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      const { refundedTickets } = await organizerApi.cancel(event.id, reason);
      setCancelOpen(false);
      // The refund count is the receipt. "Đã hủy" alone leaves an organizer wondering whether the
      // money moved, which is the one question a cancellation has to answer.
      setNotice(
        refundedTickets > 0
          ? `Đã hủy sự kiện. Đã hoàn ${refundedTickets} vé về ví của người mua.`
          : "Đã hủy sự kiện. Không có vé nào cần hoàn.",
      );
      onRefresh();
    } catch (e) {
      setCancelOpen(false);
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changedFields = () => {
    const fields: string[] = [];
    if (title !== event.title) fields.push("event.title");
    if (description.trim()) fields.push("event.description");
    if (categoryCode !== event.category) fields.push("event.category");
    if (isHighDemand !== (event.isHighDemand ?? false)) fields.push("event.isHighDemand");
    if (releasePhase !== (event.releasePhase ?? "now_showing")) fields.push("event.releasePhase");
    return fields;
  };

  const save = async () => {
    const fields = changedFields();
    if (fields.length === 0) return;

    // FR-042: tell the organizer BEFORE the event leaves the catalog, not after they notice.
    if (isLive && isMaterialEdit(fields)) {
      const ok = window.confirm(
        "Lưu thay đổi này sẽ đưa sự kiện về trạng thái chờ duyệt lại và tạm ẩn khỏi trang công khai " +
          "cho đến khi quản trị viên duyệt lại.\n\nVé đã bán và vé đang giữ không bị ảnh hưởng.\n\nTiếp tục?",
      );
      if (!ok) return;
    }

    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      const res = await studioApi.updateEvent(event.id, {
        title: title !== event.title ? title : undefined,
        description: description.trim() ? description.trim() : undefined,
        categoryCode: categoryCode !== event.category ? categoryCode : undefined,
        isHighDemand: isHighDemand !== (event.isHighDemand ?? false) ? isHighDemand : undefined,
        releasePhase:
          releasePhase !== (event.releasePhase ?? "now_showing") ? releasePhase : undefined,
      });
      setNotice(
        res.returnedToReview
          ? "Đã lưu. Sự kiện đang chờ duyệt lại và tạm ẩn khỏi trang công khai."
          : "Đã lưu thay đổi.",
      );
      setDescription("");
      onRefresh();
    } catch (e) {
      // The organizer's typing is deliberately NOT cleared on a refusal (FR-041).
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * The showtimes, read once here for the rail.
   *
   * The rail's steps are derived from server facts, not from what this screen has typed, so it needs
   * the same payload the seat-map builder reads. Advisory: a failed fetch leaves the rail absent
   * rather than guessing, and every button below still works.
   */
  const [rows, setRows] = useState<ManageShowtime[] | null>(null);
  const showtimesRef = useRef<HTMLDivElement>(null);

  const loadRows = useCallback(() => {
    let alive = true;
    organizerApi
      .showtimesManage(event.id)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows(null));
    return () => {
      alive = false;
    };
  }, [event.id]);

  useEffect(() => loadRows(), [loadRows]);

  const steps = flowSteps(event, rows);

  /**
   * What a cancellation would cost, for the confirmation dialog.
   *
   * Summed from the tiers the rail already loaded rather than fetched again — `sold × list price`,
   * which is the same arithmetic the event's revenue figure uses. It is an ESTIMATE and the dialog
   * says so: it knows nothing about refunds already issued. Showing it beats the alternative, which
   * is the modal's `= 0` default telling an organizer "0 người mua vé" moments before the server
   * refunds a hundred of them.
   */
  const soldTickets = (rows ?? []).reduce(
    (sum, s) => sum + s.tiers.reduce((n, t) => n + t.sold, 0),
    0,
  );
  const refundEstimate = (rows ?? []).reduce(
    (sum, s) => sum + s.tiers.reduce((n, t) => n + t.sold * t.price, 0),
    0,
  );

  /** Each step points at the tool that fixes it — the rail does no editing of its own. */
  const runAction = (action: NonNullable<FlowStep["action"]>) => {
    if (action === "chart" || action === "apply") onOpenSeatMap(event.id);
    else if (action === "submit") void submitForReview();
    else showtimesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className={ghost}>
          ← Danh sách sự kiện
        </button>
        <div className="flex flex-wrap items-center gap-3">
          {event.eventType === "seated" && (
            <button onClick={() => onOpenSeatMap(event.id)} className={ghost}>
              Sơ đồ ghế
            </button>
          )}
          {/* A cancelled event is finished: nothing here can put it back on sale, so the controls
              that would imply otherwise are gone rather than merely disabled. */}
          <button onClick={() => setPreviewOpen(true)} className={ghost}>
            Xem trước
          </button>
          {!cancelled &&
            (onSale ? (
              <button onClick={withdraw} disabled={busy} className={ghost}>
                Ngừng bán
              </button>
            ) : (
              <button onClick={submitForReview} disabled={busy} className={btn}>
                Gửi duyệt
              </button>
            ))}
          {!cancelled && (
            <button
              onClick={() => setCancelOpen(true)}
              disabled={busy}
              className={`${ghost} border-burgundy text-burgundy`}
            >
              Hủy sự kiện
            </button>
          )}
          {cancelled ? (
            <span className="font-mono text-[10px] text-burgundy">Đã hủy</span>
          ) : isLive ? (
            <span className="font-mono text-[10px] text-la-co">Đang hiển thị công khai</span>
          ) : (
            onSale && (
              <span className="font-mono text-[10px] text-cam-dat">Đang chờ admin duyệt</span>
            )
          )}
        </div>
      </div>

      {/*
        Its own row, not another chip in the bar above: collapsed it is one button, but open it is a
        camera, a running log and a card, and a flex item cannot hold that.

        Shown only while the event is selling. A draft has no tickets to admit and a cancelled one
        has none still good — a scanner there is a door onto an empty room.
      */}
      {onSale && <CheckInPanel eventTitle={event.title} onCheckedIn={onRefresh} />}

      {/*
        Rail beside the work, not above it: the steps stay legible while the organizer edits, which is
        the whole point of a rail rather than a banner. It collapses to a scrolling strip under `lg`.
      */}
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="lg:order-1">
          <EventFlowRail steps={steps} onAction={runAction} />
        </div>

        <div className="space-y-5 lg:order-2">
      <div className="border-2 border-beige-kem bg-surface-2 p-5">
        <h3 className="mb-3 font-display text-lg font-bold">{event.title}</h3>

        <label className="block">
          <span className={label}>Tiêu đề</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </label>

        <label className="mt-3 block">
          <span className={label}>Mô tả (để trống nếu không đổi)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={`${input} h-auto py-2`}
          />
        </label>

        <label className="mt-3 block">
          <span className={label}>Danh mục</span>
          <Select
            value={categoryCode}
            options={categories.map((c) => ({ value: c.code, label: c.labelVi }))}
            onChange={setCategoryCode}
            triggerClassName={input}
          />
        </label>

        {/*
          Films only. The column exists on every event and nothing outside the cinema band reads it,
          so offering the choice on a concert would be asking a question whose answer is discarded.

          Two radios rather than a checkbox: "sắp chiếu" and "đang chiếu" are two states a film moves
          between on a known date, not a flag that is on or off, and the pair names both so the
          organizer is not left inferring what unticking means.
        */}
        {isCinema && (
          <fieldset className="mt-3">
            <legend className={label}>Trạng thái phát hành</legend>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["upcoming", "Sắp chiếu"],
                  ["now_showing", "Đang chiếu"],
                ] as const
              ).map(([value, text]) => (
                <label key={value} className="flex cursor-pointer select-none items-center gap-2">
                  <input
                    type="radio"
                    name="releasePhase"
                    value={value}
                    checked={releasePhase === value}
                    onChange={() => setReleasePhase(value)}
                    className="h-4 w-4 accent-burgundy"
                  />
                  <span className="font-mono text-xs text-beige-kem">{text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isHighDemand}
            onChange={(e) => setIsHighDemand(e.target.checked)}
            className="h-4 w-4 rounded border-beige-kem/60 accent-burgundy"
          />
          <span className="font-mono text-xs text-beige-kem">
            🛡️ Phòng Chờ Vé Hot - Bảo Vệ Chống Bot
          </span>
        </label>

        {isLive && changedFields().length > 0 && isMaterialEdit(changedFields()) && (
          <p className="mt-3 font-mono text-[11px] text-cam-dat">
            Thay đổi này cần duyệt lại: sự kiện sẽ tạm ẩn khỏi trang công khai cho đến khi được
            duyệt.
          </p>
        )}

        <button
          onClick={save}
          disabled={busy || changedFields().length === 0}
          className={`${btn} mt-4`}
        >
          Lưu thay đổi
        </button>

        {notice && <p className="mt-3 font-mono text-[11px] text-la-co">{notice}</p>}
        <Refusal message={refusal} />
      </div>

      {/* Never on a critical path: the whole editor above works with this panel broken (FR-029). */}
      <AiListingPanel
        eventId={isLive ? undefined : event.id}
        onAccept={(field, value) => (field === "title" ? setTitle(value) : setDescription(value))}
      />

      <div ref={showtimesRef} className="border-2 border-beige-kem bg-surface-2 p-5">
        <h3 className="mb-3 font-display text-base font-bold">Suất chiếu</h3>
        <ShowtimeList
          eventId={event.id}
          venues={venues}
          onChanged={() => {
            onRefresh();
            // The rail reads showtimes, tiers and the chart binding — all of which this list edits.
            loadRows();
          }}
        />
      </div>
        </div>
      </div>

      {previewOpen && (
        <EventPreviewOverlay eventId={event.id} onClose={() => setPreviewOpen(false)} />
      )}

      {cancelOpen && (
        <CancelEventModal
          eventTitle={event.title}
          soldTicketsCount={soldTickets}
          totalRefundAmountVnd={refundEstimate}
          onConfirm={(reason) => void cancel(reason)}
          onClose={() => setCancelOpen(false)}
        />
      )}
    </div>
  );
}
