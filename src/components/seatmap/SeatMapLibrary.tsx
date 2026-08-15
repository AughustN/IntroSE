/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LayoutLibraryEntry, LayoutRevision } from "@/shared/catalog/seatmap";
import { layoutApi } from "../../services/catalogClient";
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
  const label = status === "ready" ? "Đã phát hành" : status === "archived" ? "Lưu trữ" : "Bản nháp";
  return (
    <span className={`border px-2 py-0.5 font-meta text-[10px] ${style}`}>{label}</span>
  );
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

        {error && (
          <p className="border-2 border-bubblegum bg-surface-2 px-4 py-2 text-eyebrow text-on-tint">
            {error}
          </p>
        )}

        {rows === null && (
          <p className="font-meta text-meta text-beige-kem/55">Đang tải sơ đồ…</p>
        )}

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
                                  setDiff({ revisionId: r.id, result: compareDocuments(old_.document, now.document) });
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
                                      <b className={diff.result.seatDelta < 0 ? "text-bubblegum" : "text-la-co"}>
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
                                    <li>Khu sẽ lấy lại: {diff.result.sectionsRemoved.join(", ")}</li>
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
