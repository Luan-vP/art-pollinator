import { describe, expect, it } from "vitest";
import { validateCapacityBounds } from "./library-capacity-bounds.js";

describe("validateCapacityBounds (issue #50 — AdminService runtime capacity changes)", () => {
  it("accepts a capacity within bounds", () => {
    expect(validateCapacityBounds({ maxLockableSlots: 5, swappableSlots: 5 }, 2_000)).toEqual({
      ok: true,
    });
  });

  it("accepts a capacity exactly at the maximum", () => {
    expect(validateCapacityBounds({ maxLockableSlots: 500, swappableSlots: 1_500 }, 2_000)).toEqual(
      {
        ok: true,
      },
    );
  });

  it("rejects a capacity whose total exceeds the maximum", () => {
    const result = validateCapacityBounds({ maxLockableSlots: 500, swappableSlots: 1_501 }, 2_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeds the maximum/);
  });

  it("rejects negative slot counts", () => {
    expect(validateCapacityBounds({ maxLockableSlots: -1, swappableSlots: 5 }, 2_000).ok).toBe(
      false,
    );
    expect(validateCapacityBounds({ maxLockableSlots: 5, swappableSlots: -1 }, 2_000).ok).toBe(
      false,
    );
  });

  it("rejects non-integer slot counts", () => {
    expect(validateCapacityBounds({ maxLockableSlots: 2.5, swappableSlots: 5 }, 2_000).ok).toBe(
      false,
    );
  });

  it("rejects a zero-total capacity", () => {
    const result = validateCapacityBounds({ maxLockableSlots: 0, swappableSlots: 0 }, 2_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one slot/);
  });
});
