/**
 * InMemoryLoggerPort — the in-memory fake for `LoggerPort` (issue #52).
 * Captures every emitted event into an array a test can assert on directly,
 * without a real process/stdout — the same "every port ships with an
 * in-memory fake" rule (AGENTS.md §2 rule 4) every other port already
 * follows.
 */
import type { LogEvent, LoggerPort } from "../logger-port.js";

export class InMemoryLoggerPort implements LoggerPort {
  private readonly events: LogEvent[] = [];

  log(event: LogEvent): void {
    this.events.push(event);
  }

  /** Every event logged so far, in emission order. */
  history(): readonly LogEvent[] {
    return [...this.events];
  }
}
