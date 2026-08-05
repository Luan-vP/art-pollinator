import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueuedBlobFetch } from "@art-pollinator/core";
import { FileBlobFetchQueueStorePort } from "./file-blob-fetch-queue-store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "art-pollinator-queue-store-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry: QueuedBlobFetch = {
  contentHash: "a",
  blobPointer: { scheme: "local-filesystem", contentHash: "a" },
  attempts: 1,
  nextAttemptAtEpochMs: 5000,
  enqueuedAtEpochMs: 1000,
};

describe("FileBlobFetchQueueStorePort", () => {
  it("load() on a file that does not exist yet returns an empty array", async () => {
    const store = new FileBlobFetchQueueStorePort({ filePath: join(dir, "queue.json") });
    await expect(store.load()).resolves.toEqual([]);
  });

  it("saveAll then load round-trips the exact entries", async () => {
    const store = new FileBlobFetchQueueStorePort({ filePath: join(dir, "queue.json") });
    await store.saveAll([entry]);
    await expect(store.load()).resolves.toEqual([entry]);
  });

  it("creates the parent directory if it does not exist", async () => {
    const filePath = join(dir, "nested", "dir", "queue.json");
    const store = new FileBlobFetchQueueStorePort({ filePath });
    await store.saveAll([entry]);
    await expect(store.load()).resolves.toEqual([entry]);
  });

  it("a genuinely new instance pointed at the same file sees a previous instance's persisted state — a real restart, not a simulated one", async () => {
    const filePath = join(dir, "queue.json");
    const first = new FileBlobFetchQueueStorePort({ filePath });
    await first.saveAll([entry]);

    // A brand-new object, as a fresh process would construct after restart.
    const second = new FileBlobFetchQueueStorePort({ filePath });
    await expect(second.load()).resolves.toEqual([entry]);
  });

  it("saveAll replaces the whole snapshot, not a merge", async () => {
    const store = new FileBlobFetchQueueStorePort({ filePath: join(dir, "queue.json") });
    await store.saveAll([entry]);
    await store.saveAll([]);
    await expect(store.load()).resolves.toEqual([]);
  });
});
