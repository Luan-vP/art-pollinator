import { defineConfig } from "vitest/config";

// Adapter tests may use real I/O (AGENTS.md §5) — unlike `core`'s and
// `app`'s vitest configs, there is no "must run with zero network/
// filesystem/device access" constraint here. This suite genuinely writes
// to a temporary directory on disk and uses real Ed25519 cryptography via
// `node:crypto`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
