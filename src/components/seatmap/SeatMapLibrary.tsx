/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import type { LayoutLibraryEntry, LayoutRevision } from "@/shared/catalog/seatmap";
import { layoutApi, organizerApi, type MyVenue } from "../../services/catalogClient";
import { STARTERS, starterById, type Starter } from "@/shared/catalog/seatmap-starters";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import { NEUTRAL_TIER_COLOR } from "@/shared/catalog/tier-palette";
import type { SeatMapElement } from "@/shared/catalog/types";
import PreviewOverlay from "./PreviewOverlay";
import type { CanvasBlock, CanvasSeat } from "./SeatCanvas";
import { CHANGE_LABEL, compareDocuments, type DocumentDiff } from "./compare";
import ConfirmDialog, { type ConfirmRequest } from "../ConfirmDialog";
import Select from "../Select";
import { dedupedVenues } from "./venueOptions";

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

const card = "border border-beige-kem/25 bg-surface-2 p-5";
const ghost =
  "border border-beige-kem/45 px-3 py-1.5 text-eyebrow font-bold text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem disabled:opacity-40";
const primary =
  " bg-burgundy px-4 py-2 text-eyebrow font-black text-white transition hover:brightness-95 disabled:opacity-60";
/** One row of the overflow menu: full width, left aligned, so the labels form a single column. */
const secondaryAction =
  "block w-full px-3 py-2 text-left text-xs font-bold text-beige-kem/75 transition hover:bg-beige-kem/10 hover:text-beige-kem disabled:cursor-not-allowed disabled:opacity-35";

/** The destructive row. Separated and coloured — archiving is not peer to renaming. */
const destructiveAction =
  "block w-full border-t border-beige-kem/15 px-3 py-2 text-left text-xs font-bold text-bubblegum transition hover:bg-bubblegum/10 disabled:cursor-not-allowed disabled:opacity-35";

/**
 * The card's overflow menu (the research's `[Open editor] … [•••]`).
 *
 * Three things were wrong with the disclosure this replaces, and the third is the one that mattered:
 *
 *   * it was `flex-1`, so "Quản lý" grew as wide as the primary button and read as its equal;
 *   * its panel was INLINE, so opening it made the card taller and shoved every card below it down;
 *   * and because the row wraps, the panel's width pushed the primary button onto the next line —
 *     the button an organizer was reaching for moved out from under the cursor as the menu opened.
 *
 * A square trigger and an absolutely positioned panel fix all three: the trigger cannot compete with
 * a labelled button, and nothing outside the panel moves when it opens.
 *
 * Still a `<details>`. It is a disclosure, the element is one, and keeping it means the toggle,
 * the keyboard behaviour and the open state come from the platform rather than from state this
 * component would have to hold per card. Escape and outside-click are the two things it does not
 * give, so they are added here.
 */
function OverflowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  /**
   * Whether to hang the panel above the trigger instead of below it.
   *
   * Measured on open rather than assumed: the last row of cards sits near the bottom of the page, and
   * a menu that opens downward there runs off the viewport with its destructive rows — the ones an
   * organizer most needs to see before pressing — the first to go.
   */
  const [dropUp, setDropUp] = useState(false);

  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    // `globalThis.` because this file imports React's `KeyboardEvent` type, which shadows the DOM one.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || !ref.current?.open) return;
      ref.current.open = false;
      // Focus goes back to the trigger, or Escape would drop the organizer at the top of the page.
      ref.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details
      ref={ref}
      className="relative ml-auto"
      onToggle={(e) => {
        const el = e.currentTarget;
        if (!el.open) return;
        const panel = el.querySelector("div");
        const trigger = el.querySelector("summary");
        if (!panel || !trigger) return;
        // Compare against the space actually below the trigger, not against the panel's current
        // position — it has already been placed by the time this runs.
        const below = window.innerHeight - trigger.getBoundingClientRect().bottom;
        setDropUp(panel.offsetHeight + 16 > below);
      }}
    >
      <summary
        aria-label={label}
        title={label}
        className="grid h-9 w-9 cursor-pointer list-none place-items-center border border-beige-kem/45 text-beige-kem/70 transition hover:border-beige-kem hover:text-beige-kem"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </summary>
      {/* Closes on any choice inside: every row here either acts or opens something elsewhere, so
          leaving the menu up afterwards would hide the result of the thing just pressed. */}
      <div
        onClick={() => {
          if (ref.current) ref.current.open = false;
        }}
        className={`absolute right-0 z-20 min-w-52 border border-beige-kem/30 bg-surface-2 py-1 shadow-lg shadow-black/20 ${
          dropUp ? "bottom-full mb-1" : "mt-1"
        }`}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * Lifecycle status in the platform's semantic badge vocabulary, not the raw database word.
 *
 * FOUR states from two fields, because `status` alone cannot tell the two kinds of "draft" apart.
 * Saving a published chart demotes it to `draft` — deliberately, so that what is live and what is
 * being worked on stay separate documents — which meant one word covered a chart nobody has ever
 * sold from AND a chart selling right now under an older published version. The second is the state
 * an organizer most needs to notice, and it was the one being hidden.
 *
 * `hasPublishedVersion` only refines the `draft` branch. It comes from `layout_revisions`, which is
 * written on publish — but a chart with no authoring document publishes without recording one, so a
 * `ready` chart can legitimately have no revision. Reading the flag as "was ever published" on its
 * own would mislabel exactly those charts; `status === "ready"` stays the authority on being live.
 *
 * Each state carries a MARK as well as a colour. The research this page follows is explicit that
 * draft, warning and publication must not be separated by hue alone, and three of these four are
 * variations on "published" — the one place where a colourblind reader would be left guessing.
 */
function StatusBadge({
  entry,
}: {
  entry: Pick<LayoutLibraryEntry, "status" | "hasPublishedVersion">;
}) {
  const { status, hasPublishedVersion } = entry;
  const state =
    status === "archived"
      ? "archived"
      : status === "ready"
        ? "published"
        : hasPublishedVersion
          ? "published-dirty"
          : "draft";

  const { style, label, title } = {
    published: {
      style: "border-la-co/60 bg-la-co/20 text-beige-kem",
      label: "Đang phát hành",
      title: "Bản đang phát hành khớp với bản đang sửa — suất chiếu mới gán được ngay.",
    },
    "published-dirty": {
      style: "border-cam-dat/70 bg-cam-dat/20 text-cam-dat-ink",
      label: "Đang phát hành · có sửa đổi",
      title:
        "Một bản đã phát hành vẫn đang bán, và bản nháp có thay đổi chưa phát hành. Mở trình thiết kế và bấm “Phát hành” để đưa thay đổi lên.",
    },
    draft: {
      style: "border-beige-kem/40 bg-beige-kem/5 text-beige-kem/80",
      label: "Bản nháp",
      title: "Chưa từng phát hành — chưa gán được cho suất chiếu nào.",
    },
    archived: {
      style: "border-beige-kem/25 bg-beige-kem/5 text-beige-kem/60",
      label: "Lưu trữ",
      title: "Đã ẩn khỏi danh sách đang dùng. Khôi phục được bất cứ lúc nào.",
    },
  }[state];

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1 font-meta text-meta font-bold leading-none ${style}`}
    >
      {label}
    </span>
  );
}

/**
 * The recognition thumbnail: each block as a box, framed to their union.
 *
 * A floor plan is recognised by its SILHOUETTE — a wide stage along one edge, two wings, a block in
 * the middle — long before any label is readable, which is why this is the card's visual anchor and
 * why box resolution is enough. It is drawn from `entry.thumbnail`, a few hundred bytes the list
 * query projects in SQL; the document itself never crosses the wire for a list view.
 *
 * Seat-bearing blocks are drawn solid and decoration faint, so the picture reads as "where the seats
 * are" rather than as an undifferentiated set of rectangles.
 */
const SEAT_BEARING = new Set([
  "seating-block",
  "single-row",
  "curved-row",
  "individual-seat",
  "table",
]);

function Thumbnail({ blocks, name }: { blocks: LayoutLibraryEntry["thumbnail"]; name: string }) {
  const box = useMemo(() => {
    const usable = blocks.filter(
      (b) => Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0 && b.h > 0,
    );
    if (usable.length === 0) return null;
    const pad = 400;
    const minX = Math.min(...usable.map((b) => b.x - b.w / 2)) - pad;
    const maxX = Math.max(...usable.map((b) => b.x + b.w / 2)) + pad;
    const minY = Math.min(...usable.map((b) => b.y - b.h / 2)) - pad;
    const maxY = Math.max(...usable.map((b) => b.y + b.h / 2)) + pad;
    return { minX, minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1), usable };
  }, [blocks]);

  if (!box) {
    // An honest blank, not a decorative placeholder: a chart with nothing drawn should look empty,
    // because it is, and a stock picture here would make an empty chart look finished.
    return (
      <div className="grid aspect-[16/7] w-full place-items-center border border-beige-kem/15 bg-xanh-pho/40">
        <span className="font-meta text-xs text-beige-kem/35">Chưa vẽ gì</span>
      </div>
    );
  }

  return (
    <svg
      viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Xem trước bố cục sơ đồ ${name}`}
      className="aspect-[16/7] w-full border border-beige-kem/15 bg-xanh-pho/40"
    >
      {box.usable.map((b, i) => {
        const seats = SEAT_BEARING.has(b.kind);
        const stage = b.kind === "stage";
        return (
          <rect
            key={i}
            x={b.x - b.w / 2}
            y={b.y - b.h / 2}
            width={b.w}
            height={b.h}
            rx={Math.min(b.w, b.h) * 0.08}
            className={
              seats
                ? "fill-burgundy/70 stroke-burgundy"
                : stage
                  ? "fill-beige-kem/35 stroke-beige-kem/60"
                  : "fill-beige-kem/10 stroke-beige-kem/30"
            }
            strokeWidth={Math.max(box.w, box.h) / 300}
          />
        );
      })}
    </svg>
  );
}

/**
 * "2 giờ trước" rather than a date.
 *
 * The library's default sort is by recency, so the column that justifies the order has to be read at
 * that resolution: two charts both stamped "23/08/2026" tell you nothing about which one you were
 * working in ten minutes ago. Falls back to an absolute date past a week, where relative stops being
 * the more useful of the two.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} ngày trước`;
  return new Date(then).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * What the new chart will be made FROM, shown once a source is picked.
 *
 * The pickers were `<select>`s reading "Tên · 50 ghế", which is enough to choose between two charts
 * and not enough to choose between eight — a floor plan is recognised by its shape, and a name like
 * "Khán phòng chính (bản sao)" is exactly the case where the name has stopped distinguishing
 * anything. The select stays (it is already keyboard- and screen-reader-complete); this answers
 * "which one did I just pick?" underneath it.
 *
 * `mismatch` is the venue-compatibility line. Copying into a different venue is legitimate and
 * common — it is how a chart moves between rooms — so this states the fact rather than warning about
 * it. A refusal here would forbid the operation the copy flow exists for.
 */
function SourcePreview({
  source,
  destinationVenue,
}: {
  source: LayoutLibraryEntry;
  destinationVenue: string | null;
}) {
  const mismatch =
    destinationVenue !== null && destinationVenue !== source.venueName ? destinationVenue : null;

  return (
    <div className="mt-2 border border-beige-kem/25 bg-xanh-pho/30 p-3">
      <Thumbnail blocks={source.thumbnail} name={source.name} />
      <p className="mt-2 font-meta text-meta font-bold text-beige-kem">{source.name}</p>
      <p className="mt-0.5 font-meta text-meta text-beige-kem/70">
        <span className="tabular-nums">{source.seatCount.toLocaleString("vi-VN")}</span> ghế ·{" "}
        {source.venueName}
      </p>
      {mismatch && (
        <p className="mt-1 font-meta text-meta text-beige-kem/55">
          Sẽ tạo tại <span className="font-bold text-beige-kem/80">{mismatch}</span> — hình học được
          chép sang, kích thước phòng thì không kiểm tra được, nên hãy đối chiếu lại sau khi mở.
        </p>
      )}
      {/*
        Said at the moment of copying, not after it. Every item here was checked against
        `cloneLayout`: it copies sections, categories, tables, seats, elements and the background
        image, and inserts the new row as `'draft'`. It touches no showtime table at all, so nothing
        that was ever sold, held or scheduled can travel with a copy.
      */}
      <p className="mt-2 border-t border-beige-kem/15 pt-2 font-meta text-meta text-beige-kem/45">
        Chép hình học, khu vực, hạng ghế và ảnh nền. Không mang theo suất chiếu, vé đã bán, lượt giữ
        chỗ hay lịch sử phiên bản. Bản mới là bản nháp.
      </p>
    </div>
  );
}

/**
 * A starter, projected into the shapes the buyer-facing preview already speaks.
 *
 * `projectDocument` is pure and `PreviewOverlay` takes seats and elements as props rather than a
 * layout id, so previewing an unsaved chart needs no new rendering and no round trip — only the
 * conversion between the two. Before this the only way to see a starter at full size was to create
 * one, which is a decision the preview exists to inform.
 *
 * Colours come from the starter's own categories, matching what the editor would show once created.
 */
function previewPropsFor(
  starter: Starter,
  sizeId?: string,
): {
  seats: CanvasSeat[];
  elements: SeatMapElement[];
  blocks: CanvasBlock[];
  colorOfSeat: Map<number, string>;
  floors: { name: string; displayOrder: number }[];
} {
  const doc = starter.build(sizeId);
  const projected = projectDocument(doc);
  const colorByCategory = new Map<number, string>(doc.categories.map((c) => [c.id, c.color]));
  const sectionName = new Map<number, string>(doc.sections.map((x) => [x.id, x.name]));
  // Levels (0044), resolved section → floor → name, so a two-tier starter previews with the same
  // layer control the buyer will get rather than as one unreadable pile of overlapping decks.
  const floorName = new Map<number, string>((doc.floors ?? []).map((f) => [f.id, f.name]));
  const floorOfSection = new Map<number, number | null>(
    doc.sections.map((x) => [x.id, x.floorId ?? null]),
  );

  const seats: CanvasSeat[] = projected.seats.map((seat, i) => ({
    // Placeholder rows have no database id; the index is a stable stand-in for a view that only
    // ever reads it back as a key.
    id: seat.id ?? -(i + 1),
    x: seat.x,
    y: seat.y,
    rotation: seat.rotation,
    row: seat.rowLabel,
    number: seat.seatNumber,
    section: seat.sectionId == null ? null : (sectionName.get(seat.sectionId) ?? null),
    isAccessible: seat.isAccessible,
    seatType: seat.seatType,
    floor:
      seat.sectionId == null
        ? null
        : (floorName.get(floorOfSection.get(seat.sectionId) ?? -1) ?? null),
  }));

  const colorOfSeat = new Map<number, string>();
  projected.seats.forEach((seat, i) => {
    const color = seat.categoryId == null ? undefined : colorByCategory.get(seat.categoryId);
    if (color) colorOfSeat.set(seats[i].id, color);
  });

  const blocks: CanvasBlock[] = doc.sections.map((x) => ({
    id: x.name,
    name: x.name,
    color: NEUTRAL_TIER_COLOR,
  }));

  return {
    seats,
    elements: projected.elements as unknown as SeatMapElement[],
    blocks,
    floors: (doc.floors ?? []).map((f) => ({ name: f.name, displayOrder: f.displayOrder })),
    colorOfSeat,
  };
}

type Filter = "active" | "archived" | "templates";
type StatusFilter = "all" | "draft" | "published" | "published-dirty";
type Sort = "recent" | "name" | "capacity" | "usage";

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
  const [query, setQuery] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [venues, setVenues] = useState<MyVenue[] | null>(null);
  /** The same venues with the accidental repeats collapsed — see `venueOptions`. */
  const pickableVenues = useMemo(() => dedupedVenues(venues ?? []), [venues]);
  const [venueId, setVenueId] = useState("");
  const [newLayoutName, setNewLayoutName] = useState("");
  const [creating, setCreating] = useState(false);
  const createDialog = useRef<HTMLDivElement | null>(null);
  const createReturnFocus = useRef<HTMLElement | null>(null);

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
    null | "chooser" | "template" | "duplicate" | "blank" | "starter"
  >(null);
  /** The chart a duplicate starts from, once picked. */
  const [duplicateSourceId, setDuplicateSourceId] = useState("");
  /** The template a new chart starts from, once picked. */
  const [templateSourceId, setTemplateSourceId] = useState("");
  /** Which BUILT-IN starter the create flow is using, by its string id. */
  const [starterId, setStarterId] = useState("");
  /** Which starter is open in the full-size preview, if any. */
  const [previewStarter, setPreviewStarter] = useState<Starter | null>(null);
  /** Which size of the chosen starter to build. Empty means the starter's default (its first). */
  const [starterSize, setStarterSize] = useState("");
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

  /**
   * The tab decides WHICH COLLECTION; the toolbar narrows within it.
   *
   * Kept as two stages on purpose. A tab is a different kind of thing — asset, starter, recovery —
   * and a filter is a subset of one kind; folding the tabs into the status dropdown would have made
   * "Mẫu" look like a lifecycle state, which is the one reading the three-tab split exists to
   * prevent.
   *
   * Status filtering is offered only on the active tab: an archived chart's lifecycle is not the
   * question being asked of it, and every template is statusless by definition.
   */
  const shown = useMemo(() => {
    const all = rows ?? [];
    const collection =
      filter === "templates"
        ? all.filter((l) => l.isTemplate)
        : filter === "archived"
          ? all.filter((l) => l.status === "archived" && !l.isTemplate)
          : all.filter((l) => l.status !== "archived" && !l.isTemplate);

    const needle = query.trim().toLowerCase();
    const searched = needle
      ? collection.filter(
          (l) =>
            l.name.toLowerCase().includes(needle) || l.venueName.toLowerCase().includes(needle),
        )
      : collection;

    const byVenue =
      venueFilter === "" ? searched : searched.filter((l) => String(l.venueId) === venueFilter);

    const byStatus =
      filter !== "active" || statusFilter === "all"
        ? byVenue
        : byVenue.filter((l) => {
            if (statusFilter === "published") return l.status === "ready";
            if (statusFilter === "published-dirty")
              return l.status === "draft" && l.hasPublishedVersion;
            return l.status === "draft" && !l.hasPublishedVersion;
          });

    // `recent` is the server's own order, so it sorts by doing nothing — re-sorting a list that
    // already arrived `ORDER BY updated_at DESC` would only risk disagreeing with it.
    if (sort === "recent") return byStatus;
    const out = [...byStatus];
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    if (sort === "capacity") out.sort((a, b) => b.seatCount - a.seatCount);
    if (sort === "usage") out.sort((a, b) => b.usageCount - a.usageCount);
    return out;
  }, [rows, filter, query, venueFilter, statusFilter, sort]);

  /**
   * The picked source and the chosen destination, resolved once for the create modal.
   *
   * Looked up from `rows` rather than held as state: the select already owns the id, and a second
   * copy of the entry would go stale the moment the list refreshed after a rename or a save.
   */
  const templateSource = useMemo(
    () => (rows ?? []).find((l) => String(l.id) === templateSourceId) ?? null,
    [rows, templateSourceId],
  );
  const duplicateSource = useMemo(
    () => (rows ?? []).find((l) => String(l.id) === duplicateSourceId) ?? null,
    [rows, duplicateSourceId],
  );
  /** Null until a venue is chosen — the preview then says nothing about compatibility rather than
   *  comparing against a blank. */
  const destinationVenue = useMemo(
    () => (venues ?? []).find((v) => String(v.id) === venueId)?.name ?? null,
    [venues, venueId],
  );

  /** Venues that actually own a chart in the current collection — a filter offering options that
   *  match nothing teaches the organizer that the control is broken. */
  const venueOptions = useMemo(() => {
    const inCollection = (l: LayoutLibraryEntry) =>
      filter === "templates"
        ? l.isTemplate
        : filter === "archived"
          ? l.status === "archived" && !l.isTemplate
          : l.status !== "archived" && !l.isTemplate;
    const seen = new Map<number, string>();
    for (const l of rows ?? []) if (inCollection(l)) seen.set(l.venueId, l.venueName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "vi"));
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

  /** Open the template flow with its source preselected; the organizer still chooses the venue. */
  const startFromTemplate = async (l: LayoutLibraryEntry) => {
    createReturnFocus.current = document.activeElement as HTMLElement | null;
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
    setVenueId("");
    setTemplateSourceId(String(l.id));
    setCreateMode("template");
  };

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
    createReturnFocus.current = document.activeElement as HTMLElement | null;
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
    window.requestAnimationFrame(() => createReturnFocus.current?.focus());
  };

  useEffect(() => {
    if (createMode !== null) createDialog.current?.focus();
  }, [createMode]);

  const handleCreateDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCreateChooser();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(createDialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    if (focusable.length === 0) {
      event.preventDefault();
      createDialog.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === createDialog.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
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

  /**
   * Start from a BUILT-IN starter.
   *
   * Two calls rather than a clone: a starter has no row to clone FROM — it is a `ChartDocument` in
   * shared code (`seatmap-starters.ts`, which explains why). So this creates an ordinary empty chart
   * in the chosen venue and saves the starter's document into it, through the same `PUT` a hand-drawn
   * edit uses. The result carries no link back to the starter and nothing about it is special
   * afterwards, which is what "template" is supposed to mean.
   *
   * `version` comes from the freshly created layout rather than being assumed to be 1: the save path
   * refuses a stale version, and guessing it here would be the one place in the app that does.
   */
  const createFromStarter = async () => {
    const selectedVenueId = Number(venueId);
    const starter = starterById(starterId);
    if (!selectedVenueId) {
      setError("Vui lòng chọn địa điểm để đặt sơ đồ mới.");
      return;
    }
    if (!starter) {
      setError("Vui lòng chọn một sơ đồ mẫu.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const name = newLayoutName.trim() || starter.name;
      const made = await layoutApi.create(selectedVenueId, name);
      try {
        await layoutApi.save(made.id, {
          version: made.version,
          document: starter.build(starterSize || undefined),
        });
      } catch (e) {
        /*
         * Two calls, so there is a moment where the chart exists and is EMPTY. If the document save
         * fails there — and it can: the server refuses geometry the database will not take — the
         * organizer is left with a chart named after a starter that contains nothing, which reads as
         * a broken template rather than as a failed attempt.
         *
         * So the failure is rolled back. Best-effort: if the delete also fails there is nothing
         * further to try, and the original error is the one worth reporting either way.
         */
        await layoutApi.remove(made.id).catch(() => {});
        throw e;
      }
      // A starter that states its focal point sets it now (0043) — the arena's is its pitch, which no
      // stage can express. Best-effort and NOT rolled back on failure: a chart without one simply
      // infers it, so a chart that is otherwise complete must not be thrown away over a ranking hint.
      if (starter.focalPoint) {
        await layoutApi
          .setFocalPoint(made.id, starter.focalPoint(starterSize || undefined))
          .catch(() => {});
      }
      setCreateMode(null);
      onOpen(made.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  /** Open the starter flow with one preselected — the venue is still the organizer's to choose. */
  const startFromStarter = async (starter: Starter) => {
    createReturnFocus.current = document.activeElement as HTMLElement | null;
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
    setVenueId("");
    setNewLayoutName("");
    setStarterId(starter.id);
    setStarterSize(starter.sizes[0].id);
    setCreateMode("starter");
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
    <div className="mx-auto w-full max-w-5xl px-4 py-8 text-beige-kem sm:px-6">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-beige-kem/20 pb-5">
          <div>
            <nav
              aria-label="Đường dẫn"
              className="mb-2 flex items-center gap-2 font-meta text-meta"
            >
              <span className="text-ink-soft">Nhà tổ chức</span>
              <span aria-hidden="true" className="text-beige-kem/30">
                /
              </span>
              <span aria-current="page" className="font-bold text-beige-kem">
                Sơ đồ ghế
              </span>
            </nav>
            <h2 className="font-display text-title-l font-black">Sơ đồ ghế</h2>
          </div>
          {/* Named for where it GOES, not for a metaphor: the destination is the event-management
              console, and "về trang chủ" once promised an app home this button never opened. */}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-eyebrow font-bold text-beige-kem/70 transition hover:text-beige-kem"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Bảng điều khiển
          </button>
        </div>

        <div
          className="flex flex-wrap gap-x-6 border-b border-beige-kem/20"
          role="group"
          aria-label="Lọc sơ đồ"
        >
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
              aria-pressed={filter === key}
              className={`border-b-2 px-1 pb-2 font-meta text-body font-bold transition ${
                filter === key
                  ? "border-burgundy text-beige-kem"
                  : "border-transparent text-ink-soft hover:text-beige-kem"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/*
          Toolbar. Search first because it is the fastest path once a library is more than a screen
          long, then the filters in order of how often they narrow something: venue is the strongest
          domain filter, because geometry belongs to a physical place.

          Status is offered only on the active tab — see `shown`. Every control is a plain form
          element rather than a custom menu: they are already keyboard- and screen-reader-complete,
          and none of them is doing anything a `select` cannot.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Tìm theo tên sơ đồ hoặc địa điểm</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên sơ đồ hoặc địa điểm…"
              className="h-10 w-full rounded-full border border-beige-kem/35 bg-transparent px-4 font-meta text-meta text-beige-kem outline-none placeholder:text-ink-soft focus:border-beige-kem"
            />
          </label>

          {venueOptions.length > 1 && (
            <label className="font-meta text-meta">
              <span className="sr-only">Lọc theo địa điểm</span>
              <select
                value={venueFilter}
                onChange={(e) => setVenueFilter(e.target.value)}
                className="h-10 border border-beige-kem/35 bg-transparent px-2 text-beige-kem outline-none focus:border-beige-kem"
              >
                <option value="" className="bg-xanh-pho">
                  Mọi địa điểm
                </option>
                {venueOptions.map(([id, name]) => (
                  <option key={id} value={String(id)} className="bg-xanh-pho">
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {filter === "active" && (
            <label className="font-meta text-meta">
              <span className="sr-only">Lọc theo trạng thái</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="h-10 border border-beige-kem/35 bg-transparent px-2 text-beige-kem outline-none focus:border-beige-kem"
              >
                <option value="all" className="bg-xanh-pho">
                  Mọi trạng thái
                </option>
                <option value="published" className="bg-xanh-pho">
                  Đang phát hành
                </option>
                <option value="published-dirty" className="bg-xanh-pho">
                  Có sửa đổi chưa phát hành
                </option>
                <option value="draft" className="bg-xanh-pho">
                  Bản nháp
                </option>
              </select>
            </label>
          )}

          <label className="font-meta text-meta">
            <span className="sr-only">Sắp xếp</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-10 border border-beige-kem/35 bg-transparent px-2 text-beige-kem outline-none focus:border-beige-kem"
            >
              <option value="recent" className="bg-xanh-pho">
                Mới cập nhật
              </option>
              <option value="name" className="bg-xanh-pho">
                Tên A→Z
              </option>
              <option value="capacity" className="bg-xanh-pho">
                Sức chứa
              </option>
              <option value="usage" className="bg-xanh-pho">
                Dùng nhiều nhất
              </option>
            </select>
          </label>

          {/* The create action ENDS the toolbar, which is where the research this page follows puts
              it: search and filters narrow what is here, and the last control makes something new.
              It used to sit inside a bordered panel of its own asking "Cần một sơ đồ khác?" — a box
              and a question to introduce one button, between the filters and the results. */}
          <button
            type="button"
            onClick={() => void openCreateChooser()}
            disabled={creating}
            className={`${primary} ml-auto`}
          >
            {creating ? "Đang tải…" : "+ Tạo sơ đồ"}
          </button>
        </div>

        {error && (
          <p className="border-l-2 border-burgundy bg-bubblegum px-4 py-2 text-eyebrow text-on-tint">
            {error}
          </p>
        )}

        {rows === null && (
          <div className="grid items-start gap-4 lg:grid-cols-2" role="status" aria-live="polite">
            <span className="sr-only">Đang tải sơ đồ…</span>
            {[0, 1].map((item) => (
              <div
                key={item}
                aria-hidden="true"
                className="animate-pulse border border-beige-kem/15 bg-surface-2 p-5 motion-reduce:animate-none"
              >
                <div className="h-4 w-48 bg-beige-kem/10" />
                <div className="mt-3 h-3 w-72 max-w-full bg-beige-kem/10" />
                <div className="mt-5 h-8 w-28 bg-beige-kem/10" />
              </div>
            ))}
          </div>
        )}

        {/* Not on the templates tab: the built-in starters below are always present, so an empty card
            saying "chưa có mẫu nào" would sit above six of them. That tab reports its own emptiness,
            about the organizer's OWN templates, inside the section that owns the question. */}
        {rows !== null && shown.length === 0 && filter !== "templates" && (
          <div className={card}>
            <p className="text-body text-beige-kem/70">
              {/* An empty RESULT and an empty COLLECTION are different problems: one is fixed by
                  clearing a filter, the other by drawing a chart. Saying "chưa có sơ đồ nào" over a
                  library that has thirty, filtered down to none, sends the reader the wrong way. */}
              {query.trim() || venueFilter || statusFilter !== "all"
                ? "Không có sơ đồ nào khớp bộ lọc. Thử xoá từ khoá hoặc chọn lại địa điểm/trạng thái."
                : filter === "archived"
                  ? "Chưa có sơ đồ nào được lưu trữ."
                  : "Chưa có sơ đồ nào. Dùng “+ Tạo sơ đồ” phía trên để tạo sơ đồ đầu tiên."}
            </p>
          </div>
        )}

        {/*
          Built-in starters, on the Mẫu tab only.

          Shown ABOVE the organizer's own templates and visually separated, because they are a
          different kind of thing: these are read-only and identical for everyone, an organizer's
          template is their own chart. Merging the two lists would invite the reading that a starter
          can be renamed or archived, which it cannot — it is code, not a row.
        */}
        {filter === "templates" && (
          <section className="space-y-3">
            <div>
              <h3 className="font-display text-title-m font-black">Mẫu dựng sẵn</h3>
            </div>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {STARTERS.map((st) => {
                const doc = st.build();
                return (
                  <article key={st.id} className={`${card} flex flex-col`}>
                    <Thumbnail
                      blocks={doc.blocks.map((b) => ({
                        x: b.x,
                        y: b.y,
                        w: b.width,
                        h: b.height,
                        kind: b.kind,
                      }))}
                      name={st.name}
                    />
                    <div className="mt-3 flex items-start justify-between gap-3">
                      <h4 className="min-w-0 font-display text-title-s font-bold leading-tight">
                        {st.name}
                      </h4>
                      <span className="shrink-0 border border-beige-kem/30 px-2 py-1 font-meta text-xs font-bold leading-none text-beige-kem/60">
                        Dựng sẵn
                      </span>
                    </div>
                    <p className="mt-1 font-meta text-meta text-beige-kem/60">{st.shape}</p>
                    <p className="mt-2 font-meta text-meta text-beige-kem/80">
                      <span className="font-bold tabular-nums">
                        {st.sizes[0].seatCount.toLocaleString("vi-VN")}
                      </span>{" "}
                      ghế
                      {st.sizes.length > 1 && (
                        <span className="text-beige-kem/45">
                          {" · "}
                          {st.sizes.length} quy mô
                        </span>
                      )}
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                      <button
                        onClick={() => void startFromStarter(st)}
                        disabled={busy || creating}
                        className={primary}
                      >
                        Dùng mẫu
                      </button>
                      {/* Secondary, and deliberately so: the thumbnail answers "which one is this?"
                          and this answers "is it actually right for my room?" — a question worth
                          asking BEFORE creating a chart, which was previously the only way to see. */}
                      <button onClick={() => setPreviewStarter(st)} className={ghost}>
                        Xem trước
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="pt-2">
              <h3 className="font-display text-title-m font-black">Mẫu của bạn</h3>
            </div>
          </section>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-2">
          {shown.map((l) => (
            <article key={l.id} className={`${card} flex min-h-64 flex-col`}>
              {/*
                Thumbnail first, and it is the only thing above the name: the research this page
                follows treats a floor plan's picture as the recognition aid and the text as the
                confirmation, which is the opposite of the order the card used to read in.

                A TEMPLATE gets no lifecycle badge. It is a starting point, not something that is or
                is not on sale, and giving it a "Bản nháp" chip invited exactly the reading the tabs
                exist to prevent.
              */}
              <Thumbnail blocks={l.thumbnail} name={l.name} />

              <div className="mt-3 flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words font-display text-title-s font-bold leading-tight">
                  {l.name}
                </h3>
                {l.isTemplate ? (
                  <span className="shrink-0 border border-burgundy/35 bg-bubblegum/50 px-2 py-1 font-meta text-xs font-bold leading-none text-on-tint">
                    Mẫu
                  </span>
                ) : (
                  <StatusBadge entry={l} />
                )}
              </div>

              {/* Venue on the second line, where identity belongs — geometry belongs to a physical
                  place, so "which room is this?" is the first question after "which map is this?".
                  It used to be the fourth item in a definition list below the fold of the eye. */}
              <p className="mt-1 break-words font-meta text-meta text-beige-kem/60">
                {l.venueName}
              </p>

              <p className="mt-2 font-meta text-meta text-beige-kem/80">
                <span className="font-bold tabular-nums">
                  {l.seatCount.toLocaleString("vi-VN")}
                </span>{" "}
                ghế
                {l.usageCount > 0 && (
                  <>
                    {" · "}
                    <span title="Suất chiếu chưa diễn ra và vẫn trỏ vào sơ đồ này">
                      <span className="font-bold tabular-nums">{l.usageCount}</span> suất đang dùng
                    </span>
                  </>
                )}
              </p>
              <p className="mt-0.5 font-meta text-meta text-beige-kem/45">
                Cập nhật {relativeTime(l.updatedAt)}
              </p>

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                {/*
                  On a template, STARTING A CHART is the primary action and opening it is not (§33).
                  Opening a template edits the template — which is occasionally what you want and
                  almost never what you came for, so it stays available and stops being the button
                  the eye lands on first.
                */}
                {l.isTemplate ? (
                  <button
                    onClick={() => void startFromTemplate(l)}
                    disabled={busy || creating}
                    className={primary}
                    title="Chọn địa điểm rồi tạo một sơ đồ mới từ mẫu này"
                  >
                    {creating ? "Đang tải…" : "Dùng mẫu"}
                  </button>
                ) : (
                  <button onClick={() => onOpen(l.id)} className={primary}>
                    Mở trình thiết kế
                  </button>
                )}
                <OverflowMenu label="Thao tác khác">
                  {l.isTemplate && (
                    <button
                      onClick={() => onOpen(l.id)}
                      disabled={busy}
                      className={secondaryAction}
                    >
                      Sửa mẫu
                    </button>
                  )}
                  <button onClick={() => rename(l)} disabled={busy} className={secondaryAction}>
                    Đổi tên
                  </button>
                  <button onClick={() => duplicate(l)} disabled={busy} className={secondaryAction}>
                    Nhân bản
                  </button>
                  {!l.isTemplate && (
                    <button
                      onClick={() => saveAsTemplate(l)}
                      disabled={busy}
                      className={secondaryAction}
                    >
                      Lưu thành mẫu
                    </button>
                  )}
                  <button
                    onClick={() => void openHistory(l)}
                    disabled={busy}
                    className={secondaryAction}
                  >
                    {history?.layoutId === l.id ? "Ẩn lịch sử" : "Xem lịch sử"}
                  </button>
                  {l.status === "archived" ? (
                    <button
                      onClick={() => void run(() => layoutApi.restore(l.id))}
                      disabled={busy}
                      className={secondaryAction}
                    >
                      Khôi phục
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setConfirm({
                          title: "Lưu trữ sơ đồ?",
                          // Usage-aware: the server refuses an archive while a live showtime still
                          // points at the chart, so the same count that drives that refusal is
                          // named here — the organizer learns why BEFORE the click instead of
                          // meeting a 409 after it.
                          message:
                            l.usageCount > 0
                              ? `${l.usageCount} suất chiếu chưa diễn ra vẫn đang trỏ vào sơ đồ này. Các suất đó giữ bản sao riêng nên vé đã bán không đổi, nhưng sơ đồ sẽ không gán được cho suất mới. Bạn có thể khôi phục bất cứ lúc nào.`
                              : "Sơ đồ sẽ ẩn khỏi danh sách đang dùng và không thể gán cho suất chiếu mới. Bạn có thể khôi phục bất cứ lúc nào.",
                          confirmLabel: "Lưu trữ",
                          cancelLabel: "Huỷ",
                          tone: "normal",
                          onConfirm: () => void run(() => layoutApi.archive(l.id)),
                        })
                      }
                      disabled={busy || l.usageCount > 0}
                      title={
                        l.usageCount > 0
                          ? `${l.usageCount} suất chiếu đang dùng sơ đồ này`
                          : "Ẩn khỏi danh sách đang dùng"
                      }
                      className={destructiveAction}
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
                    className={`${destructiveAction} border-t-0`}
                  >
                    Xoá
                  </button>
                </OverflowMenu>
              </div>

              {history?.layoutId === l.id && (
                <div className="mt-3 border-t-2 border-beige-kem/25 pt-3">
                  {history.rows.length === 0 ? (
                    <p className="font-meta text-meta text-ink-soft">
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
                                <p className="font-meta text-meta text-ink-soft">
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
            </article>
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
            ref={createDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-layout-dialog-title"
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto border-2 border-beige-kem bg-xanh-pho p-6 text-beige-kem"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleCreateDialogKeyDown}
          >
            <div className="flex items-center justify-between">
              <h3 id="create-layout-dialog-title" className="font-display text-title-m font-black">
                {createMode === "chooser"
                  ? "Tạo sơ đồ mới"
                  : createMode === "template"
                    ? "Bắt đầu từ mẫu"
                    : createMode === "starter"
                      ? "Bắt đầu từ mẫu dựng sẵn"
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
                  <p className="mt-1 font-meta text-meta text-ink-soft">
                    Lấy một mẫu có sẵn, rồi chỉnh lại cho đúng. Nhanh nhất cho lần đầu.
                  </p>
                </button>
                <button
                  className="block w-full border-2 border-beige-kem bg-surface-2 p-4 text-left transition hover:border-burgundy"
                  onClick={() => setCreateMode("duplicate")}
                  disabled={busy}
                >
                  <p className="font-display text-base font-bold">Nhân bản một sơ đồ đã có</p>
                  <p className="mt-1 font-meta text-meta text-ink-soft">
                    Sao chép một sơ đồ bạn đã vẽ, rồi sửa lại.
                  </p>
                </button>
                <button
                  className="block w-full border-2 border-beige-kem bg-surface-2 p-4 text-left transition hover:border-burgundy"
                  onClick={() => setCreateMode("blank")}
                  disabled={busy}
                >
                  <p className="font-display text-base font-bold">Vẽ từ trang trắng</p>
                  <p className="mt-1 font-meta text-meta text-ink-soft">
                    Mở trình thiết kế với một sơ đồ trống.
                  </p>
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {/* Shared: which venue the new chart belongs to. */}
                <label className="block">
                  <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">
                    Địa điểm
                  </span>
                  {/*
                    The shared dropdown, not a native `<select>`: a native one's option list is
                    drawn by the operating system, so it opened as a grey platform menu over a
                    designer built from hairlines and mono type, and nothing written on the element
                    reaches inside that menu.
                  */}
                  <Select
                    value={venueId}
                    options={pickableVenues.map((venue) => ({
                      value: String(venue.id),
                      label: venue.label,
                    }))}
                    placeholder="Chọn địa điểm"
                    disabled={creating}
                    onChange={setVenueId}
                    triggerClassName="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow"
                  />
                </label>

                {createMode === "template" && (
                  <label className="block">
                    <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">Mẫu</span>
                    <Select
                      value={templateSourceId}
                      options={(rows ?? [])
                        .filter((l) => l.isTemplate)
                        .map((t) => ({ value: String(t.id), label: `${t.name} · ${t.seatCount} ghế` }))}
                      placeholder="Chọn mẫu"
                      disabled={creating}
                      onChange={setTemplateSourceId}
                      triggerClassName="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow"
                    />
                    {(rows ?? []).filter((l) => l.isTemplate).length === 0 && (
                      <p className="mt-2 font-meta text-meta text-cam-dat">
                        Chưa có mẫu nào. Mở một sơ đồ, rồi dùng "Lưu thành mẫu" để tạo.
                      </p>
                    )}
                    {templateSource && (
                      <SourcePreview source={templateSource} destinationVenue={destinationVenue} />
                    )}
                  </label>
                )}

                {createMode === "duplicate" && (
                  <label className="block">
                    <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">
                      Sơ đồ nguồn
                    </span>
                    <Select
                      value={duplicateSourceId}
                      options={(rows ?? [])
                        .filter((l) => l.status !== "archived")
                        .map((l) => ({
                          value: String(l.id),
                          label: `${l.name} · ${l.venueName} · ${l.seatCount} ghế`,
                        }))}
                      placeholder="Chọn sơ đồ"
                      disabled={creating}
                      onChange={setDuplicateSourceId}
                      triggerClassName="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow"
                    />
                    {(rows ?? []).filter((l) => l.status !== "archived").length === 0 && (
                      <p className="mt-2 font-meta text-meta text-cam-dat">
                        Chưa có sơ đồ nào để nhân bản.
                      </p>
                    )}
                    {duplicateSource && (
                      <SourcePreview source={duplicateSource} destinationVenue={destinationVenue} />
                    )}
                  </label>
                )}

                {createMode === "starter" &&
                  (() => {
                    const st = starterById(starterId);
                    if (!st) return null;
                    const doc = st.build();
                    return (
                      <div>
                        <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">
                          Mẫu dựng sẵn
                        </span>
                        <div className="border border-beige-kem/25 bg-xanh-pho/30 p-3">
                          <Thumbnail
                            blocks={doc.blocks.map((b) => ({
                              x: b.x,
                              y: b.y,
                              w: b.width,
                              h: b.height,
                              kind: b.kind,
                            }))}
                            name={st.name}
                          />
                          <p className="mt-2 font-meta text-meta font-bold text-beige-kem">
                            {st.name}
                          </p>
                          <p className="mt-0.5 font-meta text-meta text-beige-kem/70">
                            <span className="tabular-nums">
                              {(
                                st.sizes.find((z) => z.id === starterSize) ?? st.sizes[0]
                              ).seatCount.toLocaleString("vi-VN")}
                            </span>{" "}
                            ghế · {st.shape}
                          </p>
                          <p className="mt-2 border-t border-beige-kem/15 pt-2 font-meta text-meta text-beige-kem/45">
                            Tạo một sơ đồ mới thuộc địa điểm đã chọn. Mẫu dựng sẵn không bị sửa và
                            không liên kết với sơ đồ mới. Bản mới là bản nháp — vẽ lại tuỳ ý rồi
                            phát hành.
                          </p>
                        </div>
                        {/* Size before name: it changes the capacity shown just above, so the
                            organizer picks the room and then names what they picked. */}
                        <label className="mt-3 block">
                          <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">
                            Quy mô
                          </span>
                          <select
                            value={starterSize || st.sizes[0].id}
                            onChange={(e) => setStarterSize(e.target.value)}
                            disabled={creating}
                            className="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow text-beige-kem outline-none focus:border-burgundy"
                          >
                            {st.sizes.map((z) => (
                              <option key={z.id} value={z.id} className="bg-xanh-pho">
                                {z.label} · {z.seatCount.toLocaleString("vi-VN")} ghế
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="mt-3 block">
                          <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">
                            Tên sơ đồ
                          </span>
                          <input
                            value={newLayoutName}
                            onChange={(e) => setNewLayoutName(e.target.value)}
                            maxLength={120}
                            disabled={creating}
                            placeholder={st.name}
                            className="h-10 w-full border-2 border-beige-kem bg-surface-2 px-3 text-eyebrow text-beige-kem outline-none focus:border-burgundy"
                          />
                        </label>
                      </div>
                    );
                  })()}

                {createMode === "blank" && (
                  <label className="block">
                    <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">
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
                  <p className="border-l-2 border-burgundy bg-bubblegum px-3 py-2 text-eyebrow text-on-tint">
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
                        : createMode === "starter"
                          ? void createFromStarter()
                          : createMode === "duplicate"
                            ? void duplicateIntoVenue()
                            : void createLayout()
                    }
                  >
                    {creating
                      ? "Đang tạo…"
                      : createMode === "template" || createMode === "starter"
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

      {/* Full-size preview of a starter, rendered from its document with no round trip — see
          `previewPropsFor`. The same overlay the editor uses, so what an organizer judges here is
          what they will get. */}
      {previewStarter &&
        (() => {
          const p = previewPropsFor(previewStarter);
          return (
            <PreviewOverlay
              seats={p.seats}
              elements={p.elements}
              blocks={p.blocks}
              floors={p.floors}
              colorOfSeat={p.colorOfSeat}
              onClose={() => setPreviewStarter(null)}
            />
          );
        })()}

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
