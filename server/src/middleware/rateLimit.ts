import type { Request, Response, NextFunction } from 'express';

export interface SlidingWindowOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  errorMessage?: string;
  statusCode?: number;
  headers?: boolean;
}

interface SlidingEntry {
  timestamps: number[];
}

const stores = new Map<string, Map<string, SlidingEntry>>();

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

export function normalizeIpKey(ip: string): string {
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 4).join(':'); // IPv6 /64
  }
  return ip; // IPv4 /32
}

/**
 * Creates an Express sliding-window rate limiting middleware
 */
export function createSlidingRateLimiter(namespace: string, options: SlidingWindowOptions) {
  if (!stores.has(namespace)) {
    stores.set(namespace, new Map<string, SlidingEntry>());
  }
  const store = stores.get(namespace)!;

  const keyGen = options.keyGenerator || ((req: Request) => normalizeIpKey(getClientIp(req)));
  const errorMessage = options.errorMessage || 'Quá nhiều yêu cầu. Vui lòng thử lại sau.';
  const statusCode = options.statusCode || 429;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGen(req);
    const now = Date.now();
    const windowStart = now - options.windowMs;

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Clean up timestamps outside window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    if (options.headers) {
      const remaining = Math.max(0, options.max - entry.timestamps.length);
      const resetSeconds = Math.ceil(options.windowMs / 1000);
      res.setHeader('X-RateLimit-Limit', options.max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetSeconds);
    }

    if (entry.timestamps.length >= options.max) {
      const retryAfter = Math.ceil((entry.timestamps[0] + options.windowMs - now) / 1000);
      res.setHeader('Retry-After', Math.max(1, retryAfter));
      return res.status(statusCode).json({
        error: 'rate_limited',
        message: errorMessage,
        retryAfterSeconds: Math.max(1, retryAfter),
      });
    }

    entry.timestamps.push(now);
    next();
  };
}

/**
 * Sliding window rate check for non-middleware usage
 */
export function checkSlidingLimit(
  namespace: string,
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; count: number; retryAfterSeconds: number } {
  if (!stores.has(namespace)) {
    stores.set(namespace, new Map<string, SlidingEntry>());
  }
  const store = stores.get(namespace)!;
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.timestamps[0] + windowMs - now) / 1000));
    return { allowed: false, count: entry.timestamps.length, retryAfterSeconds };
  }

  entry.timestamps.push(now);
  return { allowed: true, count: entry.timestamps.length, retryAfterSeconds: 0 };
}

/**
 * Reset all rate limits for testing
 */
export function resetRateLimitStore(namespace?: string): void {
  if (namespace) {
    stores.get(namespace)?.clear();
  } else {
    // Empty each namespace in place, and leave the registry itself alone.
    //
    // `createSlidingRateLimiter` resolves its namespace once, when the middleware is built at
    // import time, and closes over that Map for the process's whole life. Dropping the entry from
    // `stores` does not reach into the closure — it only orphans it: the limiter keeps counting
    // against a Map nothing can find any more, and the reset after this one sweeps an empty
    // registry while `catalog:ip` climbs past its ceiling of 60/min. Every later test that reads
    // the catalogue then answers 429, whatever it was asserting.
    stores.forEach((store) => store.clear());
  }
}

/**
 * Security audit log helper
 */
export function logSecurityEvent(
  eventType: string,
  details: Record<string, unknown>,
  req?: Request,
): void {
  const ip = req ? getClientIp(req) : 'internal';
  console.warn(`[SECURITY AUDIT] type=${eventType} ip=${ip} details=${JSON.stringify(details)}`);
}
