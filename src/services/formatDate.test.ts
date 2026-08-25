import { describe, expect, it } from "vitest";
import { formatEventDate, formatShowtimeAt } from "./formatDate";

describe("formatEventDate", () => {
  it("renders an ISO day the way a Vietnamese reader expects, day first", () => {
    expect(formatEventDate("2026-09-14")).toBe("14/09");
    expect(formatEventDate("2026-09-14", true)).toBe("14/09/2026");
  });

  it("passes anything that is not an ISO day straight through", () => {
    expect(formatEventDate("Sắp công bố")).toBe("Sắp công bố");
  });
});

describe("formatShowtimeAt", () => {
  /*
   * Built from local parts rather than an ISO string with a zone: the function formats in LOCAL time,
   * so a `Z` literal would make these assertions depend on the machine's timezone and fail wherever
   * the suite is not run at UTC+7.
   */
  const localIso = (y: number, m: number, d: number, hh: number, mm: number) =>
    new Date(y, m - 1, d, hh, mm).toISOString();

  const WEEKDAYS_VI = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

  const thisYear = new Date().getFullYear();
  const expected = (y: number, m: number, d: number, hh: number, mm: number) => {
    const at = new Date(y, m - 1, d);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(hh)}:${pad(mm)}, ${WEEKDAYS_VI[at.getDay()]} ${pad(d)}/${pad(m)}/${y}`;
  };

  it("leads with the clock time, names the weekday, and prints the full date", () => {
    expect(formatShowtimeAt(localIso(thisYear, 9, 14, 20, 0))).toBe(
      expected(thisYear, 9, 14, 20, 0),
    );
    expect(formatShowtimeAt(localIso(thisYear, 9, 14, 9, 5))).toBe(expected(thisYear, 9, 14, 9, 5));
  });

  it("always prints the year, current or not — a month-spanning list needs it", () => {
    expect(formatShowtimeAt(localIso(thisYear, 1, 2, 3, 4))).toBe(expected(thisYear, 1, 2, 3, 4));
    expect(formatShowtimeAt(localIso(thisYear + 1, 1, 2, 3, 4))).toBe(
      expected(thisYear + 1, 1, 2, 3, 4),
    );
  });

  it("always prints the year, current or not — a month-spanning list needs it", () => {
    expect(formatShowtimeAt(localIso(thisYear, 1, 2, 3, 4))).toBe(
      "03:04, Thứ Sáu 02/01/" + thisYear,
    );
    expect(formatShowtimeAt(localIso(thisYear + 1, 1, 2, 3, 4))).toBe(
      "03:04, Thứ Bảy 02/01/" + (thisYear + 1),
    );
  });

  it("passes unparseable input through rather than rendering Invalid Date", () => {
    expect(formatShowtimeAt("chưa có lịch")).toBe("chưa có lịch");
  });
});
