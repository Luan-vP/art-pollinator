/**
 * ClockPort — the domain's only way to learn the current time.
 *
 * `core` must never call `Date.now()` directly (AGENTS.md §5): that would be
 * an ambient, untestable dependency on the wall clock, and recency/priority
 * scoring (see `../priority/priority.ts`) has to be deterministic under
 * test. Anything in `core` that needs "now" takes a `ClockPort` and calls
 * this instead — a fake port can return any fixed or scripted sequence of
 * times.
 */
export interface ClockPort {
  /** Current time, in epoch milliseconds. */
  now(): number;
}
