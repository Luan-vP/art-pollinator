/**
 * Issue #23 — content hashing and deduplication, exercised end to end with
 * `../crypto/sha256.ts`'s *real* hash function, not the placeholder strings
 * ("alpha", "beta", "a", ...) `library.test.ts`'s fixtures use for
 * readability elsewhere. `Library.addItem`'s dedup-by-content-hash logic
 * predates this batch (earlier Phase 1a work); this file's job is narrowly
 * to prove that logic is actually exercised with a genuine SHA-256 digest
 * of real bytes, per issue #23's own acceptance criteria: "Content hashing
 * function defined (used for both tokens and blobs)" and "offering an
 * already-held item by hash does not evict or duplicate."
 */
import { describe, expect, it } from "vitest";
import { hashContent } from "../crypto/sha256.js";
import { utf8Encode } from "../crypto/bytes.js";
import { SWAPPABLE_SLOTS } from "../constants.js";
import { EMPTY_LIBRARY, addItem, hasContentHash, swappableCount } from "./library.js";
import type { MetadataToken } from "../metadata/metadata-token.js";

/** Build a token whose `contentHash`/`blobPointer.contentHash` is the *real* SHA-256 digest of `pieceBytes` — exactly how a genuine blob or token payload would be addressed (SPEC.md §3.2). */
function tokenForRealContent(title: string, pieceBytes: Uint8Array): MetadataToken {
  const contentHash = hashContent(pieceBytes);
  return {
    title,
    creator: "Someone",
    description: "A piece worth passing on.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

describe("Library dedup by content hash — real SHA-256, not placeholder strings (issue #23)", () => {
  it("two tokens built from byte-identical content hash to the same value and dedup without consuming a second slot", () => {
    const pieceBytes = utf8Encode("the exact same underlying artwork bytes, encountered twice");

    // Two independently-constructed tokens for the *same* underlying piece
    // (e.g. received from two different peers) — real content hashing
    // means they collide on `contentHash` without any coordination.
    const tokenFromPeerA = tokenForRealContent("Coastline Study (from A)", pieceBytes);
    const tokenFromPeerB = tokenForRealContent("Coastline Study (from B, retitled)", pieceBytes);
    expect(tokenFromPeerA.contentHash).toBe(tokenFromPeerB.contentHash);

    const once = addItem(EMPTY_LIBRARY, tokenFromPeerA);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(swappableCount(once.library)).toBe(1);

    const twice = addItem(once.library, tokenFromPeerB);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;

    // No second slot consumed — the duplicate is a no-op, per Library.addItem's
    // existing contract, now proven against a genuine hash collision on
    // real bytes rather than a hand-picked placeholder string.
    expect(swappableCount(twice.library)).toBe(1);
    expect(twice.library).toBe(once.library); // no-op returns the same library reference
  });

  it("two tokens built from different content hash to different values and both occupy distinct slots", () => {
    const pieceBytesA = utf8Encode("artwork A's actual bytes");
    const pieceBytesB = utf8Encode("artwork B's actual bytes — genuinely different content");

    const tokenA = tokenForRealContent("Piece A", pieceBytesA);
    const tokenB = tokenForRealContent("Piece B", pieceBytesB);
    expect(tokenA.contentHash).not.toBe(tokenB.contentHash);

    const withA = addItem(EMPTY_LIBRARY, tokenA);
    expect(withA.ok).toBe(true);
    if (!withA.ok) return;
    const withBoth = addItem(withA.library, tokenB);
    expect(withBoth.ok).toBe(true);
    if (!withBoth.ok) return;

    expect(swappableCount(withBoth.library)).toBe(2);
    expect(hasContentHash(withBoth.library, tokenA.contentHash)).toBe(true);
    expect(hasContentHash(withBoth.library, tokenB.contentHash)).toBe(true);
  });

  it("offering an already-held item (by real content hash) does not evict or duplicate, even when the pool is full", () => {
    let library = EMPTY_LIBRARY;
    const heldTokens: MetadataToken[] = [];
    for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
      const token = tokenForRealContent(
        `Resident piece ${String(i)}`,
        utf8Encode(`resident-content-${String(i)}`),
      );
      heldTokens.push(token);
      const result = addItem(library, token);
      expect(result.ok).toBe(true);
      if (result.ok) library = result.library;
    }
    expect(swappableCount(library)).toBe(SWAPPABLE_SLOTS);

    // "Offer" the first resident piece again, reconstructed independently
    // from the same underlying bytes (as a peer re-offering it would),
    // while the pool is already completely full.
    const reOffered = tokenForRealContent(
      "Resident piece 0 (re-offered, different title)",
      utf8Encode("resident-content-0"),
    );
    expect(reOffered.contentHash).toBe(heldTokens[0]?.contentHash);

    const result = addItem(library, reOffered);
    expect(result.ok).toBe(true); // dedup no-op succeeds even at full capacity
    if (result.ok) {
      expect(swappableCount(result.library)).toBe(SWAPPABLE_SLOTS); // unchanged — no eviction, no duplicate slot
      expect(result.library).toBe(library); // untouched
    }
  });
});
