import { describe, expect, it } from "vitest";
import { validateLockRequest } from "./validate-lock-request.js";

describe("validateLockRequest", () => {
  it("accepts a lock count within range", () => {
    expect(validateLockRequest(3)).toEqual({ ok: true });
  });

  it("rejects a lock count above the max and explains why", () => {
    const result = validateLockRequest(6);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/between 0 and 5/);
  });
});
