/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import type { ChartDocument, DocumentBlock } from "@/shared/catalog/seatmap-document";
import { isSeatBearing } from "@/shared/catalog/seatmap-document";
import { BLOCK_LABEL } from "./documentOps";
import { rowLabelsOf } from "./rowOps";

import { RAIL_PANEL } from "./panelSurface";
/**
 * The chart's structure as a tree, and the search over it (§5, §36).
 *
 * The canvas answers "where is it"; this answers "what is there". Both questions come up constantly
 * and only one of them had a surface: finding the one block among forty that had no price class meant
 * clicking around the canvas until the inspector said so.
 *
 * Venue → Section → Block → Row. Seats are deliberately NOT a level: a chart may hold 2,000 of them,
 * a tree node each would be 2,000 DOM nodes competing with the canvas that already draws them, and a
 * seat is reachable by clicking it or through the validation list. Rows are the useful bottom.
 *
 * Search filters the tree rather than replacing it with a result list, so a hit is shown in the place
 * it actually lives — which is most of what the organizer wanted to know.
 */

const ICON: Record<string, string> = {
  "seating-block": "▦",
  "single-row": "▭",
  "curved-row": "◠",
  "individual-seat": "•",
  table: "▤",
  "ga-zone": "▩",
  stage: "▬",
  aisle: "║",
  door: "⌸",
  bar: "▤",
  text: "T",
  shape: "⬡",
};

const chip =
  " px-1 font-mono text-[10px] leading-4 text-beige-kem/70 transition hover:text-beige-kem";

export default function LayersPanel({
  doc,
  selected,
  selectedRowKey,
  onSelectBlock,
  onSelectRow,
  onToggleLock,
  onToggleHidden,
}: {
  doc: ChartDocument;
  selected: ReadonlySet<string>;
  selectedRowKey: string | null;
  onSelectBlock: (key: string, additive: boolean) => void;
  onSelectRow: (blockKey: string, sectionName: string | null, label: string) => void;
  onToggleLock: (key: string, locked: boolean) => void;
  onToggleHidden: (key: string, hidden: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const nameOfSection = useMemo(
    () => new Map(doc.sections.map((s) => [s.id, s.name])),
    [doc.sections],
  );

  /** Blocks grouped under their section, with the section-less ones last under their own heading. */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (b: DocumentBlock) => {
      if (!q) return true;
      const sectionName = b.sectionId === null ? "" : (nameOfSection.get(b.sectionId) ?? "");
      const haystack = [b.title, BLOCK_LABEL[b.kind], sectionName, ...rowLabelsOf(b)]
        .join(" ")
        .toLowerCase();
      // A bare seat number is a common thing to search for; the row labels above cover "B", and the
      // seat numbers themselves are cheap to include for a block of any realistic size.
      return (
        haystack.includes(q) ||
        (b.seats ?? []).some((s) => `${s.rowLabel}${s.seatNumber}`.toLowerCase() === q)
      );
    };

    const bySection = new Map<number | null, DocumentBlock[]>();
    for (const b of doc.blocks) {
      if (!matches(b)) continue;
      const list = bySection.get(b.sectionId) ?? [];
      list.push(b);
      bySection.set(b.sectionId, list);
    }
    return [...bySection.entries()].sort((a, x) => {
      // Section-less last: it is a draft state, not a place, and it reads better at the bottom.
      if (a[0] === null) return 1;
      if (x[0] === null) return -1;
      return (nameOfSection.get(a[0]) ?? "").localeCompare(nameOfSection.get(x[0]) ?? "");
    });
  }, [doc.blocks, query, nameOfSection]);

  const total = doc.blocks.length;
  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className={RAIL_PANEL}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          Cấu trúc
        </h3>
        <span aria-live="polite" className="font-mono text-[10px] text-beige-kem/70">
          {query ? `${shown}/${total}` : `${total} khối`}
        </span>
      </div>

      <div className="relative mt-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = groups[0]?.[1][0];
            if (e.key === "Enter" && first) onSelectBlock(first.key, false);
            if (e.key === "Escape") setQuery("");
          }}
          aria-label="Tìm trong cấu trúc sơ đồ"
          placeholder="Tìm khu, khối, hàng, ghế (VD B12)"
          className="h-8 w-full border-2 border-beige-kem/40 bg-surface-2 px-2 pr-8 text-[11px] text-beige-kem outline-none focus:border-burgundy"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Xoá nội dung tìm kiếm"
            className="absolute right-0 top-0 grid h-8 w-8 place-items-center font-mono text-xs text-beige-kem/70 hover:text-beige-kem"
          >
            ×
          </button>
        )}
      </div>

      {query && shown > 0 && (
        <p className="mt-1 font-mono text-[9px] text-beige-kem/60">
          Enter để chọn và vừa khung kết quả đầu tiên
        </p>
      )}

      {total === 0 && (
        <p className="mt-3 text-[11px] leading-4 text-beige-kem/70">
          Sơ đồ trống. Thêm khối đầu tiên từ bảng bên dưới.
        </p>
      )}
      {total > 0 && shown === 0 && (
        <p className="mt-3 text-[11px] leading-4 text-beige-kem/70">Không tìm thấy gì khớp.</p>
      )}

      <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {groups.map(([sectionId, blocks]) => {
          const sectionName = sectionId === null ? null : (nameOfSection.get(sectionId) ?? null);
          return (
            <div key={sectionId ?? "none"}>
              <p className="font-mono text-[10px] uppercase tracking-wider text-beige-kem/70">
                {sectionName ?? "Chưa thuộc khu nào"}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {blocks.map((b) => {
                  const rows = isSeatBearing(b.kind) ? rowLabelsOf(b) : [];
                  const expanded = open.has(b.key) || (query.trim().length > 0 && rows.length > 0);
                  return (
                    <li key={b.key}>
                      <div
                        className={`flex items-center gap-1 px-1 py-0.5 ${
                          selected.has(b.key) ? "bg-burgundy/25" : "hover:bg-beige-kem/10"
                        }`}
                      >
                        <button
                          type="button"
                          disabled={rows.length === 0}
                          onClick={() =>
                            setOpen((cur) => {
                              const next = new Set(cur);
                              if (next.has(b.key)) next.delete(b.key);
                              else next.add(b.key);
                              return next;
                            })
                          }
                          className="w-3 shrink-0 font-mono text-[10px] text-beige-kem/70 disabled:opacity-0"
                          aria-label={expanded ? "Thu gọn" : "Mở rộng"}
                        >
                          {expanded ? "▾" : "▸"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => onSelectBlock(b.key, e.shiftKey)}
                          className={`min-w-0 flex-1 truncate text-left text-[11px] ${
                            b.hidden ? "text-beige-kem/70 line-through" : "text-beige-kem/85"
                          }`}
                          title={`${BLOCK_LABEL[b.kind]} — bấm để chọn và vừa khung`}
                        >
                          <span aria-hidden="true" className="mr-1 text-beige-kem/70">
                            {ICON[b.kind] ?? "◇"}
                          </span>
                          {b.title}
                          {rows.length > 0 && (
                            <span className="ml-1 text-beige-kem/70">({b.seats?.length ?? 0})</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleHidden(b.key, !b.hidden)}
                          className={chip}
                          title={b.hidden ? "Hiện khối này" : "Ẩn khối này khỏi canvas"}
                          aria-pressed={!!b.hidden}
                        >
                          {b.hidden ? "Hiện" : "Ẩn"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleLock(b.key, !b.locked)}
                          className={chip}
                          title={b.locked ? "Mở khoá" : "Khoá khối này"}
                          aria-pressed={!!b.locked}
                        >
                          {b.locked ? "Mở" : "Khoá"}
                        </button>
                      </div>

                      {expanded && rows.length > 0 && (
                        <ul className="ml-4 mt-0.5 flex flex-wrap gap-0.5">
                          {rows.map((label) => {
                            const key = `${sectionName ?? ""}|${label}`;
                            return (
                              <li key={label}>
                                <button
                                  type="button"
                                  onClick={() => onSelectRow(b.key, sectionName, label)}
                                  className={`border px-1 font-mono text-[10px] transition ${
                                    selectedRowKey === key
                                      ? "border-burgundy bg-burgundy/25 text-beige-kem"
                                      : "border-beige-kem/30 text-beige-kem/70 hover:border-beige-kem"
                                  }`}
                                  title={`Hàng ${label}`}
                                >
                                  {label}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
