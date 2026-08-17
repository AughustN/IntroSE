import { describe, expect, it } from "vitest";
import { normalizePhone } from "./validation";
import { formatPhone, toLocalPhone } from "../../services/phone";

/*
 * "Bỏ thay đổi chưa lưu?" must only be asked when something is unsaved.
 *
 * The rule used to be:
 *
 *   (normalizePhone(phone.trim()) ?? "") !== (me.phone ?? "")
 *
 * which runs the STORED value through a validator before comparing it to itself. `normalizePhone`
 * answers null for anything outside `+84[35789]\d{8}`, so an account holding a number the current
 * rule no longer accepts compared `"" !== "+84…"` and was dirty from the moment the screen opened —
 * the confirmation fired on every section change for somebody who had never opened the editor.
 *
 * These cases pin the rule that replaced it: compare the field to the value it was loaded with, and
 * only while the editor is open.
 */

/** The production expression, mirrored so it can be exercised without rendering React. */
function isDirty(input: {
  editing: boolean;
  nickname: string;
  phone: string;
  avatarFile: unknown | null;
  me: { nickname: string | null; phone: string | null };
}): boolean {
  const savedNickname = input.me.nickname ?? "";
  // The field spells the number the way a person types it, so the baseline does too.
  const savedPhoneField = toLocalPhone(input.me.phone);
  return (
    (input.editing && (input.nickname !== savedNickname || input.phone !== savedPhoneField)) ||
    input.avatarFile !== null
  );
}

/** The screen as it opens: fields seeded from the account, editor closed, no file picked. */
const untouched = (me: { nickname: string | null; phone: string | null }) => ({
  editing: false,
  nickname: me.nickname ?? "",
  phone: toLocalPhone(me.phone),
  avatarFile: null,
  me,
});

describe("the profile screen, freshly opened", () => {
  const accounts = [
    { name: "a normal mobile number", me: { nickname: "Admin", phone: "+84900000409" } },
    { name: "no phone at all", me: { nickname: "Admin", phone: null } },
    { name: "no nickname and no phone", me: { nickname: null, phone: null } },
    // The case that caused the bug: stored, but outside what `normalizePhone` accepts today.
    { name: "a number the validator rejects", me: { nickname: "Admin", phone: "+84123456789" } },
    { name: "a foreign number", me: { nickname: "Admin", phone: "+6591234567" } },
    { name: "a legacy unnormalised number", me: { nickname: "Admin", phone: "0900000409" } },
  ];

  for (const { name, me } of accounts) {
    it(`is not dirty with ${name}`, () => {
      expect(isDirty(untouched(me))).toBe(false);
    });
  }

  it("proves the old rule really did fire on those accounts", () => {
    // Guards the explanation above: if `normalizePhone` ever starts accepting these, this test
    // fails and the comment stops being true.
    for (const phone of ["+84123456789", "+6591234567"]) {
      expect(normalizePhone(phone)).toBeNull();
      const oldRule = (normalizePhone(phone) ?? "") !== phone;
      expect(oldRule).toBe(true);
    }
  });
});

describe("one number, one spelling per place it appears", () => {
  it("stores canonical and shows local", () => {
    expect(toLocalPhone("+84900000409")).toBe("0900000409");
    expect(formatPhone("+84900000409")).toBe("090 000 0409");
  });

  it("round-trips: what the field shows normalises back to what is stored", () => {
    const stored = "+84900000409";
    expect(normalizePhone(toLocalPhone(stored))).toBe(stored);
  });

  it("leaves a number it cannot parse exactly as it found it", () => {
    // Display must never be lossy: a value the validator would reject still has to survive being
    // shown, or the field would silently blank an account's real number.
    expect(toLocalPhone("+6591234567")).toBe("+6591234567");
    expect(formatPhone("+6591234567")).toBe("+6591234567");
    expect(toLocalPhone(null)).toBe("");
  });
});

describe("the profile screen, once somebody edits", () => {
  const me = { nickname: "Admin", phone: "+84900000409" };

  it("is dirty when the nickname is changed in the open editor", () => {
    expect(isDirty({ ...untouched(me), editing: true, nickname: "Admin 2" })).toBe(true);
  });

  it("is dirty when the phone is changed in the open editor", () => {
    expect(isDirty({ ...untouched(me), editing: true, phone: "0911111111" })).toBe(true);
  });

  it("is not dirty when the field shows the stored number in local form", () => {
    // The account holds `+84900000409`; the box shows `0900000409`. Same number, and comparing the
    // box against the canonical spelling would have called every such account edited.
    expect(isDirty({ ...untouched(me), editing: true, phone: "0900000409" })).toBe(false);
  });

  it("is not dirty when the editor is open but nothing has been typed", () => {
    expect(isDirty({ ...untouched(me), editing: true })).toBe(false);
  });

  it("is dirty when an avatar is picked, editor open or not", () => {
    // The avatar picker lives in the summary card, reachable without entering edit mode.
    expect(isDirty({ ...untouched(me), avatarFile: {} })).toBe(true);
    expect(isDirty({ ...untouched(me), editing: true, avatarFile: {} })).toBe(true);
  });

  it("is clean again after a save normalises the phone the server stores", () => {
    // Typed "0900000409", stored "+84900000409". `startEditing` re-seeds from the account, and the
    // editor is closed after a save — so neither path reports a change nobody made.
    const saved = { nickname: "Admin", phone: "+84900000409" };
    expect(isDirty({ ...untouched(saved), editing: false })).toBe(false);
    expect(isDirty({ ...untouched(saved), editing: true })).toBe(false);
  });
});
