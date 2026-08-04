# ADR-0003: Priority is a branded scalar, computed from a named signal vocabulary

**Status:** Accepted
**Date:** 2026-08-04

## Context

`IMPLEMENTATION.md`'s "Critical path" table flags the priority model (issue
#7) as a gate: `PriorityPolicy`, `OfferPolicy`, `AcceptPolicy`, and
`EvictionPolicy` (issues #8, #12-#15) all read an ordering that nothing else
in the domain defines. SPEC.md §5 fixes the seam
(`PriorityPolicy.score(item, context) -> priority`) and names four candidate
signals — user ranking, recency, hop count, dwell time — but deliberately
leaves both the shape of `priority` and how those signals combine
undefined. Getting this wrong means redesigning it after #8, #12-#15, and
#19 are already built against it, per the task instructions for this batch.

## Decision

`Priority` is a nominally-typed (branded) `number`
(`core/src/priority/priority.ts`), constructed only via `toPriority()`,
which rejects non-finite values. It ships with a small comparison API
(`comparePriority`, `isHigherPriority`, `isEqualPriority`, `lowerPriority`,
`higherPriority`) rather than exposing raw arithmetic as the primary
interface.

The four candidate signals from SPEC.md §5 are named as a separate type,
`PrioritySignals` (`userRank?`, `recencyMs`, `hopCount`, `dwellMs`) — already
computed, pure values, with no clock or other port called internally.
`PriorityContext` (the second argument to `PriorityPolicy.score`) is kept as
its own alias over `PrioritySignals` rather than reused inline, so it can
grow independently later (e.g. a peer-kind hint) without renaming every
`PriorityPolicy` implementation's signature.

`PriorityPolicy` (issue #8, `core/src/policies/priority-policy.ts`) owns the
actual combination logic — a weighted linear sum, with documented default
weights (`DEFAULT_PRIORITY_WEIGHTS`) and sign choices (positive for
`userRank` and `dwell`, negative for `recency` and `hopCount`). The weights
and the combination formula live in the policy, not in the `Priority` type
itself.

## Alternatives considered and rejected

- **A tagged union or record of per-signal scores** (e.g.
  `{ rankScore, recencyScore, hopScore, dwellScore }`), left uncombined
  until each policy decides what to do with it. Rejected: every consumer
  this type has to serve — `OfferPolicy` ranking a list, `EvictionPolicy`
  needing "lowest first," `AcceptPolicy` thresholding an incoming score —
  reduces to "is A more important than B, and by how much." A structured
  type pushes that reduction into every call site instead of doing it once,
  and makes `Array.prototype.sort`-style consumption (which `EvictionPolicy`
  will need) awkward without a custom comparator anyway. It would also make
  a policy's tuning knobs (the weights) visible on the _value_ rather than
  on the _policy_, blurring exactly the seam issue #8 exists to keep
  separate.

- **A plain, un-branded `number`.** Rejected: nothing would stop a byte
  count, a slot index, or a hop count from being passed where a `Priority`
  was expected — the exact kind of mistake TypeScript's structural typing
  otherwise permits silently. A brand costs one type declaration and one
  constructor function and closes that off completely.

- **Baking a specific combination formula (weights, signs) into the
  `Priority` type or module itself**, rather than into `PriorityPolicy`.
  Rejected: SPEC.md §5 is explicit that policy logic is "deliberately
  undefined here — only the seams are fixed," and IMPLEMENTATION.md item 8
  separately calls for `PriorityPolicy` to be swappable at the composition
  root. Putting the formula in `priority.ts` would make the ordering model
  and the scoring strategy the same artifact, defeating the reason #7 and
  #8 are separate issues.

## Consequences

- `OfferPolicy`, `AcceptPolicy`, and `EvictionPolicy` (issues #12-#14) can
  all be written against `Priority` + `comparePriority` without knowing
  anything about how a score was produced — including a future
  machine-learned `PriorityPolicy` that never touches `PrioritySignals` at
  all, as long as it still returns a `Priority`.
- Because `PriorityContext` already carries `recencyMs` and `dwellMs` as
  precomputed durations rather than absolute timestamps, no `PriorityPolicy`
  implementation ever needs a `ClockPort` reference directly — only
  whatever assembles the context does. This keeps `score()` itself trivially
  pure and deterministic under test.
- The naive default policy's weights (`DEFAULT_PRIORITY_WEIGHTS`) are an
  illustrative starting point, not a tuned result — anyone revisiting
  scoring behaviour should expect to replace them, not treat their presence
  as evidence of a considered choice.
- If a future signal turns out not to reduce sensibly to a single scalar
  contribution (e.g. something that should gate rather than weight, like an
  explicit user "never show me this again"), that likely wants to live as a
  separate mechanism alongside `Priority` (e.g. a block-list checked before
  scoring), not as a fifth term forced into the weighted sum.
