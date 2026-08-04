# ADR-0004: In-memory port fakes live in `core`, not a new `adapters/in-memory` package

**Status:** Accepted
**Date:** 2026-08-04

## Context

Issue #18 (IMPLEMENTATION.md Phase 1a item 18) requires an in-memory fake
for each of the eight driven ports from issue #17 (`TransportPort`,
`DiscoveryPort`, `MetadataRepositoryPort`, `BlobStorePort`, `IdentityPort`,
`ClockPort`, `EncounterLogPort`, `SchedulerPort`), such that a full swap can
eventually be exercised end to end with no external dependency.

ADR-0001 draws the layering as `core` (zero I/O, zero dependencies) / `app`
(use cases) / `adapters/*` (port implementations, depend on `core`, never
depended on by it) / `clients/*` (composition roots). By that layering, a
fake port implementation reads as an adapter — `adapters/README.md` already
anticipates real adapters living in their own packages
(`adapters/ble-transport`, `adapters/sqlite-metadata-repository`, etc), and
AGENTS.md §2 rule 4 lists "every port ships with an in-memory fake" as one
of `core`'s architectural rules, without saying which package the fake's
_code_ must live in.

Two placements are both defensible reads of the existing rules:

1. A new `adapters/in-memory` package, matching every other adapter.
2. Alongside the port interfaces in `core/src/ports/fakes/`.

## Decision

Place the in-memory fakes in `core/src/ports/fakes/`, exported from
`@art-pollinator/core`'s package entry point alongside the port interfaces
themselves.

The deciding fact: these fakes have **zero I/O** — each one is a `Map` or
array wrapped in a class, with no filesystem, network, timer, or platform
API underneath. `core`'s non-negotiable rule (AGENTS.md §2 rule 1, ADR-0001)
is "zero I/O, zero external dependencies," not "zero non-interface code" —
a fake that never leaves memory does not violate that rule merely by living
in `core`. Keeping it there:

- Lets `core`'s own tests (the policy contract suite, issue #15; a future
  `SwapService` test in `app`, issue #19) depend on the fakes without adding
  a new workspace package dependency edge (`app` → `adapters/in-memory` →
  `core`) for something that is, functionally, still part of testing `core`
  in isolation.
- Avoids standing up an entire new npm workspace package (`package.json`,
  `tsconfig.json`, `vitest.config.ts`, a `dependencies: { "@art-pollinator/core": "*" }`
  edge) for code that has no adapter-specific technology to name — compare
  `BleTransportAdapter` or `SqliteMetadataRepository` (AGENTS.md §5 naming:
  "adapters name their technology"), which is precisely what an in-memory
  fake does _not_ have.
- Matches how issue #18 itself is framed: "a full swap must run end to end
  **with no external dependency**" — the fakes are the mechanism by which
  `core` (and later `app`) stays testable without adapters existing yet,
  which reads as fakes being part of what makes `core` self-testable, not
  as a ninth adapter package.

## Alternatives considered and rejected

- **`adapters/in-memory` as its own workspace package.** Rejected for now:
  it would be the _only_ adapter package with zero real dependencies and
  zero platform-specific technology to name, which is a signal it doesn't
  need adapter-level packaging — a `package.json` and its own `tsconfig`
  buys nothing here. If a later contract-suite requirement forces fakes and
  real adapters to be interchangeable via the exact same import path (e.g.
  a test that swaps a fake for a real adapter via dependency injection
  keyed by package name rather than by value), revisit this — that would be
  a reason the _package boundary_, not just the _interface_, needs to match.

- **A single `InMemoryAdapters` god-object bundling all eight fakes into
  one class.** Rejected: it would force every port's fake to be constructed
  and torn down together, which fights the contract-suite pattern (each
  port's fake should be independently instantiable and independently
  testable against its own contract suite, issue #26 for the analogous
  repository case) and makes it harder to mix one real adapter with seven
  fakes during Phase 1b integration testing.

## Consequences

- Adding a real adapter later (e.g. `adapters/sqlite-metadata-repository`,
  issue #25) does _not_ remove or relocate `InMemoryMetadataRepositoryPort`
  — both are expected to coexist, and both are expected to pass the same
  contract test suite (AGENTS.md §2 rule 5, issue #26 for the repository
  case specifically).
- `core`'s "zero I/O" claim now rests on a slightly more nuanced reading
  ("zero _real_ I/O," not "zero non-domain code") than a strict first
  reading of AGENTS.md §2 rule 1 might suggest. This ADR is that nuance
  made explicit, so a future contributor auditing `core/src` for I/O finds
  the reasoning here rather than re-litigating it.
- If `adapters/*` eventually gains a convention-enforcing lint rule (e.g.
  "every `adapters/*` package must export exactly one concrete
  implementation"), the fakes living in `core` means that rule does not
  need a carve-out for them.
