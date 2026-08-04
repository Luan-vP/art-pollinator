import { describe, expect, it } from "vitest";
import {
  comparePriority,
  higherPriority,
  isEqualPriority,
  isHigherPriority,
  lowerPriority,
  toPriority,
  type PriorityContext,
} from "./priority.js";

describe("toPriority", () => {
  it("accepts finite numbers, including negative and zero", () => {
    expect(toPriority(0)).toBe(0);
    expect(toPriority(-5.5)).toBe(-5.5);
    expect(toPriority(42)).toBe(42);
  });

  it("rejects NaN", () => {
    expect(() => toPriority(NaN)).toThrow(/finite/);
  });

  it("rejects +/-Infinity", () => {
    expect(() => toPriority(Infinity)).toThrow(/finite/);
    expect(() => toPriority(-Infinity)).toThrow(/finite/);
  });
});

describe("ordering semantics", () => {
  const low = toPriority(1);
  const mid = toPriority(5);
  const high = toPriority(10);
  const highAgain = toPriority(10);

  it("comparePriority is negative when a < b, positive when a > b, zero when equal", () => {
    expect(comparePriority(low, high)).toBeLessThan(0);
    expect(comparePriority(high, low)).toBeGreaterThan(0);
    expect(comparePriority(high, highAgain)).toBe(0);
  });

  it("is a strict total order: exactly one of a<b, a=b, a>b holds for any pair", () => {
    const values = [low, mid, high, highAgain];
    for (const a of values) {
      for (const b of values) {
        const relations = [
          comparePriority(a, b) < 0,
          comparePriority(a, b) === 0,
          comparePriority(a, b) > 0,
        ];
        expect(relations.filter(Boolean)).toHaveLength(1);
      }
    }
  });

  it("is transitive", () => {
    expect(comparePriority(low, mid)).toBeLessThan(0);
    expect(comparePriority(mid, high)).toBeLessThan(0);
    expect(comparePriority(low, high)).toBeLessThan(0);
  });

  it("sorts ascending via Array.prototype.sort", () => {
    const shuffled = [high, low, mid];
    expect(shuffled.sort(comparePriority)).toEqual([low, mid, high]);
  });

  it("isHigherPriority/isEqualPriority agree with comparePriority", () => {
    expect(isHigherPriority(high, low)).toBe(true);
    expect(isHigherPriority(low, high)).toBe(false);
    expect(isEqualPriority(high, highAgain)).toBe(true);
    expect(isEqualPriority(high, low)).toBe(false);
  });

  it("lowerPriority/higherPriority pick correctly, including ties", () => {
    expect(lowerPriority(low, high)).toBe(low);
    expect(higherPriority(low, high)).toBe(high);
    expect(lowerPriority(high, highAgain)).toBe(high);
    expect(higherPriority(high, highAgain)).toBe(high);
  });
});

describe("PriorityContext", () => {
  it("carries the four candidate signals named in SPEC.md §5", () => {
    const context: PriorityContext = {
      userRank: 3,
      recencyMs: 60_000,
      hopCount: 1,
      dwellMs: 3_600_000,
    };
    expect(context.userRank).toBe(3);
    expect(context.recencyMs).toBe(60_000);
    expect(context.hopCount).toBe(1);
    expect(context.dwellMs).toBe(3_600_000);
  });

  it("allows userRank to be omitted (unranked, distinct from ranked-at-zero)", () => {
    const context: PriorityContext = { recencyMs: 0, hopCount: 0, dwellMs: 0 };
    expect(context.userRank).toBeUndefined();
  });
});
