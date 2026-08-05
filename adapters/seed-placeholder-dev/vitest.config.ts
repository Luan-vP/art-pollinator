import { defineConfig } from "vitest/config";

// No real I/O here at all — the placeholder tokens are static data and the
// gating predicate is a pure function. This package could run under the
// same zero-I/O constraint as `core`'s own suite; it lives in `adapters/`
// (not `core`) because AGENTS.md §3 requires the seed adapter itself to be
// deletable without touching `core` — see this package's README.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
