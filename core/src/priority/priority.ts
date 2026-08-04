/**
 * Priority — the ordering every policy seam reads.
 *
 * `PriorityPolicy`, `OfferPolicy`, `AcceptPolicy`, and `EvictionPolicy`
 * (SPEC.md §5) all need to compare items against each other: which is more
 * worth keeping, offering, accepting, or evicting first. Nothing else in the
 * domain defines that ordering, so it is defined once, here
 * (IMPLEMENTATION.md "Critical path" — this is item #7, a blocker for
 * #8, #12-#15, #19).
 *
 * ## Design choice: a branded number, not a richer structure
 *
 * `Priority` is a nominally-typed (branded) `number`, not an object or a
 * tuple of per-signal scores. Every consumer this type has to serve reduces
 * to "is A more important than B, and by how much":
 *
 * - `OfferPolicy.selectOffer` needs to rank swappable items to choose what
 *   to offer.
 * - `AcceptPolicy.selectAccept` needs to threshold or rank incoming offers
 *   against what's already held.
 * - `EvictionPolicy.selectEvict` needs "lowest priority first"
 *   (IMPLEMENTATION.md Phase 1a item 14) — a plain total order.
 *
 * A single scalar is the smallest shape that satisfies all three without
 * forcing every policy to know how the score was composed. Keeping the
 * *signals* (below) as a separate, richer type — rather than baking them
 * into `Priority` itself — means a policy can still weigh them however it
 * likes; `Priority` only has to be comparable once a policy has decided.
 *
 * The brand exists so a raw `number` (a byte count, a slot index, a hop
 * count) can't be passed where a `Priority` is expected by accident — you
 * must go through {@link toPriority} or a `PriorityPolicy`.
 */
export type Priority = number & { readonly __brand: "Priority" };

/**
 * Construct a `Priority` from a raw number. The only way to produce a
 * `Priority` outside of a `PriorityPolicy` — kept narrow (rejects NaN and
 * +/-Infinity) so every `Priority` in the system is safely comparable and
 * arithmetic-safe.
 */
export function toPriority(value: number): Priority {
  if (!Number.isFinite(value)) {
    throw new Error(`Priority must be a finite number, got ${String(value)}`);
  }
  return value as Priority;
}

/**
 * Three-way comparator, ascending: negative if `a` is lower priority than
 * `b`, positive if higher, zero if equal. Shaped to drop directly into
 * `Array.prototype.sort`.
 */
export function comparePriority(a: Priority, b: Priority): number {
  return a - b;
}

/** `true` if `a` outranks `b`. */
export function isHigherPriority(a: Priority, b: Priority): boolean {
  return a > b;
}

/** `true` if `a` and `b` rank equally. */
export function isEqualPriority(a: Priority, b: Priority): boolean {
  return a === b;
}

/** The lower-ranked of two priorities — the natural building block for "evict lowest first". */
export function lowerPriority(a: Priority, b: Priority): Priority {
  return a <= b ? a : b;
}

/** The higher-ranked of two priorities. */
export function higherPriority(a: Priority, b: Priority): Priority {
  return a >= b ? a : b;
}

/**
 * Candidate signals a `PriorityPolicy` may combine into a single
 * {@link Priority}. Per SPEC.md §5: "Candidate signals: user ranking,
 * recency, hop count, dwell time." This type only names the vocabulary —
 * it does not decide how (or whether) a given policy uses each one. Every
 * field is an already-computed pure value; nothing here calls a clock,
 * a random source, or any other port. Deriving these (e.g. "recency" from
 * `ClockPort.now()` minus an acquisition timestamp) is the caller's job —
 * `core` never calls `Date.now()` directly (AGENTS.md §5).
 */
export interface PrioritySignals {
  /**
   * Explicit user-assigned rank for this item, if the user has ranked it.
   * Higher means more important to the user. `undefined` means "not
   * ranked" — deliberately distinct from a rank of `0`, so a policy can
   * treat unranked items as neutral rather than as ranked-at-the-bottom.
   */
  readonly userRank?: number;

  /**
   * Elapsed time since this item was acquired or last touched, in
   * milliseconds. Smaller means more recent. Expressed as a *duration*
   * rather than an absolute timestamp so this type carries no wall-clock
   * concept of its own; the caller derives it from `ClockPort`.
   */
  readonly recencyMs: number;

  /**
   * Number of hops since the item's origin (0 = authored/added on this
   * device, 1 = received directly from its origin, etc). Deliberately a
   * count, not an identified path — SPEC.md §7 flags identified hop paths
   * as a location-history leak once nodes have persistent identities.
   * Lower generally reads as "fresher."
   */
  readonly hopCount: number;

  /**
   * Cumulative time this item has been held in a library without being
   * evicted, in milliseconds. A longer dwell time is a soft signal that
   * past policy decisions favoured keeping it.
   */
  readonly dwellMs: number;
}

/**
 * The context a `PriorityPolicy.score` call receives alongside the item
 * (SPEC.md §5: `score(item, context) -> priority`). For Phase 1a this is
 * exactly the four candidate signals above, held under its own name (rather
 * than every call site writing `PrioritySignals`) so it can grow
 * independently later — e.g. a future `PeerKind` or swap-direction hint —
 * without renaming every `PriorityPolicy` implementation.
 */
export type PriorityContext = PrioritySignals;
