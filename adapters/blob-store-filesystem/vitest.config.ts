import { defineConfig } from "vitest/config";

// Adapter tests may use real I/O (AGENTS.md §5) — this suite genuinely
// writes files to a temporary directory on disk, including deliberately
// corrupting one to prove hash-mismatch detection actually triggers.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
