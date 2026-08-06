/**
 * JsonLinesLogger — the real `LoggerPort` implementation for the node
 * server (issue #52).
 *
 * ## Why one hand-rolled class instead of an external logging framework
 *
 * A JSON-lines-to-stdout writer is one `console.log(JSON.stringify(...))`
 * call — there is no meaningful functionality (log levels, formatting,
 * rotation, transports) this deployment currently needs that would justify
 * a new dependency the way, say, `better-sqlite3`/`node:sqlite` earned its
 * place for real persistence. `stdout` is also the conventional place a
 * long-lived Unix service writes structured logs for an operator's log
 * aggregator (journald, Docker's log driver, a simple `| tee`) to pick up —
 * no framework-specific sink configuration required. If richer needs show
 * up later (log levels, sampling, a remote sink), that is the point to
 * revisit this decision, not before.
 *
 * Every line is a single JSON object: `event`, `timestampEpochMs`, and
 * whatever fields the caller (`app`'s `SwapService`,
 * `HttpTransportServer`'s security events) passed in `LogEvent`.
 */
import type { LogEvent, LoggerPort } from "@art-pollinator/core";

export class JsonLinesLogger implements LoggerPort {
  log(event: LogEvent): void {
    console.log(JSON.stringify({ timestampEpochMs: Date.now(), ...event }));
  }
}
