import { defineConfig } from "vitest/config";

export default defineConfig({
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
      },
    },
  },
});
