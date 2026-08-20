/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LayoutLibraryEntry, LayoutRevision } from "@/shared/catalog/seatmap";
import { layoutApi, organizerApi, type MyVenue } from "../../services/catalogClient";
import { CHANGE_LABEL, compareDocuments, type DocumentDiff } from "./compare";
import ConfirmDialog, { type ConfirmRequest } from "../ConfirmDialog";
import OrganizerNav from "../organizer/OrganizerNav";

/**
 * The seat map library — every chart the organizer owns, in one place.
 *
 * A chart belongs to a VENUE, and the same chart backs many showtimes across many events. Reaching it
 * only by drilling through one of those events misrepresented what it is, and meant the lifecycle the
 * database has always had — draft, published, archived — was invisible: there was no screen on which
 * to see a chart's status, rename it, archive it, or find out that three showtimes are selling from it.
 *
 * `usageCount` is what makes this honest rather than optimistic. Archive and delete are refused by the
 * server while a live showtime still points at a chart, so the same count that drives those refusals
 * also decides whether the buttons are offered at all — the UI and the server agree instead of the UI
 * guessing and being corrected by a 409.
 */

const card = " border-2 border-beige-kem bg-surface-2 p-5";
const ghost =
  " border-2 border-beige-kem px-3 py-1.5 text-eyebrow font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const primary =
  " bg-burgundy px-4 py-2 text-eyebrow font-black text-white transition hover:brightness-95 disabled:opacity-60";

/** Status, in the platform's own chip vocabulary rather than the raw database word. */
function StatusPill({ status }: { status: LayoutLibraryEntry["status"] }) {
  const style =
    status === "ready"
      ? "border-la-co text-la-co"
      : status === "archived"
        ? "border-beige-kem/30 text-beige-kem/45"
        : "border-cam-dat text-cam-dat";
  const label =
    status === "ready" ? "Đã phát hành" : status === "archived" ? "Lưu trữ" : "Bản nháp";
  return <span className={`border px-2 py-0.5 font-meta text-[10px] ${style}`}>{label}</span>;
}

type Filter = "active" | "archived" | "templates";

export default function SeatMapLibrary({
  onOpen,
  onClose,
}: {
  /** Open a chart in the editor. The caller owns the URL, so the library never navigates itself. */
  onOpen: (layoutId: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<LayoutLibraryEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [venues, setVenues] = useState<MyVenue[] | null>(null);
  const [venueId, setVenueId] = useState("");
  const [newLayoutName, setNewLayoutName] = useState("");
  const [creating, setCreating] = useState(false);

  /**
   * Template-first creation (§32, §33).
   *
   * `null` = chooser closed. `"chooser"` = the three-way "how do you want to start" modal. The other
   * three are the second step of each path, each one a different shape of "pick a venue, then pick
   * the source it comes from" — kept as separate states rather than one polymorphic blob so the modal
   * renders one simple form at a time.
   *
   * Why template first: an organizer who has never drawn a chart has nothing to copy, and the blank
   * canvas was the only door this screen offered. Most real charts are one of ~4 shapes, so starting
   * from a template and adjusting is the path with the most reuse — the blank path is still there,
   * but it is no longer the path every first-timer has to walk.
   */
  const [createMode, setCreateMode] = useState<
    null | "chooser" | "template" | "duplicate" | "blank"
  >(null);
  /** The chart a duplicate starts from, once picked. */
  const [duplicateSourceId, setDuplicateSourceId] = useState("");
  /** The template a new chart starts from, once picked. */
  const [templateSourceId, setTemplateSourceId] = useState("");
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onConfirm: () => void }) | null>(null);
  /** Which chart's history is open, and what it holds. Loaded on demand — most charts never need it. */
  const [history, setHistory] = useState<{ layoutId: number; rows: LayoutRevision[] } | null>(null);
  /**
   * What a revision differs from the CURRENT chart by (§31), loaded on demand per revision.
   *
   * Against the live chart rather than against the neighbouring revision, because that is the
   * comparison the decision needs: "what will I get back if I restore this" — not "what changed at
   * the time", which is history rather than a choice.
   */
  const [diff, setDiff] = useState<{ revisionId: number; result: DocumentDiff } | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows((await layoutApi.library()).layouts);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Guarded against a late answer arriving after the library has been closed — the request outlives
    // the screen, and setting state on the way out is how a stale error ends up on the next one.
    let alive = true;
    layoutApi
      .library()
      .then((r) => {
        if (alive) setRows(r.layouts);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Every mutation is the same shape: run it, surface the refusal, re-read the truth. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const all = rows ?? [];
    if (filter === "templates") return all.filter((l) => l.isTemplate);
    if (filter === "archived") return all.filter((l) => l.status === "archived");
    return all.filter((l) => l.status !== "archived" && !l.isTemplate);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      active: all.filter((l) => l.status !== "archived" && !l.isTemplate).length,
      archived: all.filter((l) => l.status === "archived").length,
      templates: all.filter((l) => l.isTemplate).length,
    };
  }, [rows]);

  const rename = (l: LayoutLibraryEntry) => {
    const next = window.prompt("Tên sơ đồ", l.name);
    if (!next || next.trim() === l.name) return;
    void run(() => layoutApi.rename(l.id, next.trim()));
  };

  const openHistory = async (l: LayoutLibraryEntry) => {
    if (history?.layoutId === l.id) {
      setHistory(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setHistory({ layoutId: l.id, rows: (await layoutApi.revisions(l.id)).revisions });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveAsTemplate = (l: LayoutLibraryEntry) => {
    const name = window.prompt("Tên mẫu", `${l.name} (mẫu)`);
    if (!name?.trim()) return;
    void run(() => layoutApi.saveAsTemplate(l.id, name.trim()));
  };

  const duplicate = (l: LayoutLibraryEntry) =>
    void run(() =>
      // Into the SAME venue: a chart's coordinates and sections only mean anything against the venue
      // it was drawn for, so copying it elsewhere would need a conversation this button is not.
      layoutApi.clone(l.id, { targetVenueId: l.venueId, name: `${l.name} (bản sao)` }),
    );

  /**
   * Start a real chart from a template (§32, §33).
   *
   * A clone, then straight into the editor — because "use a template" is the beginning of drawing,
   * and stopping to admire a new row in a list is not what the organizer asked for.
   *
   * The copy is not itself a template, and nothing here has to make it so: `cloneLayout`'s INSERT
   * names its columns and `is_template` is not among them, so the copy takes the column default. Were
   * that to change, every chart started from a template would appear in the template tab and the tab
   * would fill with one-off venues within a week — which is what the test below pins.
   */
  // Named `startFromTemplate`, not `useTemplate`: anything beginning with `use` is a React Hook by
  // convention and by lint rule, and calling one from an onClick is an error rather than a style note.
  const startFromTemplate = (l: LayoutLibraryEntry) =>
    void run(async () => {
      const made = await layoutApi.clone(l.id, {
        targetVenueId: l.venueId,
        name: `${l.name} (từ mẫu)`,
      });
      onOpen(made.id);
      return made;
    });

  /**
   * The BLANK path: create an empty chart on the selected venue and hand it straight to the editor.
   * Still here — it is the right choice for a venue whose shape matches none of the organizer's old
   * charts — but it no longer crowds the door: the chooser offers it third, after template and copy.
   */
  const createLayout = async () => {
    const selectedVenueId = Number(venueId);
    const name = newLayoutName.trim();
    if (!selectedVenueId) {
      setError("Vui lòng chọn địa điểm cho sơ đồ.");
      return;
    }
    if (!name) {
      setError("Vui lòng nhập tên sơ đồ.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const created = await layoutApi.create(selectedVenueId, name);
      setCreateMode(null);
      onOpen(created.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  /**
   * Open the three-way "how do you want to start" chooser (§32, §33).
   *
   * Also the single place that loads the venue list — every path needs it, so loading it up front
   * (rather than per-path) means the chooser's blank option can create the moment it is picked.
   */
  const openCreateChooser = async () => {
    if (venues === null) {
      setCreating(true);
      setError(null);
      try {
        setVenues(await organizerApi.myVenues());
      } catch (e) {
        setError((e as Error).message);
        return;
      } finally {
        setCreating(false);
      }
    }
    setError(null);
    setCreateMode("chooser");
  };

  const closeCreateChooser = () => {
    setCreateMode(null);
    setDuplicateSourceId("");
    setTemplateSourceId("");
    setError(null);
  };

  /** Start a real chart from a chosen template and open it in one move (§33). */
  const createFromTemplate = async () => {
    const selectedVenueId = Number(venueId);
    const sourceId = Number(templateSourceId);
    if (!selectedVenueId) {
      setError("Vui lòng chọn địa điểm để đặt sơ đồ mới.");
      return;
    }
    if (!sourceId) {
      setError("Vui lòng chọn một mẫu.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const source = (rows ?? []).find((l) => l.id === sourceId);
      const made = await layoutApi.clone(sourceId, {
        targetVenueId: selectedVenueId,
        name: `${source?.name ?? "Mẫu"} (từ mẫu)`,
      });
      setCreateMode(null);
      onOpen(made.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  /** Duplicate one of the organizer's own charts into a (possibly different) venue. */
  const duplicateIntoVenue = async () => {
    const selectedVenueId = Number(venueId);
    const sourceId = Number(duplicateSourceId);
    if (!selectedVenueId) {
      setError("Vui lòng chọn địa điểm để đặt bản sao.");
      return;
    }
    if (!sourceId) {
      setError("Vui lòng chọn sơ đồ nguồn để nhân bản.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const source = (rows ?? []).find((l) => l.id === sourceId);
      const made = await layoutApi.clone(sourceId, {
        targetVenueId: selectedVenueId,
        name: `${source?.name ?? "Sơ đồ"} (bản sao)`,
      });
      setCreateMode(null);
      onOpen(made.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    // A section of the console, laid out like every other page — not a `fixed inset-0` takeover. The
    // overlay was inherited from the modal this replaced and was the last thing making the seat map
    // feel like a separate tool bolted on beside the app.
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 text-beige-kem">
      <OrganizerNav current="/organizer/seatmaps" />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-title-l font-black">Sơ đồ ghế</h2>
            <p className="mt-1 font-meta text-meta text-beige-kem/55">
              Sơ đồ thuộc về địa điểm — một sơ đồ có thể dùng lại cho nhiều suất chiếu.
            </p>
          </div>
          <button onClick={onClose} className={ghost}>
            ← Về trang chủ
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["active", `Đang dùng (${counts.active})`],
              ["templates", `Mẫu (${counts.templates})`],
              ["archived", `Lưu trữ (${counts.archived})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`${ghost} ${filter === key ? "bg-beige-kem/10 text-beige-kem" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className={card} aria-labelledby="create-seatmap-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="create-seatmap-heading" className="font-display text-lg font-bold">
                Tạo sơ đồ mới
              </h3>
              <p className="mt-1 font-meta text-meta text-beige-kem/55">
                Bắt đầu từ một mẫu có sẵn, nhân bản một sơ đồ đã có, hoặc vẽ từ trang trắng.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void openCreateChooser()}
              disabled={creating}
              className={primary}
            >
              {creating ? "Đang tải…" : "Bắt đầu thiết kế"}
            </button>
          </div>
        </section>

        {error && (
          <p className="border-2 border-bubblegum bg-surface-2 px-4 py-2 text-eyebrow text-on-tint">
            {error}
          </p>
        )}

        {rows === null && <p className="font-meta text-meta text-beige-kem/55">Đang tải sơ đồ…</p>}

        {rows !== null && shown.length === 0 && (
          <div className={card}>
            <p className="text-body text-beige-kem/70">
              {filter === "archived"
                ? "Chưa có sơ đồ nào được lưu trữ."
                : filter === "templates"
                  ? "Chưa có mẫu nào. Mở một sơ đồ và lưu thành mẫu để dùng lại cho địa điểm khác."
                  : "Chưa có sơ đồ nào. Tạo sơ đồ từ trang địa điểm để bắt đầu."}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {shown.map((l) => (
            <div key={l.id} className={card}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-lg font-bold">{l.name}</h3>
                <StatusPill status={l.status} />
                {l.isTemplate && (
                  <span className="border border-bubblegum px-2 py-0.5 font-meta text-[10px] text-bubblegum">
                    Mẫu
                  </span>
                )}
                {l.usageCount > 0 && (
                  <span
                    className="border border-la-co px-2 py-0.5 font-meta text-[10px] text-la-co"
                    title="Số suất chiếu đang dùng sơ đồ này"
                  >
                    {l.usageCount} suất đang dùng
                  </span>
                )}
              </div>

              <p className="mt-1 font-meta text-meta text-beige-kem/55">
                {l.venueName} · {l.seatCount} ghế · sửa lần cuối{" "}
                {new Date(l.updatedAt).toLocaleString("vi-VN", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {/*
                  On a template, STARTING A CHART is the primary action and opening it is not (§33).
                  Opening a template edits the template — which is occasionally what you want and
                  almost never what you came for, so it stays available and stops being the button
                  the eye lands on first.
                */}
                {l.isTemplate ? (
                  <>
                    <button
                      onClick={() => startFromTemplate(l)}
                      disabled={busy}
                      className={primary}
                      title="Tạo một sơ đồ mới từ mẫu này và mở ra để sửa"
                    >
                      Dùng mẫu
                    </button>
                    <button onClick={() => onOpen(l.id)} disabled={busy} className={ghost}>
                      Sửa mẫu
                    </button>
                  </>
                ) : (
                  <button onClick={() => onOpen(l.id)} className={primary}>
                    Mở
                  </button>
                )}
                <button onClick={() => rename(l)} disabled={busy} className={ghost}>
                  Đổi tên
                </button>
                <button onClick={() => duplicate(l)} disabled={busy} className={ghost}>
                  Nhân bản
                </button>
                {!l.isTemplate && (
                  <button onClick={() => saveAsTemplate(l)} disabled={busy} className={ghost}>
                    Lưu thành mẫu
                  </button>
                )}
                <button onClick={() => void openHistory(l)} disabled={busy} className={ghost}>
                  {history?.layoutId === l.id ? "Ẩn lịch sử" : "Lịch sử"}
                </button>

                {l.status === "archived" ? (
                  <button
                    onClick={() => void run(() => layoutApi.restore(l.id))}
                    disabled={busy}
                    className={ghost}
                  >
                    Khôi phục
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      setConfirm({
                        title: "Lưu trữ sơ đồ?",
                        message:
                          "Sơ đồ sẽ ẩn khỏi danh sách đang dùng và không thể gán cho suất chiếu mới. Bạn có thể khôi phục bất cứ lúc nào.",
                        confirmLabel: "Lưu trữ",
                        cancelLabel: "Huỷ",
                        tone: "normal",
                        onConfirm: () => void run(() => layoutApi.archive(l.id)),
                      })
                    }
                    // The server refuses this outright while a showtime is live, so saying so up
                    // front beats letting the click fail.
                    disabled={busy || l.usageCount > 0}
                    title={
                      l.usageCount > 0
                        ? `${l.usageCount} suất chiếu đang dùng sơ đồ này`
                        : "Ẩn khỏi danh sách đang dùng"
                    }
                    className={ghost}
                  >
                    Lưu trữ
                  </button>
                )}

                <button
                  onClick={() =>
                    setConfirm({
                      title: "Xoá sơ đồ?",
                      message: `“${l.name}” và toàn bộ ${l.seatCount} ghế của nó sẽ bị xoá vĩnh viễn. Không thể hoàn tác.`,
                      confirmLabel: "Xoá",
                      cancelLabel: "Huỷ",
                      tone: "danger",
                      onConfirm: () => void run(() => layoutApi.remove(l.id)),
                    })
                  }
                  disabled={busy || l.usageCount > 0}
                  title={
                    l.usageCount > 0
                      ? `${l.usageCount} suất chiếu đang dùng sơ đồ này`
                      : "Xoá vĩnh viễn"
                  }
                  className={`${ghost} disabled:opacity-30`}
                >
                  Xoá
                </button>
              </div>

              {history?.layoutId === l.id && (
                <div className="mt-3 border-t-2 border-beige-kem/25 pt-3">
                  {history.rows.length === 0 ? (
                    <p className="font-meta text-meta text-beige-kem/55">
                      Chưa có phiên bản nào — lịch sử được ghi mỗi lần phát hành.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {history.rows.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-meta text-meta text-beige-kem/70">
                            Bản {r.version} · {r.seatCount} ghế ·{" "}
                            {new Date(r.createdAt).toLocaleString("vi-VN", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <button
                            className={ghost}
                            disabled={busy}
                            title="Xem phiên bản này khác gì so với sơ đồ hiện tại"
                            onClick={async () => {
                              if (diff?.revisionId === r.id) {
                                setDiff(null);
                                return;
                              }
                              setBusy(true);
                              setError(null);
                              try {
                                const [old_, now] = await Promise.all([
                                  layoutApi.revisionDocument(l.id, r.id),
                                  layoutApi.get(l.id),
                                ]);
                                if (now.document) {
                                  setDiff({
                                    revisionId: r.id,
                                    result: compareDocuments(old_.document, now.document),
                                  });
                                }
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {diff?.revisionId === r.id ? "Ẩn so sánh" : "So sánh"}
                          </button>
                          <button
                            className={ghost}
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                title: "Khôi phục phiên bản này?",
                                // Said plainly because it is the surprising part: restoring is a new
                                // edit, and the server refuses it outright if it would drop a sold seat.
                                message: `Sơ đồ sẽ quay lại bản ${r.version} (${r.seatCount} ghế) và trở về trạng thái nháp — bạn cần phát hành lại. Nếu thao tác này xoá mất ghế đã bán, hệ thống sẽ từ chối.`,
                                confirmLabel: "Khôi phục",
                                cancelLabel: "Huỷ",
                                tone: "danger",
                                onConfirm: () =>
                                  void run(async () => {
                                    await layoutApi.restoreRevision(l.id, r.id);
                                    setHistory(null);
                                  }),
                              })
                            }
                          >
                            Khôi phục
                          </button>

                          {diff?.revisionId === r.id && (
                            <div className="w-full border border-beige-kem/30 p-2">
                              {diff.result.identical ? (
                                <p className="font-meta text-meta text-beige-kem/60">
                                  Không khác gì sơ đồ hiện tại — khôi phục sẽ không thay đổi gì.
                                </p>
                              ) : (
                                <ul className="space-y-0.5 font-meta text-meta text-beige-kem/70">
                                  {diff.result.seatDelta !== 0 && (
                                    <li>
                                      Ghế:{" "}
                                      <b
                                        className={
                                          diff.result.seatDelta < 0
                                            ? "text-bubblegum"
                                            : "text-la-co"
                                        }
                                      >
                                        {diff.result.seatDelta > 0 ? "+" : ""}
                                        {diff.result.seatDelta}
                                      </b>{" "}
                                      nếu khôi phục
                                    </li>
                                  )}
                                  {/* "Added" from the CURRENT chart's point of view is what a restore
                                      would REMOVE, so it is worded as the consequence, not the diff. */}
                                  {diff.result.added.length > 0 && (
                                    <li>
                                      Sẽ mất {diff.result.added.length} khối:{" "}
                                      {diff.result.added.map((b) => b.title).join(", ")}
                                    </li>
                                  )}
                                  {diff.result.removed.length > 0 && (
                                    <li>
                                      Sẽ lấy lại {diff.result.removed.length} khối:{" "}
                                      {diff.result.removed.map((b) => b.title).join(", ")}
                                    </li>
                                  )}
                                  {diff.result.changed.map((b) => (
                                    <li key={b.key}>
                                      {b.title}: {b.changes.map((c) => CHANGE_LABEL[c]).join(", ")}
                                    </li>
                                  ))}
                                  {diff.result.sectionsRemoved.length > 0 && (
                                    <li>
                                      Khu sẽ lấy lại: {diff.result.sectionsRemoved.join(", ")}
                                    </li>
                                  )}
                                  {diff.result.sectionsAdded.length > 0 && (
                                    <li>Khu sẽ mất: {diff.result.sectionsAdded.join(", ")}</li>
                                  )}
                                </ul>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Template-first creation (§32, §33). A chooser first — start from a template, duplicate an
          existing chart, or go blank — instead of the bare venue/name form. Templates are the path
          most first-time charts should take, so it is offered first; the blank path is still one
          click away. Each sub-mode is its own simple form, rendered from the `createMode` state. */}
      {createMode !== null && venues !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeCreateChooser}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto border-2 border-beige-kem bg-xanh-pho p-6 text-beige-kem"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-title-m font-black">
                {createMode === "chooser"
                  ? "Tạo sơ đồ mới"
                  : createMode === "template"
                    ? "Bắt đầu từ mẫu"
                    : createMode === "duplicate"
                      ? "Nhân bản sơ đồ có sẵn"
                      : "Vẽ từ trang trắng"}
              </h3>
              <button onClick={closeCreateChooser} className={ghost}>
                Đóng
              </button>
            </div>

            {venues.length === 0 ? (
              <p className="mt-4 text-body text-cam-dat">
                Bạn chưa có địa điểm nào. Hãy tạo địa điểm (bằng cách tạo một sự kiện) trước khi
                thiết kế sơ đồ.
              </p>
            ) : createMode === "chooser" ? (
              <div className="mt-4 space-y-3">
                <button
                  className="block w-full border-2 border-beige-kem bg-surface-2 p-4 text-left transition hover:border-burgundy"
                  onClick={() => setCreateMode("template")}
                  disabled={busy}
                >
                  <p className="font-display text-base font-bold">Bắt đầu từ một mẫu</p>
                  <p className="mt-1 font-meta text-meta text-beige-kem/55">
                    Lấy một mẫu có sẵn, rồi chỉnh lại cho đúng. Nhanh nhất cho lần đầu.
                  </p>
                </button>
                <button
                  className="block w-full border-2 border-beige-kem bg-surface-2 p-4 text-left transition hover:border-burgundy"
                  onClick={() => setCreateMode("duplicate")}
                  disabled={busy}
                >
                  <p className="font-display text-base font-bold">Nhân bản một sơ đồ đã có</p>
                  <p className="mt-1 font-meta text-meta text-beige-kem/55">
                    Sao chép một sơ đồ bạn đã vẽ, rồi sửa lại.
                  </p>
                </button>
                <button
                  className="block w-full border-2 border-beige-kem bg-surface-2 p-4 text-left transition hover:border-burgundy"
                  onClick={() => setCreateMode("blank")}
                  disabled={busy}
                >
                  <p className="font-display text-base font-bold">Vẽ từ trang trắng</p>
                  <p className="mt-1 font-meta text-meta text-beige-kem/55">
                    Mở trình thiết kế với một sơ đồ trống.
                  </p>
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {/* Shared: which venue the new chart belongs to. */}
                <label className="block">
                  <span className="mb-1 block font-meta text-[11px] text-beige-kem/70">
                    Địa điểm
                  </span>
                  <select
                    value={venueId}
                    onChange={(e) => setVenueId(e.target.value)}
                    disabled={creating}
                    className="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow text-beige-kem outline-none focus:border-burgundy"
                  >
                    <option value="" className="bg-xanh-pho">
                      Chọn địa điểm
                    </option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id} className="bg-xanh-pho">
                        {venue.name} · {venue.city}
                      </option>
                    ))}
                  </select>
                </label>

                {createMode === "template" && (
                  <label className="block">
                    <span className="mb-1 block font-meta text-[11px] text-beige-kem/70">Mẫu</span>
                    <select
                      value={templateSourceId}
                      onChange={(e) => setTemplateSourceId(e.target.value)}
                      disabled={creating}
                      className="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow text-beige-kem outline-none focus:border-burgundy"
                    >
                      <option value="" className="bg-xanh-pho">
                        Chọn mẫu
                      </option>
                      {(rows ?? [])
                        .filter((l) => l.isTemplate)
                        .map((t) => (
                          <option key={t.id} value={t.id} className="bg-xanh-pho">
                            {t.name} · {t.seatCount} ghế
                          </option>
                        ))}
                    </select>
                    {(rows ?? []).filter((l) => l.isTemplate).length === 0 && (
                      <p className="mt-2 font-meta text-meta text-cam-dat">
                        Chưa có mẫu nào. Mở một sơ đồ, rồi dùng "Lưu thành mẫu" để tạo.
                      </p>
                    )}
                  </label>
                )}

                {createMode === "duplicate" && (
                  <label className="block">
                    <span className="mb-1 block font-meta text-[11px] text-beige-kem/70">
                      Sơ đồ nguồn
                    </span>
                    <select
                      value={duplicateSourceId}
                      onChange={(e) => setDuplicateSourceId(e.target.value)}
                      disabled={creating}
                      className="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow text-beige-kem outline-none focus:border-burgundy"
                    >
                      <option value="" className="bg-xanh-pho">
                        Chọn sơ đồ
                      </option>
                      {(rows ?? [])
                        .filter((l) => l.status !== "archived")
                        .map((l) => (
                          <option key={l.id} value={l.id} className="bg-xanh-pho">
                            {l.name} · {l.venueName} · {l.seatCount} ghế
                          </option>
                        ))}
                    </select>
                    {(rows ?? []).filter((l) => l.status !== "archived").length === 0 && (
                      <p className="mt-2 font-meta text-meta text-cam-dat">
                        Chưa có sơ đồ nào để nhân bản.
                      </p>
                    )}
                  </label>
                )}

                {createMode === "blank" && (
                  <label className="block">
                    <span className="mb-1 block font-meta text-[11px] text-beige-kem/70">
                      Tên sơ đồ
                    </span>
                    <input
                      value={newLayoutName}
                      onChange={(e) => setNewLayoutName(e.target.value)}
                      maxLength={120}
                      disabled={creating}
                      placeholder="Tên sơ đồ, ví dụ: Khán phòng chính"
                      className="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow text-beige-kem outline-none focus:border-burgundy"
                    />
                  </label>
                )}

                {error && (
                  <p className="border-2 border-bubblegum bg-surface-2 px-3 py-2 text-eyebrow text-on-tint">
                    {error}
                  </p>
                )}

                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                  <button onClick={closeCreateChooser} disabled={creating} className={ghost}>
                    Huỷ
                  </button>
                  <button
                    disabled={creating}
                    className={primary}
                    onClick={() =>
                      createMode === "template"
                        ? void createFromTemplate()
                        : createMode === "duplicate"
                          ? void duplicateIntoVenue()
                          : void createLayout()
                    }
                  >
                    {creating
                      ? "Đang tạo…"
                      : createMode === "template"
                        ? "Dùng mẫu này"
                        : createMode === "duplicate"
                          ? "Nhân bản"
                          : "Tạo và mở"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onConfirm={() => {
            const go = confirm.onConfirm;
            setConfirm(null);
            go();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
