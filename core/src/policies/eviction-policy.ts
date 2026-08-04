/**
 * EvictionPolicy — the strategy seam for choosing what to evict from the
 * swappable pool to make room for incoming items.
 *
 * SPEC.md §5 fixes the signature: `selectEvict(library, incoming) -> Item[]`.
 * AGENTS.md §6: a locked item is never evicted, enforced *independently*
 * here — this function reads each entry's own `.locked` flag directly,
 * rather than trusting a pre-filtered candidate list a caller might hand in
 * (issue #14, IMPLEMENTATION.md Phase 1a item 14).
 *
 * See `../library/library.ts`'s doc comment on `LibraryEntry` for why
 * `Priority` now lives on the aggregate — this issue's one change to the
 * previous batch's `Library` type.
 */

import { SWAPPABLE_SLOTS } from "../constants.js";
import type { Library, LibraryEntry } from "../library/library.js";
import { comparePriority } from "../priority/priority.js";
import type { Item } from "./policy-types.js";

export interface EvictionPolicy {
  selectEvict(library: Library, incoming: readonly Item[]): Item[];
}

/**
 * Naive default `EvictionPolicy`: evict the lowest-priority swappable items
 * first, evicting exactly enough to make room for `incoming` — never more,
 * never fewer ("lowest priority first" — IMPLEMENTATION.md Phase 1a item
 * 14).
 *
 * Locked entries are filtered out of consideration *before* any ranking
 * happens: this function never even reads a locked entry's `priority`, so a
 * locked item being simultaneously the lowest-priority item in the whole
 * library cannot put it up for eviction (AGENTS.md §6, issue #14's explicit
 * acceptance criterion).
 */
export function createNaiveEvictionPolicy(): EvictionPolicy {
  return {
    selectEvict(library: Library, incoming: readonly Item[]): Item[] {
      const swappableEntries: LibraryEntry[] = [];
      for (const entry of library.entries.values()) {
        if (entry.locked) continue; // independent enforcement of the locked-item invariant, AGENTS.md §6
        swappableEntries.push(entry);
      }

      const neededSlots = swappableEntries.length + incoming.length - SWAPPABLE_SLOTS;
      if (neededSlots <= 0) {
        return [];
      }

      const lowestPriorityFirst = [...swappableEntries].sort((a, b) =>
        comparePriority(a.priority, b.priority),
      );
      return lowestPriorityFirst.slice(0, neededSlots).map((entry) => entry.token);
    },
  };
}

/** A ready-to-use naive `EvictionPolicy` instance for callers that don't need a custom one. */
export const naiveEvictionPolicy: EvictionPolicy = createNaiveEvictionPolicy();
