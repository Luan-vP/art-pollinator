import { defineConfig } from "vitest/config";

// This package's tests are genuine integration/end-to-end tests (real
// `node:http` servers, real SQLite files, and — for the end-to-end suite —
// a real spawned child process), not pure unit tests, so they run slower
// and get a longer default timeout than core/app's pure suites.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
