# ADR-0010: Foreground-first, background-enhanced BLE swap model

**Status:** Accepted
**Date:** 2026-08-04

## Context

Issue #28 (spike, [`docs/spikes/0028-background-ble-feasibility.md`](../spikes/0028-background-ble-feasibility.md))
is the critical-path gate IMPLEMENTATION.md flags before committing Phase 1b
timelines. It found two things that ADR-0002 did not separately evaluate
when it chose `react-native-ble-plx`:

1. `react-native-ble-plx` implements **only the Central (scan) role**. Its
   own README states it does not support the Peripheral (advertising) role.
   SPEC.md §6.1 requires _mutual_ advertise-and-scan for person-to-person
   street encounters, so a second dependency or custom native module is
   required for the advertising half regardless of which client framework
   was chosen.
2. Even with a peripheral-capable library in place, both platforms
   materially restrict _background_ peripheral/advertising operation: iOS
   drops the local name and moves service UUIDs into an overflow region
   discoverable only by another iOS device explicitly scanning for the same
   UUID (so cross-platform background discovery does not reliably work),
   and does not relaunch a user-swipe-killed app under any circumstances.
   Android increasingly requires a foreground service with a visible
   notification to sustain background advertising/scanning past a few
   minutes, particularly from Android 12–15.

Neither finding is a reason to abandon BLE-first Phase 1 — SPEC.md §9's
actual exit criterion ("scans for peers over BLE, gossips metadata on
contact") does not require silent, always-on background operation, only
that a swap happens on contact. But building #33/#34 against an assumed
"ambient background gossip" model would build the wrong thing.

## Decision

**The primary, reliably-supported swap model is foreground-first: both
devices have the app open during the contact window.** Background BLE
activity is a best-effort enhancement layered on top, split by role and
platform, not a dependency for meeting Phase 1's exit criterion:

- **Central/scan side** uses `react-native-ble-plx` with iOS state
  restoration enabled, as ADR-0002 already specifies. This part of the
  original plan is unchanged and confirmed sound by the spike.
- **Peripheral/advertise side** requires a second library or a small custom
  native module (`react-native-ble-plx` does not cover it). #34 must
  time-box a spike to select and prototype this dependency before
  implementation; it is new, previously-unsurfaced scope, not a drop-in
  adapter swap.
- **Android** background advertising+scanning, when attempted, runs inside
  a foreground service with a persistent, user-visible notification — this
  is disclosed UX, not hidden background magic.
- **iOS** background peripheral advertising, when attempted, is assumed
  discoverable only by another iOS device explicitly scanning for the exact
  same service UUID; it is not relied upon for iOS↔Android background
  discovery, and it is never relied upon to relaunch a user-swipe-killed
  app (Apple does not support this under any configuration).
- The short-contact swap profile (IMPLEMENTATION.md #36, a 2–10 second
  encounter) is designed assuming foreground-open apps on both sides as the
  baseline case a user can rely on. Background discovery, where it happens
  to work, is a silent bonus, never a promise made to the user.

## Alternatives considered and rejected

- **No-go: abandon BLE-first Phase 1, pursue a different discovery
  mechanism (e.g. QR-code pairing, NFC tap-to-pair) as the primary flow.**
  Rejected: nothing found is a hard technical blocker to SPEC.md §9's actual
  exit criterion, which only requires a swap on contact, not silent
  always-on gossip. Discarding BLE-first over a UX-model refinement would
  be an overcorrection; the spike's findings constrain _how_ BLE-first
  works, not _whether_ it can.
- **Pretend the background limitations don't apply and build #33/#34 as
  originally scoped (single library, assumed ambient background
  operation).** Rejected: this would silently under-deliver against
  ADR-0002's and SPEC.md §8's framing (which reads as if
  `react-native-ble-plx` alone handles the mutual-advertise-and-scan case),
  and would surface as a late, expensive discovery mid-implementation of
  #34 rather than an early, cheap one here.
- **Revisit ADR-0002 itself (reconsider Flutter/Capacitor).** Rejected:
  ADR-0002 already compared these on exactly the peripheral-role axis and
  found them equal or worse (Flutter: weaker peripheral role and Android
  foreground-service workarounds already noted; Capacitor: mirrors Web
  Bluetooth, which is Central-only, i.e. _no_ peripheral role at all). This
  spike's findings do not change that comparison; they refine what
  "React Native's BLE story" concretely requires.

## Consequences

- #33 (BLE transport adapter) proceeds against `react-native-ble-plx` for
  the central/scan side with high confidence, as originally planned.
- #34 (BLE discovery adapter) gains new first-task scope: select and
  prototype a peripheral/advertising-role dependency
  (`react-native-peripheral`, `react-native-ble-advertiser`,
  `munim-bluetooth`, or a custom native module — see the spike for a
  maturity comparison) before building the discovery flow around it. This
  is additional risk and lead time the original single-library plan did
  not budget for.
- The short-contact swap profile (#36) and scan scheduling defaults (#35)
  are designed around foreground-open apps as the reliable case; Android's
  scan-restart throttle (five restarts per 30s) and unfiltered-scan timeout
  (30s) become concrete inputs to #35's default duty cycle.
- **User-facing consequence, flagged per AGENTS.md §3:** the product cannot
  honestly promise "your phone finds pieces even when the app is fully
  closed." A persistent notification is required for any sustained Android
  background operation, and iOS never relaunches a swipe-killed app for BLE
  events. This should shape the onboarding/UX copy in the client scaffold
  (#29 onward) — do not write copy implying always-on ambient collection.
- If a future real-device test (tracked as a first task under #33/#34, not
  here — this environment has no hardware to run it) finds the peripheral
  library candidates unworkable in practice, this ADR and the underlying
  spike are the ones to revisit, not ADR-0002.
