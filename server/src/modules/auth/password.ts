import bcrypt from 'bcrypt';
import { BCRYPT_COST } from '../../config.js';

// A fixed bcrypt hash of a throwaway value. Verifying against it on the
// unknown-identifier path makes the timing indistinguishable from a real
// wrong-password check (FR-012, SC-006).
const DUMMY_HASH = bcrypt.hashSync('tixhub-dummy-password', BCRYPT_COST);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Burn the same CPU as a real verify when no account exists, then fail. */
export async function dummyVerify(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_HASH);
  return false;
}

/** FR-003: min 8 chars, at least one letter and one digit. Returns the
 *  Vietnamese rule message when invalid, else null. */
export function passwordStrengthError(password: string): string | null {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số.';
  }
  return null;
}
