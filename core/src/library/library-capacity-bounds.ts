/**
 * validateCapacityBounds — a pure, reusable check for "is this a legal
 * `LibraryCapacity`," parameterized by the caller's own upper bound.
 *
 * `clients/node/src/composition/node-capacity.ts`'s `resolveNodeCapacity`
 * already validates a node's *startup* capacity against
 * `NODE_MAX_TOTAL_SLOTS`, but that function lives in `clients/node`
 * (composition-root territory) and reads `totalSlots`/`lockableSlots` as
 * separate override fields, not a `LibraryCapacity` value directly. Issue
 * #50's `AdminService` (`app/src/admin/admin-service.ts`) needs the
 * identical *shape* of validation — reject an out-of-bounds capacity change
 * loudly rather than silently clamping — for a **runtime** capacity change
 * request, not just a startup one. Rather than duplicate the bounds-checking
 * logic (or have `app` import a `clients/node`-specific module, which would
 * invert the dependency direction AGENTS.md §2 fixes), this is the one
 * shared, pure implementation both call sites use: `clients/node`'s startup
 * path and `AdminService`'s runtime path each supply their own numbers
 * (`maxTotalSlots`), and this function only knows how to check them against
 * a `LibraryCapacity`, exactly as it's already silent on "what a node's
 * capacity should be" (`docs/adr/0012-node-library-capacity-generalization.md`).
 */
import type { LibraryCapacity } from "./library.js";

export type CapacityBoundsResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * `true` (well, `{ ok: true }`) if `capacity`'s two pools are individually
 * non-negative integers and their sum does not exceed `maxTotalSlots`.
 * Never clamps — a caller that gets `{ ok: false }` must decide for itself
 * whether to reject the request outright (the choice both current callers
 * make).
 */
export function validateCapacityBounds(
  capacity: LibraryCapacity,
  maxTotalSlots: number,
): CapacityBoundsResult {
  const { maxLockableSlots, swappableSlots, maxTotalBytes } = capacity;
  if (!Number.isInteger(maxLockableSlots) || maxLockableSlots < 0) {
    return {
      ok: false,
      error: `maxLockableSlots must be a non-negative integer, got ${String(maxLockableSlots)}.`,
    };
  }
  if (!Number.isInteger(swappableSlots) || swappableSlots < 0) {
    return {
      ok: false,
      error: `swappableSlots must be a non-negative integer, got ${String(swappableSlots)}.`,
    };
  }
  const total = maxLockableSlots + swappableSlots;
  if (total > maxTotalSlots) {
    return {
      ok: false,
      error: `requested total capacity (${String(total)}) exceeds the maximum of ${String(maxTotalSlots)}.`,
    };
  }
  if (total === 0) {
    return {
      ok: false,
      error: "requested capacity is zero — a library must hold at least one slot.",
    };
  }
  if (maxTotalBytes !== undefined && (!Number.isFinite(maxTotalBytes) || maxTotalBytes <= 0)) {
    return {
      ok: false,
      error: `maxTotalBytes must be a positive number when provided, got ${String(maxTotalBytes)}.`,
    };
  }
  return { ok: true };
}
