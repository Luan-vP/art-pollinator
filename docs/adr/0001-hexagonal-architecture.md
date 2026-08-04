# ADR-0001: Strict hexagonal architecture (core / app / adapters / clients)

**Status:** Accepted
**Date:** 2026-08-04

## Context

ArtPollinator's domain logic — slots, policies (`PriorityPolicy`,
`OfferPolicy`, `AcceptPolicy`, `EvictionPolicy`), the swap state machine — has
to run identically across very different runtimes: a React Native mobile app
(iOS/Android/web) and a long-lived Node.js stationary server, per SPEC.md §8.
It also has to be testable end-to-end (a full swap negotiated and executed)
with no BLE hardware, no network, and no filesystem, since Phase 1a is built
and tested before any real transport, device, or network exists
(IMPLEMENTATION.md).

That combination — one piece of logic, several runtimes, fully testable
without I/O — is what drove the architecture, not a general preference for
layering.

## Decision

Adopt a strict hexagonal (ports-and-adapters) layout as four workspace
packages, per AGENTS.md §2:

```
core/          Domain types, policies, state machines. ZERO I/O. ZERO dependencies.
app/           Use cases (SwapService, LibraryService). Depends on core only.
adapters/*     Implementations of ports. Depend on core. Never depended upon by core.
clients/*      Composition roots. Wire adapters to ports. Platform-specific.
```

Non-negotiable rules (enforced, not just documented):

1. `core` imports nothing external — no HTTP client, filesystem, BLE
   library, or framework. A dependency needed by the domain becomes a port
   interface owned by `core`, not an import of the library that happens to
   provide it.
2. No platform conditionals in `core` or `app`. Capability differences
   (e.g. "this target has no BLE adapter") are resolved by which adapters a
   client registers at its composition root, not by branching on
   `Platform.OS` inside domain code.
3. Every port ships with an in-memory fake and a contract test suite that
   every real adapter must also pass — this is what keeps BLE and HTTP
   transports interchangeable, and what makes a full swap runnable in
   memory before any real transport exists.

This is enforced today by a dependency-direction check
(`scripts/check-core-boundaries.mjs`, wired into `npm run lint`) that fails
the build if `core` contains a bare (non-relative) import or a relative
import that resolves outside `core/src`. A fixture-driven test
(`npm run verify:boundaries-rule`) proves the check actually fails on
violations, not just that it exists.

## Alternatives considered and rejected

- **Layered MVC-style structure** (`models/`, `services/`, `controllers/`),
  with the "model" layer holding both domain logic and persistence code.
  Rejected: this is exactly the shape that lets I/O creep into domain
  logic — a "model" importing an ORM is normal in MVC and fatal here, since
  the domain must run without a database, network, or device to satisfy the
  Phase 1a exit criteria (fully testable in memory). MVC also has no seam
  that naturally maps to "three client runtimes share one domain," which
  this project requires from day one.

- **Single package, folder-based separation** (`src/core/`, `src/adapters/`
  as directories in one npm package, not separate workspace packages).
  Rejected: a directory convention is not enforceable. Nothing stops
  `src/core/foo.ts` from `import`-ing `src/adapters/bar.ts` — the mistake
  compiles, passes review if nobody notices, and only surfaces later as a
  platform-specific crash in a build that shouldn't have depended on that
  platform. Separate workspace packages give each layer its own
  `package.json`, so `core` declaring zero dependencies is a checkable fact,
  not a convention someone can quietly violate. This project has an explicit
  tool (#1) whose entire job is failing the build on that violation; a
  single package would leave it nothing to check against except import
  paths within one `node_modules` graph shared by everything.

- **Dependency injection framework** (e.g. a DI container/decorators) instead
  of plain composition-root wiring. Rejected as unnecessary complexity for
  this project's size: `clients/*` wiring concrete adapters to ports by hand
  at startup is a few function calls, fully typed, and requires no runtime
  reflection or decorator metadata — which also matters for React Native,
  where decorator/reflection-heavy patterns have historically had bundler and
  Hermes-engine friction. Revisit only if composition roots grow large enough
  that manual wiring becomes error-prone.

## Consequences

- Adding a new capability to the domain (e.g. a new policy seam) never
  requires touching `adapters/*` or `clients/*`, and is testable via the
  in-memory fakes alone — this is the whole point, and it is what lets
  Phase 1a be built and fully tested before Phase 1b's BLE work starts.
- Every new adapter is required to ship a contract test suite before the
  adapter itself is considered done (AGENTS.md §4: "Write the contract test
  suite before the adapter"). This is more up-front process than a simpler
  layout would demand, and is a deliberate cost — an adapter without one
  cannot be verified interchangeable with its fake, which defeats the reason
  this architecture exists.
- The boundary is enforced by a same-repo script rather than a battle-tested
  linter plugin (e.g. `eslint-plugin-boundaries`). This keeps the check
  simple, dependency-free, and easy to read in full, at the cost of being
  hand-rolled rather than community-maintained. If the ruleset grows more
  elaborate (e.g. per-adapter allow-lists), revisit adopting a plugin.
- Three empty workspace globs (`adapters/*`, `clients/*`) exist in
  `package.json` before any package fills them, which is mildly unusual for
  a fresh repo but avoids a root `package.json` edit — and the accompanying
  workspace-glob churn — the moment the first adapter or client lands.
