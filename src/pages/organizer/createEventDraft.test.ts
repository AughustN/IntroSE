import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, isWorthSaving, loadDraft, saveDraft } from "./createEventDraft";

/**
 * The unsaved create-event form.
 *
 * What matters here is not that a round trip works — it is the three rules that make the feature
 * safe: an untouched form leaves nothing behind, junk in storage never reaches the form, and a
 * failing `localStorage` cannot take the form down with it.
 */
const base = {
  title: "",
  description: "",
  category: "music",
  eventType: "seated" as const,
  venueName: "",
  venueAddress: "",
  city: "TP.HCM",
};

/** A minimal in-memory `localStorage`; the suite runs in node, where there is no DOM. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
});

describe("isWorthSaving", () => {
  it("is false for an untouched form", () => {
    expect(isWorthSaving(base)).toBe(false);
  });

  it("ignores fields that carry a default rather than typing", () => {
    // Category, event type and city all start populated. A form where only those are set has had
    // nothing entered, and must not leave a draft to be offered back.
    expect(isWorthSaving({ ...base, category: "sports", eventType: "general_admission" })).toBe(
      false,
    );
  });

  it("is true once anything is actually typed", () => {
    expect(isWorthSaving({ ...base, title: "Đêm nhạc" })).toBe(true);
    expect(isWorthSaving({ ...base, venueAddress: "240 Đường 3/2" })).toBe(true);
  });
});

describe("saveDraft / loadDraft", () => {
  it("round-trips what was typed", () => {
    saveDraft({ ...base, title: "Đêm nhạc", venueName: "Nhà hát Hòa Bình" });
    const back = loadDraft();
    expect(back?.title).toBe("Đêm nhạc");
    expect(back?.venueName).toBe("Nhà hát Hòa Bình");
    expect(back?.savedAt).toBeTruthy();
  });

  it("stores nothing for an untouched form, and sweeps away an earlier draft", () => {
    saveDraft({ ...base, title: "Đêm nhạc" });
    expect(loadDraft()).not.toBeNull();

    // Clearing the last typed character is the organizer emptying the form; the draft goes with it.
    saveDraft(base);
    expect(loadDraft()).toBeNull();
  });

  it("returns null for a draft that was never written", () => {
    expect(loadDraft()).toBeNull();
  });

  it("discards unparseable storage instead of handing it to the form", () => {
    saveDraft({ ...base, title: "x" });
    globalThis.localStorage.setItem("tixhub:create-event-draft:v1:anon", "{not json");
    expect(loadDraft()).toBeNull();
  });

  it("fills defaults for a draft written by an older shape", () => {
    globalThis.localStorage.setItem(
      "tixhub:create-event-draft:v1:anon",
      JSON.stringify({ title: "Chỉ có tiêu đề" }),
    );

    const back = loadDraft();
    expect(back?.title).toBe("Chỉ có tiêu đề");
    expect(back?.eventType).toBe("seated");
    expect(back?.city).toBe("TP.HCM");
  });

  it("clears on request", () => {
    saveDraft({ ...base, title: "Đêm nhạc" });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
});
