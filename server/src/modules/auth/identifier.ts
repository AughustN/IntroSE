// Identifier normalisation + classification (research R-8).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex === -1) return trimmed;

  let user = trimmed.slice(0, atIndex);
  let domain = trimmed.slice(atIndex + 1);

  if (domain === 'googlemail.com' || domain === 'gmail.com') {
    domain = 'gmail.com';
    user = user.replace(/\./g, '').split('+')[0];
  } else if (domain === 'outlook.com' || domain === 'hotmail.com') {
    user = user.split('+')[0];
  } else if (domain === 'yahoo.com') {
    user = user.split('-')[0].split('+')[0];
  }

  return `${user}@${domain}`;
}

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Normalise a Vietnamese phone number to canonical `+84XXXXXXXXX`.
 * Accepts `0XXXXXXXXX`, `+84XXXXXXXXX`, `84XXXXXXXXX` (spaces/dashes stripped).
 * Returns null if it is not a valid VN mobile number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s.-]/g, '');
  let national: string | null = null;
  if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\+84\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^84\d{9}$/.test(digits)) national = digits.slice(2);
  if (national === null) return null;
  // VN mobile prefixes start 3/5/7/8/9.
  if (!/^[35789]\d{8}$/.test(national)) return null;
  return `+84${national}`;
}

export type Classified =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: 'unknown' };

/**
 * Classify a login identifier by strict parse — email if it parses as one, else
 * a canonical VN phone, else unknown. Exactly one kind; never both (R-8).
 */
export function classifyIdentifier(raw: string): Classified {
  const trimmed = raw.trim();
  if (isEmail(trimmed)) return { kind: 'email', value: normalizeEmail(trimmed) };
  const phone = normalizePhone(trimmed);
  if (phone) return { kind: 'phone', value: phone };
  return { kind: 'unknown' };
}
