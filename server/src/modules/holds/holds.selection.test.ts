import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HoldRequest } from "@shared/holds/types.js";
import { hold } from "./holds.service.js";
import * as repo from "./holds.repo.js";
import { broadcastSeatUpdate } from "../../realtime/io.js";

// Exercise the real hold service, without connecting to or mutating a database.
vi.mock("../../db/pool.js", () => ({
  pool: {},
  LOCK_TIMEOUT: "55P03",
  withTransaction: (run: (client: object) => Promise<unknown>) => run({}),
}));
vi.mock("../../realtime/io.js", () => ({ broadcastSeatUpdate: vi.fn() }));
vi.mock("../admin/settings.service.js", () => ({
  getSettings: async () => ({ max_tickets_per_buyer: 8, seat_hold_ttl_minutes: 10 }),
}));
vi.mock("../concessions/concessions.repo.js", () => ({ listedCartLines: async () => [] }));
vi.mock("../notifications/notifications.service.js", () => ({
  notifyWaitlistForShowtime: vi.fn(),
}));
vi.mock("./holds.repo.js", () => ({
  getShowtimeInfo: vi.fn(),
  findActiveReservation: vi.fn(),
  findReservation: vi.fn(),
  countHeldTickets: vi.fn(),
  listSeatIds: vi.fn(),
  listGaLines: vi.fn(),
  lockSeats: vi.fn(),
  holdSeats: vi.fn(),
  addSeatItems: vi.fn(),
  lockTier: vi.fn(),
  tierHasSeats: vi.fn(),
  tierRemaining: vi.fn(),
  bumpReserved: vi.fn(),
  upsertGaItem: vi.fn(),
  createReservation: vi.fn(),
  setReservationStatus: vi.fn(),
  releaseSeats: vi.fn(),
  listItems: vi.fn(),
  toReservationView: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  const reservation: repo.ReservationRow = {
    id: 8,
    user_id: 1,
    showtime_id: 1,
    status: "active",
    expired: false,
    extended_once: false,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 600000),
  };
  vi.mocked(repo.getShowtimeInfo).mockResolvedValue({ id: 1, eventType: "seated", sellable: true });
  vi.mocked(repo.findActiveReservation).mockResolvedValue(reservation);
  vi.mocked(repo.findReservation).mockResolvedValue(reservation);
  vi.mocked(repo.createReservation).mockResolvedValue({ ...reservation, id: 9 });
  vi.mocked(repo.countHeldTickets).mockResolvedValue(1);
  vi.mocked(repo.listSeatIds).mockResolvedValue([]);
  vi.mocked(repo.listGaLines).mockResolvedValue([]);
  vi.mocked(repo.lockSeats).mockResolvedValue([
    {
      id: 11,
      showtime_id: 1,
      ticket_tier_id: 6,
      status: "available",
      hold_owner_id: null,
      hold_expires_at: null,
      price_amount: 100000,
      seat_label: "A1",
      holdable: true,
      held_by_me: false,
    },
  ]);
  vi.mocked(repo.lockTier).mockResolvedValue({
    id: 7,
    showtime_id: 1,
    price_amount: 100000,
    total_quantity: 10,
    sold_quantity: 0,
    reserved_quantity: 1,
    archived_at: null,
  });
  vi.mocked(repo.tierHasSeats).mockResolvedValue(false);
  vi.mocked(repo.tierRemaining).mockImplementation((t) =>
    t.total_quantity === null ? null : t.total_quantity - t.sold_quantity - t.reserved_quantity,
  );
  vi.mocked(repo.listItems).mockResolvedValue([]);
});

describe("one reservation contains either seats or standing tickets", () => {
  it.each([
    { kind: "standing", body: { showtimeId: 1, ticketTierId: 7, quantity: 1 } },
    { kind: "seated", body: { showtimeId: 1, seatIds: [11] } },
  ] satisfies { kind: string; body: HoldRequest }[])(
    "refuses adding $kind tickets to a reservation of the other kind before changing inventory",
    async ({ kind, body }) => {
      if (kind === "standing") vi.mocked(repo.listSeatIds).mockResolvedValue([12]);
      else vi.mocked(repo.listGaLines).mockResolvedValue([{ ticket_tier_id: 7, quantity: 1 }]);
      await expect(hold(1, body)).rejects.toMatchObject({ code: "invalid_selection", status: 422 });
      expect(repo.holdSeats).not.toHaveBeenCalled();
      expect(repo.bumpReserved).not.toHaveBeenCalled();
      expect(repo.upsertGaItem).not.toHaveBeenCalled();
      expect(repo.addSeatItems).not.toHaveBeenCalled();
      expect(broadcastSeatUpdate).not.toHaveBeenCalled();
    },
  );
  it("allows another standing tier in the same standing reservation", async () => {
    vi.mocked(repo.listGaLines).mockResolvedValue([{ ticket_tier_id: 8, quantity: 1 }]);
    await hold(1, { showtimeId: 1, ticketTierId: 7, quantity: 2 });
    expect(repo.upsertGaItem).toHaveBeenCalledWith(expect.anything(), 8, 7, 2, 100000);
    expect(broadcastSeatUpdate).toHaveBeenCalledWith({
      showtimeId: 1,
      tier: { ticketTierId: 7, remaining: 7 },
    });
  });
  it("allows adding another seat to a seated reservation", async () => {
    vi.mocked(repo.listSeatIds).mockResolvedValue([12]);
    await hold(1, { showtimeId: 1, seatIds: [11] });
    expect(repo.holdSeats).toHaveBeenCalledWith(expect.anything(), [11], 1, 8);
  });
  it("releases an expired seated reservation before starting a standing reservation", async () => {
    const current = await repo.findReservation({} as never, 8);
    vi.mocked(repo.findActiveReservation).mockResolvedValue({ ...current!, expired: true });
    vi.mocked(repo.listSeatIds).mockResolvedValue([12]);
    await hold(1, { showtimeId: 1, ticketTierId: 7, quantity: 1 });
    expect(repo.releaseSeats).toHaveBeenCalledWith(expect.anything(), [12]);
    expect(repo.upsertGaItem).toHaveBeenCalledWith(expect.anything(), 9, 7, 1, 100000);
  });
});
