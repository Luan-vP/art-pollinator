import { describe, expect, it } from "vitest";
import {
  InMemoryMetadataRepositoryPort,
  lockedItems,
  swappableItems,
  type MetadataToken,
} from "@art-pollinator/core";
import { LibraryService } from "./library-service.js";

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

describe("LibraryService — creation and initial state", () => {
  it("creates empty when the repository is empty", async () => {
    const service = await LibraryService.create(new InMemoryMetadataRepositoryPort());
    expect(service.getLibrary().entries.size).toBe(0);
  });

  it("seeds initial state from every token the repository already holds, into the swappable pool", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    await repository.save(token("a"));
    await repository.save(token("b"));

    const service = await LibraryService.create(repository);

    expect(
      swappableItems(service.getLibrary())
        .map((t) => t.contentHash)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(lockedItems(service.getLibrary())).toEqual([]);
  });
});

describe("LibraryService — lock/unlock (issue #38: lock/unlock controls per item)", () => {
  it("lock() moves an item into the locked pool", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    await repository.save(token("a"));
    const service = await LibraryService.create(repository);

    const result = service.lock("a");

    expect(result.ok).toBe(true);
    expect(lockedItems(service.getLibrary()).map((t) => t.contentHash)).toEqual(["a"]);
    expect(swappableItems(service.getLibrary())).toEqual([]);
  });

  it("unlock() moves an item back into the swappable pool", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    await repository.save(token("a"));
    const service = await LibraryService.create(repository);
    service.lock("a");

    const result = service.unlock("a");

    expect(result.ok).toBe(true);
    expect(swappableItems(service.getLibrary()).map((t) => t.contentHash)).toEqual(["a"]);
  });

  it("lock() rejects locking a 6th item, leaving state unchanged", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    const service = await LibraryService.create(repository);
    for (const hash of ["a", "b", "c", "d", "e", "f"]) {
      await service.add(token(hash));
    }
    for (const hash of ["a", "b", "c", "d", "e"]) {
      expect(service.lock(hash).ok).toBe(true);
    }

    const before = service.getLibrary();
    const result = service.lock("f");

    expect(result.ok).toBe(false);
    expect(service.getLibrary()).toBe(before); // unchanged reference — no notification either
  });

  it("notifies subscribers on lock()", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    await repository.save(token("a"));
    const service = await LibraryService.create(repository);

    const seen: unknown[] = [];
    service.subscribe((library) => seen.push(library));
    service.lock("a");

    expect(seen.length).toBe(1);
  });

  it("does NOT notify subscribers when an operation is rejected", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    const service = await LibraryService.create(repository);

    const seen: unknown[] = [];
    service.subscribe((library) => seen.push(library));
    const result = service.lock("does-not-exist");

    expect(result.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it("unsubscribe() stops further notifications", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    await repository.save(token("a"));
    await repository.save(token("b"));
    const service = await LibraryService.create(repository);

    const seen: unknown[] = [];
    const unsubscribe = service.subscribe((library) => seen.push(library));
    service.lock("a");
    unsubscribe();
    service.lock("b");

    expect(seen.length).toBe(1);
  });
});

describe("LibraryService.createEmpty — synchronous construction (issue #37)", () => {
  it("starts empty without reading the repository", () => {
    const repository = new InMemoryMetadataRepositoryPort();
    const service = LibraryService.createEmpty(repository);
    expect(service.getLibrary().entries.size).toBe(0);
  });
});

describe("LibraryService.adoptLibrary — adopting a SwapService outcome (issue #37)", () => {
  it("replaces the snapshot and notifies subscribers", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    const service = await LibraryService.create(repository);
    await service.add(token("a"));
    const replacement = service.getLibrary();

    // Reset to empty, then adopt the earlier snapshot back — proves
    // adoptLibrary() actually overwrites whatever was there before.
    const empty = await LibraryService.create(new InMemoryMetadataRepositoryPort());
    const seen: unknown[] = [];
    empty.subscribe((library) => seen.push(library));

    empty.adoptLibrary(replacement);

    expect(empty.getLibrary()).toBe(replacement);
    expect(seen).toEqual([replacement]);
  });
});

describe("LibraryService — add/remove persist to the repository", () => {
  it("add() persists the token and reflects it in the library", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    const service = await LibraryService.create(repository);

    const result = await service.add(token("a"));

    expect(result.ok).toBe(true);
    expect(swappableItems(service.getLibrary()).map((t) => t.contentHash)).toEqual(["a"]);
    await expect(repository.findByContentHash("a")).resolves.toBeDefined();
  });

  it("remove() deletes the token from the repository and the library", async () => {
    const repository = new InMemoryMetadataRepositoryPort();
    await repository.save(token("a"));
    const service = await LibraryService.create(repository);

    const result = await service.remove("a");

    expect(result.ok).toBe(true);
    expect(service.getLibrary().entries.size).toBe(0);
    await expect(repository.findByContentHash("a")).resolves.toBeUndefined();
  });
});
