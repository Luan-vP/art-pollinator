# ADR-0012: Generalize `Library` capacity behind an optional, defaulted parameter — the phone's 10 slots stay the fixed default, a node gets a distinct, larger, still-bounded configuration

**Status:** Accepted
**Date:** 2026-08-05

## Context

Issue #46 requires the stationary node (SPEC.md §4) to hold a "larger disk"
than a phone — configurable, larger than the 10-slot phone default, but
"still bounded by design to preserve curation pressure": an explicit upper
bound, no unbounded-accumulation option.

`core`'s `Library` aggregate (`core/src/library/library.ts`) currently reads
`MAX_LOCKABLE_SLOTS`/`SWAPPABLE_SLOTS` as module-level constants imported
from `core/src/constants.ts` directly inside `addItem`/`lockItem`/`unlockItem`
— there is no parameter anywhere in the call chain to plug a different
number into. `core`'s naive `AcceptPolicy`/`EvictionPolicy` defaults
(`core/src/policies/accept-policy.ts`, `eviction-policy.ts`) do the same:
`createNaiveAcceptPolicy()`/`createNaiveEvictionPolicy()` close over
`SWAPPABLE_SLOTS` with no parameter either. `app`'s `SwapService` and
`LibraryService` call `core`'s `addItem`/`lockItem`/`unlockItem` without
threading any capacity value through — there is nowhere in the existing
call chain for a different number to enter even if `Library` itself grew a
parameter, without also touching these two call sites.

AGENTS.md §6 fixes "Total slots: 10" for the **personal device** case as a
parameter that must not change without an ADR: "Slot limits and eviction
pressure are intentional design, not constraints to engineer around. If you
find yourself proposing to raise a limit, cache more, or accumulate in the
background, you have misread the intent." SPEC.md §4 draws a **second,
distinct node type** — "a machine on a Wi-Fi network with a larger disk...
still bounded by design to preserve curation pressure" — explicitly
different from the phone. This ADR is about drawing that fork cleanly: is
generalizing the one `Library` type in `core` to accept a configurable
capacity a violation of the fixed-10 rule, or a legitimate generalization
that happens to keep the phone's number unchanged?

## Decision

Generalize `Library`'s capacity into an explicit, optional, defaulted
value, threaded through every call site that currently hardcodes it —
**not** two parallel aggregate types (no `NodeLibrary`), and **not** a
change to the fixed default itself.

1. **`core/src/library/library.ts`** gains:

   ```ts
   export interface LibraryCapacity {
     readonly maxLockableSlots: number;
     readonly swappableSlots: number;
   }
   export const DEFAULT_LIBRARY_CAPACITY: LibraryCapacity = {
     maxLockableSlots: MAX_LOCKABLE_SLOTS,
     swappableSlots: SWAPPABLE_SLOTS,
   };
   ```

   `addItem(library, token, priority?, capacity = DEFAULT_LIBRARY_CAPACITY)`,
   `lockItem(library, contentHash, capacity = DEFAULT_LIBRARY_CAPACITY)`,
   and `unlockItem(library, contentHash, capacity = DEFAULT_LIBRARY_CAPACITY)`
   read `capacity.swappableSlots`/`capacity.maxLockableSlots` instead of the
   bare module constants. Every existing call site that does not pass a
   4th/3rd argument gets the exact same behaviour as before this ADR — the
   phone's fixed 10 (5 lockable + 5 swappable) is the _default_, not a
   number that moved.

2. **`core/src/policies/accept-policy.ts`** /
   **`eviction-policy.ts`**: `createNaiveAcceptPolicy(swappableSlots =
SWAPPABLE_SLOTS)` and `createNaiveEvictionPolicy(swappableSlots =
SWAPPABLE_SLOTS)` gain the same optional, defaulted parameter. Without
   this, a node configured with a larger `Library` capacity but still using
   the exported `naiveAcceptPolicy`/`naiveEvictionPolicy` singletons would
   silently cap accepted items at 5 regardless of how large the aggregate's
   own limit was — the policy and the aggregate would disagree about what
   "full" means. `naiveAcceptPolicy`/`naiveEvictionPolicy` (the singleton
   convenience exports) are unchanged — they still call the factory with no
   argument, i.e. the phone default.

3. **`app/src/swap/swap-service.ts`** (`SwapServiceDeps`) and
   **`app/src/library/library-service.ts`** (`LibraryService`'s
   constructors) each gain an optional `libraryCapacity?: LibraryCapacity`
   dependency, threaded into their own `addItem`/`lockItem`/`unlockItem`
   calls. Omitted, both behave exactly as before this ADR (the phone
   default). A composition root that wants a larger capacity supplies the
   _same_ `LibraryCapacity` value to both the policies (via their factory
   parameter) and to `SwapService`/`LibraryService` (via this dependency) —
   see `clients/node`'s composition root for the one place all three are
   wired consistently together.

4. **The node's actual numbers** (a default and a hard upper bound) are
   decided in `clients/node`, not `core` — see that package's
   `src/config/node-capacity.ts`. `core` only knows how to accept _a_
   capacity; it is deliberately silent on what a node's capacity _should_
   be, exactly as it is already silent on port numbers or file paths.

## Alternatives considered and rejected

- **A parallel `NodeLibrary` aggregate (or a `NodeLibraryEntry`
  discriminated variant), separate from `Library`.** Rejected: `Library` has
  no behavior that is phone-specific — "10" is a _number_, not a shape.
  Duplicating `addItem`/`lockItem`/`unlockItem`/`removeItem` (and every test
  in `library.test.ts`) into a second near-identical module is exactly the
  "duplicated domain logic between composition roots" AGENTS.md §2 rule 4
  and this task's own working agreement warn against — it would also fork
  `AcceptPolicy`/`EvictionPolicy`/`SwapService`, none of which have any
  reason to know which aggregate type they're holding, into node- and
  phone-flavoured copies. A configurable _value_ threaded through one
  aggregate is the smaller, more honest change.

- **Change the module-level constant itself (`TOTAL_SLOTS`) per build
  target, e.g. via a bundler define or environment variable read inside
  `core`.** Rejected outright: `core` is zero-I/O, zero-ambient-state
  (AGENTS.md §2 rule 1/2 — "no platform conditionals in `core` or `app`").
  Reading `process.env` or any per-build define from inside `core` to decide
  its own fixed constants is exactly the kind of platform conditional that
  rule forbids, and it would make the "fixed parameter, do not change
  without an ADR" constant silently mutable by whichever process happens to
  set an environment variable — the opposite of what AGENTS.md §6 is
  protecting.

- **Leave `core` exactly as-is; have `clients/node` post-process the
  aggregate after the fact (e.g. call `addItem` in a loop up to the real
  Library's fixed 5, then track "overflow" items in a second, node-only
  data structure sitting beside it).** Rejected: this doesn't give the node
  a larger _library_, it gives the node a library plus a bolt-on side table
  that every policy, the repository, and any future UI would need to know
  about separately — worse duplication than a configurable parameter, for
  no benefit.

- **Leave the naive policies unparameterized, and have `clients/node` supply
  entirely custom `AcceptPolicy`/`EvictionPolicy` implementations instead.**
  Rejected as the default path (though nothing stops a real node deployment
  from doing this later): the task instructions are explicit that this
  batch should "reuse the naive defaults from `core`/`app` — no new policy
  logic needed here." A one-line optional parameter on the existing naive
  factories satisfies that without inventing new policy logic — the
  strategy is still "accept what fits" / "evict lowest priority first,"
  just measured against a different, honestly-configurable capacity.

## Consequences

- The phone's fixed parameters (AGENTS.md §6: 10 total, 5 lockable, 5
  swappable) do not change — they are now expressed as the _default value_
  of an optional parameter rather than an unconditional constant reference,
  but every existing call site, every existing test in
  `core/src/library/library.test.ts` and
  `core/src/policies/policy-contract-suite.ts`, and every existing
  composition root (`clients/mobile`) is unaffected and requires no edits.
- A node composition root can now supply one `LibraryCapacity` value once
  and have `Library`'s own enforcement, the naive accept/eviction policies,
  and `SwapService`/`LibraryService` all agree on what "full" means — no
  duplicated capacity math, no aggregate fork.
- Future capacity-aware call sites (a hypothetical curation UI showing
  "N of M slots used," say) must remember to pass the same
  `LibraryCapacity` value through if the number they display should match
  what the aggregate actually enforces — `DEFAULT_LIBRARY_CAPACITY` being
  the default everywhere means a call site that _forgets_ silently falls
  back to the phone's 10, rather than erroring. This is the same
  trade-off `priority`'s optional, defaulted parameter on `addItem` already
  accepts (`library.ts`'s own doc comment) — a deliberate, documented
  choice consistent with an existing pattern in this file, not a new risk
  class.
- This ADR does not touch `isValidLockCount` (`core/src/constants.ts`),
  which remains phone-specific (`0..MAX_LOCKABLE_SLOTS`) and unused by the
  node path — the node composition root validates its own configured
  capacity independently (`clients/node`'s `node-capacity.ts`), rather than
  overloading a function whose name and doc comment are about the phone's
  lock-count UI.
