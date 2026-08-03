/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client-side mirrors of the server's validation rules, so a mistake is caught next to the field
 * instead of coming back as a page-level banner (UI design principle: user guidance).
 *
 * These MUST stay in step with the server — it remains the authority:
 *   - nickname  → `updateMeSchema` in server/src/modules/auth/auth.routes.ts
 *   - phone     → `normalizePhone` in server/src/modules/auth/identifier.ts
 *   - password  → `passwordStrengthError` in server/src/modules/auth/password.ts
 */

export const NICKNAME_MAX = 50;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME = ["image/jpeg", "image/png", "image/webp"];

export function nicknameError(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return "Biệt danh không được để trống.";
  if (v.length > NICKNAME_MAX) return `Biệt danh tối đa ${NICKNAME_MAX} ký tự.`;
  return null;
}

/** Mirrors the server: 0xxxxxxxxx / +84xxxxxxxxx / 84xxxxxxxxx, mobile prefixes 3/5/7/8/9. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s.-]/g, "");
  let national: string | null = null;
  if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\+84\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^84\d{9}$/.test(digits)) national = digits.slice(2);
  if (national === null) return null;
  if (!/^[35789]\d{8}$/.test(national)) return null;
  return `+84${national}`;
}

/** Phone is optional, so an empty value is valid. */
export function phoneError(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (!normalizePhone(v)) return "Số điện thoại không hợp lệ (ví dụ 0901234567).";
  return null;
}

export function avatarError(file: File): string | null {
  if (!AVATAR_MIME.includes(file.type)) return "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.";
  if (file.size > AVATAR_MAX_BYTES) return "Ảnh phải nhỏ hơn 2 MB.";
  return null;
}

export interface PasswordRule {
  label: string;
  ok: boolean;
}

/**
 * The three rules the server actually enforces, shown as a live checklist rather than revealed by a
 * rejection (principle: minimal surprise).
 */
export function passwordRules(password: string): PasswordRule[] {
  return [
    { label: "Ít nhất 8 ký tự", ok: password.length >= 8 },
    { label: "Có chữ cái", ok: /[A-Za-z]/.test(password) },
    { label: "Có số", ok: /[0-9]/.test(password) },
  ];
}

export function passwordError(password: string): string | null {
  return passwordRules(password).every((r) => r.ok)
    ? null
    : "Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số.";
}

/**
 * Advisory strength, beyond the hard rules — length and character variety only. Deliberately not a
 * gate: the server decides what is acceptable, this only tells the user where they stand.
 */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!password) return { score: 0, label: "Chưa nhập" };
  let points = 0;
  if (password.length >= 8) points++;
  if (password.length >= 12) points++;
  if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) points++;
  if (/[^A-Za-z0-9]/.test(password)) points++;
  if (points <= 1) return { score: 1, label: "Yếu" };
  if (points <= 3) return { score: 2, label: "Trung bình" };
  return { score: 3, label: "Mạnh" };
}
