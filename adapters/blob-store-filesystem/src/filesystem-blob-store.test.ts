import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobStoreContractCases, sha256Hex } from "@art-pollinator/core";
import { BlobIntegrityError, FilesystemBlobStorePort } from "./filesystem-blob-store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "art-pollinator-blob-store-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FilesystemBlobStorePort — contract suite (issue #40, AGENTS.md §2 rule 5)", () => {
  // `makeFreshStore` must hand back a genuinely independent store each call
  // (the suite's own "a fresh store instance never carries over state from
  // a previous instance" case constructs two and expects them not to
  // share state) — a real filesystem adapter's "freshness" is a function of
  // *which directory* it's pointed at, so each call gets its own
  // subdirectory under this test's temp dir, not the same `dir` reused.
  let counter = 0;
  const makeFreshStore = () =>
    new FilesystemBlobStorePort({ baseDir: join(dir, `store-${String(counter++)}`) });

  for (const { name, run } of blobStoreContractCases(makeFreshStore)) {
    it(name, run);
  }
});

describe("FilesystemBlobStorePort — content-addressed layout", () => {
  it("stores a blob at <baseDir>/<hash[0:2]>/<hash>", async () => {
    const store = new FilesystemBlobStorePort({ baseDir: dir });
    const data = new Uint8Array([1, 2, 3]);
    const contentHash = sha256Hex(data);
    await store.put(contentHash, data);

    const onDisk = readFileSync(join(dir, contentHash.slice(0, 2), contentHash));
    expect(new Uint8Array(onDisk)).toEqual(data);
  });

  it("creates the base directory on first use if it does not exist", async () => {
    const freshDir = join(dir, "does", "not", "exist", "yet");
    const store = new FilesystemBlobStorePort({ baseDir: freshDir });
    const data = new Uint8Array([1]);
    const contentHash = sha256Hex(data);
    await store.put(contentHash, data);
    await expect(store.has(contentHash)).resolves.toBe(true);
  });
});

describe("FilesystemBlobStorePort — real write/read/corruption cycle (issue #40 DoD)", () => {
  it("write a blob, read it back: bytes match exactly", async () => {
    const store = new FilesystemBlobStorePort({ baseDir: dir });
    const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const contentHash = sha256Hex(data);

    await store.put(contentHash, data);
    const readBack = await store.get(contentHash);

    expect(readBack).toEqual(data);
  });

  it("verifies integrity on fetch: flipping one byte on disk makes the next get() reject", async () => {
    const store = new FilesystemBlobStorePort({ baseDir: dir });
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const contentHash = sha256Hex(data);
    await store.put(contentHash, data);

    // Manually corrupt the stored file: flip a single byte, bypassing the
    // port entirely (simulating bit rot / tampering after `put` wrote
    // correct bytes) — the file must still exist and still be readable,
    // just no longer hash to `contentHash`.
    const path = join(dir, contentHash.slice(0, 2), contentHash);
    const onDisk = readFileSync(path);
    const corrupted = Buffer.from(onDisk);
    corrupted[0] = (corrupted[0]! + 1) % 256;
    writeFileSync(path, corrupted);

    await expect(store.get(contentHash)).rejects.toBeInstanceOf(BlobIntegrityError);
  });

  it("verifies integrity on fetch: truncating the stored file makes the next get() reject", async () => {
    const store = new FilesystemBlobStorePort({ baseDir: dir });
    const data = new Uint8Array(Array.from({ length: 64 }, (_, i) => i));
    const contentHash = sha256Hex(data);
    await store.put(contentHash, data);

    const path = join(dir, contentHash.slice(0, 2), contentHash);
    const onDisk = readFileSync(path);
    writeFileSync(path, onDisk.subarray(0, onDisk.length - 8)); // truncate the last 8 bytes

    await expect(store.get(contentHash)).rejects.toBeInstanceOf(BlobIntegrityError);
  });

  it("a corruption-rejecting get() does not delete or otherwise mutate the corrupted file", async () => {
    const store = new FilesystemBlobStorePort({ baseDir: dir });
    const data = new Uint8Array([1, 2, 3]);
    const contentHash = sha256Hex(data);
    await store.put(contentHash, data);

    const path = join(dir, contentHash.slice(0, 2), contentHash);
    writeFileSync(path, Buffer.from([9, 9, 9])); // corrupt: different bytes, wrong length too

    await expect(store.get(contentHash)).rejects.toBeInstanceOf(BlobIntegrityError);
    // The file is still there (get() rejected, it did not silently clean up) — `has()` still reports true.
    await expect(store.has(contentHash)).resolves.toBe(true);
  });

  it("BlobIntegrityError reports both the requested and actual (corrupted) hash", async () => {
    const store = new FilesystemBlobStorePort({ baseDir: dir });
    const data = new Uint8Array([1, 2, 3]);
    const contentHash = sha256Hex(data);
    await store.put(contentHash, data);

    const path = join(dir, contentHash.slice(0, 2), contentHash);
    writeFileSync(path, Buffer.from([9, 9, 9]));

    try {
      await store.get(contentHash);
      expect.fail("expected get() to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(BlobIntegrityError);
      const integrityError = error as BlobIntegrityError;
      expect(integrityError.contentHash).toBe(contentHash);
      expect(integrityError.actualHash).toBe(sha256Hex(new Uint8Array([9, 9, 9])));
      expect(integrityError.actualHash).not.toBe(contentHash);
    }
  });
});
