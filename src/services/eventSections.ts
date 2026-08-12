/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The landing page's four bands, and which catalogue categories belong to each.
 *
 * The bands are fixed — phim, ca nhạc, sân khấu & nghệ thuật, khác — but the categories under them
 * are not: they are Admin-managed rows (UC-35), so the codes are whatever the console has created
 * over the life of the database. A band cannot therefore name a single code; it names a *shape* of
 * category, and the codes that fall into it are worked out from the catalogue at run time.
 *
 * Matching runs over the code **and** the Vietnamese label, folded to unaccented lowercase, because
 * an admin-created category carries a generated code (`custom_nhac_song_1786192179702`) whose only
 * readable part is the same word the label spells out.
 *
 * `other` is the fallback and has no keywords of its own — a category is "khác" precisely when it is
 * none of the three above it. Which also means adding a keyword to one of them automatically empties
 * that much out of "Khác", with nothing else to keep in step.
 */

import type { MovieEvent } from "../types";

export type SectionId = "movie" | "music" | "stage" | "other";

/** Unaccented lowercase, `đ` folded to `d`. Both halves of every comparison go through this. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

/**
 * The three named bands, in the order they are tested.
 *
 * Order matters where a label could answer to two of them — "nhạc kịch" is music before it is
 * theatre — so this is a list rather than a map.
 */
const KEYWORDS: ReadonlyArray<{ id: Exclude<SectionId, "other">; words: readonly string[] }> = [
  { id: "movie", words: ["phim", "movie", "cinema", "dien anh", "chieu bong"] },
  { id: "music", words: ["music", "nhac", "concert", "liveshow", "live show", "gala"] },
  {
    id: "stage",
    words: [
      "theatre",
      "theater",
      "san khau",
      "kich",
      "xiec",
      "nghe thuat",
      "trien lam",
      "exhibition",
      "opera",
      "ballet",
      // No bare "art": it is a substring of ordinary words a category could be called ("startup"),
      // and a keyword that matches by accident is worse than one category landing in "Khác".
      "nghe si",
    ],
  },
];

/** Which band a category belongs to. Never throws and never returns nothing — everything is at worst "khác". */
export function sectionOfCategory(code: string, label: string): SectionId {
  const haystack = `${fold(code)} ${fold(label)}`;
  for (const { id, words } of KEYWORDS) {
    if (words.some((word) => haystack.includes(word))) return id;
  }
  return "other";
}

export interface LandingSection {
  id: SectionId;
  /** What the band is called on screen. */
  title: string;
  eyebrow: string;
  /** Shown in place of the cards when the catalogue has nothing for this band yet. */
  emptyNote: string;
  /**
   * The category codes this band covers, taken from the events it found.
   *
   * Handed to the filter behind "Xem thêm" so `/events` shows exactly the set the band was drawing
   * from — a second, hand-written filter would be a different question with the same label on it.
   */
  codes: string[];
  events: MovieEvent[];
}

const BANDS: ReadonlyArray<Pick<LandingSection, "id" | "title" | "eyebrow" | "emptyNote">> = [
  {
    id: "movie",
    title: "Phim sắp chiếu",
    eyebrow: "Điện ảnh",
    emptyNote: "Chưa có suất chiếu nào được mở bán. Mời bạn quay lại sau.",
  },
  {
    id: "music",
    title: "Ca nhạc",
    eyebrow: "Nhạc sống",
    emptyNote: "Chưa có đêm nhạc nào đang mở bán.",
  },
  {
    id: "stage",
    title: "Sân khấu & Nghệ thuật",
    eyebrow: "Trình diễn",
    emptyNote: "Chưa có suất diễn nào đang mở bán.",
  },
  {
    id: "other",
    title: "Khác",
    eyebrow: "Mọi thể loại",
    emptyNote: "Chưa có sự kiện nào ở nhóm này.",
  },
];

/**
 * Whether an event is worth putting in front of someone. Sold-out, finished and cancelled events
 * still appear — the catalogue is honest about them — but never ahead of one that can be bought.
 */
const bookable = (event: MovieEvent): boolean =>
  event.status === "available" || event.status === "low";

/** Soonest first, and undated last: a band of four is a shortlist, so the nearest dates earn it. */
function byRelevance(a: MovieEvent, b: MovieEvent): number {
  if (bookable(a) !== bookable(b)) return bookable(a) ? -1 : 1;
  const dateA = a.dates[0] ?? "";
  const dateB = b.dates[0] ?? "";
  if (!dateA !== !dateB) return dateA ? -1 : 1;
  return dateA.localeCompare(dateB);
}

/**
 * Split the catalogue into the four bands.
 *
 * Every band is returned even when it is empty — "Phim sắp chiếu" with nothing under it is a real
 * statement about the catalogue, and a band that disappears when it has no events is a band the
 * reader cannot tell from one that was never there.
 */
export function buildLandingSections(events: MovieEvent[], perSection = 4): LandingSection[] {
  const grouped = new Map<SectionId, MovieEvent[]>();
  const codes = new Map<SectionId, Set<string>>();

  for (const event of events) {
    if (!event.category) continue;
    const id = sectionOfCategory(event.category, event.categoryLabel || "");
    (grouped.get(id) ?? grouped.set(id, []).get(id)!).push(event);
    (codes.get(id) ?? codes.set(id, new Set()).get(id)!).add(event.category);
  }

  return BANDS.map((band) => ({
    ...band,
    codes: [...(codes.get(band.id) ?? [])],
    events: [...(grouped.get(band.id) ?? [])].sort(byRelevance).slice(0, perSection),
  }));
}

/**
 * Whether a category is the catalogue's own "Khác" — the row the filter list keeps at the bottom.
 *
 * A real category, not the `other` *band* above: a catalogue can carry a literal "Khác" row that an
 * organizer picked deliberately, and it sorts last however many events it holds, because a list of
 * named things ending in "Khác" reads as complete and one beginning with it reads as unsorted.
 */
export function isCatchAllCategory(code: string, label: string): boolean {
  const folded = `${fold(code)}|${fold(label)}`;
  return /(^|\|)other($|\|)|(^|\|)khac($|\|)/.test(folded);
}
