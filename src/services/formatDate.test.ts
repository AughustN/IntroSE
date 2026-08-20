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

  const thisYear = new Date().getFullYear();

  it("keeps the clock time — two showtimes of one event differ by it, not by the day", () => {
    expect(formatShowtimeAt(localIso(thisYear, 9, 14, 20, 0))).toBe("14/09 20:00");
    expect(formatShowtimeAt(localIso(thisYear, 9, 14, 9, 5))).toBe("14/09 09:05");
  });

  it("omits the year in the current year and prints it otherwise", () => {
    expect(formatShowtimeAt(localIso(thisYear, 1, 2, 3, 4))).toBe("02/01 03:04");
    expect(formatShowtimeAt(localIso(thisYear + 1, 1, 2, 3, 4))).toBe(
      `02/01/${thisYear + 1} 03:04`,
    );
  });

  it("passes unparseable input through rather than rendering Invalid Date", () => {
    expect(formatShowtimeAt("chưa có lịch")).toBe("chưa có lịch");
  });
});
