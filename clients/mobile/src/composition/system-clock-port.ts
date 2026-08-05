import type { ClockPort } from "@art-pollinator/core";

/**
 * SystemClockPort — the real `ClockPort` for this client, backed by the
 * platform's `Date.now()`. `Date` is available identically on iOS,
 * Android, and web (React Native and RNWeb both provide it — this is not
 * an RN-only API needing a `.native.ts`/`.web.ts` split, unlike BLE), so
 * this one tiny class serves every platform this composition root builds
 * for.
 *
 * Lives here (`clients/mobile`) rather than as its own `adapters/*`
 * package: it is a three-line wrapper around a global already present in
 * every JS host this codebase targets, not real I/O requiring a driven
 * port implementation with its own contract suite the way BLE/HTTP/SQLite
 * adapters are. A future Node server composition root (Phase 2, `IMPLEMENTATION.md`
 * item 45) will need the identical class; if that duplication ever becomes
 * real (rather than three lines), promoting this to a shared
 * `adapters/clock-system` package is the fix — not preemptively building
 * that package now for a single call site.
 */
export class SystemClockPort implements ClockPort {
  now(): number {
    return Date.now();
  }
}
