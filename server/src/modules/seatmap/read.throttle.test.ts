import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerMapRateLimit } from "./read.throttle.js";
import { checkSlidingLimit, resetRateLimitStore } from "../../middleware/rateLimit.js";

function read(userId?: number, ip = "198.51.100.1") {
  const next = vi.fn();
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  ownerMapRateLimit(
    { auth: userId ? { userId } : undefined, ip } as Request,
    res as unknown as Response,
    next,
  );
  return { next, res };
}
beforeEach(() => resetRateLimitStore());
afterEach(() => vi.restoreAllMocks());

describe("owner map read budget", () => {
  it("requires a verified account before spending an account budget", () => {
    expect(read().next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });
  it("limits an account even if it changes IPs and does not block a colleague on the same IP", () => {
    for (let i = 0; i < 60; i++) expect(read(1, `198.51.100.${i}`).next).toHaveBeenCalledWith();
    const blocked = read(1);
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "rate_limited", retryAfterSeconds: expect.any(Number) }),
    );
    expect(read(2).next).toHaveBeenCalledWith();
  });
  it("does not spend or inherit the public catalog budget", () => {
    for (let i = 0; i < 60; i++) checkSlidingLimit("catalog:ip", "198.51.100.1", 60, 60_000);
    expect(read(1).next).toHaveBeenCalledWith();
  });
  it("allows 30-second polling for an hour without accumulating a permanent block", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (let i = 0; i < 120; i++) {
      expect(read(1).next).toHaveBeenCalledWith();
      now += 30_000;
    }
  });
});
