import { describe, expect, it } from "vitest";
import { InMemoryLoggerPort } from "./in-memory-logger-port.js";

describe("InMemoryLoggerPort (issue #52)", () => {
  it("captures logged events in order", () => {
    const logger = new InMemoryLoggerPort();
    logger.log({ event: "swap.started", peerId: "a" });
    logger.log({ event: "swap.completed", peerId: "a" });
    expect(logger.history()).toEqual([
      { event: "swap.started", peerId: "a" },
      { event: "swap.completed", peerId: "a" },
    ]);
  });

  it("starts empty", () => {
    expect(new InMemoryLoggerPort().history()).toEqual([]);
  });
});
