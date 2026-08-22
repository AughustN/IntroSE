import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";

/*
 * Registration hardening (feature 013, UC-01).
 *
 * The route-level cases the primitive suites cannot see end to end: the disposable-domain refusal,
 * alias canonicalisation feeding the uniqueness check, and the IP soft challenge — over the limit
 * the next registration is asked to solve a CAPTCHA rather than being hard-blocked.
 */

const register = (body: Record<string, unknown>) =>
  request(app).post("/api/auth/register").send(body);

const valid = (email: string) => ({
  email,
  password: "secret123",
  passwordConfirm: "secret123",
  nickname: "U",
});

describe("POST /api/auth/register — disposable and alias emails", () => {
  it("rejects a disposable email domain with a permanent-address message", async () => {
    const res = await register(valid("burner@mailinator.com")).expect(400);
    expect(res.body.error).toBe("disposable_email_rejected");
  });

  it("folds gmail +tags and dots into one mailbox before the uniqueness check", async () => {
    await register(valid("fan.alias@gmail.com")).expect(201);

    for (const variant of [
      "fanalias+vip@gmail.com",
      "fan.a.li.as@gmail.com",
      "fanalias+drop2026@googlemail.com",
    ]) {
      const res = await register(valid(variant)).expect(409);
      expect(res.body.error).toBe("email_taken");
    }
  });

  it("strips provider sub-addressing on outlook and yahoo too", async () => {
    await register(valid("name@yahoo.com")).expect(201);
    const yahoo = await register(valid("name-news@yahoo.com")).expect(409);
    expect(yahoo.body.error).toBe("email_taken");

    await register(valid("work.name@outlook.com")).expect(201);
    const tagged = await register(valid("work.name+tag@outlook.com")).expect(409);
    expect(tagged.body.error).toBe("email_taken");

    // Only gmail collapses dots — elsewhere they distinguish mailboxes.
    await register(valid("w.o.r.k.name@outlook.com")).expect(201);
  });
});

describe("POST /api/auth/register — per-IP soft challenge", () => {
  it("asks for a CAPTCHA past 6 accounts/hour from one IP instead of blocking, and accepts a solved one", async () => {
    // Fill the sliding window with six successful registrations.
    for (let i = 1; i <= 6; i++) {
      await register(valid(`soft-${i}@example.com`)).expect(201);
    }

    // Seventh without a token: challenged, not blocked.
    const challenged = await register(valid(`soft-7@example.com`)).expect(403);
    expect(challenged.body.error).toBe("captcha_required");
    expect(challenged.body.requireCaptcha).toBe(true);

    // The same registration with a solved challenge goes through.
    await register({ ...valid("soft-8@example.com"), turnstileToken: "test-captcha" }).expect(201);
  });
});
