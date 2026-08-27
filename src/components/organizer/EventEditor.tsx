/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
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
import EventPreviewOverlay from "./EventPreviewOverlay";
import EventMediaEditor from "./EventMediaEditor";
import EventFlowRail from "./EventFlowRail";
import FlowProgressStrip from "./FlowProgressStrip";
import { flowSteps, type FlowStep } from "./flowSteps";
import OrganizerConcessionsTab from "./OrganizerConcessionsTab";
import ShowtimeList from "./ShowtimeList";
import { Refusal } from "./states";
import { VN_PROVINCES } from "../../vnProvinces";
import { useMutationConfirmation } from "./useMutationConfirmation";
import { REVIEW_WARNING } from "./mutationConfirmation";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";

const input =
  "h-10 min-w-0 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
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
  const [description, setDescription] = useState(event.description);
  const [categoryCode, setCategoryCode] = useState(event.category);
  const [isHighDemand, setIsHighDemand] = useState(event.isHighDemand ?? false);
  const [releasePhase, setReleasePhase] = useState(event.releasePhase ?? "now_showing");
  const categories = useEventCategories();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** An approved, on-sale event is the only one a save can pull out of the public catalog. */
  const isLive = event.moderation === "approved" && event.status === "on_sale";
  const { confirmMutation, dialog: mutationDialog } = useMutationConfirmation(isLive);

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
  const cancelled = event.status === "cancelled" || event.status === "finished";

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

  /** The modal owns failures, retaining the reason and enabling a retry. */
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
    } finally {
      setBusy(false);
    }
  };

  const changedFields = () => {
    const fields: string[] = [];
    if (title !== event.title) fields.push("event.title");
    if (description !== event.description) fields.push("event.description");
    if (categoryCode !== event.category) fields.push("event.category");
    if (isHighDemand !== (event.isHighDemand ?? false)) fields.push("event.isHighDemand");
    if (releasePhase !== (event.releasePhase ?? "now_showing")) fields.push("event.releasePhase");
    return fields;
  };

  const save = async (confirmReview = true): Promise<boolean> => {
    const fields = changedFields();
    if (fields.length === 0) return true;
    if (busy) return false;

    // FR-042: tell the organizer BEFORE the event leaves the catalog, not after they notice.
    if (confirmReview && !(await confirmMutation(fields))) return false;

    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      const res = await studioApi.updateEvent(event.id, {
        title: title !== event.title ? title : undefined,
        description: description !== event.description ? description : undefined,
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
      onRefresh();
      return true;
    } catch (e) {
      // The organizer's typing is deliberately NOT cleared on a refusal (FR-041).
      setRefusal((e as Error).message);
      return false;
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

  /*
   * The bound venue's display details, editable while the event is a DRAFT.
   *
   * The venue was collected on the create form and locked system-wide from then on — but a draft
   * has sold nothing and surprised nobody, so a typo in "Nhà hát Hòa Bình" should be fixable where
   * it was made, not frozen forever. Once the event is submitted this card disappears: published
   * buyers bought the venue's name as much as its seats (the server refuses independently).
   *
   * Showtimes need no migration when this saves — they point at the same VENUE ROW; only its
   * spelling changed.
   */
  const boundVenue = venues.find((v) => v.id === event.venueId) ?? null;
  const venueEditable = event.status === "draft" && boundVenue !== null;
  const [venueDraft, setVenueDraft] = useState({
    name: boundVenue?.name ?? "",
    city: boundVenue?.city ?? "",
    rawAddress: boundVenue?.rawAddress ?? "",
  });
  // Re-seed the draft when a DIFFERENT venue becomes bound, adjusted during render against the
  // previous id — the same pattern OrganizerEventsPage uses for URL sync (no effect, no cascade).
  const [venueSeenId, setVenueSeenId] = useState<number | null>(boundVenue?.id ?? null);
  if (boundVenue !== null && boundVenue.id !== venueSeenId) {
    setVenueSeenId(boundVenue.id);
    setVenueDraft({
      name: boundVenue.name,
      city: boundVenue.city,
      rawAddress: boundVenue.rawAddress,
    });
  }
  const [venueBusy, setVenueBusy] = useState(false);
  const [venueNotice, setVenueNotice] = useState<string | null>(null);
  const [venueRefusal, setVenueRefusal] = useState<string | null>(null);
  /** An UNBOUND draft picks its venue here; the details card takes over once one is bound. */
  const [bindChoice, setBindChoice] = useState<number | "">("");
  const bindVenue = async () => {
    if (!bindChoice || venueBusy) return;
    setVenueBusy(true);
    setVenueNotice(null);
    setVenueRefusal(null);
    try {
      await organizerApi.bindEventVenue(event.id, Number(bindChoice));
      setVenueNotice("Đã gán địa điểm.");
      onRefresh();
    } catch (e) {
      setVenueRefusal((e as Error).message);
    } finally {
      setVenueBusy(false);
    }
  };

  const venueDirty =
    boundVenue !== null &&
    (venueDraft.name !== boundVenue.name ||
      venueDraft.city !== boundVenue.city ||
      venueDraft.rawAddress !== boundVenue.rawAddress);

  const saveVenue = async (): Promise<boolean> => {
    if (!boundVenue || !venueDirty) return true;
    if (venueBusy) return false;
    setVenueBusy(true);
    setVenueNotice(null);
    setVenueRefusal(null);
    try {
      await organizerApi.updateVenue(boundVenue.id, {
        name: venueDraft.name.trim() || undefined,
        city: venueDraft.city.trim() || undefined,
        rawAddress: venueDraft.rawAddress.trim() || undefined,
      });
      setVenueNotice("Đã lưu địa điểm.");
      onRefresh();
      return true;
    } catch (e) {
      // Its OWN refusal surface: a venue error must not appear inside the event-info card above.
      setVenueRefusal((e as Error).message);
      return false;
    } finally {
      setVenueBusy(false);
    }
  };

  const { requestLeave, dialog: leaveDialog } = useUnsavedChanges({
    dirty: !cancelled && (changedFields().length > 0 || venueDirty),
    busy: busy || venueBusy,
    // The exit dialog already explains the review consequence; do not stack another dialog.
    save: async () => (await save(false)) && (await saveVenue()),
    warning: isLive && isMaterialEdit(changedFields()) ? REVIEW_WARNING : undefined,
  });

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

  if (cancelled)
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className={ghost}>
          ← Quay lại sự kiện
        </button>
        <h2 className="font-display text-2xl">{event.title}</h2>
        <p className="text-ink-soft">
          Sự kiện đã kết thúc hoặc đã hủy. Dữ liệu được giữ để đối soát, không thể chỉnh sửa hay
          đăng bán lại.
        </p>
      </div>
    );

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Borderless, like the booking flow's back link (`BookingHeader`) — an arrow and a label
            rather than a boxed button, since this is navigation, not an action taken on the page. */}
        <button
          type="button"
          onClick={() => requestLeave(onBack)}
          className="inline-flex min-h-10 items-center gap-2 px-2 text-sm font-bold text-ink-soft transition-colors hover:text-beige-kem focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Quay lại sự kiện
        </button>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
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
              <button
                onClick={submitForReview}
                disabled={busy || ["flagged", "removed"].includes(event.moderation)}
                className={btn}
              >
                Gửi duyệt
              </button>
            ))}
          {!cancelled && (
            <button
              onClick={() => setCancelOpen(true)}
              disabled={busy}
              className={`${ghost} border-burgundy text-burgundy-ink`}
            >
              Hủy sự kiện
            </button>
          )}
        </div>
      </div>

      {/* The glance, above the work: one line saying what still blocks this event and the button
          that fixes it. The rail beside the content below remains the detailed reading. */}
      <FlowProgressStrip steps={steps} onAction={runAction} />

      {/*
        Rail beside the work, not above it: the steps stay legible while the organizer edits, which is
        the whole point of a rail rather than a banner. It collapses to a scrolling strip under `lg`.
      */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="lg:order-1">
          <EventFlowRail steps={steps} onAction={runAction} />
        </div>

        {/*
          Tinted blocks, not bordered cards: `space-y-5` already puts page showing between them, so
          the border-2 outline each used to carry was doing the same job twice — once with the
          outline, once with the gap. Dropping it is the same call the booking flow's own
          `OrderSummary` made for the same reason (see that file's "Blocks on the page, not
          compartments inside a box").
        */}
        <div className="min-w-0 space-y-5 lg:order-2">
          {!cancelled && <EventMediaEditor event={event} onSaved={onRefresh} />}
          <div className="min-w-0 bg-surface-2 p-5">
            <h3 className="mb-3 break-words font-display text-2xl font-bold">{event.title}</h3>

            <label className="block">
              <span className={label}>Tiêu đề</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
            </label>

            <label className="mt-3 block">
              <span className={label}>Mô tả</span>
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
                    <label
                      key={value}
                      className="flex cursor-pointer select-none items-center gap-2"
                    >
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

            {/*
              A setting whose consequence lands on the BUYER, not on this form, so it states that
              consequence instead of naming the feature.

              It was a bare checkbox reading "Phòng Chờ Vé Hot - Bảo Vệ Chống Bot" — a compressed
              product name that says what the feature is called and nothing about what ticking it
              does. What it actually does is put every buyer through a queue and a CAPTCHA before
              they may hold a seat, which is a material change to the purchase flow and the kind of
              thing an organizer should not have to discover from support tickets.

              The description hangs under the title rather than beside the tick so the second and
              third lines stay on the title's left edge instead of wrapping under the checkbox.
            */}
            <label className="mt-4 flex cursor-pointer select-none items-start gap-3">
              <input
                type="checkbox"
                checked={isHighDemand}
                onChange={(e) => setIsHighDemand(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-beige-kem/60 accent-burgundy"
              />
              <span className="min-w-0">
                <span className="block font-mono text-xs font-bold text-beige-kem">
                  Phòng chờ vé hot
                </span>
                <span className="mt-1 block font-mono text-[11px] leading-4 text-beige-kem/70">
                  Người mua phải xếp hàng và qua bước kiểm tra chống bot trước khi được chọn ghế.
                  Dành cho sự kiện dự kiến cháy vé trong vài phút.
                </span>
                {isHighDemand && (
                  <span className="mt-1 block font-mono text-[11px] leading-4 text-cam-dat-ink">
                    Đang bật — người mua vào chọn ghế theo lượt, khoảng 300 người mỗi phút.
                  </span>
                )}
              </span>
            </label>

            {isLive && changedFields().length > 0 && isMaterialEdit(changedFields()) && (
              <p className="mt-3 font-mono text-[11px] text-cam-dat-ink">
                Thay đổi này cần duyệt lại: sự kiện sẽ tạm ẩn khỏi trang công khai cho đến khi được
                duyệt.
              </p>
            )}

            <button
              onClick={() => void save()}
              disabled={cancelled || busy || changedFields().length === 0}
              className={`${btn} mt-4`}
            >
              Lưu thay đổi
            </button>

            {notice && <p className="mt-3 font-mono text-[11px] text-la-co-ink">{notice}</p>}
            <Refusal message={refusal} />
          </div>

          {/* The venue card, only while the event is still a draft — see `venueEditable` above. */}
          {venueEditable && (
            <div className="bg-surface-2 p-5">
              <h3 className="mb-1 font-display text-lg font-bold">Địa điểm</h3>

              {/* ── Chưa gán: chọn một trong các địa điểm của bạn ── */}
              {!boundVenue && (
                <div className="space-y-3">
                  <p className="font-mono text-[11px] text-beige-kem/55">
                    Sự kiện này chưa gán địa điểm. Chọn một địa điểm của bạn — mọi suất chiếu hiện
                    có sẽ chuyển theo.
                  </p>
                  <select
                    value={bindChoice}
                    onChange={(e) => setBindChoice(Number(e.target.value) || "")}
                    className={input}
                  >
                    <option value="" className="bg-surface-2">
                      Chọn địa điểm
                    </option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id} className="bg-surface-2">
                        {v.name} · {v.city}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void bindVenue()}
                    disabled={!bindChoice || venueBusy}
                    className={btn}
                  >
                    Gán địa điểm
                  </button>
                </div>
              )}

              {/* ── Đã gán: sửa chi tiết hiển thị ── */}
              {boundVenue && (
                <>
                  <p className="mb-3 font-mono text-[11px] text-beige-kem/55">
                    Sự kiện chưa xuất bản nên địa điểm vẫn sửa được. Các suất chiếu hiện có tự theo
                    địa điểm này — chúng trỏ vào cùng một bản ghi, chỉ tên và vị trí thay đổi.
                  </p>

                  <label className="block">
                    <span className={label}>Tên địa điểm</span>
                    <input
                      value={venueDraft.name}
                      onChange={(e) => setVenueDraft((v) => ({ ...v, name: e.target.value }))}
                      className={input}
                    />
                  </label>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <label className="block">
                      <span className={label}>Thành phố</span>
                      <select
                        value={venueDraft.city}
                        onChange={(e) => setVenueDraft((v) => ({ ...v, city: e.target.value }))}
                        className={input}
                      >
                        {VN_PROVINCES.map((p) => (
                          <option key={p} value={p} className="bg-surface-2">
                            {p === "TP.HCM" ? "TP. Hồ Chí Minh" : p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className={label}>Địa chỉ chi tiết</span>
                      <input
                        value={venueDraft.rawAddress}
                        onChange={(e) =>
                          setVenueDraft((v) => ({ ...v, rawAddress: e.target.value }))
                        }
                        className={input}
                      />
                    </label>
                  </div>

                  <button
                    onClick={() => void saveVenue()}
                    disabled={venueBusy || !venueDirty}
                    className={`${btn} mt-4`}
                  >
                    Lưu địa điểm
                  </button>

                  {venueNotice && (
                    <p className="mt-3 font-mono text-[11px] text-la-co-ink">{venueNotice}</p>
                  )}
                  <Refusal message={venueRefusal} />
                </>
              )}
            </div>
          )}

          {/* Never on a critical path: the whole editor above works with this panel broken (FR-029). */}
          <AiListingPanel
            eventId={isLive ? undefined : event.id}
            onAccept={(field, value) =>
              field === "title" ? setTitle(value) : setDescription(value)
            }
          />

          <div ref={showtimesRef} className="min-w-0 bg-surface-2 p-5">
            <h3 className="mb-3 font-display text-lg font-bold">Suất chiếu</h3>
            <ShowtimeList
              eventId={event.id}
              venues={venues}
              preferredVenueId={event.venueId ?? undefined}
              isLive={isLive}
              onChanged={(returnedToReview) => {
                setNotice(
                  returnedToReview
                    ? "Đã lưu. Sự kiện đang chờ duyệt lại và tạm ẩn khỏi trang công khai."
                    : "Đã cập nhật suất chiếu / hạng vé.",
                );
                onRefresh();
                // The rail reads showtimes, tiers and the chart binding — all of which this list edits.
                loadRows();
              }}
            />
          </div>

          {/*
            Bắp nước (014): the menu belongs to the EVENT — every showtime sells the same list — so
            it lives beside showtimes in the per-event editor rather than becoming a console section
            of its own. A nav entry would advertise a page that does not exist.
          */}
          <OrganizerConcessionsTab eventId={event.id} />
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
          onConfirm={cancel}
          onClose={() => setCancelOpen(false)}
        />
      )}
      {mutationDialog}
      {leaveDialog}
    </div>
  );
}
