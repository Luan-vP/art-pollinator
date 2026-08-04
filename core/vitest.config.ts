import { defineConfig } from "vitest/config";

// The core test suite must be runnable with zero network, filesystem, or
// device access (AGENTS.md §5, IMPLEMENTATION.md Phase 0 item 3). This config
// deliberately does not enable any browser/jsdom/node-environment features
// beyond what vitest's default "node" pool needs to execute plain functions —
// tests here must not reach out to real I/O. Adapter integration tests live
// in adapters/* with their own config and are never merged into this run.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
