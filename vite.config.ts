import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// FE and API are same-origin in production (Nginx serves the built SPA and reverse-proxies /api).
// In dev, proxy /api to the Express backend so the httpOnly refresh cookie stays first-party.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 3000,
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
