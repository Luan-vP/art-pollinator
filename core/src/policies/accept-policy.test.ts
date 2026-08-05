import { describe, expect, it } from "vitest";
import { SWAPPABLE_SLOTS } from "../constants.js";
import { addItem, EMPTY_LIBRARY, type Library } from "../library/library.js";
import type { MetadataToken } from "../metadata/metadata-token.js";
import { createNaiveAcceptPolicy, naiveAcceptPolicy } from "./accept-policy.js";

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

function expectOkLibrary(result: { ok: boolean; library?: Library; error?: string }): Library {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${String(result.error)}`);
  }
  return result.library as Library;
}

describe("naiveAcceptPolicy (issue #13: accept what fits)", () => {
  it("accepts every offered item when the library is empty and offered fits entirely", () => {
    const offered = [token("a"), token("b"), token("c")];
    const accepted = naiveAcceptPolicy.selectAccept(offered, EMPTY_LIBRARY);
    expect(accepted.map((t) => t.contentHash).sort()).toEqual(["a", "b", "c"]);
  });

  it("accepts only up to remaining swappable capacity, in offered order", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS - 2; i++) {
      library = expectOkLibrary(addItem(library, token(`existing-${String(i)}`)));
    }
    // Exactly 2 slots remain.
    const offered = [token("x"), token("y"), token("z"), token("w")];
    const accepted = naiveAcceptPolicy.selectAccept(offered, library);
    expect(accepted).toHaveLength(2);
    expect(accepted.map((t) => t.contentHash)).toEqual(["x", "y"]);
  });

  it("accepts nothing when the swappable pool is already full", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOkLibrary(addItem(library, token(`existing-${String(i)}`)));
    }
    const offered = [token("x"), token("y")];
    expect(naiveAcceptPolicy.selectAccept(offered, library)).toEqual([]);
  });

  it("skips an item already held by content hash, without spending capacity budget on it", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS - 1; i++) {
      library = expectOkLibrary(addItem(library, token(`existing-${String(i)}`)));
    }
    library = expectOkLibrary(addItem(library, token("dup")));
    // Now the pool is full (SWAPPABLE_SLOTS items, one of which is "dup").
    // Offering "dup" again plus one genuinely new item, with zero remaining
    // capacity, should accept nothing new.
    const accepted = naiveAcceptPolicy.selectAccept([token("dup"), token("new")], library);
    expect(accepted).toEqual([]);
  });

  it("skips a content hash repeated within the same offered batch", () => {
    const offered = [token("a"), token("a"), token("b")];
    const accepted = naiveAcceptPolicy.selectAccept(offered, EMPTY_LIBRARY);
    expect(accepted.map((t) => t.contentHash)).toEqual(["a", "b"]);
  });

  it("does not assume `offered` is small: a large offered array still resolves correctly and stops at capacity", () => {
    const hugeOffered = Array.from({ length: 10_000 }, (_, i) => token(`flood-${String(i)}`));
    const accepted = naiveAcceptPolicy.selectAccept(hugeOffered, EMPTY_LIBRARY);
    expect(accepted).toHaveLength(SWAPPABLE_SLOTS);
    expect(accepted.map((t) => t.contentHash)).toEqual(
      Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => `flood-${String(i)}`),
    );
  });

  it("createNaiveAcceptPolicy() produces an independent, equivalent policy instance", () => {
    const policy = createNaiveAcceptPolicy();
    expect(policy.selectAccept([token("a")], EMPTY_LIBRARY).map((t) => t.contentHash)).toEqual([
      "a",
    ]);
  });
});
