import type { Response } from 'supertest';

/** The `tix_refresh=<value>` pair from a response's Set-Cookie, ready to replay
 *  via `.set('Cookie', ...)`. Lets tests hold a specific (pre-rotation) token. */
export function refreshCookie(res: Response): string | undefined {
  const set = res.headers['set-cookie'] as unknown as string[] | undefined;
  return set?.find((c) => c.startsWith('tix_refresh='))?.split(';')[0];
}
