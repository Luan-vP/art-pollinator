import { describe, expect, it } from "vitest";
import { SystemClockPort } from "./system-clock-port.js";

describe("SystemClockPort", () => {
  it("now() returns a real epoch-ms timestamp close to Date.now()", () => {
    const clock = new SystemClockPort();
    const before = Date.now();
    const value = clock.now();
    const after = Date.now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });
});
