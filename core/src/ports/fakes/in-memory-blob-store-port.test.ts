import { describe, expect, it } from "vitest";
import { InMemoryBlobStorePort } from "./in-memory-blob-store-port.js";

describe("InMemoryBlobStorePort", () => {
  it("round-trips: put then get returns the same bytes", async () => {
    const store = new InMemoryBlobStorePort();
    const data = new Uint8Array([1, 2, 3, 4]);
    await store.put("hash-a", data);
    await expect(store.get("hash-a")).resolves.toEqual(data);
  });

  it("get returns undefined for a blob not held", async () => {
    const store = new InMemoryBlobStorePort();
    await expect(store.get("missing")).resolves.toBeUndefined();
  });

  it("has reports true only once a blob has been put", async () => {
    const store = new InMemoryBlobStorePort();
    await expect(store.has("hash-a")).resolves.toBe(false);
    await store.put("hash-a", new Uint8Array([1]));
    await expect(store.has("hash-a")).resolves.toBe(true);
  });

  it("delete removes a blob; deleting an absent one is a no-op", async () => {
    const store = new InMemoryBlobStorePort();
    await store.put("hash-a", new Uint8Array([1]));
    await store.delete("hash-a");
    await expect(store.has("hash-a")).resolves.toBe(false);
    await expect(store.delete("does-not-exist")).resolves.toBeUndefined();
  });

  it("put overwrites existing bytes under the same content hash", async () => {
    const store = new InMemoryBlobStorePort();
    await store.put("hash-a", new Uint8Array([1, 2, 3]));
    await store.put("hash-a", new Uint8Array([9, 9]));
    await expect(store.get("hash-a")).resolves.toEqual(new Uint8Array([9, 9]));
  });
});
