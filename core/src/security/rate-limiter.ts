/**
 * SlidingWindowRateLimiter — issue #49's concrete "AcceptPolicy is a
 * security control... accept-side filtering and rate limiting are the
 * primary defence" finally getting teeth (SPEC.md §5, AGENTS.md §7).
 *
 * ## Why this is pure enough to live in `core`
 *
 * AGENTS.md §2 rule 1 forbids I/O in `core`, but counting events inside a
 * sliding time window is pure bookkeeping over a `Map` — no different in
 * kind from `core`'s swap state machine or `Library` aggregate, both of
 * which hold in-memory state and are still "pure" in the sense that matters
 * here: no filesystem, no network, no ambient clock read. The one thing a
 * rate limiter fundamentally needs — "what time is it" — is never read
 * internally; every call is handed `nowEpochMs` explicitly by its caller
 * (`app`'s `SwapService`, itself driven by a `ClockPort` adapter). This is
 * the exact same seam `core`'s encounter-memory suppression already uses
 * (`../encounter/encounter-memory.ts`'s `filterSuppressedCandidates(...,
 * now, windowMs)`) — a deterministic function of an explicit timestamp, not
 * a hidden `Date.now()` call.
 *
 * ## Design: per-key sliding window, not a token bucket
 *
 * A sliding window ("no more than `maxEvents` events with timestamps within
 * the last `windowMs`, for this key") is simpler to reason about and to
 * explain to an operator ("at most N swap attempts per minute per peer")
 * than a token bucket's refill-rate framing, and it is what SPEC.md §5's own
 * language ("rate limiting") most naturally maps to. `key` is caller-defined
 * — `SwapService` uses the peer's authenticated public key when available,
 * falling back to the bare transport-level peer id otherwise (see that
 * file's doc comment) — this module has no opinion on what a "peer" is,
 * only on counting events against whatever string it's given.
 *
 * ## Design: unbounded key growth is a caller responsibility, documented not hidden
 *
 * Every distinct `key` ever seen keeps its own timestamp array until
 * {@link SlidingWindowRateLimiter.prune} is called — an attacker who mints
 * fresh identities for every single request (trivial with Ed25519: key
 * generation is free) can grow this map without bound between prunes. This
 * is the well-known Sybil limitation of any per-identity rate limit —
 * `docs/security/threat-model.md` names it explicitly as a residual risk
 * mitigated by pairing this limiter with a *connection*-level (IP-based)
 * limiter in the transport adapter, which costs an attacker a real TCP
 * connection per attempt rather than a free keypair. `prune(nowEpochMs)` is
 * exposed so a composition root can call it periodically (e.g. once per
 * incoming connection, or on a timer) to bound memory growth in a live
 * process — not required for correctness of `record`/`peek` themselves.
 */

export interface RateLimitDecision {
  /** `true` if this event is allowed under the configured limit. */
  readonly allowed: boolean;
  /** How many events (including this one, if allowed) are now counted within the current window for this key. */
  readonly countInWindow: number;
  /** The configured ceiling this decision was checked against. */
  readonly limit: number;
}

export interface SlidingWindowRateLimiterOptions {
  /** Maximum events permitted per key within any `windowMs`-long trailing window. Must be a positive integer. */
  readonly maxEvents: number;
  /** The trailing window's length, in milliseconds. Must be positive. */
  readonly windowMs: number;
}

/**
 * A sliding-window rate limiter keyed by an arbitrary string. See this
 * file's doc comment for why this is pure enough to live in `core` despite
 * holding mutable state, and for the documented Sybil-identity caveat.
 */
export class SlidingWindowRateLimiter {
  private readonly maxEvents: number;
  private readonly windowMs: number;
  private readonly timestampsByKey = new Map<string, number[]>();

  constructor(options: SlidingWindowRateLimiterOptions) {
    if (!Number.isInteger(options.maxEvents) || options.maxEvents <= 0) {
      throw new Error(
        `SlidingWindowRateLimiter: maxEvents must be a positive integer, got ${String(options.maxEvents)}.`,
      );
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error(
        `SlidingWindowRateLimiter: windowMs must be a positive number, got ${String(options.windowMs)}.`,
      );
    }
    this.maxEvents = options.maxEvents;
    this.windowMs = options.windowMs;
  }

  /**
   * Record one event for `key` at `nowEpochMs` and report whether it is
   * allowed. An event is always recorded in the internal window *before*
   * the allow/deny decision is computed — a rejected caller still "used up"
   * an attempt, which is the correct flood-defence behaviour: a peer
   * hammering past the limit does not get to retry for free while still
   * inside the same window.
   */
  recordAndCheck(key: string, nowEpochMs: number): RateLimitDecision {
    const windowStart = nowEpochMs - this.windowMs;
    const existing = this.timestampsByKey.get(key) ?? [];
    const withinWindow = existing.filter((t) => t > windowStart);
    withinWindow.push(nowEpochMs);
    this.timestampsByKey.set(key, withinWindow);

    return {
      allowed: withinWindow.length <= this.maxEvents,
      countInWindow: withinWindow.length,
      limit: this.maxEvents,
    };
  }

  /**
   * Report what {@link recordAndCheck} would currently see for `key`,
   * without recording a new event. Useful for a read-only admin view of
   * current rate-limit pressure (issue #50).
   */
  peek(key: string, nowEpochMs: number): RateLimitDecision {
    const windowStart = nowEpochMs - this.windowMs;
    const existing = this.timestampsByKey.get(key) ?? [];
    const withinWindow = existing.filter((t) => t > windowStart);
    return {
      allowed: withinWindow.length < this.maxEvents,
      countInWindow: withinWindow.length,
      limit: this.maxEvents,
    };
  }

  /** Number of distinct keys currently tracked (before pruning) — an admin/observability signal, not used by `recordAndCheck` itself. */
  trackedKeyCount(): number {
    return this.timestampsByKey.size;
  }

  /** Drop every key whose entire timestamp history has fallen outside the window as of `nowEpochMs` — bounds memory growth (see this file's doc comment). Safe to call at any cadence; never affects correctness, only memory. */
  prune(nowEpochMs: number): void {
    const windowStart = nowEpochMs - this.windowMs;
    for (const [key, timestamps] of this.timestampsByKey) {
      const withinWindow = timestamps.filter((t) => t > windowStart);
      if (withinWindow.length === 0) {
        this.timestampsByKey.delete(key);
      } else {
        this.timestampsByKey.set(key, withinWindow);
      }
    }
  }
}
