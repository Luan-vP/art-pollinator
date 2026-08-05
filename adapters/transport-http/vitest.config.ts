import { defineConfig } from "vitest/config";

// Adapter tests may use real I/O (AGENTS.md §5). This suite starts a real
// `node:http` server on an ephemeral loopback port and connects a real
// `fetch`-based client to it for every test — no mocking anywhere in this
// package, unlike the BLE adapters, which have no real hardware to test
// against in this environment.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
