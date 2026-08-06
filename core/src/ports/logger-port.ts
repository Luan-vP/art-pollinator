/**
 * LoggerPort — structured event emission for observability (issue #52).
 *
 * SPEC.md/IMPLEMENTATION.md ask for "structured logs for swap lifecycle
 * events" — started, negotiated, transferred, reconciled, aborted — plus
 * (issue #49) rate-limited/rejected security events, since those are
 * exactly what an operator most needs visibility into. `SwapService`
 * (`app/src/swap/swap-service.ts`) is where every one of those lifecycle
 * transitions actually happens, so it is the natural place to *emit* them —
 * but writing to `stdout` is real I/O (AGENTS.md §2 rule 1), so `app` may
 * only depend on a port, never a concrete writer. `LoggerPort` is that
 * port: a single `log(event)` method taking a plain structured record,
 * implemented for real by a trivial JSON-lines-to-stdout adapter at the
 * composition root (`clients/node/src/observability/json-lines-logger.ts`)
 * — see that file's doc comment for why this project reaches for one
 * hand-rolled class instead of an external logging framework.
 *
 * Deliberately synchronous and fire-and-forget (no `Promise`, no return
 * value): logging must never be able to make a swap slower or fail because
 * a log sink hiccuped, matching how `SwapActivityLog.record` (`app`,
 * issue #38) is already synchronous for the identical reason.
 */
export interface LogEvent {
  /** A short, stable, machine-greppable name — e.g. `"swap.started"`, `"swap.completed"`, `"swap.aborted"`, `"security.rate_limited"`, `"security.auth_rejected"`. */
  readonly event: string;
  /** Arbitrary additional structured fields (peer id, content hashes, reason, counts, ...) — merged alongside `event` and a timestamp by the concrete adapter. */
  readonly [key: string]: unknown;
}

export interface LoggerPort {
  log(event: LogEvent): void;
}
