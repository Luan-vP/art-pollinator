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
import type { PeerKind } from "../ports/discovery-port.js";
import { toPriority } from "../priority/priority.js";
import { createNaiveOfferPolicy, naiveOfferPolicy } from "./offer-policy.js";

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

/** Build a `Library` directly from raw entries, bypassing `addItem`/`lockItem` entirely. Used for adversarial fixtures that a normal add/lock sequence could never produce (e.g. more locked entries than `MAX_LOCKABLE_SLOTS` permits) — the point is to prove `OfferPolicy` doesn't lean on `Library`'s own invariants holding. */
function rawLibrary(entries: readonly { contentHash: string; locked: boolean }[]): Library {
  const map = new Map<string, LibraryEntry>();
  for (const e of entries) {
    map.set(e.contentHash, {
      token: token(e.contentHash),
      locked: e.locked,
      priority: toPriority(0),
    });
  }
  return { entries: map };
}

const PEER_KINDS: readonly PeerKind[] = ["node", "person"];

function expectOkLibrary(result: { ok: boolean; library?: Library; error?: string }): Library {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${String(result.error)}`);
  }
  return result.library as Library;
}

describe("naiveOfferPolicy", () => {
  it("offers every swappable item when nothing is locked", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOkLibrary(addItem(library, token(`swap-${String(i)}`)));
    }

    for (const peerKind of PEER_KINDS) {
      const offered = naiveOfferPolicy.selectOffer(library, peerKind);
      expect(offered.map((t) => t.contentHash).sort()).toEqual(
        Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => `swap-${String(i)}`).sort(),
      );
    }
  });

  it("never offers a locked item, with 5 locked + 5 swappable simultaneously", () => {
    let library = EMPTY_LIBRARY;
    for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
      library = expectOkLibrary(addItem(library, token(`lock-${String(i)}`)));
      library = expectOkLibrary(lockItem(library, `lock-${String(i)}`));
    }
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      library = expectOkLibrary(addItem(library, token(`swap-${String(i)}`)));
    }

    for (const peerKind of PEER_KINDS) {
      const offered = naiveOfferPolicy.selectOffer(library, peerKind);
      const offeredHashes = offered.map((t) => t.contentHash);
      for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
        expect(offeredHashes).not.toContain(`lock-${String(i)}`);
      }
      expect(offeredHashes.sort()).toEqual(
        Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => `swap-${String(i)}`).sort(),
      );
    }
  });

  it("adversarial: never offers a locked item when the locked pool is the only non-empty pool", () => {
    // Constructed directly (not via lockItem) with more locked entries than
    // MAX_LOCKABLE_SLOTS would ever normally allow, and zero swappable
    // entries at all — the policy must not assume Library's own capacity
    // invariants held to get here.
    const library = rawLibrary([
      { contentHash: "locked-1", locked: true },
      { contentHash: "locked-2", locked: true },
      { contentHash: "locked-3", locked: true },
      { contentHash: "locked-4", locked: true },
      { contentHash: "locked-5", locked: true },
      { contentHash: "locked-6", locked: true },
      { contentHash: "locked-7", locked: true },
    ]);

    for (const peerKind of PEER_KINDS) {
      expect(naiveOfferPolicy.selectOffer(library, peerKind)).toEqual([]);
    }
  });

  it("offers nothing from an empty library", () => {
    for (const peerKind of PEER_KINDS) {
      expect(naiveOfferPolicy.selectOffer(EMPTY_LIBRARY, peerKind)).toEqual([]);
    }
  });

  it("createNaiveOfferPolicy() produces an independent, equivalent policy instance", () => {
    const policy = createNaiveOfferPolicy();
    let library = expectOkLibrary(addItem(EMPTY_LIBRARY, token("a")));
    library = expectOkLibrary(lockItem(library, "a"));
    library = expectOkLibrary(addItem(library, token("b")));

    expect(policy.selectOffer(library, "person").map((t) => t.contentHash)).toEqual(["b"]);
  });
});
