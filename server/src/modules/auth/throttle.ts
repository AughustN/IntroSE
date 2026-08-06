// Minimal per-key fixed-window limiter for the MVP slice. US7 (T048) replaces this
// with the full per-source + progressive-per-identifier design (D6/R-5). Kept
// in-memory: a single VPS instance, and abuse-resistance polish is deferred.

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

/** Returns true if the action is allowed, false if the key is over the limit. */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/** Test seam — the buckets are process-wide state, so cases must not leak into each other. Mirrors
 *  `resetHoldRateLimit()`; a suite that legitimately registers many users (e.g. an RBAC matrix over
 *  every endpoint) would otherwise trip the per-IP register limit and fail for the wrong reason. */
export function resetAuthThrottle(): void {
  buckets.clear();
}

/** Normalise a client IP to a throttle key: /32 for IPv4, /64 for IPv6 (R-5). */
export function ipKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':'); // IPv6 /64
  return ip; // IPv4 /32
}

/**
 * Progressive per-identifier delay (FR-048/049): the first few failures are free,
 * then each subsequent one is answered more slowly, capped. Applied EQUALLY to
 * unknown identifiers so the delay curve cannot enumerate accounts. There is NO
 * lockout — a correct password is always accepted regardless of this count (D-E).
 */
export function identifierDelayMs(failures: number): number {
  if (failures < 3) return 0;
  return Math.min((failures - 2) * 250, 5000);
}

// Real sleeps are skipped under vitest so the suite stays fast; the no-lockout and
// per-source invariants are asserted behaviourally, not by wall-clock.
const DELAYS_ENABLED = process.env.VITEST !== 'true';

export async function applyIdentifierDelay(failures: number): Promise<void> {
  const ms = identifierDelayMs(failures);
  if (DELAYS_ENABLED && ms > 0) await new Promise((r) => setTimeout(r, ms));
}
