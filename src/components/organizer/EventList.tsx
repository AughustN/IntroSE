/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import Select from "../Select";
import { MyEvent } from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";
import { formatShowtimeAt } from "../../services/formatDate";
import { Empty } from "./states";

const ghost = " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80";

/**
 * Status badges: dark ink on a PALE TINT of the state's own hue.
 *
 * The old set filled the badge with the saturated hue and printed `on-tint` over it, which worked for
 * orange and failed for olive: `#6b0a1c` on `la-co` measures **2.75:1**, well under WCAG AA's 4.5,
 * and "Đã duyệt" is the badge an organizer most needs to read at a glance. Two mid-dark colours
 * cannot carry each other.
 *
 * Inverting to a tint fixes it without giving up the hue, and measured against the real blended
 * background — not against the token, since these sit on both the card and the page:
 *
 *     Đã duyệt   la-co-ink on la-co/18       5.01:1 (card) · 4.80:1 (page)
 *     Chờ duyệt  cam-dat-ink on cam-dat/20   4.90:1 (card) · 4.75:1 (page)
 *     Bị gắn cờ  on-tint on bubblegum/70     9.85:1
 *     Đã gỡ      on-tint on bubblegum/70     9.85:1
 *
 * Hue is the only feature separating four of these, so each badge also spells its state out in words
 * rather than leaning on colour alone.
 */
const BADGE: Record<string, { cls: string; text: string }> = {
  pending_review: {
    cls: "text-cam-dat-ink border-cam-dat/60 bg-cam-dat/20",
    text: "Chờ duyệt",
  },
  approved: { cls: "text-la-co-ink border-la-co/55 bg-la-co/20", text: "Đã duyệt" },
  removed: {
    cls: "text-on-tint border-bubblegum bg-bubblegum/70",
    text: "Đã gỡ/từ chối",
  },
  flagged: { cls: "text-on-tint border-bubblegum bg-bubblegum/70", text: "Bị gắn cờ" },
};

/**
 * A draft that has never been submitted, distinct from "Chờ duyệt". `events.moderation_status`
 * defaults to `pending_review` in the schema for every row, draft or not — so `BADGE[ev.moderation]`
 * alone printed "Chờ duyệt" on an event the organizer had not yet sent anywhere, indistinguishable
 * from one an admin was actually sitting on. Checked ahead of the moderation lookup for exactly
 * that reason: `status` is the fact that a draft has not been submitted, `moderation` is not.
 */
const DRAFT_BADGE = {
  cls: "text-beige-kem/75 border-beige-kem/35 bg-transparent",
  text: "Bản nháp",
};

/**
 * An event whose showtimes have all passed, distinct from `status` — nothing flips `events.status`
 * off a clock, so `on_sale` stays true long after the last showtime has, and the moderation badge
 * above kept calling a finished run "Đã duyệt" as if it were still something to buy. Takes priority
 * over the moderation badge once true, because "it's over" is the fact an organizer needs first.
 */
const FINISHED_BADGE = {
  cls: "text-beige-kem/70 border-beige-kem/30 bg-beige-kem/10",
  text: "Đã diễn",
};

/**
 * Match "nha nhac" against "Nhạc hội": NFD strips the combining marks, `đ` folds to `d`, and the
 * rest lowercases. Without this an organizer typing without diacritics — most keyboards here make
 * them optional — would miss their own event sitting right there in the list.
 */
const normalise = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .trim();

/**
 * The four questions an organizer actually opens this page to ask of the list — plus "all". The
 * raw 4×4 of `status` × `moderation_status` is a database matrix, not answers; each option here
 * names one answer in the words the badge below already uses.
 */
type StatusFilter = "all" | "live" | "pending_review" | "draft" | "finished" | "cancelled";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "live", label: "Đang mở bán" },
  { value: "pending_review", label: "Chờ duyệt" },
  { value: "draft", label: "Bản nháp" },
  { value: "finished", label: "Đã diễn" },
  { value: "cancelled", label: "Đã hủy" },
];

/**
 * Had at least one showtime and none of them are still ahead — distinct from a draft or an
 * approved-but-never-scheduled event, neither of which ever had a date to run out. Shared between
 * the filter and the row badge below so the two can never disagree about which events qualify.
 */
function isFinished(ev: MyEvent): boolean {
  return (
    ev.status !== "cancelled" &&
    ev.status !== "draft" &&
    ev.nextShowtimeAt !== null &&
    !ev.hasUpcoming
  );
}

function eventDateParts(value: string | null): { day: string; month: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: new Intl.DateTimeFormat("vi-VN", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("vi-VN", { month: "short" }).format(date).replace(".", ""),
  };
}

function matchesFilter(ev: MyEvent, filter: StatusFilter): boolean {
  const cancelled = ev.status === "cancelled";
  switch (filter) {
    case "all":
      return true;
    // Same compound predicate the header's "Sự kiện đang mở bán" counter uses — one definition of
    // "live" everywhere, so filtering to it can never disagree with the number above the list.
    // `hasUpcoming` is what keeps a finished run (status still `on_sale`, nothing ever flips it)
    // from counting as live just because nobody has gone back and cancelled it.
    case "live":
      return (
        !cancelled && ev.moderation === "approved" && ev.status === "on_sale" && ev.hasUpcoming
      );
    // `moderation` alone is not enough — see `DRAFT_BADGE` — an untouched draft carries the same
    // `pending_review` default an actually-submitted event does, and this filter means the latter.
    case "pending_review":
      return !cancelled && ev.status !== "draft" && ev.moderation === "pending_review";
    case "draft":
      return ev.status === "draft";
    case "finished":
      return isFinished(ev);
    case "cancelled":
      return cancelled;
  }
}

/**
 * Level 1 of the console: the organizer's events.
 *
 * The empty state is explicit rather than a blank region — an organizer who has just been approved
 * and has nothing yet should be told what to do next, not left looking at nothing (FR-040).
 *
 * The search toolbar sits above the rows because it filters THEM: typed text narrows by title and
 * venue, the chips narrow by where the event stands, and both are client-side over the list this
 * screen already holds — an organizer's portfolio is dozens of rows at most, and a round trip per
 * keystroke would buy nothing but latency.
 */
export default function EventList({
  events,
  onOpen,
  onCreate,
}: {
  events: MyEvent[];
  onOpen: (event: MyEvent) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  /** One-based; clamped into range at render, so filter changes can never strand an empty page. */
  const [requestedPage, setRequestedPage] = useState(1);

  const needle = normalise(query);
  const visible = useMemo(() => {
    return events.filter((ev) => {
      if (!matchesFilter(ev, filter)) return false;
      if (!needle) return true;
      return normalise(`${ev.title} ${ev.venueName ?? ""}`).includes(needle);
    });
  }, [events, filter, needle]);

  /*
   * Pagination over the ALREADY-filtered rows. Eight per page: enough that a small portfolio never
   * sees a pager at all, few enough that a scan stays one screen tall.
   */
  const PAGE_SIZE = 8;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  /** Any narrowing resets the reader to page one — stale page numbers are how rows get "lost". */
  const goToPage = (next: number) => setRequestedPage(Math.min(Math.max(1, next), pageCount));
  const resetPage = () => setRequestedPage(1);

  /** True while the toolbar is narrowing anything — switches "no events" into "no MATCHES". */
  const filtering = query.trim() !== "" || filter !== "all";

  if (events.length === 0) {
    return (
      <Empty
        title="Bạn chưa có sự kiện nào."
        hint="Tạo sự kiện đầu tiên để bắt đầu bán vé."
        action={
          <button onClick={onCreate} className={ghost}>
            Tạo sự kiện
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* ---- the toolbar ---- */}
      <div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/*
            Same shape as the public search pill in the site header (`nav-search-input`): a full
            rounded field, taller than a form control, with the icon and the clear button inside
            it rather than a boxed input beside a magnifier. This one stays its own element instead
            of the header's mid-nav expand/collapse — an organizer's toolbar has room for it open
            all the time — but the sizing, radius and icon treatment now match on purpose.
          */}
          <label className="relative flex-1">
            <span className="sr-only">Tìm sự kiện</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-beige-kem/50"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetPage();
              }}
              placeholder="Tìm theo tên sự kiện hoặc địa điểm…"
              className="h-12 w-full rounded-full border-2 border-beige-kem/30 bg-xanh-pho pl-11 pr-10 text-body text-beige-kem outline-none transition-colors placeholder:text-beige-kem/40 focus:border-burgundy"
            />
            {query !== "" && (
              <button
                type="button"
                aria-label="Xóa tìm kiếm"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-beige-kem/60 transition-colors hover:text-beige-kem"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          {/*
            One status field, not five buttons. The chip row put every state at equal weight and
            equal width whether an organizer ever touches it or not; a dropdown asks "which state"
            as one question and answers it with the one that is actually chosen, in the same pill
            shape and height as the search field it now sits beside.
          */}
          <Select
            value={filter}
            options={FILTERS}
            onChange={(v) => {
              setFilter(v as StatusFilter);
              resetPage();
            }}
            triggerClassName="h-12 w-full shrink-0 justify-between border-2 border-beige-kem/30 bg-xanh-pho px-4 text-body text-beige-kem transition-colors hover:border-beige-kem/60 sm:w-48"
          />
        </div>

        {filtering && (
          <p className="mt-2 font-mono text-[11px] text-beige-kem/55">
            {visible.length}/{events.length} sự kiện
            {(query.trim() !== "" || visible.length === 0) && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                    resetPage();
                  }}
                  className="underline decoration-dotted underline-offset-2 hover:text-beige-kem"
                >
                  Xóa bộ lọc
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {/*
        No match is not the same fact as no events. The create call-to-action below belongs to an
        empty PORTFOLIO; an empty RESULT means every row is still there behind the filter, so the
        way back is clearing the search rather than making something new.
      */}
      {visible.length === 0 ? (
        <div className="border-2 border-dashed border-beige-kem/30 p-6 text-center">
          <p className="text-xs font-bold text-beige-kem">Không có sự kiện nào khớp.</p>
          <p className="mt-1 font-mono text-[11px] text-beige-kem/55">
            Thử từ khóa khác hoặc bỏ lọc trạng thái.
          </p>
        </div>
      ) : (
        pageRows.map((ev) => {
          // Cancelled outranks whatever the moderation column says: an approved event that has been
          // cancelled and refunded is not "Đã duyệt" in any sense the organizer cares about.
          const cancelled = ev.status === "cancelled";
          const finished = isFinished(ev);
          const badge = cancelled
            ? { cls: "text-white border-burgundy/60 bg-burgundy/25", text: "Đã hủy" }
            : ev.status === "draft"
              ? DRAFT_BADGE
              : finished
                ? FINISHED_BADGE
                : (BADGE[ev.moderation] ?? { cls: "", text: ev.moderation });
          const isLive =
            !cancelled && ev.moderation === "approved" && ev.status === "on_sale" && ev.hasUpcoming;
          const date = eventDateParts(ev.nextShowtimeAt);
          return (
            <button
              key={ev.id}
              onClick={() => onOpen(ev)}
              className="w-full rounded-2xl border-2 border-beige-kem/25 bg-surface-2 p-4 text-left shadow-sm transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-burgundy/70 hover:bg-bubblegum/10 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 sm:p-5"
            >
              <div className="grid gap-4 md:grid-cols-[5.5rem_minmax(0,1fr)_12rem] md:items-center md:gap-5">
                {/* A stable date tile makes a long list scannable before the title is even read. */}
                <div className="flex items-center gap-3 md:block md:border-r md:border-beige-kem/20 md:pr-5">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border-2 border-burgundy/30 bg-burgundy/10 text-burgundy-ink md:h-16 md:w-16">
                    {date ? (
                      <span className="text-center leading-none">
                        <span className="block font-mono text-2xl font-black tabular-nums">
                          {date.day}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] font-bold uppercase tracking-wide">
                          {date.month}
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono text-xs font-bold">—</span>
                    )}
                  </div>
                </div>

                {/* The middle column carries the event identity and supporting context. */}
                <div className="min-w-0">
                  <span className="block break-words text-lg font-bold leading-snug text-beige-kem sm:text-xl">
                    {ev.title}
                  </span>
                  {ev.nextShowtimeAt && (
                    <p className="mt-2 font-mono text-xs text-ink-soft">
                      {formatShowtimeAt(ev.nextShowtimeAt)}
                      {ev.venueName ? ` · ${ev.venueName}` : ""}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-beige-kem/20 pt-3">
                    <span className="font-mono text-xs tabular-nums text-ink-soft">
                      {ev.totalCapacity > 0
                        ? `${ev.soldTickets.toLocaleString("vi-VN")}/${ev.totalCapacity.toLocaleString("vi-VN")} vé`
                        : "Chưa có hạng vé"}
                    </span>
                    {ev.reviewNote && (
                      <span className="text-xs text-burgundy-ink">{ev.reviewNote}</span>
                    )}
                  </div>
                </div>

                {/* Status and money form a consistent scan target on the right. */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-beige-kem/20 pt-3 md:flex-col md:items-end md:border-t-0 md:pt-0">
                  <span
                    className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-meta font-bold leading-none ${badge.cls}`}
                  >
                    {badge.text}
                  </span>
                  {/*
                    A finished event is still publicly visible if it was approved — nothing hid it,
                    its showtimes just ran out — so "chưa hiển thị công khai" would be a second,
                    contradicting claim sitting under a badge that already said "Đã diễn". Skipped
                    rather than reworded: whether it is still listed is not the question an organizer
                    is asking about a run that is already over.
                  */}
                  {!finished && (
                    <span className="font-mono text-xs text-ink-soft">
                      {isLive ? "Đang hiển thị công khai" : "Chưa hiển thị công khai"}
                    </span>
                  )}
                  <span className="font-mono text-lg font-black tabular-nums text-burgundy-ink sm:text-xl">
                    {formatVnd(ev.totalRevenueVnd)}
                  </span>
                </div>
              </div>
            </button>
          );
        })
      )}

      {/* Match the public event catalogue pager: ruled off, borderless, and set in the page meta type. */}
      {pageCount > 1 && (
        <nav
          aria-label="Phân trang sự kiện"
          className="mt-14 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 border-t border-beige-kem/25 pt-6"
        >
          <button
            type="button"
            aria-label="Trang trước"
            disabled={page === 1}
            onClick={() => goToPage(page - 1)}
            className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:cursor-not-allowed disabled:text-ink-soft/40"
          >
            ‹ Trước
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              aria-current={p === page ? "page" : undefined}
              onClick={() => goToPage(p)}
              className={`min-w-8 px-2 py-1 font-meta text-meta tabular-nums transition ${
                p === page
                  ? "border-b-2 border-burgundy font-bold text-beige-kem"
                  : "text-ink-soft hover:text-beige-kem"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            aria-label="Trang sau"
            disabled={page === pageCount}
            onClick={() => goToPage(page + 1)}
            className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:cursor-not-allowed disabled:text-ink-soft/40"
          >
            Sau ›
          </button>
        </nav>
      )}
    </div>
  );
}
