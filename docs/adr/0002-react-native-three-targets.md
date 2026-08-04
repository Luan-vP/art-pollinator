# ADR-0002: React Native for iOS, Android, and web from one codebase

**Status:** Accepted
**Date:** 2026-08-04

## Context

SPEC.md §8 requires one client codebase spanning iOS, Android, and the
browser. Phase 1's exit criteria (SPEC.md §9) requires BLE peer discovery and
gossip on the mobile targets — including the ability to relaunch the app on
a background BLE event on iOS (state restoration) — while the browser is
required to be a first-class target with a _reduced_ capability set (Wi-Fi
node swaps only; no BLE, since Web Bluetooth cannot advertise). Maintaining
three entirely separate native codebases for one shared domain would
directly undercut ADR-0001's premise — one `core`, several runtimes — by
tripling the surface area that has to stay behavior-consistent.

## Decision

Use **React Native**, targeting iOS, Android, and the browser (via
React Native Web) from one codebase, per SPEC.md §8. The mobile targets use
`react-native-ble-plx` for BLE — chosen specifically for its maturity around
iOS background state restoration, the mechanism that relaunches the app on a
background BLE event, which SPEC.md flags as the largest technical risk on
the critical path (IMPLEMENTATION.md #28, "Background BLE spike"). The
browser build registers no BLE adapter at its composition root and acquires
content only via Wi-Fi node swaps (SPEC.md §8 capability tiers table); `core`
is unaware this distinction exists, per ADR-0001's platform-conditional
rule.

CI enforces that `react-native-ble-plx` (and any other native-only import)
never reaches the web bundle or the Node server build
(IMPLEMENTATION.md #31) — a native-only dependency leaking into a target
that cannot run it is exactly the kind of platform conditional ADR-0001
forbids leaking into shared code, just one layer further out.

## Alternatives considered and rejected

Per SPEC.md §8, two alternatives were already evaluated at the spec level;
this ADR records them formally as the project's first architectural
decision on client platform.

- **Flutter.** Rejected: weaker BLE peripheral/advertising role support, and
  background scanning requires foreground-service workarounds on Android
  that fight the OS rather than working with it. Since Phase 1's exit
  criterion is mutual BLE gossip between peers (both sides advertising _and_
  scanning), a framework with a weaker peripheral story is a risk directly
  on the critical path, not a peripheral concern.

- **Capacitor.** Rejected: capable in principle, and its BLE story mirrors
  the Web Bluetooth API, but it is less proven for the specific case that
  matters most here — the background peripheral (advertising) role on iOS.
  Capacitor's web-first architecture (native code wrapping a webview) is
  also a worse fit for a project whose native mobile behavior (background
  BLE) is the hard part and the web target is deliberately the _reduced_
  capability tier, not the primary one.

- **Fully separate native codebases** (Swift/Kotlin for mobile, a separate
  web app) were not seriously evaluated as an alternative, but are recorded
  here because they are the obvious fallback if React Native's constraints
  ever become blocking. Rejected preemptively: this would mean re-deriving
  the same domain logic in at least two more languages, defeating the
  entire premise of ADR-0001 (`core` shared across every runtime, including
  the Node server). The cost is only justified if React Native's BLE
  background story turns out not to work at all — which is precisely what
  IMPLEMENTATION.md #28 (the background BLE spike) exists to determine
  before Phase 1b timelines are committed. If that spike returns a no-go,
  this ADR should be revisited, not silently worked around.

## Consequences

- One shared codebase for UI and composition-root wiring across iOS,
  Android, and web, consistent with `core`/`app` already being runtime-
  agnostic per ADR-0001.
- The browser is explicitly a **capability tier**, not a degraded port: no
  BLE affordances are shown (absent, not disabled — IMPLEMENTATION.md #32),
  and it depends on the HTTP transport and LAN discovery adapters being
  pulled forward from Phase 2 into Phase 1b (IMPLEMENTATION.md #43–44) —
  without those, the browser target has no acquisition path at all and is
  inert at Phase 1 exit. This ADR does not on its own make the browser
  useful; it depends on that pull-forward actually landing.
- `react-native-ble-plx` becomes a hard dependency of the mobile composition
  root and must never be imported by `core`, `app`, or any code path reached
  by the web/Node builds. This is enforced by the RN Web compatibility gate
  in CI (IMPLEMENTATION.md #31), which does not exist yet in this repo (it
  arrives with the React Native scaffold, IMPLEMENTATION.md #29) — until
  then this constraint is a documented intent, not yet a build-failing
  check.
- The single largest technical risk this decision inherits — iOS
  background peripheral/advertising reliability — is not resolved by
  choosing React Native; it is deferred to the spike at
  IMPLEMENTATION.md #28. If that spike returns a no-go, this ADR is the one
  to revisit.
