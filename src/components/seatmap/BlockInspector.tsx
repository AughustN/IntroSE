/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import type {
  BlockParams,
  DocumentBlock,
  RowLabelScheme,
  SeatLabelScheme,
} from "@/shared/catalog/seatmap-document";
import { isSeatBearing } from "@/shared/catalog/seatmap-document";
import { type BlockGeometry, BLOCK_LABEL } from "./documentOps";
import { MAX_ARC_ANGLE } from "@/shared/catalog/seatmap-document";
import Select from "../Select";
import { SEAT_PITCH } from "./layoutOps";

import { RAIL_PANEL } from "./panelSurface";
/**
 * The block inspector — the reason the editor moved to a document at all.
 *
 * Before this, a row of seats was drawn once and then existed only as coordinates: "6 rows of 18,
 * lettered A upward" was gone the instant the drag ended, so changing it to 20 per row meant deleting
 * the block and drawing it again — losing every seat's identity, and with it any ticket already sold
 * against one. Here those numbers ARE the block, so changing one is an edit: `regenerateBlock` keeps
 * the database row of every seat whose label survives.
 *
 * Two things the reference version of this panel had that are deliberately absent:
 *
 *   * **a price per category.** Price belongs to `ticket_tiers`, per showtime, so one chart can sell at
 *     different prices on different nights. A price here would be a second number that no sale reads.
 *   * **canvas width and height.** The layout space is fixed at 0–10000; a per-chart canvas size would
 *     mean every reader had to scale, and two charts could not be compared or cloned.
 *
 * Section and seat-class assignment are also deliberately absent. They act on blocks or individually
 * selected seats and therefore live in their dedicated workspace modes; repeating them here would
 * create two controls with different visible subjects for the same persisted fields.
 */

const input =
  "h-8 w-full border-2 border-beige-kem bg-surface-2 px-2 text-xs text-beige-kem outline-none focus:border-burgundy";
const label = "block font-mono text-[11px] text-beige-kem/70";
const btn =
  " border-2 border-beige-kem px-2 py-1 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
/** The ‹ › ends of a `CommittedNumber`. Narrow on purpose: the number is the control, these are its grips. */
const stepBtn =
  "w-6 shrink-0 select-none text-sm leading-none text-beige-kem/70 transition hover:bg-beige-kem/10 hover:text-beige-kem disabled:opacity-25 disabled:hover:bg-transparent";

/**
 * One named concern in the inspector.
 *
 * The panel used to head only SOME of its groups — "Bố cục" and "Cách đánh nhãn" had titles while
 * section, class, size and the actions were bare fields separated by nothing but a margin. So the
 * reader could not tell where a group ended, and the two headings that did exist read as sub-parts of
 * whatever came before them. Every concern gets the same treatment or the treatment means nothing.
 */
/**
 * What a raw layout number MEANS, in the vocabulary the editor already speaks.
 *
 * Spacing and radius are stored in layout units, and the field showed the bare number: "150" told an
 * organizer nothing about whether that was wide, narrow, pixels or seats. seats.io puts the unit
 * inside the field for exactly this reason — its spacing reads `4 pt`, its rotation `116 °`.
 *
 * The unit here is the SEAT PITCH, because that is the one the editor's own grid control already
 * names ("Lưới · 0,3 khoảng ghế"). Two vocabularies for one distance would be worse than none.
 */
function pitchHint(units: number): string {
  const pitches = units / SEAT_PITCH;
  return `≈ ${Number(pitches.toFixed(1)).toLocaleString("vi-VN")} khoảng ghế`;
}

/** A number field with its unit beside it — the value and what the value means, together. */
function Measured({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <>
      {children}
      <span className="mt-0.5 block font-mono text-[10px] text-beige-kem/55">{hint}</span>
    </>
  );
}

function Group({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  /** A control that belongs to the whole group — a lock, a "manage" link. Sits on the heading row. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-3 border-t border-beige-kem/25 pt-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-beige-kem/70">
          {title}
        </p>
        {action}
      </div>
      {children}
    </section>
  );
}

const ROW_SCHEMES: { value: RowLabelScheme; label: string }[] = [
  { value: "alpha-asc", label: "A, B, C… (từ đầu)" },
  { value: "alpha-desc", label: "…C, B, A (từ cuối)" },
  { value: "num-asc", label: "1, 2, 3… (từ đầu)" },
  { value: "num-desc", label: "…3, 2, 1 (từ cuối)" },
];

const SEAT_SCHEMES: { value: SeatLabelScheme; label: string }[] = [
  { value: "num-asc", label: "1, 2, 3…" },
  { value: "num-desc", label: "…3, 2, 1" },
  { value: "odd", label: "1, 3, 5… (số lẻ)" },
  { value: "even", label: "2, 4, 6… (số chẵn)" },
];

/** Parse a numeric field without letting a half-typed value wipe the block. */
/**
 * A number field that commits when you finish, not on every keystroke.
 *
 * Each commit regenerates the block's seats, re-projects the chart and revalidates it, so typing "120"
 * used to build the block three times — at 1, then 12, then 120 seats per row. The two intermediate
 * charts are pure waste, and on a large block they are the biggest of the three.
 *
 * Commits on blur and on Enter; Escape abandons the edit. Arrow keys step by one and commit
 * immediately, because nudging a value is meant to feel live.
 *
 * The ‹ › buttons are an AFFORDANCE, not a new capability. Every behaviour a stepper exists to give
 * was already here — arrow keys stepped, blank input fell back, a fraction was rounded — but it was
 * all invisible, so the field read as free text and an organizer nudging "seats per row" by one
 * selected the number and retyped it. The designer teardown recorded exactly this: sound, and
 * undiscoverable. The buttons carry `tabIndex={-1}` so they never come between the field and the next
 * one on a Tab pass; the keyboard path is still the arrow keys.
 */
function CommittedNumber({
  value,
  onCommit,
  onDraft,
  className,
  title,
}: {
  value: number;
  onCommit: (next: number) => void;
  /** Every keystroke's parsed value (or null while blank) — lets a parent preview what the commit
   *  WILL become, without committing on every keystroke. */
  onDraft?: (draft: number | null) => void;
  className: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // While the field is not being edited it mirrors the block, so an undo or a regeneration elsewhere
  // shows up here instead of leaving a stale number on screen.
  const shown = editing ? draft : String(value);

  const setEditingValue = (raw: string) => {
    setDraft(raw);
    const parsed = Number(raw);
    onDraft?.(Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null);
  };

  const commit = (raw: string) => {
    setEditing(false);
    onDraft?.(null);
    const next = num(raw, value);
    if (next !== value) onCommit(next);
  };

  /** Same floor the arrow keys have always used: one, never zero — a block of nothing is not a block. */
  const step = (delta: number) => {
    const next = Math.max(1, value + delta);
    setDraft(String(next));
    onDraft?.(null);
    if (next !== value) onCommit(next);
  };

  return (
    // The caller's class dresses the WRAPPER, so the border and height it asks for land around the
    // whole control rather than around the input alone — `focus-within` then lights the same edge
    // `focus` used to.
    <span className={`${className} flex items-stretch p-0 focus-within:border-burgundy`}>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => step(-1)}
        disabled={value <= 1}
        className={stepBtn}
      >
        ‹
      </button>
      <input
        value={shown}
        inputMode="numeric"
        title={title}
        className="min-w-0 flex-1 border-0 bg-transparent px-1 text-center text-xs text-beige-kem outline-none"
        onFocus={() => {
          setDraft(String(value));
          setEditing(true);
          onDraft?.(value);
        }}
        onChange={(e) => setEditingValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            onDraft?.(null);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            step(e.key === "ArrowUp" ? 1 : -1);
          }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => step(1)}
        className={stepBtn}
      >
        ›
      </button>
    </span>
  );
}

/** The palette a drawn outline may take. Same family as the price classes, so a chart reads as one set. */

const num = (raw: string, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

export default function BlockInspector({
  block,
  mode = "all",
  seatBudget,
  onChange,
  onParams,
  onRotate,
  onGeometry,
}: {
  block: DocumentBlock | null;
  /** Label mode reuses the same mutation path while hiding unrelated geometry controls. */
  mode?: "all" | "labels";
  /** Seats still available before the layout ceiling — shown so a clip is never a surprise. */
  seatBudget: number;
  onChange: (patch: Partial<DocumentBlock>) => void;
  onParams: (patch: Partial<BlockParams>) => void;
  onRotate: (degrees: number) => void;
  /** Regenerate the outline as a named shape. `free` is not offered — a hand-drawn polygon is what a
   *  shape BECOMES when its points are dragged, not something to pick. */
  onGeometry?: (geometry: Exclude<BlockGeometry, "free">) => void;
}) {
  /*
   * Which block the labelling unlock applies to, as a KEY rather than a boolean.
   *
   * Derived, not reset by an effect: unlocking is a decision about the block in front of you, so
   * selecting another one has to hand the protection straight back. Storing a boolean and clearing it
   * in an effect would do the same thing a render later — and would trip the cascading-render rule
   * the editor already learned about elsewhere.
   *
   * Hoisted above the null-block early return with the other hooks, for the reason stated below.
   */
  const [unlockedFor, setUnlockedFor] = useState<string | null>(null);

  /**
   * What the block WOULD become, shown while typing, not after — hooks hoisted ABOVE the null-block
   * early return, because a conditional hook call on `block == null` would break the rules of hooks
   * the first time the selection flipped from nothing to a block.
   *
   * `CommittedNumber` commits on blur precisely because each commit regenerates the whole block —
   * but the organizer does not know that typing "60" into a 20-per-row field is about to mint more
   * seats than the layout can hold. Lifting the two count fields' in-progress values up here lets
   * the inspector print the arithmetic live (`6 hàng × 20 ghế → 120 ghế`) and shout about the clip
   * BEFORE the commit, when it is still a decision instead of a surprise.
   */
  const [pending, setPending] = useState<{
    key: string | undefined;
    rows: number | null;
    perRow: number | null;
  }>({ key: undefined, rows: null, perRow: null });
  // Adjusting state during render, React's own pattern for "props changed, discard local": a new block
  // throws away whatever was half-typed in the old one. Done here rather than in an effect so the
  // preview can never paint one frame of the previous block's arithmetic.
  if (pending.key !== block?.key) {
    setPending({ key: block?.key, rows: null, perRow: null });
  }
  const setPendingRows = (rows: number | null) => setPending((p) => ({ ...p, rows }));
  const setPendingPerRow = (perRow: number | null) => setPending((p) => ({ ...p, perRow }));

  if (!block) {
    return (
      <div className="border-2 border-beige-kem/40 bg-surface-2 p-4">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          Thuộc tính
        </h3>
      </div>
    );
  }

  const labelsUnlocked = unlockedFor === block.key;
  const p = block.params;
  const seats = block.seats?.length ?? 0;
  const parametric = p !== undefined && isSeatBearing(block.kind);
  const rows = p?.rowsCount ?? 1;
  const perRow = p?.seatsPerRow ?? 1;

  const nextRows = pending.rows ?? rows;
  const nextPerRow = pending.perRow ?? perRow;
  const prospectiveCount = nextRows * nextPerRow;
  const wouldClip = parametric && prospectiveCount > seats + seatBudget;
  const hasEditableCaption = ["stage", "text", "exit", "ga-zone"].includes(block.kind);

  return (
    <div className={RAIL_PANEL}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          {BLOCK_LABEL[block.kind]}
        </h3>
        <span className="font-mono text-[10px] text-beige-kem/70">{seats} ghế</span>
      </div>

      {mode === "labels" && !parametric && !hasEditableCaption && (
        <p className="mt-3 border border-beige-kem/30 p-3 text-[11px] leading-4 text-beige-kem/70">
          Phần tử này không có nhãn bên trong. Thêm một khối văn bản riêng nếu cần chú thích trên sơ
          đồ.
        </p>
      )}

      {/* Identity stays with object editing; section and category assignment live in dedicated modes. */}
      {mode === "all" && (
        <Group title="Nhận dạng">
          <label className={`${label} mt-2`}>
            Tên khối
            <input
              value={block.title}
              onChange={(e) => onChange({ title: e.target.value.slice(0, 80) })}
              className={`mt-1 ${input}`}
            />
          </label>
        </Group>
      )}

      {/* ---- The parametric controls ---- */}
      {mode === "all" &&
        (parametric ? (
          <Group title="Bố cục">
            <div className="mt-2 grid grid-cols-2 gap-2">
              {block.kind !== "single-row" && block.kind !== "individual-seat" && (
                <label className={label}>
                  Số hàng
                  <CommittedNumber
                    value={rows}
                    onCommit={(rowsCount) => onParams({ rowsCount })}
                    onDraft={setPendingRows}
                    className={`mt-1 ${input}`}
                  />
                </label>
              )}
              {block.kind !== "individual-seat" && (
                <label className={label}>
                  Ghế mỗi hàng
                  <CommittedNumber
                    value={perRow}
                    onCommit={(seatsPerRow) => onParams({ seatsPerRow })}
                    onDraft={setPendingPerRow}
                    className={`mt-1 ${input}`}
                  />
                </label>
              )}
            </div>

            {/* The arithmetic, live: the count the commit WILL produce, restated next to the fields
              that drive it. It duplicates the header's seat total only while nothing is being
              edited — but pinning it mid-edit meant an organizer had to START typing to learn what
              the two numbers mean together, which is exactly when confirmation matters. */}
            {parametric && block.kind !== "individual-seat" && (
              <p
                className={`mt-2 font-mono text-[10px] leading-4 ${
                  wouldClip ? "text-cam-dat-ink" : "text-beige-kem/70"
                }`}
              >
                {nextRows} hàng × {nextPerRow} ghế → {prospectiveCount} ghế
              </p>
            )}

            {wouldClip && (
              <p className="mt-1 text-[10px] leading-4 text-cam-dat-ink">
                Chỉ còn {seatBudget} ghế trong hạn mức của sơ đồ — phần vượt sẽ bị cắt bỏ.
              </p>
            )}

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className={label}>
                Khoảng cách ghế
                <Measured hint={pitchHint(p.seatSpacing ?? 150)}>
                  <CommittedNumber
                    value={p.seatSpacing ?? 150}
                    onCommit={(seatSpacing) => onParams({ seatSpacing })}
                    className={`mt-1 ${input}`}
                  />
                </Measured>
              </label>
              <label className={label}>
                Khoảng cách hàng
                <Measured hint={pitchHint(p.rowSpacing ?? 150)}>
                  <CommittedNumber
                    value={p.rowSpacing ?? 150}
                    onCommit={(rowSpacing) => onParams({ rowSpacing })}
                    className={`mt-1 ${input}`}
                  />
                </Measured>
              </label>
            </div>

            {block.kind === "curved-row" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className={label}>
                  Bán kính
                  <Measured hint={pitchHint(p.radius ?? 1500)}>
                    <CommittedNumber
                      value={p.radius ?? 1500}
                      onCommit={(radius) => onParams({ radius })}
                      className={`mt-1 ${input}`}
                    />
                  </Measured>
                </label>
                <label className={label}>
                  Góc cung ({p.arcAngle ?? 90}°)
                  <input
                    type="range"
                    min={30}
                    max={MAX_ARC_ANGLE}
                    step={5}
                    value={p.arcAngle ?? 90}
                    onChange={(e) => onParams({ arcAngle: Number(e.target.value) })}
                    className="mt-1 w-full accent-burgundy"
                  />
                </label>
              </div>
            )}
          </Group>
        ) : (
          isSeatBearing(block.kind) && (
            <p className="mt-3 border-t border-beige-kem/25 pt-3 text-[11px] leading-4 text-beige-kem/70">
              Khối này được vẽ trước khi sơ đồ có bố cục tham số, nên các ghế đang ở vị trí riêng
              lẻ. Đặt số hàng và số ghế để chuyển thành khối tham số — lưu ý việc này sẽ đánh nhãn
              lại toàn bộ ghế trong khối.
            </p>
          )
        ))}

      {/* Labelling is its OWN concern, not a tail of the layout. It was a bare paragraph inside the
          "Bố cục" section, so three dropdowns that relabel every seat in the block read as more
          geometry — the two groups answer different questions and now say so. */}
      {parametric && (
        <Group
          title="Cách đánh nhãn"
          action={
            <button
              type="button"
              onClick={() => setUnlockedFor((cur) => (cur === block.key ? null : block.key))}
              aria-pressed={labelsUnlocked}
              className={`flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px] font-bold transition ${
                labelsUnlocked
                  ? "border-cam-dat/60 bg-cam-dat/20 text-cam-dat-ink"
                  : "border-beige-kem/40 text-beige-kem/70 hover:border-beige-kem"
              }`}
            >
              {labelsUnlocked ? <Unlock size={11} /> : <Lock size={11} />}
              {labelsUnlocked ? "Đang mở" : "Mở khoá"}
            </button>
          }
        >
          {/*
            LOCKED by default, which is the one thing the old paragraph could not do.
            
            A seat's label is what a buyer's ticket says, and the save path REFUSES to relabel a seat
            that is already sold. The warning was accurate and still let an organizer change three
            dropdowns, watch every seat in the block relabel on the canvas, and only meet the refusal
            at save time — with no obvious way back to the labels that had been there.

            seats.io locks its Row labeling and Seat labeling groups behind an explicit Unlock for
            exactly this. Making the gesture deliberate turns a late refusal into an early decision.
          */}
          {/* A consequence, not a description — the lock is what explains itself, so this is one line. */}
          <p className="mt-1 text-[10px] leading-4 text-beige-kem/70">
            {labelsUnlocked ? "Sẽ đổi nhãn cả khối. Ghế đã bán bị từ chối." : "Nhãn in trên vé."}
          </p>

          <label className={`${label} mt-2`}>
            Nhãn hàng
            <div className="mt-1">
              <Select
                value={p.rowLabelScheme ?? "alpha-asc"}
                options={ROW_SCHEMES}
                disabled={!labelsUnlocked}
                onChange={(v) => onParams({ rowLabelScheme: v as RowLabelScheme })}
                triggerClassName={`${input} ${labelsUnlocked ? "" : "opacity-45"}`}
              />
            </div>
          </label>

          <label className={`${label} mt-2`}>
            Số ghế
            <div className="mt-1">
              <Select
                value={p.seatLabelScheme ?? "num-asc"}
                options={SEAT_SCHEMES}
                disabled={!labelsUnlocked}
                onChange={(v) => onParams({ seatLabelScheme: v as SeatLabelScheme })}
                triggerClassName={`${input} ${labelsUnlocked ? "" : "opacity-45"}`}
              />
            </div>
          </label>

          <label className={`${label} mt-2`}>
            Tiền tố hàng (VD “L-”)
            <input
              value={p.rowLabelPrefix ?? ""}
              maxLength={8}
              disabled={!labelsUnlocked}
              onChange={(e) => onParams({ rowLabelPrefix: e.target.value })}
              className={`mt-1 ${input} ${labelsUnlocked ? "" : "opacity-45"}`}
            />
          </label>
        </Group>
      )}

      {/* ---- Capacity zone (0027) ---- */}
      {mode === "all" && block.kind === "ga-zone" && (
        <Group title="Sức chứa">
          <label className={label}>
            Sức chứa (người)
            <CommittedNumber
              value={block.capacity ?? 0}
              onCommit={(capacity) => onChange({ capacity })}
              className={`mt-1 ${input}`}
            />
            <span className="mt-1 block text-[10px] leading-4 text-beige-kem/70">
              Bán theo số lượng, không theo từng chỗ — khu này không tạo ghế nào.
            </span>
          </label>
          {block.categoryId === null && (
            // The zone is drawn but unsellable until it names a seat class, and the publish gate will
            // say so. Saying it here means the organizer finds out while looking at the zone.
            <p className="mt-2 border border-burgundy-ink px-2 py-1 text-[10px] leading-4 text-burgundy-ink">
              Chưa có hạng ghế — chọn một hạng ở bảng “Hạng ghế” để bán được khu này.
            </p>
          )}
        </Group>
      )}

      {/* ---- Drawn shape: which shape it is. Colour lives in the palette, with the blocks it
             applies to — every block kind can take one, not just this one. ---- */}
      {mode === "all" && block.kind === "shape" && (
        <Group title="Hình dạng">
          <div className="mt-2 grid grid-cols-3 gap-1">
            {(
              [
                ["rect", "▭", "Chữ nhật"],
                ["square", "◻", "Vuông"],
                ["circle", "◯", "Tròn"],
                ["oval", "⬭", "Bầu dục"],
                ["triangle", "△", "Tam giác"],
                ["hexagon", "⬡", "Lục giác"],
              ] as const
            ).map(([geometry, glyph, name]) => (
              <button
                key={geometry}
                title={name}
                aria-pressed={block.geometry === geometry}
                onClick={() => onGeometry?.(geometry)}
                className={`border-2 px-2 py-1.5 text-sm transition ${
                  block.geometry === geometry
                    ? "border-beige-kem bg-beige-kem/10 text-beige-kem"
                    : "border-beige-kem/40 text-beige-kem/70 hover:border-beige-kem"
                }`}
              >
                {glyph}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-beige-kem/70">
            {block.geometry
              ? "Kéo các điểm trên sơ đồ để chỉnh lại — hình sẽ thành tự do."
              : "Hình tự do: kéo từng điểm trên sơ đồ để sửa."}
          </p>
        </Group>
      )}

      {/* ---- Decoration text ---- */}
      {/* A shape deliberately has no embedded text. Add a separate text block when the floor plan
          needs a caption, so resizing the polygon never leaves its caption behind. */}
      {(block.kind === "stage" ||
        block.kind === "text" ||
        block.kind === "exit" ||
        block.kind === "ga-zone") && (
        <Group title="Chữ hiển thị">
          <input
            value={block.label ?? ""}
            maxLength={120}
            onChange={(e) => onChange({ label: e.target.value || null })}
            className={`mt-2 ${input}`}
          />
        </Group>
      )}

      {/* Size and angle — the block as a rectangle on the map, whatever it contains. */}
      {mode === "all" && (
        <Group title="Kích thước & góc">
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className={label}>
              Rộng
              <CommittedNumber
                value={block.width}
                onCommit={(width) => onChange({ width })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className={label}>
              Cao
              <CommittedNumber
                value={block.height}
                onCommit={(height) => onChange({ height })}
                className={`mt-1 ${input}`}
              />
            </label>
          </div>

          <p className={`${label} mt-2`}>Xoay ({block.rotation}°)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {[-90, -15, 15, 90].map((d) => (
              <button key={d} className={btn} onClick={() => onRotate(d)}>
                {d > 0 ? `+${d}°` : `${d}°`}
              </button>
            ))}
            <button className={btn} onClick={() => onRotate(-block.rotation)}>
              Về 0°
            </button>
          </div>
        </Group>
      )}
    </div>
  );
}
