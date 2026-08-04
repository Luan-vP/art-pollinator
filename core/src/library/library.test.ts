import { describe, expect, it } from "vitest";
import { MAX_LOCKABLE_SLOTS, SWAPPABLE_SLOTS } from "../constants.js";
import type { MetadataToken } from "../metadata/metadata-token.js";
import {
  EMPTY_LIBRARY,
  addItem,
  hasContentHash,
  lockItem,
  lockedCount,
  lockedItems,
  removeItem,
  swappableCount,
  swappableItems,
  unlockItem,
  type Library,
} from "./library.js";

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

function expectOk(result: { ok: boolean; library?: Library; error?: string }): Library {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${String(result.error)}`);
  }
  return result.library as Library;
}

describe("addItem", () => {
  it("adds a new item to the swappable pool", () => {
    const result = addItem(EMPTY_LIBRARY, token("a"));
    const library = expectOk(result);
    expect(swappableCount(library)).toBe(1);
    expect(lockedCount(library)).toBe(0);
    expect(swappableItems(library).map((t) => t.contentHash)).toEqual(["a"]);
  });

  it("deduplicates by content hash without consuming an extra slot", () => {
    const once = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    const twice = expectOk(addItem(once, token("a")));
    expect(swappableCount(twice)).toBe(1);
    expect(twice).toBe(once); // no-op returns the same library reference
  });

  it("fills the swappable pool up to its fixed cap of 5", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`item-${String(i)}`)));
    }
    expect(swappableCount(library)).toBe(SWAPPABLE_SLOTS);
  });

  it("rejects adding a new (non-duplicate) item once the swappable pool is full", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`item-${String(i)}`)));
    }
    const result = addItem(library, token("one-too-many"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/full/);
    }
    expect(hasContentHash(library, "one-too-many")).toBe(false);
  });

  it("still accepts a duplicate of an existing item even when the pool is full", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`item-${String(i)}`)));
    }
    const result = addItem(library, token("item-0"));
    expect(result.ok).toBe(true);
  });
});

describe("removeItem", () => {
  it("removes an item, freeing its slot", () => {
    const withItem = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    const withoutItem = expectOk(removeItem(withItem, "a"));
    expect(swappableCount(withoutItem)).toBe(0);
    expect(hasContentHash(withoutItem, "a")).toBe(false);
  });

  it("removing an absent item is a no-op success", () => {
    const result = removeItem(EMPTY_LIBRARY, "does-not-exist");
    expect(result.ok).toBe(true);
  });

  it("frees a slot in whichever pool the item occupied, including locked", () => {
    let library = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    library = expectOk(lockItem(library, "a"));
    expect(lockedCount(library)).toBe(1);
    library = expectOk(removeItem(library, "a"));
    expect(lockedCount(library)).toBe(0);
  });
});

describe("lockItem", () => {
  it("moves an item from swappable to locked", () => {
    const withItem = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    const locked = expectOk(lockItem(withItem, "a"));
    expect(lockedCount(locked)).toBe(1);
    expect(swappableCount(locked)).toBe(0);
    expect(lockedItems(locked).map((t) => t.contentHash)).toEqual(["a"]);
  });

  it("is idempotent when the item is already locked", () => {
    const withItem = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    const lockedOnce = expectOk(lockItem(withItem, "a"));
    const lockedTwice = expectOk(lockItem(lockedOnce, "a"));
    expect(lockedTwice).toBe(lockedOnce);
  });

  it("rejects locking an item the library does not hold", () => {
    const result = lockItem(EMPTY_LIBRARY, "ghost");
    expect(result.ok).toBe(false);
  });

  it("allows locking exactly up to the maximum of 5", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`lock-${String(i)}`)));
      library = expectOk(lockItem(library, `lock-${String(i)}`));
    }
    expect(lockedCount(library)).toBe(MAX_LOCKABLE_SLOTS);
  });

  it("rejects locking a 6th item with a clear error, leaving the library unchanged", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`lock-${String(i)}`)));
      library = expectOk(lockItem(library, `lock-${String(i)}`));
    }
    library = expectOk(addItem(library, token("sixth")));

    const result = lockItem(library, "sixth");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/full/);
    }
    // Library is unchanged: the sixth item remains swappable, not locked.
    expect(lockedCount(library)).toBe(MAX_LOCKABLE_SLOTS);
    expect(swappableItems(library).map((t) => t.contentHash)).toContain("sixth");
  });
});

describe("unlockItem", () => {
  it("moves an item from locked back to swappable", () => {
    let library = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    library = expectOk(lockItem(library, "a"));
    library = expectOk(unlockItem(library, "a"));
    expect(lockedCount(library)).toBe(0);
    expect(swappableCount(library)).toBe(1);
  });

  it("is idempotent when the item is already unlocked", () => {
    const withItem = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    const result = unlockItem(withItem, "a");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.library).toBe(withItem);
    }
  });

  it("rejects unlocking an item the library does not hold", () => {
    const result = unlockItem(EMPTY_LIBRARY, "ghost");
    expect(result.ok).toBe(false);
  });

  it("rejects unlocking when it would overflow the fixed-size swappable pool", () => {
    // Fill swappable to capacity, then lock one *more* item on top (via a
    // temporary opening) so that locked + swappable together exceed what a
    // single unlock could re-accommodate.
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`swap-${String(i)}`)));
    }
    // Lock one swappable item to free a swappable slot, then refill it, then
    // re-lock a second item so we end up with a locked item and a full
    // swappable pool simultaneously.
    library = expectOk(lockItem(library, "swap-0"));
    library = expectOk(addItem(library, token("refill")));
    expect(swappableCount(library)).toBe(SWAPPABLE_SLOTS);
    expect(lockedCount(library)).toBe(1);

    const result = unlockItem(library, "swap-0");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/full/);
    }
    // Unchanged: still locked, swappable pool still full.
    expect(lockedCount(library)).toBe(1);
    expect(swappableCount(library)).toBe(SWAPPABLE_SLOTS);
  });
});

describe("lock configuration edge cases (issue #11)", () => {
  it("behaves sanely at 0 locked items", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`item-${String(i)}`)));
    }
    expect(lockedCount(library)).toBe(0);
    expect(lockedItems(library)).toEqual([]);
    expect(swappableCount(library)).toBe(SWAPPABLE_SLOTS);
  });

  it("behaves sanely at the maximum of 5 locked items, with the swappable pool still independently at 5", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`lock-${String(i)}`)));
      library = expectOk(lockItem(library, `lock-${String(i)}`));
    }
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOk(addItem(library, token(`swap-${String(i)}`)));
    }
    expect(lockedCount(library)).toBe(MAX_LOCKABLE_SLOTS);
    expect(swappableCount(library)).toBe(SWAPPABLE_SLOTS);
    expect(library.entries.size).toBe(MAX_LOCKABLE_SLOTS + SWAPPABLE_SLOTS);
  });

  it("locking then unlocking round-trips without losing the item or altering its content", () => {
    const original = token("a");
    let library = expectOk(addItem(EMPTY_LIBRARY, original));
    library = expectOk(lockItem(library, "a"));
    library = expectOk(unlockItem(library, "a"));

    const entry = library.entries.get("a");
    expect(entry?.locked).toBe(false);
    expect(entry?.token).toEqual(original);
  });

  it("never classifies a locked item as swappable, and vice versa, across reconfiguration", () => {
    let library = expectOk(addItem(EMPTY_LIBRARY, token("a")));
    library = expectOk(addItem(library, token("b")));
    library = expectOk(lockItem(library, "a"));

    expect(lockedItems(library).map((t) => t.contentHash)).toEqual(["a"]);
    expect(swappableItems(library).map((t) => t.contentHash)).toEqual(["b"]);

    library = expectOk(lockItem(library, "b"));
    expect(
      lockedItems(library)
        .map((t) => t.contentHash)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(swappableItems(library)).toEqual([]);
  });
});
