import { defineConfig } from "vitest/config";

// Adapter tests may use real I/O (AGENTS.md §5) — unlike `core`'s and
// `app`'s vitest configs, there is no "must run with zero network/
// filesystem/device access" constraint here. This suite genuinely creates
// and reopens real SQLite database files under a temporary directory.
// See `src/node-sqlite.ts`'s header comment: this monorepo's pinned
// `vitest@2.1.9` cannot resolve a *static* `import ... from "node:sqlite"`
// (a newer, prefix-only Node builtin) inside a test file, regardless of
// config here — `deps.optimizer.ssr.enabled: false`, `ssr.external`, etc.
// were all tried and none routed around it. The actual fix lives in
// `node-sqlite.ts` (a `createRequire`-based re-export); this config has no
// special-casing for it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
