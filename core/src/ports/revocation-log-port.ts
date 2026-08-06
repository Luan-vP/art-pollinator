/**
 * RevocationLogPort — this device's record of every revocation it currently
 * knows about (issue #51). A 10th driven port, alongside `EncounterLogPort`
 * (the closest existing analogue: both are small, append-mostly logs a
 * `SwapService` reads from and writes to on every swap, per AGENTS.md §2
 * rule 3 — "ports are owned by the domain, shaped by what the domain
 * needs").
 *
 * Unlike `EncounterLogPort` (strictly local bookkeeping, never sent over
 * the wire), a `RevocationLogPort`'s contents *are* exchanged with peers —
 * `listAll()` is what `SwapService` sends in its revocation round, and
 * `record()` is what merges in whatever a peer sends back. See
 * `core/src/security/revocation.ts`'s doc comment for the full opportunistic-
 * gossip design and `app/src/swap/swap-service.ts` for where this port is
 * actually driven.
 */
import type { RevocationEntry } from "../security/revocation.js";

export interface RevocationLogPort {
  /** Record `entry` if not already known (by content hash) — a no-op if this exact content hash is already recorded. Does not itself verify the entry's signature or authorization; callers (`SwapService`) do that first. */
  record(entry: RevocationEntry): Promise<void>;

  /** `true` if a revocation is already recorded for `contentHash`. */
  has(contentHash: string): Promise<boolean>;

  /** Every revocation this device currently knows about — what gets sent to a peer during the revocation round of a swap. */
  listAll(): Promise<readonly RevocationEntry[]>;
}
