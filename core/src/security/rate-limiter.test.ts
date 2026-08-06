import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

describe("SlidingWindowRateLimiter (issue #49)", () => {
  it("allows events up to the configured ceiling within the window", () => {
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 3, windowMs: 1_000 });
    expect(limiter.recordAndCheck("peer-a", 0).allowed).toBe(true);
    expect(limiter.recordAndCheck("peer-a", 10).allowed).toBe(true);
    expect(limiter.recordAndCheck("peer-a", 20).allowed).toBe(true);
  });

  it("rejects the (N+1)th event within the same window — a flooding peer gets throttled", () => {
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 3, windowMs: 1_000 });
    limiter.recordAndCheck("peer-a", 0);
    limiter.recordAndCheck("peer-a", 10);
    limiter.recordAndCheck("peer-a", 20);
    const fourth = limiter.recordAndCheck("peer-a", 30);
    expect(fourth.allowed).toBe(false);
    expect(fourth.countInWindow).toBe(4);
    expect(fourth.limit).toBe(3);

    // Continuing to flood stays rejected — it does not "recover" mid-window.
    const fifth = limiter.recordAndCheck("peer-a", 31);
    expect(fifth.allowed).toBe(false);
  });

  it("tracks each key independently — one peer's flood does not affect another's budget", () => {
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 1, windowMs: 1_000 });
    expect(limiter.recordAndCheck("peer-a", 0).allowed).toBe(true);
    expect(limiter.recordAndCheck("peer-a", 1).allowed).toBe(false);
    expect(limiter.recordAndCheck("peer-b", 1).allowed).toBe(true);
  });

  it("allows events again once the window has fully elapsed", () => {
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 2, windowMs: 100 });
    limiter.recordAndCheck("peer-a", 0);
    limiter.recordAndCheck("peer-a", 10);
    expect(limiter.recordAndCheck("peer-a", 20).allowed).toBe(false);

    // Move well past the window — old timestamps expire.
    expect(limiter.recordAndCheck("peer-a", 500).allowed).toBe(true);
  });

  it("peek reports the current state without consuming budget", () => {
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 2, windowMs: 1_000 });
    limiter.recordAndCheck("peer-a", 0);
    const peeked = limiter.peek("peer-a", 5);
    expect(peeked).toEqual({ allowed: true, countInWindow: 1, limit: 2 });
    // peek must not have recorded anything — a subsequent recordAndCheck sees the same count plus one.
    expect(limiter.recordAndCheck("peer-a", 6).countInWindow).toBe(2);
  });

  it("prune drops keys whose entire history has expired, without affecting live keys", () => {
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 5, windowMs: 100 });
    limiter.recordAndCheck("stale", 0);
    limiter.recordAndCheck("fresh", 950);
    expect(limiter.trackedKeyCount()).toBe(2);

    limiter.prune(1_000);
    expect(limiter.trackedKeyCount()).toBe(1);
    expect(limiter.peek("fresh", 1_000).countInWindow).toBe(1);
  });

  it("rejects an invalid configuration rather than silently misbehaving", () => {
    expect(() => new SlidingWindowRateLimiter({ maxEvents: 0, windowMs: 1_000 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ maxEvents: 3, windowMs: 0 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ maxEvents: -1, windowMs: 1_000 })).toThrow();
  });
});
