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
  return ev.status !== "cancelled" && ev.status !== "draft" && ev.nextShowtimeAt !== null && !ev.hasUpcoming;
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
      return !cancelled && ev.moderation === "approved" && ev.status === "on_sale" && ev.hasUpcoming;
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
            ? { cls: "text-beige-kem border-burgundy/60 bg-burgundy/25", text: "Đã hủy" }
            : ev.status === "draft"
              ? DRAFT_BADGE
              : finished
                ? FINISHED_BADGE
                : (BADGE[ev.moderation] ?? { cls: "", text: ev.moderation });
          const isLive =
            !cancelled && ev.moderation === "approved" && ev.status === "on_sale" && ev.hasUpcoming;
          return (
            <button
              key={ev.id}
              onClick={() => onOpen(ev)}
              className="w-full border-2 border-beige-kem p-4 text-left transition hover:border-burgundy"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {/* The title alone on the left — scanning a page of these reads titles first, not
                    a wall of same-weight text an organizer has to parse line by line. */}
                <div className="min-w-0">
                  <span className="block break-words text-lg font-bold leading-snug text-beige-kem sm:text-xl">
                    {ev.title}
                  </span>
                </div>

                {/*
                  Where the event stands, moved to the right and led with the badge rather than
                  buried under the title in the same small mono as everything else — status is the
                  first thing an organizer scanning this list is trying to answer, so it gets the
                  corner a reader's eye lands on right after the title.
                */}
                <div className="flex shrink-0 flex-col items-end gap-1">
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
                    <span className="font-mono text-xs text-beige-kem/45">
                      {isLive ? "Đang hiển thị công khai" : "Chưa hiển thị công khai"}
                    </span>
                  )}
                </div>
              </div>

              {/*
                WHEN and WHERE. Rendered only when there is a showtime to name — an event created but
                not yet scheduled prints no line at all rather than a row of dashes, because a
                placeholder costs the same vertical space as the answer while carrying none of it.
              */}
              {ev.nextShowtimeAt && (
                <p className="mt-2 font-mono text-xs text-beige-kem/60">
                  {formatShowtimeAt(ev.nextShowtimeAt)}
                  {ev.venueName ? ` · ${ev.venueName}` : ""}
                </p>
              )}

              {/*
                HOW IT IS SELLING — the question the organizer opened this page with. Sold-over-capacity
                rather than sold alone: 12 tickets means nothing without knowing whether the room holds
                20 or 2,000. Ruled off and given its own row, with revenue set apart from the ticket
                count beside it — bigger, bolder, and in the one accent colour this console spends on
                money — because "how much did this make" is the number an organizer actually opens the
                list to check, and it used to sit in the same small grey mono as everything above it.

                Capacity of 0 means no tier has been created yet, so there is nothing to be a fraction
                OF; that case shows the revenue alone rather than the "0/0" that reads like a sold-out
                room of no seats.
              */}
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-beige-kem/20 pt-3">
                <span className="font-mono text-xs tabular-nums text-beige-kem/70">
                  {ev.totalCapacity > 0
                    ? `${ev.soldTickets.toLocaleString("vi-VN")}/${ev.totalCapacity.toLocaleString("vi-VN")} vé`
                    : "Chưa có hạng vé"}
                </span>
                <span className="font-mono text-lg font-black tabular-nums text-burgundy-ink sm:text-xl">
                  {formatVnd(ev.totalRevenueVnd)}
                </span>
              </div>

              {ev.reviewNote && <p className="mt-2 text-xs text-burgundy">{ev.reviewNote}</p>}
            </button>
          );
        })
      )}

      {/*
        The pager, shown only when more than one page exists. Numbered buttons rather than a bare
        arrow pair: an organizer hunting for an event from three weeks ago navigates by memory of
        position, and a page NUMBER says where they are without counting presses.
      */}
      {pageCount > 1 && (
        <nav
          aria-label="Phân trang sự kiện"
          className="flex items-center justify-center gap-1 pt-2"
        >
          <button
            type="button"
            aria-label="Trang trước"
            disabled={page === 1}
            onClick={() => goToPage(page - 1)}
            className="border-2 border-beige-kem/30 px-3 py-1.5 text-xs font-bold text-beige-kem/70 transition-colors hover:border-beige-kem/60 hover:text-beige-kem disabled:opacity-30"
          >
            ‹
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              aria-current={p === page ? "page" : undefined}
              onClick={() => goToPage(p)}
              className={`min-w-9 border-2 px-3 py-1.5 text-xs font-bold tabular-nums transition-colors ${
                p === page
                  ? "border-burgundy bg-burgundy/15 text-beige-kem"
                  : "border-beige-kem/25 text-beige-kem/55 hover:border-beige-kem/60 hover:text-beige-kem"
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
            className="border-2 border-beige-kem/30 px-3 py-1.5 text-xs font-bold text-beige-kem/70 transition-colors hover:border-beige-kem/60 hover:text-beige-kem disabled:opacity-30"
          >
            ›
          </button>
        </nav>
      )}
    </div>
  );
}
