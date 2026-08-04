/**
 * InMemoryClockPort — a `ClockPort` fake with a manually-controlled clock.
 *
 * Deliberately never reads the real wall clock (no `Date.now()`) — tests
 * that use this fake get a fully deterministic notion of "now," advanced
 * only by explicit calls to {@link InMemoryClockPort.advance} or
 * {@link InMemoryClockPort.set} (issue #18, IMPLEMENTATION.md Phase 1a item
 * 18).
 */
import type { ClockPort } from "../clock-port.js";

export class InMemoryClockPort implements ClockPort {
  private currentEpochMs: number;

  constructor(initialEpochMs = 0) {
    this.currentEpochMs = initialEpochMs;
  }

  now(): number {
    return this.currentEpochMs;
  }

  /** Test control: move the clock forward by `deltaMs` (must be >= 0). */
  advance(deltaMs: number): void {
    if (deltaMs < 0) {
      throw new Error(`InMemoryClockPort.advance: deltaMs must be >= 0, got ${String(deltaMs)}`);
    }
    this.currentEpochMs += deltaMs;
  }

  /** Test control: set the clock to an absolute epoch-ms value. */
  set(epochMs: number): void {
    this.currentEpochMs = epochMs;
  }
}
