import { describe, expect, it } from "vitest";
import { cleanGenre, cleanLineup } from "./fix-movie-arrays.js";

/*
 * The importer wrote a JSON array into a `TEXT[]`, so Postgres split it on commas and kept the
 * punctuation. These are the five faults that produced, and what each should become.
 */

describe("repairing an imported film lineup", () => {
  it("undoes every fault in one real row", () => {
    // `Moana live action`, exactly as stored.
    expect(
      cleanLineup([
        '{"Director: Thomas Kail',
        '"Đạo diễn: Thomas Kail"',
        '"Writers: Jared Bush"',
        '"Dana Ledoux Miller"',
        '"Ron Clements"',
        '"Dwayne Johnson"',
        '"Catherine Laga&apos;aia"',
        '"Rena Owen"',
        '"Catherine Laga‘aia"',
        '"John Tui"',
        '"Frankie Adams"',
        `"Catherine Laga'aia"}`,
      ]),
    ).toEqual([
      "Đạo diễn: Thomas Kail",
      "Biên kịch: Jared Bush",
      "Dana Ledoux Miller",
      "Ron Clements",
      "Dwayne Johnson",
      "Catherine Laga'aia",
      "Rena Owen",
      "John Tui",
      "Frankie Adams",
    ]);
  });

  it("strips the array's own braces and quotes", () => {
    expect(cleanLineup(['{"A', '"B"', '"C"}'])).toEqual(["A", "B", "C"]);
  });

  it("folds the English and Vietnamese label onto one credit", () => {
    expect(cleanLineup(['{"Director: X', '"Đạo diễn: X"'])).toEqual(["Đạo diễn: X"]);
    expect(cleanLineup(['"Writers: Y"'])).toEqual(["Biên kịch: Y"]);
    expect(cleanLineup(['"Stars: Z"'])).toEqual(["Diễn viên: Z"]);
  });

  it("keeps one person twice when the two credits are different jobs", () => {
    // The Odyssey: Nolan directed it and wrote it. Two facts, not one duplicate.
    expect(
      cleanLineup(['{"Director: Christopher Nolan', '"Đạo diễn: Christopher Nolan"', '"Writers: Christopher Nolan"']),
    ).toEqual(["Đạo diễn: Christopher Nolan", "Biên kịch: Christopher Nolan"]);
  });

  it("treats three spellings of one apostrophe as one name", () => {
    expect(
      cleanLineup(['"Catherine Laga&apos;aia"', '"Catherine Laga‘aia"', `"Catherine Laga'aia"`]),
    ).toEqual(["Catherine Laga'aia"]);
  });

  it("drops a truncation marker rather than storing it as part of a name", () => {
    expect(cleanLineup(['"Charlize Theron"', '"Charlize Theron…"'])).toEqual(["Charlize Theron"]);
    expect(cleanLineup(['"Someone..."'])).toEqual(["Someone"]);
  });

  it("drops what is left of an element that was only punctuation", () => {
    expect(cleanLineup(['{"', '"}', '"  "'])).toEqual([]);
  });

  it("leaves an already-clean lineup exactly as it is", () => {
    // The 539 hand-entered events must survive the same pass untouched.
    const clean = ["Sơn Tùng M-TP", "Vũ", "Đen Vâu", "Hà Anh Tuấn"];
    expect(cleanLineup(clean)).toEqual(clean);
  });
});

describe("repairing an imported film's tags", () => {
  it("collapses the bilingual pair the importer wrote twice", () => {
    // `Người Nhện 4`, exactly as stored: six tags for three genres.
    expect(
      cleanGenre([
        '{"Action"',
        '"Adventure"',
        '"Sci-Fi"',
        '"Khoa Học Viễn Tưởng"',
        '"Hành Động"',
        '"Phiêu Lưu"',
        '"Thần thoại"}',
      ]),
    ).toEqual(["Hành động", "Phiêu lưu", "Khoa học viễn tưởng", "Thần thoại"]);
  });

  it("treats a casing difference as one tag", () => {
    // `Cô Nàng Ngổ Ngáo` carried both "Tình Cảm" and "Tình cảm".
    expect(cleanGenre(['{"Hài"', '"Tình Cảm"', '"Tâm Lý"', '"Tình cảm"}'])).toEqual([
      "Hài",
      "Tình cảm",
      "Tâm lý",
    ]);
  });

  it("puts every tag in the sentence case the category labels use", () => {
    expect(cleanGenre(['"Drama"', '"Sci-Fi"', '"Film-Noir"'])).toEqual([
      "Tâm lý",
      "Khoa học viễn tưởng",
      "Phim đen",
    ]);
  });

  it("folds a synonym onto the tag already in use", () => {
    expect(cleanGenre(['"Thriller"', '"Hồi hộp"', '"Giật Gân"'])).toEqual(["Giật gân"]);
  });

  it("keeps a tag it has never been taught", () => {
    // Dropping the unknown would lose data every time somebody invents a tag.
    expect(cleanGenre(['{"Chèo"', '"Cải lương"}'])).toEqual(["Chèo", "Cải lương"]);
  });

  it("leaves an already-clean tag list alone", () => {
    const clean = ["Âm nhạc", "Pop", "Rock", "Indie"];
    expect(cleanGenre(clean)).toEqual(clean);
  });

  it("folds the rest of the catalogue's English tags too", () => {
    // Concerts and workshops were tagged in English by hand, so the rail showed "Technology"
    // beside "Công nghệ" for one idea.
    expect(cleanGenre(["Technology", "Food", "Culture", "Art"])).toEqual([
      "Công nghệ",
      "Ẩm thực",
      "Văn hóa",
      "Nghệ thuật",
    ]);
    expect(cleanGenre(["Marketing", "Investment", "Finance", "Running"])).toEqual([
      "Tiếp thị",
      "Đầu tư",
      "Tài chính",
      "Chạy bộ",
    ]);
  });

  it("keeps the words Vietnamese speakers use in English", () => {
    // "nhạc đá" is not a thing anybody asks for, and AI/Crypto/Workshop/Marathon are the words
    // actually in use.
    const kept = ["Pop", "Rock", "Indie", "EDM", "DJ", "AI", "Crypto", "Workshop", "Marathon"];
    expect(cleanGenre(kept)).toEqual(kept);
  });

  it("folds an English tag onto a Vietnamese one already on the same event", () => {
    expect(cleanGenre(["Công nghệ", "Technology", "AI"])).toEqual(["Công nghệ", "AI"]);
  });
});
