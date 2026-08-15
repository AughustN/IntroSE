import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@shared/*` is a tsconfig path, which the transform only resolves for erased type imports.
  // The holds contract also exports runtime values (event names, room key), so the alias has to
  // exist for the bundler too. `.js` specifiers map back to the TS source.
  resolve: {
    alias: [
      { find: /^@shared\/(.*)\.js$/, replacement: path.resolve(__dirname, "shared/$1.ts") },
      // Mirrors tsconfig.web.json, so an integration test can drive the EDITOR's own pure operations
      // against the real API rather than hand-rolling a payload that only resembles what it sends.
      { find: /^@\//, replacement: `${path.resolve(__dirname)}/` },
    ],
  },
  test: {
    include: ["server/tests/**/*.test.ts"],
    // Integration tests share one Postgres database and truncate between tests,
    // so they must not run concurrently against each other.
    fileParallelism: false,
    testTimeout: 20_000,
    setupFiles: ["server/tests/helpers/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["server/src/**/*.ts"],
      exclude: ["server/src/index.ts"],
      // MAIN-03 bar for critical logic (Principle IV). Auth is security-critical.
      thresholds: {
        "server/src/modules/auth/**": {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
        // Seat holds are the concurrency-critical path: no double-sell, no leaked inventory (SC-009).
        "server/src/modules/holds/**": {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
        // The seat-map designer edits maps with money already taken: a sold seat must never be
        // deleted or re-tiered, and a held seat must never be touched (005 SC-003/SC-004, MAIN-03).
        "server/src/modules/seatmap/**": {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
        // The organizer studio edits tiers with money already taken and carries the UC-24 A6
        // moderation gate: capacity may never fall below sold + reserved, a sold tier is archived
        // rather than deleted, and every material edit returns the event for review
        // (006 SC-002/SC-003/SC-009, MAIN-03).
        "server/src/modules/studio/**": {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
      },
    },
  },
});
