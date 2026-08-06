import { describe, expect, it } from "vitest";
import { InMemoryRevocationLogPort } from "./in-memory-revocation-log-port.js";
import type { RevocationEntry } from "../../security/revocation.js";

function entry(contentHash: string): RevocationEntry {
  return { contentHash, revokedAtEpochMs: 0, signerPublicKey: "aa", signature: "bb" };
}

describe("InMemoryRevocationLogPort (issue #51)", () => {
  it("records and reports an entry", async () => {
    const log = new InMemoryRevocationLogPort();
    expect(await log.has("hash-1")).toBe(false);
    await log.record(entry("hash-1"));
    expect(await log.has("hash-1")).toBe(true);
  });

  it("listAll returns everything recorded", async () => {
    const log = new InMemoryRevocationLogPort();
    await log.record(entry("hash-1"));
    await log.record(entry("hash-2"));
    const all = await log.listAll();
    expect(all.map((e) => e.contentHash).sort()).toEqual(["hash-1", "hash-2"]);
  });

  it("recording the same content hash twice is idempotent (keeps the first)", async () => {
    const log = new InMemoryRevocationLogPort();
    const first = entry("hash-1");
    const second: RevocationEntry = { ...entry("hash-1"), revokedAtEpochMs: 999 };
    await log.record(first);
    await log.record(second);
    const all = await log.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.revokedAtEpochMs).toBe(0);
  });
});
