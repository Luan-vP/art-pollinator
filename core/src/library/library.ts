/**
 * Slot / Library aggregate — the central aggregate other policies operate on.
 *
 * SPEC.md §3.3: a fixed-capacity local store of 10 slots — up to 5
 * *lockable* (never evictable, never offered) and 5 *swappable* (available
 * for outbound swaps; incoming pieces land here). AGENTS.md §6 fixes these
 * numbers; changing them needs an ADR.
 *
 * ## Design: two independent capacity pools, not one reclassifiable pool of 10
 *
 * The lockable and swappable slots are two separate pools, each with its own
 * cap (`MAX_LOCKABLE_SLOTS`, `SWAPPABLE_SLOTS`) — not a single pool of 10
 * that gets divided up however locking happens to land. That matters for two
 * fixed parameters: the swappable pool has a size of exactly 5 *regardless*
 * of how many items are locked, and the lockable pool is capped at 5
 * independently. An item added to the library always lands in the swappable
 * pool first (that's where "incoming pieces land," per SPEC.md §3.3);
 * locking moves it into the lockable pool, unlocking moves it back — this is
 * the "deterministic reclassification" issue #11 asks for. Locking or
 * unlocking never resizes a pool, discards an item, or silently drops a slot
 * — an operation that would overflow either pool's cap is rejected outright
 * with a descriptive error, leaving the library unchanged.
 *
 * ## Design: a plain immutable value, not a class with mutating methods
 *
 * `Library` is a plain, structurally-typed, immutable snapshot. Every
 * operation (`addItem`, `removeItem`, `lockItem`, `unlockItem`) is a pure
 * function taking a `Library` and returning either a new `Library` or a
 * rejection reason — never throwing, and never mutating its input. This
 * keeps the aggregate trivially testable (assert on the returned value, no
 * hidden state) and matches the "no I/O, no ambient state" constraint the
 * rest of `core` already follows (see `constants.ts`).
 */

import { MAX_LOCKABLE_SLOTS, SWAPPABLE_SLOTS } from "../constants.js";
import type { MetadataToken } from "../metadata/metadata-token.js";

/** A single item's residency in a `Library`: the token plus which pool it currently occupies. */
export interface LibraryEntry {
  readonly token: MetadataToken;
  readonly locked: boolean;
}

/**
 * The library aggregate: every item currently held, keyed by content hash.
 * A `Map` keyed by content hash is what makes duplicate-by-content-hash
 * dedup (SPEC.md §3.3) a lookup rather than a linear scan, and gives
 * `addItem` an unambiguous identity to check before consuming a slot.
 */
export interface Library {
  readonly entries: ReadonlyMap<string, LibraryEntry>;
}

/** A library with no items — the starting state for a fresh device. */
export const EMPTY_LIBRARY: Library = { entries: new Map() };

export type LibraryOperationResult =
  { readonly ok: true; readonly library: Library } | { readonly ok: false; readonly error: string };

function withEntries(entries: ReadonlyMap<string, LibraryEntry>): Library {
  return { entries };
}

/** Items currently in the lockable pool (never evictable, never offered — SPEC.md §3.3). */
export function lockedItems(library: Library): readonly MetadataToken[] {
  return [...library.entries.values()].filter((entry) => entry.locked).map((entry) => entry.token);
}

/** Items currently in the swappable pool (offerable outbound, and where incoming items land). */
export function swappableItems(library: Library): readonly MetadataToken[] {
  return [...library.entries.values()].filter((entry) => !entry.locked).map((entry) => entry.token);
}

/** Count of items currently occupying the lockable pool. Always `<= MAX_LOCKABLE_SLOTS`. */
export function lockedCount(library: Library): number {
  return lockedItems(library).length;
}

/** Count of items currently occupying the swappable pool. Always `<= SWAPPABLE_SLOTS`. */
export function swappableCount(library: Library): number {
  return swappableItems(library).length;
}

/** `true` if the library already holds an item with this content hash, in either pool. */
export function hasContentHash(library: Library, contentHash: string): boolean {
  return library.entries.has(contentHash);
}

/**
 * Add an item to the library. New items always land in the swappable pool
 * (SPEC.md §3.3: "Incoming pieces land here").
 *
 * - A duplicate content hash is a no-op success (the existing library is
 *   returned unchanged) rather than an error — "encountering a duplicate"
 *   is an expected, ordinary event during gossip, not a caller mistake, and
 *   it must never consume a slot (SPEC.md §3.3, tracked further by the full
 *   hashing/dedup work in issue #23).
 * - If the swappable pool is already full, the add is rejected.
 */
export function addItem(library: Library, token: MetadataToken): LibraryOperationResult {
  if (library.entries.has(token.contentHash)) {
    return { ok: true, library };
  }

  if (swappableCount(library) >= SWAPPABLE_SLOTS) {
    return {
      ok: false,
      error: `Cannot add item: swappable pool is full (${String(SWAPPABLE_SLOTS)}/${String(SWAPPABLE_SLOTS)} slots occupied).`,
    };
  }

  const nextEntries = new Map(library.entries);
  nextEntries.set(token.contentHash, { token, locked: false });
  return { ok: true, library: withEntries(nextEntries) };
}

/** Remove an item from the library, from whichever pool it currently occupies. Removing an absent item is a no-op success. */
export function removeItem(library: Library, contentHash: string): LibraryOperationResult {
  if (!library.entries.has(contentHash)) {
    return { ok: true, library };
  }

  const nextEntries = new Map(library.entries);
  nextEntries.delete(contentHash);
  return { ok: true, library: withEntries(nextEntries) };
}

/**
 * Move an item from the swappable pool into the lockable pool.
 *
 * - Locking an already-locked item is a no-op success.
 * - Locking a 6th item — i.e. when the lockable pool already holds
 *   `MAX_LOCKABLE_SLOTS` *other* items — is rejected with a descriptive
 *   error (issue #10's explicit acceptance criterion), leaving the library
 *   unchanged.
 * - Locking an item the library does not hold is rejected.
 */
export function lockItem(library: Library, contentHash: string): LibraryOperationResult {
  const entry = library.entries.get(contentHash);
  if (!entry) {
    return {
      ok: false,
      error: `Cannot lock item: no item with content hash "${contentHash}" in the library.`,
    };
  }
  if (entry.locked) {
    return { ok: true, library };
  }
  if (lockedCount(library) >= MAX_LOCKABLE_SLOTS) {
    return {
      ok: false,
      error: `Cannot lock item: lockable pool is full (${String(MAX_LOCKABLE_SLOTS)}/${String(MAX_LOCKABLE_SLOTS)} slots occupied).`,
    };
  }

  const nextEntries = new Map(library.entries);
  nextEntries.set(contentHash, { token: entry.token, locked: true });
  return { ok: true, library: withEntries(nextEntries) };
}

/**
 * Move an item from the lockable pool back into the swappable pool.
 *
 * - Unlocking an already-unlocked item is a no-op success.
 * - Rejected if the swappable pool is already full — the swappable pool has
 *   a fixed size of `SWAPPABLE_SLOTS` regardless of how many items are
 *   locked, so unlocking must not silently overflow it. (This can only
 *   arise if the swappable pool is already at capacity; freeing a swappable
 *   slot first, e.g. via `removeItem` or an `EvictionPolicy` decision in a
 *   later issue, makes room.)
 * - Unlocking an item the library does not hold is rejected.
 */
export function unlockItem(library: Library, contentHash: string): LibraryOperationResult {
  const entry = library.entries.get(contentHash);
  if (!entry) {
    return {
      ok: false,
      error: `Cannot unlock item: no item with content hash "${contentHash}" in the library.`,
    };
  }
  if (!entry.locked) {
    return { ok: true, library };
  }
  if (swappableCount(library) >= SWAPPABLE_SLOTS) {
    return {
      ok: false,
      error: `Cannot unlock item: swappable pool is full (${String(SWAPPABLE_SLOTS)}/${String(SWAPPABLE_SLOTS)} slots occupied).`,
    };
  }

  const nextEntries = new Map(library.entries);
  nextEntries.set(contentHash, { token: entry.token, locked: false });
  return { ok: true, library: withEntries(nextEntries) };
}
