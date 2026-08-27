import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../db/pool.js";
vi.mock("../../db/pool.js", () => ({ pool: {}, withTransaction: vi.fn() }));
vi.mock("../../config.js", () => ({ LAYOUT_SPACE: 10000, SEAT_DIAMETER: 100 }));
import { getShowtimeMap } from "./layouts.repo.js";

async function read(snapshot: Record<string, unknown> | null) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          row_label: "A",
          seat_number: 1,
          section_name: "Balcony",
          category_name: "VIP",
          ticket_tier_id: 2,
          label: "VIP",
          price: "500000",
          status: "sold",
          pos_x: 500,
          pos_y: 500,
          rotation: 0,
          buyer_name: "Guest",
          checked_in_at: null,
          is_accessible: true,
          table_id: null,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ layout_snapshot: snapshot }] })
    .mockResolvedValueOnce({ rows: [{ id: 2, label: "VIP", price: "500000", color: "#123456" }] });
  const result = await getShowtimeMap(7, { query } as unknown as Db);
  for (const call of query.mock.calls) expect(call[1]).toEqual([7]);
  return result;
}
describe("owner live map display contract", () => {
  it("carries the buyer-visible floor plan, floor assignment and accessibility from the showtime snapshot", async () => {
    const map = await read({
      elements: [],
      tables: [],
      floors: [{ name: "Tầng 2", displayOrder: 1 }],
      sectionStyles: [
        { name: "Balcony", seatShape: "square", seatSizeMultiplier: 1.5, floor: "Tầng 2" },
      ],
      planUrl: "/plan.webp",
      planVisibleToBuyers: true,
      planScale: 1000,
      planOffsetX: 2,
      planOffsetY: 3,
      planOpacity: 50,
    });
    expect(map.floors).toEqual([{ name: "Tầng 2", displayOrder: 1 }]);
    expect(map.seats[0]).toMatchObject({
      floor: "Tầng 2",
      shape: "square",
      sizeMultiplier: 1.5,
      isAccessible: true,
      status: "sold",
    });
    expect(map.floorPlan).toEqual({
      url: "/plan.webp",
      scale: 1000,
      offsetX: 2,
      offsetY: 3,
      opacity: 50,
    });
  });
  it("does not display a private tracing plan as part of the buyer-like map", async () => {
    expect(
      (await read({ planUrl: "/private-plan.webp", planVisibleToBuyers: false })).floorPlan,
    ).toBeNull();
  });
  it("keeps old single-floor snapshots readable without new metadata", async () => {
    const map = await read(null);
    expect(map.floors).toEqual([]);
    expect(map.floorPlan).toBeNull();
    expect(map.seats[0].floor).toBeNull();
    expect(map.seats[0].status).toBe("sold");
  });
});
