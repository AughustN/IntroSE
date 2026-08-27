import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("socket.io-client", () => ({ io: () => fake }));
vi.mock("./authClient", () => ({ getAccessToken: () => null }));
vi.mock("./api", () => ({ API_ORIGIN: "http://localhost" }));
import { disconnectSeatSocket, watchShowtime } from "./seatSocket";
import { SEAT_JOIN_EVENT, SEAT_LEAVE_EVENT, SEAT_UPDATE_EVENT } from "@/shared/holds/types";

beforeEach(() => {
  disconnectSeatSocket();
  vi.clearAllMocks();
  fake.connected = true;
});
describe("shared seat socket rooms", () => {
  it("keeps a room joined until its last viewer closes", () => {
    const first = watchShowtime(1, vi.fn());
    const second = watchShowtime(1, vi.fn());
    expect(fake.emit).toHaveBeenCalledTimes(1);
    expect(fake.emit).toHaveBeenCalledWith(SEAT_JOIN_EVENT, { showtimeId: 1 });
    first();
    expect(fake.emit).not.toHaveBeenCalledWith(SEAT_LEAVE_EVENT, expect.anything());
    second();
    second();
    expect(fake.emit.mock.calls.filter(([event]) => event === SEAT_LEAVE_EVENT)).toHaveLength(1);
  });
  it("filters unrelated showtimes and reports connectivity", () => {
    const update = vi.fn();
    const connection = vi.fn();
    watchShowtime(1, update, connection);
    expect(connection).toHaveBeenCalledWith(true);
    const handler = fake.on.mock.calls.find(([event]) => event === SEAT_UPDATE_EVENT)![1];
    handler({ showtimeId: 2 });
    handler({ showtimeId: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ showtimeId: 1 });
    fake.on.mock.calls.find(([event]) => event === "disconnect")![1]();
    expect(connection).toHaveBeenLastCalledWith(false);
    fake.on.mock.calls.find(([event]) => event === "connect")![1]();
    expect(connection).toHaveBeenLastCalledWith(true);
  });
  it("does not queue a join while disconnected and removes its reconnect callback on close", () => {
    fake.connected = false;
    const close = watchShowtime(1, vi.fn());
    expect(fake.emit).not.toHaveBeenCalledWith(SEAT_JOIN_EVENT, expect.anything());
    close();
    expect(fake.off).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(fake.off).toHaveBeenCalledWith("disconnect", expect.any(Function));
    expect(fake.off).toHaveBeenCalledWith("connect_error", expect.any(Function));
  });
});
