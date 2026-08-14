import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the CLIENT's pure logic — a second, deliberately separate project.
 *
 * `vitest.config.ts` cannot host these. It collects only `server/tests/**`, and its `setupFiles`
 * opens a Postgres connection and TRUNCATEs ~30 tables between cases; borrowing that for a pure
 * geometry function would make a 2 ms assertion take seconds and would couple the editor's maths to a
 * database it never touches. So the seatmap editor's ops had no test home at all, which is how a bug
 * that fires on EVERY Ctrl+D survived: nothing could have caught it.
 *
 * No DB, no setup file, no `fileParallelism: false` — these are pure functions and should run in
 * milliseconds. Run with `npm run test:web`.
 */
export default defineConfig({
  resolve: {
    alias: [
      // Mirrors tsconfig.web.json's paths, so a test imports what the app imports.
      { find: /^@shared\/(.*)\.js$/, replacement: path.resolve(__dirname, "shared/$1.ts") },
      { find: /^@\//, replacement: `${path.resolve(__dirname)}/` },
    ],
  },
  test: {
    // `shared/` too: the projection and the document helpers live there because BOTH sides import
    // them, and they are pure — so they belong in the no-database project rather than the one whose
    // setup file opens Postgres.
    include: ["src/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
  },
});
