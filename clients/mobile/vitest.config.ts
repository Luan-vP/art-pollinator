import { defineConfig } from "vitest/config";

// Composition-root tests here import the platform-specific modules directly
// by filename (composition-root.native.ts / composition-root.web.ts) rather
// than through Metro's platform-extension resolution, which only exists at
// bundle time. No JSX is exercised, so the plain "node" environment is
// enough — this suite never touches real network/filesystem/device I/O.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
