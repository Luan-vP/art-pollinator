import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonLinesLogger } from "./json-lines-logger.js";

describe("JsonLinesLogger (issue #52)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("writes one JSON line per event, including a timestamp and every field passed", () => {
    const logger = new JsonLinesLogger();
    logger.log({ event: "swap.started", peerId: "device-a" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.event).toBe("swap.started");
    expect(parsed.peerId).toBe("device-a");
    expect(typeof parsed.timestampEpochMs).toBe("number");
  });

  it("each log call is valid, independently parseable JSON", () => {
    const logger = new JsonLinesLogger();
    logger.log({ event: "security.rate_limited", countInWindow: 5, limit: 3 });
    logger.log({ event: "swap.aborted", reason: "timed out" });

    expect(logSpy).toHaveBeenCalledTimes(2);
    for (const call of logSpy.mock.calls) {
      expect(() => JSON.parse(call[0] as string)).not.toThrow();
    }
  });
});
