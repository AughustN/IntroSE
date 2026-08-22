import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { seedEvent, seedShowtime, seedTier, seedVenue } from "../helpers/catalogSeed.js";
import {
  getWaitingRoomStatus,
  joinWaitingRoom,
  resetWaitingRooms,
  setWaitingRoomConfig,
} from "../../src/services/waitingRoom.service.js";
import { generateTimingTicket } from "../../src/services/timingTicket.js";

/*
 * The high-demand gate on POST /api/reservations (UC-11 A11, feature 013).
 *
 * Service-level suites pin the queue and the timing maths; these pin that the ROUTE demands all
 * three proofs for a flagged showtime, in order — queue token, CAPTCHA, timing — and that an
 * unflagged showtime skips the gate entirely.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A general-admission showtime; `highDemand` flags its event like the organizer toggle would. */
async function seedGaShowtime(
  highDemand: boolean,
): Promise<{ showtimeId: number; tierId: number }> {
  const owner = await registerUser();
  const organizerId = await makeApprovedOrganizer(owner.userId);
  const venue = await seedVenue(owner.userId);
  const ev = await seedEvent({ organizerId });
  if (highDemand) {
    await pool.query(`UPDATE events SET is_high_demand = true WHERE id = $1`, [ev.id]);
  }
  const showtimeId = await seedShowtime(ev.id, venue);
  const tierId = await seedTier(showtimeId, { total: 20 });
  return { showtimeId, tierId };
}

/** Join the showtime's room and wait out admission; returns the one-shot queue token. */
async function admittedQueueToken(
  showtimeId: number,
  userId: number,
  opts: { ttlMs?: number } = {},
): Promise<string> {
  setWaitingRoomConfig(showtimeId, {
    enabled: true,
    batchSize: 50,
    admissionIntervalMs: 1,
    tokenTtlMs: opts.ttlMs ?? 3 * 60 * 1000,
  });
  joinWaitingRoom(showtimeId, userId);
  await sleep(30);
  const status = getWaitingRoomStatus(showtimeId, userId);
  expect(status.status).toBe("admitted");
  return status.queueToken!;
}

const hold = (token: string, body: Record<string, unknown>) =>
  request(app).post("/api/reservations").set(bearer(token)).send(body);

describe("POST /api/reservations — high-demand gate", () => {
  beforeEach(() => {
    resetWaitingRooms();
  });

  it("does not gate an ordinary event", async () => {
    const user = await registerUser();
    const { showtimeId, tierId } = await seedGaShowtime(false);

    const res = await hold(user.token, { showtimeId, ticketTierId: tierId, quantity: 2 }).expect(
      201,
    );
    // General admission holds one line item carrying the quantity, not one item per unit.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(2);
  });

  it("refuses a flagged showtime without a queue token", async () => {
    const user = await registerUser();
    const { showtimeId, tierId } = await seedGaShowtime(true);

    const res = await hold(user.token, { showtimeId, ticketTierId: tierId, quantity: 1 }).expect(
      403,
    );
    expect(res.body.error).toBe("queue_token_required");
  });

  it("refuses an expired queue token", async () => {
    const user = await registerUser();
    const { showtimeId, tierId } = await seedGaShowtime(true);
    // Short enough that the token dies shortly after admission, long enough to be handed out.
    const queueToken = await admittedQueueToken(showtimeId, user.userId, { ttlMs: 80 });
    await sleep(120); // past the TTL

    const res = await hold(user.token, {
      showtimeId,
      ticketTierId: tierId,
      quantity: 1,
      queueToken,
    }).expect(403);
    expect(res.body.error).toBe("queue_token_expired");
  });

  it("demands a CAPTCHA even with a valid queue token", async () => {
    const user = await registerUser();
    const { showtimeId, tierId } = await seedGaShowtime(true);
    const queueToken = await admittedQueueToken(showtimeId, user.userId);

    const res = await hold(user.token, {
      showtimeId,
      ticketTierId: tierId,
      quantity: 1,
      queueToken,
    }).expect(400);
    expect(res.body.error).toBe("captcha_failed");

    // Nothing was held by either refused attempt.
    const active = await request(app)
      .get(`/api/reservations/active?showtimeId=${showtimeId}`)
      .set(bearer(user.token))
      .expect(200);
    expect(active.body).toBeNull();
  });

  it("admits a fully-proved hold and consumes the queue token exactly once", async () => {
    const user = await registerUser();
    const { showtimeId, tierId } = await seedGaShowtime(true);

    // The timing proof needs ≥ 1.5 s between map view and submission — age it while queuing.
    const { ticket } = generateTimingTicket(showtimeId);
    const queueToken = await admittedQueueToken(showtimeId, user.userId);
    await sleep(1600);

    await hold(user.token, {
      showtimeId,
      ticketTierId: tierId,
      quantity: 1,
      queueToken,
      turnstileToken: "test-captcha",
      timingTicket: ticket,
    }).expect(201);

    // The token was one-shot: replaying the whole payload must now fail token validation.
    const replay = await hold(user.token, {
      showtimeId,
      ticketTierId: tierId,
      quantity: 1,
      queueToken,
      turnstileToken: "test-captcha",
      timingTicket: ticket,
    }).expect(403);
    expect(replay.body.error).toBe("queue_token_invalid");
  });
});
