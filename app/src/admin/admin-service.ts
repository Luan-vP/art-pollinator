/**
 * AdminService — the node operator experience use case (issue #50).
 *
 * ## Design: a plain `app` class, not a new `core` port
 *
 * `IMPLEMENTATION.md`'s Phase 2 item 50 calls for "an `AdminService` driving
 * port." A *driving* port (as opposed to the *driven* ports `core` already
 * defines — `TransportPort`, `MetadataRepositoryPort`, etc.) is the
 * interface an outside caller uses to drive the domain, not one the domain
 * calls out through — the same category `LibraryService` and `SwapService`
 * already occupy without either needing a separate `core`-level interface
 * of its own. `AdminService` follows that exact precedent: it is the
 * concrete class a driving adapter (a localhost-only HTTP admin surface,
 * `clients/node/src/admin/admin-http-server.ts`) calls directly, built from
 * the same `LibraryService`/port-shaped dependencies every other `app` use
 * case already takes. No new `core` interface was needed because nothing
 * *inside* `core` needs to call *out* to an admin operation — the direction
 * of control here is entirely "operator drives the node," which is exactly
 * what a plain class in `app` is for.
 *
 * ## What this covers (issue #50's explicit DoD)
 *
 * - **View current library contents/stats** — {@link getLibrarySnapshot}.
 * - **Moderate** (issue #51) — {@link revokeContent}, {@link listRevocations}.
 * - **Administer**: change capacity at runtime, within issue #46's bounds —
 *   {@link setCapacity}; view connected-peer/rate-limit state from issue
 *   #49 — {@link getSecurityStatus}.
 */
import {
  validateCapacityBounds,
  type ClockPort,
  type IdentityPort,
  type LibraryCapacity,
  type RevocationEntry,
  type RevocationLogPort,
  type SecurityStatusPort,
  type SecurityStatusSnapshot,
} from "@art-pollinator/core";
import type { LibraryService } from "../library/library-service.js";
import { signRevocationEntry } from "../identity/sign-revocation.js";

export interface LibrarySnapshot {
  readonly totalItems: number;
  readonly lockedItems: number;
  readonly swappableItems: number;
  readonly capacity: LibraryCapacity;
}

export interface LibraryEntryView {
  readonly contentHash: string;
  readonly title: string;
  readonly creator: string;
  readonly locked: boolean;
  readonly hopCount: number;
}

export type CapacityChangeResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface AdminServiceDeps {
  readonly libraryService: LibraryService;
  readonly revocationLog: RevocationLogPort;
  /** This node's own identity — used to sign revocations this operator issues (see {@link AdminService.revokeContent}'s doc comment on the authorization model). */
  readonly identity: IdentityPort;
  readonly clock: ClockPort;
  /** Upper bound `setCapacity` enforces (issue #46's `NODE_MAX_TOTAL_SLOTS`, threaded in rather than imported directly — `app` must not depend on `clients/node`, AGENTS.md §2). */
  readonly maxTotalSlots: number;
  /** Optional — omit if no transport-level security status is wired (e.g. a test constructing `AdminService` without a running `HttpTransportServer`). `getSecurityStatus()` returns `undefined` in that case. */
  readonly securityStatus?: SecurityStatusPort;
}

export class AdminService {
  constructor(private readonly deps: AdminServiceDeps) {}

  /** Current library occupancy and configured capacity — "view current library contents/stats." */
  getLibrarySnapshot(): LibrarySnapshot {
    const library = this.deps.libraryService.getLibrary();
    const entries = [...library.entries.values()];
    return {
      totalItems: entries.length,
      lockedItems: entries.filter((e) => e.locked).length,
      swappableItems: entries.filter((e) => !e.locked).length,
      capacity: this.deps.libraryService.getCapacity(),
    };
  }

  /** Every item currently held, as a flat view suitable for an admin listing. */
  listLibraryEntries(): readonly LibraryEntryView[] {
    const library = this.deps.libraryService.getLibrary();
    return [...library.entries.values()].map((entry) => ({
      contentHash: entry.token.contentHash,
      title: entry.token.title,
      creator: entry.token.creator,
      locked: entry.locked,
      hopCount: entry.token.provenance.hopCount,
    }));
  }

  /**
   * Change this node's configured `LibraryCapacity` at runtime (issue #50),
   * validated against `maxTotalSlots` (issue #46's bound) via `core`'s
   * `validateCapacityBounds` — never silently clamped, matching
   * `resolveNodeCapacity`'s own "fail loudly" convention
   * (`clients/node/src/composition/node-capacity.ts`). On success, updates
   * `LibraryService` immediately (so `getLibrarySnapshot`/`add`/`lock`
   * reflect the new bound right away).
   *
   * **Disclosed scope limitation:** this updates the `Library` aggregate's
   * own enforcement via `LibraryService`. It does not reach into a running
   * `SwapService`'s already-constructed `AcceptPolicy`/`EvictionPolicy`
   * instances, which (per `docs/adr/0012-node-library-capacity-generalization.md`)
   * close over a `swappableSlots` number at construction time. A
   * composition root that wants a swap in progress *right now* to also
   * honour a capacity change made mid-flight must wire those policies via a
   * live-reading indirection (see `clients/node`'s composition root for
   * how it does this for the numbers that matter — `libraryCapacity`,
   * `acceptPolicy`, `evictionPolicy` are supplied as getters over one
   * shared mutable holder this method updates, rather than static values
   * frozen at startup) rather than reconstructing `SwapService` on every
   * change.
   */
  setCapacity(capacity: LibraryCapacity): CapacityChangeResult {
    const validation = validateCapacityBounds(capacity, this.deps.maxTotalSlots);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }
    this.deps.libraryService.setCapacity(capacity);
    return { ok: true };
  }

  /** Connected-peer/rate-limit/TLS state from the transport layer (issue #49), if wired. `undefined` when no `securityStatus` port was supplied. */
  getSecurityStatus(): SecurityStatusSnapshot | undefined {
    return this.deps.securityStatus?.getStatus();
  }

  /**
   * Moderation and takedown (issue #51): sign a revocation of `contentHash`
   * with this node's own identity, record it in `revocationLog` (so it
   * propagates the next time this node swaps with anyone — see
   * `app/src/swap/swap-service.ts`'s revocation round), and remove it from
   * this node's own library immediately if present.
   *
   * **Authorization model, stated plainly:** local removal here is
   * unconditional — a node operator has authority over their own node's
   * library regardless of who originally signed a piece (that is what
   * "moderation and takedown" means for content hosted at a venue). What is
   * *not* unconditional is how far this binds other devices: when this
   * signed entry reaches a peer during a future swap, that peer only
   * removes its own copy if `entry.signerPublicKey` matches the content's
   * *original* signer (`core`'s `isRevocationAuthorizedForToken`) — an
   * operator revoking someone else's signed work takes effect locally right
   * away, but does not unilaterally force removal on every other device
   * that already holds a copy signed by the original artist. See
   * `docs/security/threat-model.md` and
   * `docs/adr/0015-opportunistic-revocation-protocol.md` for the full
   * reasoning behind this conservative default.
   */
  async revokeContent(contentHash: string): Promise<RevocationEntry> {
    const revokedAtEpochMs = this.deps.clock.now();
    const entry = await signRevocationEntry(contentHash, revokedAtEpochMs, this.deps.identity);
    await this.deps.revocationLog.record(entry);

    const library = this.deps.libraryService.getLibrary();
    if (library.entries.has(contentHash)) {
      await this.deps.libraryService.remove(contentHash);
    }
    return entry;
  }

  /** Every revocation this node currently knows about — "view moderation state." */
  listRevocations(): Promise<readonly RevocationEntry[]> {
    return this.deps.revocationLog.listAll();
  }
}
