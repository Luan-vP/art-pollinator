/**
 * Node capacity — the stationary node's actual numbers (issue #46).
 *
 * `core`'s `Library` aggregate accepts a configurable `LibraryCapacity`
 * (`docs/adr/0012-node-library-capacity-generalization.md`); this module is
 * the one place those numbers are decided for *this* node type, matching
 * that ADR's own design ("`core` only knows how to accept a capacity; it is
 * deliberately silent on what a node's capacity should be").
 *
 * ## Picking a default: 10x a phone's swappable pool, still firmly bounded
 *
 * SPEC.md §4 fixes only the shape of the requirement, not a number: "a
 * larger disk... still bounded by design to preserve curation pressure."
 * There is no measured deployment to size against yet (this is the first
 * node server this codebase has ever run), so the default below is a
 * considered guess, not a load-tested figure — documented as such rather
 * than presented as more authoritative than it is:
 *
 * - **{@link NODE_DEFAULT_SWAPPABLE_SLOTS} = 190** — a stationary node's
 *   whole purpose (SPEC.md §4) is receiving and passing pieces on to
 *   whoever visits next, so almost all of its capacity is swappable, unlike
 *   a phone's fixed 50/50 split (AGENTS.md §6) between a personal,
 *   never-evicted collection and a swappable one. 190 is deliberately *not*
 *   round-tripped from "10x a phone's 5" via some formula — it is simply
 *   "an order of magnitude more room than a phone, chosen for a machine
 *   with meaningfully more disk and no battery/carry-weight constraint,"
 *   while remaining small enough that eviction pressure still exists long
 *   before "unbounded accumulation" would (AGENTS.md's opening line: "if
 *   you find yourself proposing to raise a limit... you have misread the
 *   intent" — the point of a bound is that it binds, not that it is
 *   generous).
 * - **{@link NODE_DEFAULT_LOCKABLE_SLOTS} = 10** — a node operator (a
 *   venue, a gallery) may still want to pin a small, curated "house
 *   selection" that never gets swapped away regardless of visitor traffic,
 *   the same reason a phone has a lockable pool at all — just a smaller
 *   *proportion* of the whole than a phone's, since curation-by-pinning is
 *   secondary to a node's main job of circulating everything else.
 * - **{@link NODE_MAX_TOTAL_SLOTS} = 2,000 (a hard upper bound, issue
 *   #46's explicit requirement)** — roughly 10x the default, chosen so an
 *   operator can scale a node up for a genuinely high-traffic venue without
 *   the ceiling being the very next round number after the default (which
 *   would make the "bound" purely nominal), while still being small enough
 *   that "unbounded accumulation" is unambiguously not on the table: 2,000
 *   metadata tokens at the ~5 KB budget (AGENTS.md §6) is ~10 MB of
 *   metadata, trivially small for the disk SPEC.md §4 describes, but the
 *   number itself — not the disk math — is what actually enforces the
 *   bound, since nothing here ever raises it automatically.
 *
 * Both the default and the upper bound are revisitable once a real node has
 * actually run against real traffic — this module is the one place to
 * change them, not scattered throughout the composition root.
 */
import { DEFAULT_LIBRARY_CAPACITY, type LibraryCapacity } from "@art-pollinator/core";

/** Default swappable-pool size for a stationary node — see this file's doc comment. */
export const NODE_DEFAULT_SWAPPABLE_SLOTS = 190;

/** Default lockable-pool size for a stationary node — see this file's doc comment. */
export const NODE_DEFAULT_LOCKABLE_SLOTS = 10;

/** Default total capacity for a stationary node (issue #46: "larger than the 10-slot phone default"). */
export const NODE_DEFAULT_TOTAL_SLOTS = NODE_DEFAULT_SWAPPABLE_SLOTS + NODE_DEFAULT_LOCKABLE_SLOTS;

/** The node's default configured capacity, ready to pass to `SwapService`/`LibraryService`/the naive policy factories. */
export const NODE_DEFAULT_CAPACITY: LibraryCapacity = {
  maxLockableSlots: NODE_DEFAULT_LOCKABLE_SLOTS,
  swappableSlots: NODE_DEFAULT_SWAPPABLE_SLOTS,
};

/**
 * Hard upper bound on a node's *total* configured capacity (issue #46: "An
 * explicit upper bound exists — no unbounded accumulation option"). No
 * configuration path in this package — env var or programmatic override —
 * can produce a `LibraryCapacity` whose `swappableSlots + maxLockableSlots`
 * exceeds this; {@link resolveNodeCapacity} throws rather than clamping
 * silently, since a silently-clamped value would hide a misconfiguration
 * from whoever set it.
 */
export const NODE_MAX_TOTAL_SLOTS = 2_000;

/** Thrown by {@link resolveNodeCapacity} for a requested capacity this module refuses to honor. */
export class InvalidNodeCapacityError extends Error {}

export interface NodeCapacityOverrides {
  /** Requested total capacity (swappable + lockable). Defaults to {@link NODE_DEFAULT_TOTAL_SLOTS}. Must not exceed {@link NODE_MAX_TOTAL_SLOTS}. */
  readonly totalSlots?: number;
  /** Requested lockable-pool size, must be `<= totalSlots`. Defaults to {@link NODE_DEFAULT_LOCKABLE_SLOTS}. */
  readonly lockableSlots?: number;
}

/**
 * Resolve a node's actual `LibraryCapacity` from optional overrides
 * (typically read from environment variables by `../config.js`),
 * validating against {@link NODE_MAX_TOTAL_SLOTS} along the way. Never
 * silently clamps — an out-of-bounds request throws
 * {@link InvalidNodeCapacityError} with a message naming the exact limit
 * violated, so a misconfigured deployment fails loudly at startup rather
 * than running with a capacity nobody actually asked for.
 *
 * The phone's own fixed default ({@link DEFAULT_LIBRARY_CAPACITY}) plays no
 * role here beyond being re-exported for a caller that wants to compare
 * against it — a stationary node is a distinct node type with its own
 * default (`docs/adr/0012-node-library-capacity-generalization.md`), not a
 * multiple of the phone's numbers computed at runtime.
 */
export function resolveNodeCapacity(overrides: NodeCapacityOverrides = {}): LibraryCapacity {
  const totalSlots = overrides.totalSlots ?? NODE_DEFAULT_TOTAL_SLOTS;
  const lockableSlots = overrides.lockableSlots ?? NODE_DEFAULT_LOCKABLE_SLOTS;

  if (!Number.isInteger(totalSlots) || totalSlots <= 0) {
    throw new InvalidNodeCapacityError(
      `Node capacity: totalSlots must be a positive integer, got ${String(totalSlots)}.`,
    );
  }
  if (totalSlots > NODE_MAX_TOTAL_SLOTS) {
    throw new InvalidNodeCapacityError(
      `Node capacity: requested totalSlots (${String(totalSlots)}) exceeds the hard upper bound of ` +
        `${String(NODE_MAX_TOTAL_SLOTS)} (issue #46 — see clients/node/src/composition/node-capacity.ts). ` +
        `Unbounded accumulation is not an option; lower the request.`,
    );
  }
  if (!Number.isInteger(lockableSlots) || lockableSlots < 0) {
    throw new InvalidNodeCapacityError(
      `Node capacity: lockableSlots must be a non-negative integer, got ${String(lockableSlots)}.`,
    );
  }
  if (lockableSlots > totalSlots) {
    throw new InvalidNodeCapacityError(
      `Node capacity: lockableSlots (${String(lockableSlots)}) cannot exceed totalSlots (${String(totalSlots)}).`,
    );
  }

  return {
    maxLockableSlots: lockableSlots,
    swappableSlots: totalSlots - lockableSlots,
  };
}

export { DEFAULT_LIBRARY_CAPACITY };
