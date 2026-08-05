import { defineConfig } from "vitest/config";

// `TimerSchedulerPort`'s own tests use real (short) timers — that part is
// genuinely real I/O (AGENTS.md §5). `ScanScheduler`'s tests deliberately
// use `core`'s in-memory `SchedulerPort`/`ClockPort` fakes instead (see
// `scan-scheduler.test.ts`'s header) so the duty-cycle/backoff policy
// itself is deterministic and fast, independent of real elapsed time.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
