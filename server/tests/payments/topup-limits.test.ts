import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import { createTopup } from "../../src/modules/payments/wallet.service.js";

/*
 * Top-up abuse limits at the route level (UC-40, feature 013).
 *
 * The primitive suites pin the limiter maths; these pin that the ROUTE applies them in order —
 * rate limit first, then the two-pending ceiling — and that the VNPay gate does not shadow them.
 * The gateway is stubbed by mocking the config's VNPay credentials: building the payment URL is
 * pure signing, so nothing leaves the process.
 */

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    config: { ...actual.config, vnpayTmnCode: "TESTTMC", vnpayHashSecret: "TESTSECRET".repeat(4) },
  };
});

const AMOUNT = 500_000;

describe("POST /api/wallet/topups — creation limits", () => {
  it("allows five creations per 10 minutes and throttles the sixth", async () => {
    const user = await registerUser();

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/wallet/topups")
        .set(bearer(user.token))
        .send({ amount: AMOUNT })
        .expect(201);
      expect(res.body.orderRef).toBeTruthy();
      expect(res.body.paymentUrl).toContain("vpcpay.html");

      // Settle it, or the two-pending ceiling — not the rate limit — would refuse #3 onward.
      await pool.query(
        `UPDATE payment_transactions SET status = 'failed' WHERE provider_txn_ref = $1`,
        [res.body.orderRef],
      );
    }

    const sixth = await request(app)
      .post("/api/wallet/topups")
      .set(bearer(user.token))
      .send({ amount: AMOUNT })
      .expect(429);
    expect(sixth.body.error).toBe("rate_limited");
  });

  it("refuses a third concurrent pending top-up until one settles", async () => {
    const user = await registerUser();

    // Two initiated rows straight through the service — the route's rate limit must not be what
    // this case exercises.
    await createTopup(user.userId, AMOUNT);
    await createTopup(user.userId, AMOUNT);

    const third = await request(app)
      .post("/api/wallet/topups")
      .set(bearer(user.token))
      .send({ amount: AMOUNT })
      .expect(409);
    expect(third.body.error).toBe("pending_topups_limit");

    // One of them fails at the gateway; a new creation is allowed again.
    await pool.query(
      `UPDATE payment_transactions SET status = 'failed'
       WHERE user_id = $1 AND payment_kind = 'topup' AND status = 'initiated'
         AND id = (SELECT min(id) FROM payment_transactions
                   WHERE user_id = $1 AND payment_kind = 'topup' AND status = 'initiated')`,
      [user.userId],
    );

    await request(app)
      .post("/api/wallet/topups")
      .set(bearer(user.token))
      .send({ amount: AMOUNT })
      .expect(201);
  });
});
