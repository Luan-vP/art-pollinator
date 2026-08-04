import { describe, expect, it } from "vitest";
import { InMemoryClockPort } from "./in-memory-clock-port.js";

describe("InMemoryClockPort", () => {
  it("starts at 0 by default", () => {
    const clock = new InMemoryClockPort();
    expect(clock.now()).toBe(0);
  });

  it("starts at a given initial time", () => {
    const clock = new InMemoryClockPort(1_000);
    expect(clock.now()).toBe(1_000);
  });

  it("advances by a given delta", () => {
    const clock = new InMemoryClockPort(1_000);
    clock.advance(500);
    expect(clock.now()).toBe(1_500);
    clock.advance(500);
    expect(clock.now()).toBe(2_000);
  });

  it("rejects a negative advance", () => {
    const clock = new InMemoryClockPort();
    expect(() => {
      clock.advance(-1);
    }).toThrow();
  });

  it("sets an absolute time directly", () => {
    const clock = new InMemoryClockPort(1_000);
    clock.set(9_999);
    expect(clock.now()).toBe(9_999);
  });

  it("never moves on its own — repeated now() calls with no advance/set are stable", () => {
    const clock = new InMemoryClockPort(42);
    expect(clock.now()).toBe(42);
    expect(clock.now()).toBe(42);
    expect(clock.now()).toBe(42);
  });
});
