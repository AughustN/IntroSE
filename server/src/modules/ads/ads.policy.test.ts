import { describe, expect, it } from "vitest";
import { capacityLimit, chooseFair, unavailable } from "./ads.policy.js";
import { playableTrailer } from "@shared/ads/trailer.js";

describe("equal advertising opportunities", () => {
  it.each([1, 4, 20])("serves every one of %i campaigns without starvation", (count) => {
    const rows = Array.from({ length: count }, (_, id) => ({ id, turns: 0, last: 0 }));
    for (let i = 1; i <= count * 100; i++) {
      const [selected] = chooseFair(rows, 1);
      selected.turns++;
      selected.last = i;
    }
    expect(rows.every((r) => r.turns === 100)).toBe(true);
  });
  it("shares 10 hot slots between 20 campaigns with no duplicate in a batch", () => {
    const rows = Array.from({ length: 20 }, (_, id) => ({ id, turns: 0, last: 0 }));
    for (let i = 1; i <= 100; i++) {
      const chosen = chooseFair(rows, 10);
      expect(new Set(chosen.map((r) => r.id)).size).toBe(10);
      chosen.forEach((r) => {
        r.turns++;
        r.last = i;
      });
    }
    expect(rows.every((r) => r.turns === 50)).toBe(true);
  });
  it("a new campaign initialized at the active floor has no lifetime catch-up debt", () => {
    const rows = [
      { id: 1, turns: 300, last: 2 },
      { id: 2, turns: 301, last: 3 },
      { id: 3, turns: 300, last: 0 },
    ];
    expect(chooseFair(rows, 2).map((r) => r.id)).toEqual([3, 1]);
    expect(rows[0].id).toBe(1); // chooser does not mutate caller order
  });
  it("blocks a combo if either placement is full or reserved for legacy contracts", () => {
    const hot = { placement: "hot_events" as const, reserved: 2, limit: 20, legacy: false };
    expect(unavailable([hot])).toBe(false);
    expect(
      unavailable([hot, { placement: "hero_trailer", reserved: 4, limit: 4, legacy: false }]),
    ).toBe(true);
    expect(unavailable([{ ...hot, legacy: true }])).toBe(true);
  });
  it.each(["0", "-1", "2.2", "hello", "1001", ""])(
    "rejects invalid deployment capacity %s",
    (value) => {
      expect(() => capacityLimit(value, 4)).toThrow();
    },
  );
  it("uses configurable positive capacities", () => {
    expect(capacityLimit(undefined, 4)).toBe(4);
    expect(capacityLimit("8", 4)).toBe(8);
  });
  it.each([null, "", "https://youtube.com/watch?v=x", "javascript:alert(1)"])(
    "does not sell a trailer slot for %s",
    (url) => {
      expect(playableTrailer(url)).toBeNull();
    },
  );
  it("accepts playable video files and Cloudinary videos", () => {
    expect(playableTrailer("https://example.test/trailer.mp4?x=1")).toBeTruthy();
    expect(playableTrailer("https://res.cloudinary.com/demo/video/upload/trailer")).toBeTruthy();
  });
});
