import express from "express";
import { createServer, type Server } from "node:http";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real routers and real limiter; replace only persistence/auth dependencies, never touch a database.
vi.mock("../../db/pool.js", () => ({ pool: {} }));
vi.mock("../admin/admin.repo.js", () => ({ listCategories: async () => [] }));
vi.mock("./catalog.repo.js", () => ({
  getEventDetail: async () => ({ id: 1, title: "Event" }),
  getSeatMap: async () => ({ eventType: "seated", seats: [] }),
  getShowtimes: async () => [],
  listEvents: async () => ({ events: [], total: 0 }),
  listFeaturedEvents: async () => [],
  searchEventsSemantic: async () => [],
}));
vi.mock("./report.service.js", () => ({ reportEvent: async () => ({ alreadyReported: false }) }));
vi.mock("../../services/timingTicket.js", () => ({
  generateTimingTicket: () => ({ ticket: "test", viewTimestamp: 1 }),
}));
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: vi.fn((_req, _res, next) => next()),
}));
vi.mock("../concessions/concessions.repo.js", () => ({ listPublicByEvent: async () => [] }));

import { catalogPublicRouter } from "./catalog.public.routes.js";
import { concessionsPublicRouter } from "../concessions/concessions.public.routes.js";
import { resetRateLimitStore } from "../../middleware/rateLimit.js";

const servers: Server[] = [];
async function app() {
  const instance = express();
  instance.set("trust proxy", 1);
  // Preserve the real mounting order: these two public routers precede organizer and booking APIs.
  instance.use("/api", catalogPublicRouter);
  instance.use("/api", concessionsPublicRouter);
  instance.get("/api/organizer/events/1/showtimes/manage", (_req, res) => res.json([]));
  instance.get("/api/organizer/showtimes/1/seat-map", (_req, res) => res.json({ seats: [] }));
  const server = createServer(instance);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return server;
}

beforeEach(() => {
  resetRateLimitStore();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("catalog rate-limit routing", () => {
  it("does not block organizer event reads with the public catalog quota", async () => {
    const server = await app();
    for (let i = 0; i < 31; i++) {
      const response = await request(server).get("/api/organizer/events/1/showtimes/manage");
      expect(response.status, `Read ${i + 1}: ${JSON.stringify(response.body)}`).toBe(200);
    }
  });

  it("still blocks scraping public event details after 60 reads in one minute", async () => {
    const server = await app();
    for (let i = 0; i < 60; i++) {
      const response = await request(server).get("/api/events/test-event");
      expect(response.status, `Event read ${i + 1}: ${JSON.stringify(response.body)}`).toBe(200);
    }
    const response = await request(server).get("/api/events/test-event");
    expect(response.status).toBe(429);
    expect(response.body.message).toBe(
      "Quá nhiều yêu cầu tải danh mục. Vui lòng thử lại sau giây lát.",
    );
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("counts the concession menu exactly once in the same public budget", async () => {
    const server = await app();
    for (let i = 0; i < 60; i++) {
      const path = i % 2 === 0 ? "/api/categories" : "/api/catalog/events/1/concessions";
      const response = await request(server).get(path);
      expect(response.status, `Public read ${i + 1}: ${JSON.stringify(response.body)}`).toBe(200);
    }
    expect((await request(server).get("/api/catalog/events/1/concessions")).status).toBe(429);
    expect((await request(server).get("/api/categories")).status).toBe(429);
    expect((await request(server).get("/api/organizer/showtimes/1/seat-map")).status).toBe(200);
  });

  it("does not let a bot evade the budget by changing a prepended forwarding header", async () => {
    const server = await app();
    for (let i = 0; i < 60; i++)
      await request(server)
        .get("/api/categories")
        .set("X-Forwarded-For", `203.0.113.${i + 1}, 198.51.100.25`);
    const response = await request(server)
      .get("/api/categories")
      .set("X-Forwarded-For", "203.0.113.200, 198.51.100.25");
    expect(response.status).toBe(429);
    expect(
      (await request(server).get("/api/categories").set("X-Forwarded-For", "198.51.100.26")).status,
    ).toBe(200);
  });

  it("expires the public budget after one minute without requiring a server restart", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const server = await app();
    for (let i = 0; i < 60; i++) await request(server).get("/api/categories");
    expect((await request(server).get("/api/categories")).status).toBe(429);
    now += 60_001;
    expect((await request(server).get("/api/categories")).status).toBe(200);
  });
});
