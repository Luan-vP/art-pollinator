import { describe, expect, it } from "vitest";
import type { SwapOutcome } from "./swap-service.js";
import { SwapActivityLog } from "./swap-activity-log.js";

function outcome(overrides: Partial<SwapOutcome> = {}): SwapOutcome {
  return {
    library: { entries: new Map() },
    offered: [],
    sent: [],
    accepted: [],
    rejectedUnverified: [],
    rejectedOversized: [],
    revoked: [],
    evicted: [],
    state: { phase: "completed", peerKind: "person", sent: [], received: [], evicted: [] },
    ...overrides,
  };
}

describe("SwapActivityLog", () => {
  it("starts with empty history", () => {
    const log = new SwapActivityLog();
    expect(log.history()).toEqual([]);
  });

  it("record() appends to history, in order", () => {
    const log = new SwapActivityLog();
    const first = outcome();
    const second = outcome();
    log.record(first);
    log.record(second);
    expect(log.history()).toEqual([first, second]);
  });

  it("subscribe() is notified synchronously on record()", () => {
    const log = new SwapActivityLog();
    const received: SwapOutcome[] = [];
    log.subscribe((o) => received.push(o));

    const o = outcome();
    log.record(o);

    expect(received).toEqual([o]);
  });

  it("subscribe() does NOT replay past history — only future outcomes", () => {
    const log = new SwapActivityLog();
    log.record(outcome()); // before any subscriber

    const received: SwapOutcome[] = [];
    log.subscribe((o) => received.push(o));
    expect(received).toEqual([]);

    const next = outcome();
    log.record(next);
    expect(received).toEqual([next]);
  });

  it("the unsubscribe function stops further notifications", () => {
    const log = new SwapActivityLog();
    const received: SwapOutcome[] = [];
    const unsubscribe = log.subscribe((o) => received.push(o));

    log.record(outcome());
    unsubscribe();
    log.record(outcome());

    expect(received.length).toBe(1);
  });

  it("supports multiple independent subscribers", () => {
    const log = new SwapActivityLog();
    const a: SwapOutcome[] = [];
    const b: SwapOutcome[] = [];
    log.subscribe((o) => a.push(o));
    log.subscribe((o) => b.push(o));

    const o = outcome();
    log.record(o);

    expect(a).toEqual([o]);
    expect(b).toEqual([o]);
  });
});
