/**
 * TrustTracker — issue #59's answer to SPEC.md §11 open question 6 ("Anti-abuse
 * and trust model — spam and flooding mitigations beyond accept-side rate
 * limiting") and `docs/security/threat-model.md`'s own forward-looking note:
 * "A reputation system (weighting known-good identities that have completed
 * prior successful swaps more favorably)... is a natural next step."
 *
 * ## Why this is more than the existing `SlidingWindowRateLimiter`
 *
 * `./rate-limiter.js` already throttles a key past N events in a trailing
 * window, but its memory is bounded *by design* to that one window — once
 * `windowMs` passes, a repeat offender looks exactly like a brand-new
 * identity again (that self-erasure is a deliberate, documented property,
 * not an oversight: see that file's own doc comment). Issue #59 explicitly
 * asks for something that survives *across* windows — "track... a rolling
 * count of accepted-vs-rejected/throttled interactions" — so that a peer
 * who keeps getting throttled every single window pays a compounding cost,
 * not the same flat cost every time. This module is that longer-lived
 * memory, kept deliberately separate from the rate limiter rather than
 * folded into it, so the two failure modes each already disclosed in the
 * threat model (a per-window Sybil-evadable limiter vs. a longer-lived
 * reputation signal) stay independently reasoned about.
 *
 * ## ⚠️ Privacy tension with AGENTS.md §7 — read before wiring this up
 *
 * AGENTS.md §7 / SPEC.md §7: "Encounter memory is item-scoped, not
 * peer-scoped... people use rotating identities." This tracker is, by
 * construction, peer-scoped and longer-lived than a single rate-limit
 * window — closer to the exact shape of tracking AGENTS.md §7 warns
 * against than the rate limiter's short, self-erasing window is. If a
 * caller keys this tracker by an identifier a *person's* rotating identity
 * happens to reuse across encounters (nothing in `core`/`app` currently
 * *enforces* rotation — it is a client-side discipline, not a protocol
 * guarantee), this module would quietly become a longer-term behavioral
 * profile of that specific person's device, exactly the persistent
 * peer-scoped tracking the encounter-memory design (`../encounter/encounter-memory.js`)
 * deliberately avoided.
 *
 * SPEC.md §7 draws the exact line this module leans on to resolve that
 * tension: **"Nodes have persistent identities. People use rotating
 * ephemeral IDs."** A node's stable identity is a deliberate design
 * commitment (SPEC.md §4) — building trust history against it is no more
 * privacy-invasive than, say, a browser trusting a CA it has seen issue
 * valid certificates before. A person's identity is designed to be
 * disposable specifically so history *cannot* accumulate against them.
 * **This module therefore takes no position on who it's fed** (like
 * `SlidingWindowRateLimiter`, it has no opinion on what a "peer" is, per
 * that file's own doc comment) — but `app/src/swap/swap-service.ts`, the
 * one real call site, deliberately only ever calls `recordOutcome`/
 * `acceptCapacityFraction` when `peer.kind === "node"` (the bare
 * `PeerKind` discriminator SPEC.md §6.3 already threads through for
 * exactly this kind of distinction), and never for `peer.kind === "person"`
 * connections. See that file's doc comment for the enforcement point, and
 * `docs/adr/0017-trust-tracker-scoped-to-node-identities.md` for the full
 * reasoning and the alternatives rejected. This is flagged prominently in
 * this batch's PR description per AGENTS.md §3 — it is a real, live tension
 * this design resolves by scope restriction, not by pretending it doesn't
 * exist.
 *
 * ## Design: forgiveness only through good behaviour, never through time alone
 *
 * Unlike the rate limiter (whose window self-erases with the mere passage
 * of time), a bad mark recorded here is never forgotten just because time
 * passed — only a subsequent `"reciprocalSwap"` outcome offsets it
 * (one-for-one, see {@link netPenalty}). This is deliberate: a
 * time-based decay would let a patient flooder simply wait out each
 * accumulated penalty between bursts, defeating the entire point of a
 * longer-lived signal. `prune()` exists only to bound memory for identities
 * that have gone permanently quiet (mirroring `SlidingWindowRateLimiter.prune`)
 * — it is a memory-management operation, not a forgiveness mechanism, and a
 * pruned identity starting "fresh" on its *next* contact is an accepted,
 * documented consequence of bounding memory at all (the same trade-off the
 * rate limiter's own `prune()` already accepts).
 *
 * ## Design: only *reciprocal* swaps build trust, never one-way ones
 *
 * SPEC.md §6.3 permits one-way seeding, and SPEC.md §5 names it as the
 * exact mechanism a hostile node can exploit ("push without receiving").
 * If a purely one-way encounter (this device received something, gave
 * nothing back — or vice versa) counted toward good history, a flooder
 * could accumulate trust for free simply by never triggering
 * `AcceptPolicy`/the rate limiter's rejection path at all, then spend that
 * trust on a later burst. Requiring *reciprocity* — both sides actually
 * exchanged something — as the only trust-building signal closes that: a
 * one-way seeder (legitimate or not) never gets more permissive treatment
 * than the neutral, unpenalized default it already has (see
 * {@link acceptCapacityFractionForSnapshot} — a brand-new, never-seen
 * identity already gets `1.0`, the same "accept what fits" ceiling
 * `AcceptPolicy`'s naive default already applies; there is no "more
 * permissive than that" to grant).
 */

import type { AcceptPolicy } from "../policies/accept-policy.js";

export type TrustOutcome = "reciprocalSwap" | "oneWaySwap" | "throttled" | "rejectedContent";

export type TrustLevel = "neutral" | "trusted" | "low-trust" | "quarantined";

/** `netPenalty` at or above this value is classified `"quarantined"` (see {@link classifyTrustLevel}). Chosen so a phone's 5-slot swappable pool reaches `acceptCapacityFraction === 0` (see this file's own tests) — i.e. "quarantined" is not just a label, it is the point at which the naive `AcceptPolicy` default accepts nothing at all from this identity, regardless of the phone's own free slots. */
export const QUARANTINE_NET_PENALTY = 5;

export interface TrustSnapshot {
  readonly key: string;
  /** Total `"reciprocalSwap"` outcomes ever recorded for this key. */
  readonly reciprocalCount: number;
  /** Total `"throttled"` + `"rejectedContent"` outcomes ever recorded for this key. */
  readonly badCount: number;
  /** `max(0, badCount - reciprocalCount)` — each reciprocal swap forgives exactly one bad mark; this never goes negative (a spotless identity has nothing further to gain from more reciprocal swaps than it has bad marks, since there is no "more permissive than unpenalized" — see this file's doc comment). */
  readonly netPenalty: number;
  readonly trustLevel: TrustLevel;
  /** `1 / (1 + netPenalty)`, i.e. `1.0` (fully unpenalized) for any identity with `netPenalty === 0`, shrinking smoothly and strictly monotonically as `netPenalty` grows. Never boosted above `1.0` — see this file's doc comment on why "more permissive" has no ceiling to raise. */
  readonly acceptCapacityFraction: number;
  readonly lastSeenEpochMs: number;
}

interface TrustState {
  reciprocalCount: number;
  badCount: number;
  lastSeenEpochMs: number;
}

function netPenalty(state: Pick<TrustState, "reciprocalCount" | "badCount">): number {
  return Math.max(0, state.badCount - state.reciprocalCount);
}

/** Classify a `netPenalty`/`reciprocalCount` pair into a human-readable {@link TrustLevel} — purely for observability (an admin view, logging); {@link TrustSnapshot.acceptCapacityFraction} (a continuous function of `netPenalty`) is what `AcceptPolicy` actually consults, not this label. */
export function classifyTrustLevel(penalty: number, reciprocalCount: number): TrustLevel {
  if (penalty >= QUARANTINE_NET_PENALTY) return "quarantined";
  if (penalty > 0) return "low-trust";
  if (reciprocalCount > 0) return "trusted";
  return "neutral";
}

function snapshotFrom(key: string, state: TrustState): TrustSnapshot {
  const penalty = netPenalty(state);
  return {
    key,
    reciprocalCount: state.reciprocalCount,
    badCount: state.badCount,
    netPenalty: penalty,
    trustLevel: classifyTrustLevel(penalty, state.reciprocalCount),
    acceptCapacityFraction: 1 / (1 + penalty),
    lastSeenEpochMs: state.lastSeenEpochMs,
  };
}

/**
 * Longer-lived, per-key trust bookkeeping — see this file's doc comment for
 * the full design, and its "⚠️ Privacy tension" section before wiring this
 * up against any identifier that might belong to a person rather than a
 * node.
 */
export class TrustTracker {
  private readonly stateByKey = new Map<string, TrustState>();

  /** Record one outcome for `key`. `"oneWaySwap"` updates `lastSeenEpochMs` only — see this file's doc comment on why one-way encounters never move the score either direction. */
  recordOutcome(key: string, outcome: TrustOutcome, nowEpochMs: number): void {
    const existing = this.stateByKey.get(key) ?? {
      reciprocalCount: 0,
      badCount: 0,
      lastSeenEpochMs: nowEpochMs,
    };
    const next: TrustState = { ...existing, lastSeenEpochMs: nowEpochMs };
    if (outcome === "reciprocalSwap") {
      next.reciprocalCount += 1;
    } else if (outcome === "throttled" || outcome === "rejectedContent") {
      next.badCount += 1;
    }
    // "oneWaySwap": no count changes, only lastSeenEpochMs above.
    this.stateByKey.set(key, next);
  }

  /** A never-seen key reports the neutral, fully-unpenalized default (`acceptCapacityFraction: 1`, `trustLevel: "neutral"`) — a brand-new identity (the common case for a rotating person identity) is never penalized just for being new. */
  getSnapshot(key: string, nowEpochMs: number): TrustSnapshot {
    const existing = this.stateByKey.get(key);
    if (!existing) {
      return snapshotFrom(key, { reciprocalCount: 0, badCount: 0, lastSeenEpochMs: nowEpochMs });
    }
    return snapshotFrom(key, existing);
  }

  /** Convenience accessor for the one number `AcceptPolicy` wrapping actually needs — see {@link TrustSnapshot.acceptCapacityFraction}. */
  acceptCapacityFraction(key: string, nowEpochMs: number): number {
    return this.getSnapshot(key, nowEpochMs).acceptCapacityFraction;
  }

  /** Number of distinct keys currently tracked (before pruning) — an admin/observability signal, mirroring `SlidingWindowRateLimiter.trackedKeyCount`. */
  trackedKeyCount(): number {
    return this.stateByKey.size;
  }

  /** Drop every key not seen within `maxAgeMs` of `nowEpochMs` — bounds memory growth for identities that have gone permanently quiet. This is a memory-management operation, not forgiveness: see this file's doc comment for why a bad mark is never time-decayed while a key is still tracked. */
  prune(nowEpochMs: number, maxAgeMs: number): void {
    for (const [key, state] of this.stateByKey) {
      if (nowEpochMs - state.lastSeenEpochMs > maxAgeMs) {
        this.stateByKey.delete(key);
      }
    }
  }
}

/**
 * Wrap `basePolicy` so it accepts at most `floor(swappableSlots *
 * acceptCapacityFraction)` items regardless of how many `basePolicy`
 * itself would otherwise select. `basePolicy`'s own selection (already
 * capped to whatever real remaining capacity the library has, plus
 * whatever domain logic it applies) is computed first and then simply
 * truncated — this decorator adds no new selection logic of its own, only
 * a stricter ceiling, the same "wrap the output, keep the wrapped policy
 * unaware" shape `SwapService` already uses for encounter-memory
 * suppression on the offer side (`../encounter/encounter-memory.js`).
 *
 * `acceptCapacityFraction` is a plain number, not a `TrustTracker`
 * reference — this function stays pure and trivially testable without
 * needing a tracker instance or a clock; the one real call site
 * (`app/src/swap/swap-service.ts`) reads the fraction from a `TrustTracker`
 * for the current peer and passes just that number through.
 */
export function createTrustAdjustedAcceptPolicy(
  basePolicy: AcceptPolicy,
  acceptCapacityFraction: number,
  swappableSlots: number,
): AcceptPolicy {
  const clamped = Math.min(1, Math.max(0, acceptCapacityFraction));
  const cap = Math.floor(swappableSlots * clamped);
  return {
    selectAccept(offered, library) {
      const baseSelection = basePolicy.selectAccept(offered, library);
      return baseSelection.length <= cap ? baseSelection : baseSelection.slice(0, cap);
    },
  };
}
