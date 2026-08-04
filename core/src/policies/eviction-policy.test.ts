import { describe, expect, it } from "vitest";
import { MAX_LOCKABLE_SLOTS, SWAPPABLE_SLOTS } from "../constants.js";
import {
  addItem,
  EMPTY_LIBRARY,
  lockItem,
  type Library,
  type LibraryEntry,
} from "../library/library.js";
import type { MetadataToken } from "../metadata/metadata-token.js";
import { toPriority } from "../priority/priority.js";
import { createNaiveEvictionPolicy, naiveEvictionPolicy } from "./eviction-policy.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { contentHash },
    contentHash,
    signature: "",
  };
}

/** Build a `Library` directly from raw entries (with explicit priorities), bypassing `addItem`/`lockItem`. Used so priorities can be set precisely for ranking tests, and for adversarial fixtures a normal add/lock sequence couldn't produce. */
function rawLibrary(
  entries: readonly { contentHash: string; locked: boolean; priority: number }[],
): Library {
  const map = new Map<string, LibraryEntry>();
  for (const e of entries) {
    map.set(e.contentHash, {
      token: token(e.contentHash),
      locked: e.locked,
      priority: toPriority(e.priority),
    });
  }
  return { entries: map };
}

function expectOkLibrary(result: { ok: boolean; library?: Library; error?: string }): Library {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${String(result.error)}`);
  }
  return result.library as Library;
}

describe("naiveEvictionPolicy (issue #14: evict lowest priority first)", () => {
  it("evicts nothing when there is already room for incoming items", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS - 1; i++) {
      library = expectOkLibrary(addItem(library, token(`swap-${String(i)}`)));
    }
    const evicted = naiveEvictionPolicy.selectEvict(library, [token("incoming")]);
    expect(evicted).toEqual([]);
  });

  it("evicts exactly the lowest-priority swappable item(s) needed to fit incoming, no more", () => {
    const library = rawLibrary([
      { contentHash: "low", locked: false, priority: 1 },
      { contentHash: "mid", locked: false, priority: 5 },
      { contentHash: "high", locked: false, priority: 10 },
      { contentHash: "highest", locked: false, priority: 20 },
      { contentHash: "highest2", locked: false, priority: 30 },
    ]);
    // SWAPPABLE_SLOTS is 5; library already has 5 swappable, 2 incoming ->
    // need to evict exactly 2, lowest priority first.
    const evicted = naiveEvictionPolicy.selectEvict(library, [token("in-1"), token("in-2")]);
    expect(evicted.map((t) => t.contentHash)).toEqual(["low", "mid"]);
  });

  it("never evicts a locked item, with 5 locked + 5 swappable simultaneously", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
      library = expectOkLibrary(addItem(library, token(`lock-${String(i)}`)));
      library = expectOkLibrary(lockItem(library, `lock-${String(i)}`));
    }
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOkLibrary(addItem(library, token(`swap-${String(i)}`)));
    }

    const incoming = Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => token(`in-${String(i)}`));
    const evicted = naiveEvictionPolicy.selectEvict(library, incoming);
    const evictedHashes = evicted.map((t) => t.contentHash);
    for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
      expect(evictedHashes).not.toContain(`lock-${String(i)}`);
    }
    // All 5 swappable items had to go to make room for 5 incoming.
    expect(evictedHashes.sort()).toEqual(
      Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => `swap-${String(i)}`).sort(),
    );
  });

  it("adversarial: never evicts a locked item, even when it is simultaneously the lowest-priority item in the whole library", () => {
    const library = rawLibrary([
      // The locked item is priority -1000 — lower than every swappable
      // item — yet must never be evicted.
      { contentHash: "locked-lowest", locked: true, priority: -1000 },
      { contentHash: "swap-a", locked: false, priority: 1 },
      { contentHash: "swap-b", locked: false, priority: 2 },
      { contentHash: "swap-c", locked: false, priority: 3 },
      { contentHash: "swap-d", locked: false, priority: 4 },
      { contentHash: "swap-e", locked: false, priority: 5 },
    ]);
    // 5 swappable already at cap; 1 incoming forces exactly 1 eviction.
    const evicted = naiveEvictionPolicy.selectEvict(library, [token("incoming")]);
    expect(evicted.map((t) => t.contentHash)).not.toContain("locked-lowest");
    // The lowest-priority *swappable* item is evicted instead.
    expect(evicted.map((t) => t.contentHash)).toEqual(["swap-a"]);
  });

  it("evicts nothing when the library has no swappable items at all (only locked)", () => {
    const library = rawLibrary([{ contentHash: "locked-only", locked: true, priority: -999 }]);
    const evicted = naiveEvictionPolicy.selectEvict(library, [token("incoming")]);
    expect(evicted).toEqual([]);
  });

  it("createNaiveEvictionPolicy() produces an independent, equivalent policy instance", () => {
    const policy = createNaiveEvictionPolicy();
    const library = rawLibrary([
      { contentHash: "a", locked: false, priority: 1 },
      { contentHash: "b", locked: false, priority: 2 },
      { contentHash: "c", locked: false, priority: 3 },
      { contentHash: "d", locked: false, priority: 4 },
      { contentHash: "e", locked: false, priority: 5 },
    ]);
    const evicted = policy.selectEvict(library, [token("in")]);
    expect(evicted.map((t) => t.contentHash)).toEqual(["a"]);
  });
});
