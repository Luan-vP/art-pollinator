import { describe, expect, it } from "vitest";
import {
  InvalidNodeCapacityError,
  NODE_DEFAULT_CAPACITY,
  NODE_DEFAULT_LOCKABLE_SLOTS,
  NODE_DEFAULT_SWAPPABLE_SLOTS,
  NODE_DEFAULT_TOTAL_SLOTS,
  NODE_MAX_TOTAL_SLOTS,
  resolveNodeCapacity,
} from "./node-capacity.js";

describe("resolveNodeCapacity", () => {
  it("defaults to NODE_DEFAULT_CAPACITY when no overrides are given", () => {
    expect(resolveNodeCapacity()).toEqual(NODE_DEFAULT_CAPACITY);
  });

  it("the default is larger than the 10-slot phone default (issue #46)", () => {
    expect(NODE_DEFAULT_TOTAL_SLOTS).toBeGreaterThan(10);
    expect(NODE_DEFAULT_SWAPPABLE_SLOTS + NODE_DEFAULT_LOCKABLE_SLOTS).toBe(
      NODE_DEFAULT_TOTAL_SLOTS,
    );
  });

  it("accepts a custom, in-bounds totalSlots/lockableSlots pair", () => {
    const capacity = resolveNodeCapacity({ totalSlots: 500, lockableSlots: 50 });
    expect(capacity).toEqual({ maxLockableSlots: 50, swappableSlots: 450 });
  });

  it("accepts a request at exactly the hard upper bound", () => {
    const capacity = resolveNodeCapacity({ totalSlots: NODE_MAX_TOTAL_SLOTS, lockableSlots: 0 });
    expect(capacity.swappableSlots + capacity.maxLockableSlots).toBe(NODE_MAX_TOTAL_SLOTS);
  });

  it("rejects a totalSlots request beyond the hard upper bound — no unbounded accumulation option (issue #46)", () => {
    expect(() => resolveNodeCapacity({ totalSlots: NODE_MAX_TOTAL_SLOTS + 1 })).toThrow(
      InvalidNodeCapacityError,
    );
  });

  it("rejects a non-positive totalSlots", () => {
    expect(() => resolveNodeCapacity({ totalSlots: 0 })).toThrow(InvalidNodeCapacityError);
    expect(() => resolveNodeCapacity({ totalSlots: -5 })).toThrow(InvalidNodeCapacityError);
  });

  it("rejects a non-integer totalSlots or lockableSlots", () => {
    expect(() => resolveNodeCapacity({ totalSlots: 10.5 })).toThrow(InvalidNodeCapacityError);
    expect(() => resolveNodeCapacity({ lockableSlots: 1.5 })).toThrow(InvalidNodeCapacityError);
  });

  it("rejects a negative lockableSlots", () => {
    expect(() => resolveNodeCapacity({ lockableSlots: -1 })).toThrow(InvalidNodeCapacityError);
  });

  it("rejects lockableSlots exceeding totalSlots", () => {
    expect(() => resolveNodeCapacity({ totalSlots: 10, lockableSlots: 20 })).toThrow(
      InvalidNodeCapacityError,
    );
  });
});
