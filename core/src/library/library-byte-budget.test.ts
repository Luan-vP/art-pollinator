/**
 * Library byte-budget tests (issue #61) — proving `LibraryCapacity.maxTotalBytes`
 * is enforced *independently* of the existing slot-count cap: a library
 * with free slots still rejects an add that would exceed the byte budget,
 * and (symmetrically) a library within its byte budget still rejects an
 * add when slots are full.
 */
import { describe, expect, it } from "vitest";
import { metadataTokenByteSize, type MetadataToken } from "../metadata/metadata-token.js";
import { toPriority } from "../priority/priority.js";
import {
  addItem,
  EMPTY_LIBRARY,
  libraryByteSize,
  type Library,
  type LibraryCapacity,
} from "./library.js";

const P0 = toPriority(0);

function tokenOfSize(contentHash: string, descriptionLength: number): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "x".repeat(descriptionLength),
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

function expectOk(result: { ok: boolean; library?: Library; error?: string }): Library {
  if (!result.ok) throw new Error(`expected ok result, got error: ${String(result.error)}`);
  return result.library as Library;
}

describe("libraryByteSize", () => {
  it("is zero for an empty library and sums held items' serialised sizes otherwise", () => {
    expect(libraryByteSize(EMPTY_LIBRARY)).toBe(0);
    const a = tokenOfSize("a", 100);
    const b = tokenOfSize("b", 200);
    const library = expectOk(addItem(expectOk(addItem(EMPTY_LIBRARY, a)), b));
    expect(libraryByteSize(library)).toBe(metadataTokenByteSize(a) + metadataTokenByteSize(b));
  });
});

describe("addItem — maxTotalBytes (issue #61)", () => {
  it("is unenforced when omitted — unchanged behaviour from before this field existed", () => {
    const capacity: LibraryCapacity = { maxLockableSlots: 0, swappableSlots: 2 };
    const library = expectOk(addItem(EMPTY_LIBRARY, tokenOfSize("a", 100_000), P0, capacity));
    expect(libraryByteSize(library)).toBeGreaterThan(90_000); // no budget configured — the huge item still fits
  });

  it("rejects an add that would exceed the byte budget even though a swappable slot is free", () => {
    const first = tokenOfSize("a", 100);
    const second = tokenOfSize("b", 5_000); // large enough to blow the budget below
    const budget = metadataTokenByteSize(first) + 50; // room for `first`, not for `first` + `second`
    const capacity: LibraryCapacity = {
      maxLockableSlots: 0,
      swappableSlots: 5,
      maxTotalBytes: budget,
    };

    const afterFirst = expectOk(addItem(EMPTY_LIBRARY, first, P0, capacity));
    expect(afterFirst.entries.size).toBe(1);
    // Plenty of free swappable slots remain (5 total, 1 used) — proving the
    // rejection below is the byte budget, not the slot-count cap.
    expect(afterFirst.entries.size).toBeLessThan(capacity.swappableSlots);

    const afterSecond = addItem(afterFirst, second, P0, capacity);
    expect(afterSecond.ok).toBe(false);
    if (!afterSecond.ok) {
      expect(afterSecond.error).toMatch(/byte budget/);
    }
    // The rejected add must not have mutated anything.
    expect(libraryByteSize(afterFirst)).toBeLessThanOrEqual(budget);
  });

  it("rejects an add on slot-count grounds even when comfortably within the byte budget (the symmetric case)", () => {
    const capacity: LibraryCapacity = {
      maxLockableSlots: 0,
      swappableSlots: 1,
      maxTotalBytes: 1_000_000, // effectively unlimited — never the binding constraint here
    };
    const afterFirst = expectOk(addItem(EMPTY_LIBRARY, tokenOfSize("a", 10), P0, capacity));
    const afterSecond = addItem(afterFirst, tokenOfSize("b", 10), P0, capacity);
    expect(afterSecond.ok).toBe(false);
    if (!afterSecond.ok) {
      expect(afterSecond.error).toMatch(/swappable pool is full/);
    }
  });

  it("a duplicate content hash is still a no-op success regardless of the byte budget", () => {
    const token = tokenOfSize("a", 100);
    const capacity: LibraryCapacity = {
      maxLockableSlots: 0,
      swappableSlots: 5,
      maxTotalBytes: metadataTokenByteSize(token), // exactly enough for one copy, no more
    };
    const afterFirst = expectOk(addItem(EMPTY_LIBRARY, token, P0, capacity));
    const afterDuplicate = addItem(afterFirst, token, P0, capacity);
    expect(afterDuplicate.ok).toBe(true);
    expect(afterDuplicate.ok && afterDuplicate.library.entries.size).toBe(1);
  });

  it("an add that exactly meets the budget (not over) is accepted", () => {
    const token = tokenOfSize("a", 100);
    const capacity: LibraryCapacity = {
      maxLockableSlots: 0,
      swappableSlots: 5,
      maxTotalBytes: metadataTokenByteSize(token),
    };
    const result = addItem(EMPTY_LIBRARY, token, P0, capacity);
    expect(result.ok).toBe(true);
  });
});
