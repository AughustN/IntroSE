import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { config } from '../../src/config.js';

/*
 * The CORS preflight, checked against the methods the app actually routes.
 *
 * `PUT` was missing from `Access-Control-Allow-Methods` while five routes used it — the seat-map save
 * (`PUT /organizer/layouts/:id`) and three admin writes. The failure mode is unusually nasty: the
 * preflight SUCCEEDS with 204, then the browser refuses to send the real request. There is no status
 * code, no server log and no error body — the client sees a bare network failure ("Load failed" in
 * Safari, "Failed to fetch" in Chrome), indistinguishable from the API being down.
 *
 * It also hid behind the read paths. GET is a simple request needing no preflight, so the app loaded
 * fine and only writes broke, which made it look like a bug in whatever was being saved.
 *
 * This test derives the expectation from the ROUTER rather than restating the header, so adding a route
 * with a method the middleware does not advertise fails here instead of in someone's browser.
 */

/** Every HTTP method Express has a route registered for, read off the router stack. */
function routedMethods(): Set<string> {
  const found = new Set<string>();
  const walk = (stack: unknown[]): void => {
    for (const layer of stack as {
      route?: { methods: Record<string, boolean> };
      handle?: { stack?: unknown[] };
    }[]) {
      if (layer.route) {
        for (const [method, on] of Object.entries(layer.route.methods)) {
          if (on) found.add(method.toUpperCase());
        }
      }
      if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk((app as unknown as { _router: { stack: unknown[] } })._router.stack);
  return found;
}

const origin = config.corsOrigins[0];

describe('CORS preflight', () => {
  it('advertises every method the app actually routes', async () => {
    const res = await request(app)
      .options('/api/organizer/layouts/1')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'PUT')
      .expect(204);

    const advertised = new Set(
      (res.headers['access-control-allow-methods'] ?? '').split(',').map((m: string) => m.trim().toUpperCase()),
    );

    // `_all` is Express's internal marker, not a wire method.
    const routed = [...routedMethods()].filter((m) => m !== '_ALL');
    expect(routed.length).toBeGreaterThan(3);

    const missing = routed.filter((m) => !advertised.has(m));
    expect(missing, `routed but not advertised to the browser: ${missing.join(', ')}`).toEqual([]);
  });

  it('allows the seat-map save specifically', async () => {
    // The one that broke. Named on its own so the failure says what a user would notice.
    const res = await request(app)
      .options('/api/organizer/layouts/1')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'PUT')
      .expect(204);
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('says nothing to an origin that is not allowed', async () => {
    const res = await request(app)
      .options('/api/organizer/layouts/1')
      .set('Origin', 'https://not-our-app.example')
      .set('Access-Control-Request-Method', 'PUT');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
