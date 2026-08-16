import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// FE and API are same-origin in production (Nginx serves the built SPA and reverse-proxies /api).
// In dev, proxy /api to the Express backend so the httpOnly refresh cookie stays first-party.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // An array, not an object, because these are ordered and `@shared` must win before the bare
    // `@` prefix gets a look at the same specifier.
    alias: [
      /*
       * `@shared/*` → the shared/ folder, mirroring tsconfig.web.json's paths (and the identical
       * rule in vitest.web.config.ts).
       *
       * Absent until now only because every earlier `@shared` import in src/ was `import type`, which
       * esbuild erases before Vite ever resolves it. The first VALUE imported across that boundary —
       * `AD_PLACEMENT_LABELS` — is what made the missing alias visible.
       *
       * The `.js` in the specifier is rewritten to `.ts` here rather than left to Vite's TS-output
       * guessing: shared/ ships only sources, so there is never a real `.js` to find.
       */
      { find: /^@shared\/(.*)\.js$/, replacement: path.resolve(__dirname, 'shared/$1.ts') },
      { find: /^@\//, replacement: `${path.resolve(__dirname)}/` },
    ],
  },
  server: {
    port: 3000,
    // Fail rather than drift. Google OAuth authorises one JavaScript origin for this app —
    // http://localhost:3000 — so a Vite that quietly falls forward to 3001 because something
    // else holds 3000 produces a dev server that looks fine and rejects every Google sign-in
    // with `Error 400: origin_mismatch`. Refusing to start says which port is taken, immediately.
    strictPort: true,
    proxy: {
      // 127.0.0.1 (not localhost) → force IPv4 to match Express's bind and avoid the
      // Windows localhost→::1 ECONNREFUSED on the dev proxy.
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      // Live seat channel (feature 003). Same origin in production behind Nginx; in dev the
      // websocket needs its own proxy entry or socket.io hits the Vite server instead.
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
      },
      // Uploaded avatars are stored on the API host and referenced by a relative path.
      '/uploads': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
