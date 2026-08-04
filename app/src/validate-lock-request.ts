import { isValidLockCount, MAX_LOCKABLE_SLOTS } from "@art-pollinator/core";

export interface LockRequestResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Minimal placeholder use case wrapping the pure `core` rule with an
 * application-facing error message. Stands in for the real
 * `LibraryService.setLockCount` use case scaffolded in Phase 1a
 * (IMPLEMENTATION.md item 11 — "Lock configuration").
 */
export function validateLockRequest(requestedLockCount: number): LockRequestResult {
  if (isValidLockCount(requestedLockCount)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `lock count must be an integer between 0 and ${MAX_LOCKABLE_SLOTS}`,
  };
}
