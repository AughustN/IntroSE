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
  /**
   * The band's own sub-divisions, when it has any. Only cinema does (0038).
   *
   * A film that opens next month and one playing tonight are both "on sale", and putting them in one
   * row of four means the row answers neither question a reader arrives with. The split is by
   * `releasePhase`, which the organizer sets — see the migration for why a date cannot decide it.
   *
   * `events` still holds the band's default set, so a caller that ignores tabs shows something
   * sensible rather than nothing.
   */
  tabs?: LandingTab[];
}

export interface LandingTab {
  id: string;
  label: string;
  events: MovieEvent[];
  /** Shown in place of the cards when this tab has nothing. */
  emptyNote: string;
}

const BANDS: ReadonlyArray<Pick<LandingSection, "id" | "title" | "eyebrow" | "emptyNote">> = [
  {
    id: "movie",
    title: "Phim sắp chiếu",
    // The word on the marquee. English on purpose: "CINEMA" is what is written on the sign outside a
    // cinema in Vietnam too, it sets wide and evenly in caps, and it is six letters rather than the
    // eight of "ĐIỆN ẢNH" — which matters on a plate that has to stay narrower than the tabs below.
    eyebrow: "Cinema",
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
 * Whether an event is worth putting in front of someone. Sold out still counts — it is a real,
 * upcoming event that could sell more later — and is only sorted behind one that can be bought
 * right now. `finished` is excluded before this ever runs (see `buildLandingSections`): the
 * landing page is a shortlist of what to do next, not an archive of what already happened.
 */
const bookable = (event: MovieEvent): boolean =>
  event.status === "available";

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
/**
 * How many films a cinema row holds, and therefore how many the band asks for.
 *
 * Five, where the other bands take four: a poster is about half the width of a still at the same
 * height, so five fit across before the row starts to tower over its neighbours. The band was being
 * sliced to four while its grid was already five wide, which left the fifth column empty on every
 * load — a gap that reads as a missing card rather than as a deliberate margin.
 *
 * `CategoryRow` hardcodes the matching `lg:grid-cols-5`, because Tailwind compiles class names it
 * can see in the source and cannot build one from a variable. The two have to be changed together.
 */
export const CINEMA_PER_ROW = 5;

export function buildLandingSections(events: MovieEvent[], perSection = 4): LandingSection[] {
  const grouped = new Map<SectionId, MovieEvent[]>();
  const codes = new Map<SectionId, Set<string>>();

  for (const event of events) {
    if (!event.category) continue;
    // An event whose last showtime has already passed has nothing left to invite anyone to — it
    // is dropped here, before grouping, so it can never fill a band's last empty slot the way a
    // sold-out (still upcoming) event legitimately can.
    if (event.status === "finished") continue;
    const id = sectionOfCategory(event.category, event.categoryLabel || "");
    (grouped.get(id) ?? grouped.set(id, []).get(id)!).push(event);
    (codes.get(id) ?? codes.set(id, new Set()).get(id)!).add(event.category);
  }

  return BANDS.map((band) => {
    const all = [...(grouped.get(band.id) ?? [])].sort(byRelevance);
    const cinema = band.id === "movie";
    const take = cinema ? CINEMA_PER_ROW : perSection;
    return {
      ...band,
      codes: [...(codes.get(band.id) ?? [])],
      events: all.slice(0, take),
      tabs: cinema ? cinemaTabs(all, take) : undefined,
    };
  });
}

/**
 * Cinema's two tabs: what is coming, then what is on.
 *
 * Upcoming leads. The band is the one place on the landing page that can tell somebody about a film
 * before it opens, and a reader who already knows what is playing tonight is the reader most likely
 * to go looking; the other order puts the news second.
 *
 * A film with no `releasePhase` — anything that predates 0038, or a card built before the column
 * reached the client — counts as now showing, matching the column's own default.
 */
function cinemaTabs(films: MovieEvent[], perTab: number): LandingTab[] {
  const upcoming = films.filter((film) => film.releasePhase === "upcoming");
  const nowShowing = films.filter((film) => film.releasePhase !== "upcoming");
  return [
    {
      id: "upcoming",
      label: "Sắp chiếu",
      events: upcoming.slice(0, perTab),
      emptyNote: "Chưa có phim nào được công bố lịch chiếu.",
    },
    {
      id: "now_showing",
      label: "Đang chiếu",
      events: nowShowing.slice(0, perTab),
      emptyNote: "Chưa có phim nào đang chiếu.",
    },
  ];
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
