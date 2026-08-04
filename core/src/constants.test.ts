import { describe, expect, it } from "vitest";
import { MAX_LOCKABLE_SLOTS, SWAPPABLE_SLOTS, TOTAL_SLOTS, isValidLockCount } from "./constants.js";

describe("slot constants", () => {
  it("sums lockable and swappable slots to the total", () => {
    expect(MAX_LOCKABLE_SLOTS + SWAPPABLE_SLOTS).toBe(TOTAL_SLOTS);
  });

  it("matches the fixed parameters in AGENTS.md §6", () => {
    expect(TOTAL_SLOTS).toBe(10);
    expect(MAX_LOCKABLE_SLOTS).toBe(5);
    expect(SWAPPABLE_SLOTS).toBe(5);
  });
});

describe("isValidLockCount", () => {
  it("accepts zero", () => {
    expect(isValidLockCount(0)).toBe(true);
  });

  it("accepts the maximum", () => {
    expect(isValidLockCount(MAX_LOCKABLE_SLOTS)).toBe(true);
  });

  it("rejects one past the maximum", () => {
    expect(isValidLockCount(MAX_LOCKABLE_SLOTS + 1)).toBe(false);
  });

  it("rejects negative counts", () => {
    expect(isValidLockCount(-1)).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(isValidLockCount(2.5)).toBe(false);
  });
});
