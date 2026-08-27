import { describe, expect, it } from "vitest";
import { dedupedVenues } from "./venueOptions";
import type { MyVenue } from "../../services/catalogClient";

const v = (over: Partial<MyVenue> & { id: number }): MyVenue => ({
  name: "Online",
  city: "Hà Nội",
  rawAddress: "",
  guide: null,
  inUse: false,
  ...over,
});

describe("dedupedVenues", () => {
  it("collapses untouched look-alikes to the lowest id", () => {
    const out = dedupedVenues([v({ id: 9 }), v({ id: 3 }), v({ id: 7 })]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(3);
  });

  it("NEVER hides a venue something already points at", () => {
    // The bug: an event's showtime names venue 42, but only its identical twin 7 was offered — so a
    // chart could not be made for 42, and one made for 7 was refused at apply.
    const out = dedupedVenues([v({ id: 7 }), v({ id: 42, inUse: true })]);
    expect(out.map((o) => o.id).sort((a, b) => a - b)).toEqual([7, 42]);
  });

  it("tells identical survivors apart by id, since nothing else can", () => {
    const out = dedupedVenues([
      v({ id: 7, inUse: true }),
      v({ id: 42, inUse: true }),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((o) => o.label)).size, "labels must differ").toBe(2);
    expect(out.every((o) => o.label.includes("#"))).toBe(true);
  });

  it("still distinguishes same-name venues by address", () => {
    const out = dedupedVenues([
      v({ id: 1, name: "Nhà hát", rawAddress: "1 Lê Lợi" }),
      v({ id: 2, name: "Nhà hát", rawAddress: "9 Trần Phú" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.label).sort()).toEqual(["Nhà hát — 1 Lê Lợi", "Nhà hát — 9 Trần Phú"]);
  });

  it("leaves a lone venue's name unadorned", () => {
    expect(dedupedVenues([v({ id: 1, name: "Sân Mỹ Đình" })])[0].label).toBe("Sân Mỹ Đình");
  });
});
