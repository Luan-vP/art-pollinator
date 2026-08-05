import { defineConfig } from "vitest/config";

// Adapter tests may use real I/O (AGENTS.md §5). This suite binds real
// `node:http` servers to real loopback addresses (127.0.0.1 / 127.0.0.2,
// both usable loopback addresses on Linux) and probes them with real
// `fetch` calls — no mocking.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});
