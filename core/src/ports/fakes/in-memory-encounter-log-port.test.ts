import { describe, expect, it } from "vitest";
import { InMemoryEncounterLogPort } from "./in-memory-encounter-log-port.js";

describe("InMemoryEncounterLogPort", () => {
  it("round-trips: record then history returns the recorded outcome", async () => {
    const log = new InMemoryEncounterLogPort();
    await log.record("hash-a", "offered", 100);
    await expect(log.history("hash-a")).resolves.toEqual([{ outcome: "offered", atEpochMs: 100 }]);
  });

  it("history for an unrecorded content hash is empty", async () => {
    const log = new InMemoryEncounterLogPort();
    await expect(log.history("missing")).resolves.toEqual([]);
  });

  it("accumulates multiple outcomes for the same item, oldest first", async () => {
    const log = new InMemoryEncounterLogPort();
    await log.record("hash-a", "offered", 100);
    await log.record("hash-a", "accepted", 200);
    await log.record("hash-a", "evicted", 300);
    await expect(log.history("hash-a")).resolves.toEqual([
      { outcome: "offered", atEpochMs: 100 },
      { outcome: "accepted", atEpochMs: 200 },
      { outcome: "evicted", atEpochMs: 300 },
    ]);
  });

  it("sorts a history oldest-first even if recorded out of order", async () => {
    const log = new InMemoryEncounterLogPort();
    await log.record("hash-a", "evicted", 300);
    await log.record("hash-a", "offered", 100);
    await expect(log.history("hash-a")).resolves.toEqual([
      { outcome: "offered", atEpochMs: 100 },
      { outcome: "evicted", atEpochMs: 300 },
    ]);
  });

  it("is item-scoped: histories for different content hashes are independent", async () => {
    const log = new InMemoryEncounterLogPort();
    await log.record("hash-a", "offered", 100);
    await log.record("hash-b", "declined", 50);
    await expect(log.history("hash-a")).resolves.toEqual([{ outcome: "offered", atEpochMs: 100 }]);
    await expect(log.history("hash-b")).resolves.toEqual([{ outcome: "declined", atEpochMs: 50 }]);
  });
});
