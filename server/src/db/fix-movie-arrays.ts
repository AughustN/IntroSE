/**
 * Repair `events.lineup` and `events.genre` for the imported films.
 *
 * Run with `npm run db:fix-movies`.
 *
 * The importer serialised a JSON array to a string and handed the string to a `TEXT[]` column, so
 * Postgres split it on commas and kept the punctuation. Every film's cast reads:
 *
 *     {"Director: Thomas Kail      ← the array's own opening brace and quote
 *     "Đạo diễn: Thomas Kail"      ← the same person again, in the other language
 *     "Writers: Jared Bush"        ← a role prefix on the first writer only
 *     "Dana Ledoux Miller"         ← …and none on the rest
 *     "Catherine Laga&apos;aia"    ← an HTML entity that was never decoded
 *     "Catherine Laga‘aia"         ← the same name with a curly apostrophe
 *     "Catherine Laga'aia"}        ← and again with a straight one, plus the closing brace
 *
 * Five faults in one field. `genre` was written by the same importer and carries the same wrapper,
 * plus two of its own: the tag list holds "Action" AND "Hành Động" for one film, and "Tình Cảm"
 * beside "Tình cảm". This undoes all of it, and only for the 237 films that carry it — the 539
 * other events were entered by hand and are already clean, so they are not touched.
 *
 * Roles are kept, not flattened. A bare list of names would be tidier to produce and would throw
 * away the one thing the prefixes are good for: on `The Odyssey`, Christopher Nolan is both the
 * director and a writer, and two credits for one person is a fact about the film rather than a
 * duplicate to collapse.
 */
import { pool } from "./pool.js";

/** The entities this importer left behind. Not a general HTML decoder — it does not need to be. */
const ENTITIES: Record<string, string> = {
  "&apos;": "'",
  "&#39;": "'",
  "&quot;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

/** English and Vietnamese role labels, both folded onto the Vietnamese one the site reads in. */
const ROLES: Array<[RegExp, string]> = [
  [/^(directors?|đạo diễn)\s*:\s*/i, "Đạo diễn"],
  [/^(writers?|screenplay|biên kịch)\s*:\s*/i, "Biên kịch"],
  [/^(stars?|cast|diễn viên)\s*:\s*/i, "Diễn viên"],
  [/^(producers?|nhà sản xuất)\s*:\s*/i, "Nhà sản xuất"],
];

/**
 * The tag vocabulary, in the language the site is written in.
 *
 * The importer wrote IMDb's English genres and, for some films, a Vietnamese translation as well —
 * so `Người Nhện 4` was tagged `Action, Adventure, Sci-Fi, Khoa Học Viễn Tưởng, Hành Động, Phiêu
 * Lưu`: six tags for three genres. Folding English onto Vietnamese collapses the pair and leaves a
 * list a Vietnamese reader can actually scan.
 *
 * Sentence case, because that is what `event_categories.label_vi` uses ("Âm nhạc", "Gia đình") and
 * a tag row that mixes "Hành Động" with "Gia đình" looks like two different systems.
 */
const GENRES: Record<string, string> = {
  action: "Hành động",
  adventure: "Phiêu lưu",
  animation: "Hoạt hình",
  biography: "Tiểu sử",
  comedy: "Hài",
  crime: "Tội phạm",
  documentary: "Tài liệu",
  drama: "Tâm lý",
  family: "Gia đình",
  fantasy: "Giả tưởng",
  "film-noir": "Phim đen",
  history: "Lịch sử",
  horror: "Kinh dị",
  music: "Âm nhạc",
  musical: "Nhạc kịch",
  mystery: "Bí ẩn",
  romance: "Tình cảm",
  "sci-fi": "Khoa học viễn tưởng",
  "science fiction": "Khoa học viễn tưởng",
  sport: "Thể thao",
  thriller: "Giật gân",
  war: "Chiến tranh",
  western: "Miền Tây",
  // Vietnamese spellings already in the data, folded onto one casing — and one synonym.
  "hành động": "Hành động",
  "phiêu lưu": "Phiêu lưu",
  "hoạt hình": "Hoạt hình",
  "tâm lý": "Tâm lý",
  hài: "Hài",
  "kinh dị": "Kinh dị",
  "gia đình": "Gia đình",
  "giả tưởng": "Giả tưởng",
  "bí ẩn": "Bí ẩn",
  "khoa học viễn tưởng": "Khoa học viễn tưởng",
  "giật gân": "Giật gân",
  "hồi hộp": "Giật gân",
  "tội phạm": "Tội phạm",
  "lịch sử": "Lịch sử",
  "tình cảm": "Tình cảm",
  "chiến tranh": "Chiến tranh",
  "thần thoại": "Thần thoại",

  /*
   * The rest of the catalogue, not just films.
   *
   * Concerts, workshops and exhibitions were tagged in English by whoever entered them, so the tag
   * rail mixed "Công nghệ" with "Technology" for the same idea. Anything with an ordinary
   * Vietnamese word folds onto it.
   */
  technology: "Công nghệ",
  food: "Ẩm thực",
  culture: "Văn hóa",
  art: "Nghệ thuật",
  "digital art": "Nghệ thuật số",
  festival: "Lễ hội",
  "music festival": "Lễ hội âm nhạc",
  "beach party": "Tiệc bãi biển",
  marketing: "Tiếp thị",
  investment: "Đầu tư",
  finance: "Tài chính",
  running: "Chạy bộ",
  fitness: "Thể hình",
};

/*
 * Words that stay in English, because translating them makes them harder to read.
 *
 * Music genres are proper names of styles — nobody in Vietnam asks for "nhạc đá" — and `AI`,
 * `Crypto`, `Workshop` and `Marathon` are the words Vietnamese speakers actually use. Listed
 * explicitly rather than left to fall through `GENRES`, so the decision is written down instead of
 * being an accident of what the table happens to omit.
 */
const KEEP_ENGLISH = new Set(["pop", "rock", "indie", "edm", "dj", "ai", "crypto", "workshop", "marathon"]);

/**
 * One array element, cleaned.
 *
 * Returns null for anything that is left empty — the closing `"}` on its own, say — so the caller
 * can drop it rather than store a blank credit.
 */
function cleanEntry(raw: string): string | null {
  let text = raw;

  // 1. The wrapper Postgres never removed, because it was never Postgres's to remove.
  text = text.replace(/^\{/, "").replace(/\}$/, "");
  text = text.replace(/^"/, "").replace(/"$/, "");

  // 2. Entities the importer copied through as literal text.
  for (const [entity, char] of Object.entries(ENTITIES)) text = text.split(entity).join(char);

  // 3. One apostrophe. `Laga‘aia`, `Laga’aia` and `Laga'aia` are one woman, and three spellings of
  //    her name is three entries in a list that should hold her once.
  text = text.replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"');

  // 4. A truncation marker is not part of anybody's name.
  text = text.replace(/\s*(\.\.\.|…)\s*$/, "");

  // 5. The role, in one language.
  for (const [pattern, label] of ROLES) {
    if (pattern.test(text)) {
      text = `${label}: ${text.replace(pattern, "")}`;
      break;
    }
  }

  text = text.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/** Case-insensitive, so `DIỄN VIÊN: X` and `Diễn viên: X` are not two credits. */
const keyOf = (entry: string) => entry.toLocaleLowerCase("vi");

export function cleanLineup(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const entry = cleanEntry(item);
    if (!entry) continue;
    /*
     * Deduplicated on the WHOLE credit, not on the name.
     *
     * "Đạo diễn: Christopher Nolan" and "Biên kịch: Christopher Nolan" survive together, because he
     * did both jobs. What collapses is the same credit twice — which is what the English/Vietnamese
     * pair became once both were folded onto one label.
     */
    const key = keyOf(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * The tag list, unwrapped and reduced to one tag per genre.
 *
 * Shares `cleanEntry` with the lineup — same importer, same wrapper, same entities — then does the
 * one thing tags need that names do not: map a known genre onto its canonical Vietnamese spelling.
 * Anything unrecognised is kept exactly as written; a vocabulary that silently drops what it has
 * not been taught loses data every time somebody adds a tag.
 */
export function cleanGenre(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const entry = cleanEntry(item);
    if (!entry) continue;
    const lower = entry.toLocaleLowerCase("vi");
    // An unrecognised tag is kept as written either way; the set only records that the omission
    // from `GENRES` was deliberate.
    const canonical = KEEP_ENGLISH.has(lower) ? entry : (GENRES[lower] ?? entry);
    const key = canonical.toLocaleLowerCase("vi");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

async function main(): Promise<void> {
  const { rows } = await pool.query<{
    id: number;
    title: string;
    lineup: string[];
    genre: string[];
  }>(
    /*
     * Every event, not only the films.
     *
     * The wrapper damage is the importer's and is confined to films, but the tag vocabulary is the
     * whole catalogue's — and both cleaners are proven no-ops on data that is already correct, so a
     * hand-entered concert passes through untouched unless its tags really do need folding.
     */
    `SELECT e.id, e.title, e.lineup, e.genre FROM events e ORDER BY e.id`,
  );

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const stat = {
    lineup: { rows: 0, before: 0, after: 0 },
    genre: { rows: 0, before: 0, after: 0 },
  };
  const samples: string[] = [];

  for (const film of rows) {
    const lineup = cleanLineup(film.lineup ?? []);
    const genre = cleanGenre(film.genre ?? []);
    stat.lineup.before += film.lineup?.length ?? 0;
    stat.lineup.after += lineup.length;
    stat.genre.before += film.genre?.length ?? 0;
    stat.genre.after += genre.length;

    const lineupChanged = !same(lineup, film.lineup ?? []);
    const genreChanged = !same(genre, film.genre ?? []);
    if (!lineupChanged && !genreChanged) continue;
    if (lineupChanged) stat.lineup.rows++;
    if (genreChanged) stat.genre.rows++;

    await pool.query(`UPDATE events SET lineup = $2, genre = $3 WHERE id = $1`, [
      film.id,
      lineup,
      genre,
    ]);

    if (genreChanged && samples.length < 3) {
      samples.push(
        [
          `  ${film.title}`,
          `    before: ${JSON.stringify(film.genre)}`,
          `    after:  ${JSON.stringify(genre)}`,
        ].join("\n"),
      );
    }
  }

  console.log(`films inspected: ${rows.length}`);
  for (const [name, s] of Object.entries(stat)) {
    console.log(
      `  ${name.padEnd(7)} ${String(s.rows).padStart(4)} rewritten · ` +
        `${s.before} → ${s.after} entries (${s.before - s.after} removed)`,
    );
  }
  if (samples.length) console.log(`\n${samples.join("\n\n")}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
