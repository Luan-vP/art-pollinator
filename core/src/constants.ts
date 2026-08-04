/**
 * Fixed domain parameters. See AGENTS.md §6 ("Fixed parameters — do not
 * change without an ADR") and SPEC.md §3.3.
 *
 * These are pure values with no I/O and no external dependency — exactly the
 * shape everything in `core` must take.
 */

/** Total number of slots a library holds. */
export const TOTAL_SLOTS = 10;

/** Maximum number of slots that may be locked (never evicted, never offered). */
export const MAX_LOCKABLE_SLOTS = 5;

/** Number of slots always available for outbound/inbound swaps. */
export const SWAPPABLE_SLOTS = TOTAL_SLOTS - MAX_LOCKABLE_SLOTS;

/** Metadata token size budget, in bytes. See SPEC.md §3.1. */
export const METADATA_TOKEN_MAX_BYTES = 5 * 1024;

/**
 * Whether a requested lock count is a legal configuration.
 *
 * Locking is bounded at both ends: you cannot lock more than
 * {@link MAX_LOCKABLE_SLOTS} items, and a negative count is nonsensical.
 * Zero locked items is valid (nothing pinned).
 */
export function isValidLockCount(lockCount: number): boolean {
  return Number.isInteger(lockCount) && lockCount >= 0 && lockCount <= MAX_LOCKABLE_SLOTS;
}
