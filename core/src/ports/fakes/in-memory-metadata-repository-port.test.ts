import { describe, expect, it } from "vitest";
import type { MetadataToken } from "../../metadata/metadata-token.js";
import { InMemoryMetadataRepositoryPort } from "./in-memory-metadata-repository-port.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

describe("InMemoryMetadataRepositoryPort", () => {
  it("round-trips: save then findByContentHash returns the same token", async () => {
    const repo = new InMemoryMetadataRepositoryPort();
    const t = token("a");
    await repo.save(t);
    await expect(repo.findByContentHash("a")).resolves.toEqual(t);
  });

  it("findByContentHash returns undefined for an unknown hash", async () => {
    const repo = new InMemoryMetadataRepositoryPort();
    await expect(repo.findByContentHash("missing")).resolves.toBeUndefined();
  });

  it("save overwrites an existing token with the same content hash", async () => {
    const repo = new InMemoryMetadataRepositoryPort();
    await repo.save(token("a"));
    const updated: MetadataToken = { ...token("a"), title: "Updated title" };
    await repo.save(updated);
    await expect(repo.findByContentHash("a")).resolves.toEqual(updated);
  });

  it("delete removes a token; deleting an absent one is a no-op", async () => {
    const repo = new InMemoryMetadataRepositoryPort();
    await repo.save(token("a"));
    await repo.delete("a");
    await expect(repo.findByContentHash("a")).resolves.toBeUndefined();
    await expect(repo.delete("does-not-exist")).resolves.toBeUndefined();
  });

  it("listAll returns every currently-persisted token", async () => {
    const repo = new InMemoryMetadataRepositoryPort();
    await repo.save(token("a"));
    await repo.save(token("b"));
    const all = await repo.listAll();
    expect(all.map((t) => t.contentHash).sort()).toEqual(["a", "b"]);
  });

  it("listAll on a fresh repository is empty", async () => {
    const repo = new InMemoryMetadataRepositoryPort();
    await expect(repo.listAll()).resolves.toEqual([]);
  });
});
