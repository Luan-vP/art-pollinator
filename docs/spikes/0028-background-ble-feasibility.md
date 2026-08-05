# Spike 0028: Background BLE feasibility

**Issue:** [#28](https://github.com/Luan-vP/art-pollinator/issues/28) · **Status:** Complete · **Date:** 2026-08-04
**Critical path gate for:** #33 (BLE transport adapter), #34 (BLE discovery adapter)

## Method and its limits

This is desk research (official Apple/Android documentation, the
`react-native-ble-plx` maintainers' own docs and issue tracker, and current
third-party writeups), not a device experiment. **This sandbox has no
physical iOS/Android hardware, no Xcode, no Android SDK, and no BLE radio
— every claim below is sourced, not independently reproduced.** Where a
finding is safety-critical to get right (foreground service requirements,
exact background scan throttling numbers, iOS overflow-area behaviour), a
short "what real-device verification would still need to confirm" note is
attached. That verification requires physical hardware this environment does
not have; it belongs in #33/#34 as a first task, not here.

## Key finding: the chosen library does not implement the peripheral role at all

This is the single most important finding of this spike and changes the
shape of #33/#34.

**`react-native-ble-plx` only implements the BLE Central role** (scanning
for and connecting to other devices). Its own README states plainly that it
does **not** support "communicating between phones using BLE (Peripheral
support)." [[dotintent/react-native-ble-plx README]](https://github.com/dotintent/react-native-ble-plx)

SPEC.md §6.1 requires **mutual advertise and scan** for person-to-person
street encounters — both devices must simultaneously act as a peripheral
(advertising, so the other side's scan can find them) and a central
(scanning, to find the other side). `react-native-ble-plx` alone can only
ever supply one half of that (the scanning half). ADR-0002 chose this
library "including iOS state restoration" without flagging that state
restoration there refers to the central role only; it did not separately
evaluate peripheral-role support, and that gap surfaces here.

**This does not invalidate ADR-0002's choice of React Native as the client
framework** (Flutter and Capacitor have the same or worse peripheral-role
gaps per that ADR's own comparison) — it means a **second, dedicated
library or a small custom native module is required for the advertising
side**, on top of `react-native-ble-plx` for the scanning side. Candidates,
in descending order of maturity as of this writing:

| Package                                                                                | Role coverage                                       | Maintenance signal                                                           |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `react-native-peripheral` (petrbela)                                                   | Peripheral only, iOS-focused                        | Small, low adoption, last significant activity years old                     |
| `react-native-ble-advertiser`                                                          | Peripheral (advertise) + basic scan, Android-first  | Effectively unmaintained (last publish ~4 years ago)                         |
| `munim-bluetooth`                                                                      | Central + peripheral, cross-platform, Nitro modules | Newest, most actively developed, but young — no long production track record |
| Custom native module wrapping `CBPeripheralManager` / `BluetoothLeAdvertiser` directly | Whatever you build                                  | Full control, full cost — this is what the others are already doing          |

None of these carries `react-native-ble-plx`'s maturity. **Treat "which
peripheral-role library to use" as new, unresolved scope that #34 must spike
before implementation**, not an incidental adapter-swap. This is flagged
explicitly so the agent picking up #33/#34 does not discover it mid-task.

## Finding: iOS background peripheral (advertising) mode is real but severely restricted

Native `CBPeripheralManager` (the underlying iOS API, regardless of which RN
wrapper eventually calls it) does support advertising while backgrounded,
gated behind the `bluetooth-peripheral` `UIBackgroundModes` entry. But
Apple's own documentation describes two restrictions that bite hard here:

1. **The advertised local name is dropped**, and **advertised service UUIDs
   move into a special "overflow" area** that "can be discovered only by an
   iOS device that is explicitly scanning for them" [[Apple Developer
   documentation via Punch Through / developer forums]](https://punchthrough.com/ios-ble-scanning-guide/).
   In practice this means **a non-iOS central (an Android phone) cannot
   reliably discover a backgrounded iOS peripheral by service UUID at all.**
   Cross-platform (iOS↔Android) background mutual discovery is not just
   throttled — it does not work as a stable, general mechanism.
2. **Non-connectable advertisements are suppressed entirely while
   backgrounded**, and background scanning only surfaces connectable
   advertisements whose service UUIDs match an explicit filter list, which
   the scanning side must set up in advance — an unfiltered "see anyone
   nearby" scan does not work in the background on iOS.

**State restoration does not rescue "swipe-killed" apps.** iOS state
restoration (`CBCentralManagerOptionRestoreIdentifierKey` /
`CBPeripheralManagerOptionRestoreIdentifierKey`) relaunches the app **only
when iOS itself suspended or terminated the process for resource reasons**
(e.g. memory pressure while backgrounded). If the user swipes the app away
from the app switcher, that is treated as an explicit "stop running me"
signal, and Bluetooth activity does not resume or relaunch the app — this
is documented Apple behaviour, not a library limitation. So "gossip
continues even after the user has fully quit the app" is **not achievable
on iOS**, with or without `react-native-ble-plx`, with or without a better
peripheral library.

_What a real device would still need to confirm:_ the exact conditions
under which iOS decides to suspend vs. terminate a backgrounded app holding
an active BLE session, and how long the overflow-UUID advertising window
practically stays discoverable by another iOS device before the OS further
throttles it. Both are well documented in principle but have edge-case
variance across iOS versions that only a device test would settle
precisely — track as a first task in #34, not blocking this go/no-go.

## Finding: Android background advertising and scanning are throttled, and increasingly require a foreground service

- **Since Android 8 (Oreo), background execution is aggressively limited.**
  A `BluetoothLeAdvertiser` running without a foreground service has no
  guaranteed lifetime in the background and can be silently stopped by the
  system even after successfully starting.
- **Scan throttling since Android 7/8:** starting/stopping a scan more than
  five times in a 30-second window causes the system to silently throttle
  the scanner for the rest of that window; unfiltered scans running longer
  than 30 seconds without a `ScanFilter` are silently stopped by the OS.
- **Android 12+ and especially Android 14/15 tighten this further:**
  sustained background BLE work (advertising, connected-device scanning)
  increasingly requires an explicit **foreground service** with a
  `connectedDevice` service type and the matching runtime permission,
  which in turn means a **persistent, user-visible notification** while the
  swap session is live. This is a real, working pattern (many
  Nearby-Share-style apps use exactly this), but it is a UX cost, not free
  background magic — it should be represented as an actual notification and
  disclosed to the user, not hidden.
- A `PendingIntent`-based scan registration exists as an OS-level mechanism
  for scan results to be delivered even when the scanning app process has
  been killed, but it is intended for opportunistic beacon-style detection,
  not for sustaining an active bidirectional swap session, and it does not
  cover the advertising (peripheral) side at all.

_What a real device would still need to confirm:_ actual battery draw and
real-world throttling behaviour across OEM skins (Android background
restrictions are notoriously more aggressive on some manufacturers'
firmware than stock AOSP) — this is exactly the kind of measurement
IMPLEMENTATION.md #35 ("battery cost of defaults measured and recorded")
already schedules as a follow-up task with real devices, not something this
desk spike can substitute for.

## Go/no-go recommendation

**GO, with the swap model revised from "ambient background gossip" to
"foreground-first, background-enhanced."** BLE-first Phase 1 remains the
right approach — nothing found here is a hard blocker to the _exit
criterion_ SPEC.md §9 actually states ("a cross-platform app that scans for
peers over BLE, gossips metadata on contact"). But it is not achievable as
an always-on background service on either platform without cost, and on
iOS it is not achievable as a "wake from fully-quit" mechanism at all. This
is a **decision that carries weight beyond code** per AGENTS.md §3 (it
changes the user-facing contract: users may need the app open during a
street encounter) and is flagged here for that reason.

### What "go, with caveats" means concretely for #33/#34

1. **Treat foreground operation as the primary, reliably-supported path on
   both platforms**, for both the central (scan) and peripheral (advertise)
   sides. This matches SPEC.md §6.1's own framing of a short 2–10 second
   contact window (IMPLEMENTATION.md #36): a user opening the app during an
   encounter — the way one opens a wallet, ticket, or transit-card app — is
   a reasonable, ordinary ask, not a compromise of the vision. Do not build
   #33/#34 around an assumption of silent background operation as the
   baseline case.
2. **Background is a best-effort enhancement layered on top, not the
   guaranteed path, and it splits by role:**
   - **Central/scan side:** `react-native-ble-plx` plus iOS state
     restoration is genuinely solid here and should be used as specified.
     This half of ADR-0002's premise holds.
   - **Peripheral/advertise side:** requires the second library evaluated
     above. #34 must time-box a spike on this specific gap (which package,
     or a custom native module) before implementation — this was not
     accounted for in the original single-library plan and is new,
     unresolved scope this document surfaces.
   - **Android:** sustaining background advertising+scanning together
     needs a foreground service with a visible notification. Build this in
     from the start rather than retrofitting it once background operation
     turns out to be silently killed in testing.
   - **iOS:** background advertising, even once a peripheral-role library
     exists, should be assumed **discoverable only by another iOS device
     explicitly scanning for the exact same service UUID.** Do not design
     #34's discovery flow to depend on an Android central finding a
     backgrounded iOS peripheral — that path does not reliably exist.
     Cross-platform discovery should be assumed foreground-only until a
     real-device test says otherwise.
   - **State restoration relaunches the app for an OS-initiated suspension
     of an in-progress session — never for a user-initiated swipe-kill.**
     Do not message this to users as "always on"; a swipe-killed app is
     genuinely offline for BLE purposes on iOS, by Apple design.
3. **Feed Android's scan/advertise throttling numbers into #35's scan
   scheduling defaults** (duty cycle, window, interval, backoff): default
   scan-restart cadence should stay comfortably under the "5 restarts per
   30s" throttle threshold, and any unfiltered scan should have an explicit
   timeout well under 30 seconds or supply a `ScanFilter`.
4. **This spike does not change ADR-0002's conclusion** (React Native
   remains the right framework choice; Flutter and Capacitor were already
   documented there as weaker on exactly this peripheral-role axis). It
   narrows what ADR-0002 assumed `react-native-ble-plx` alone would cover,
   which is recorded formally in
   [`docs/adr/0010-hybrid-foreground-first-ble-swap-model.md`](../adr/0010-hybrid-foreground-first-ble-swap-model.md).

## Summary for whoever implements #33/#34

- Use `react-native-ble-plx` for the central/scan side and its
  transport/discovery ports as originally planned; its iOS state
  restoration story is real and should be used.
- Budget separate, first-task time in #34 to pick and prototype a
  peripheral/advertising-role dependency — none of the current options
  match `react-native-ble-plx`'s maturity, so this is genuine unresolved
  risk, not a mechanical adapter swap.
- Design the short-contact swap profile (#36) assuming the app is
  foreground on both sides during the encounter; treat any background
  discovery as a bonus path that degrades silently, not a dependency.
- Android's background service requirement means a real, user-visible
  notification during an active swap session — design for it, do not hide
  it.
- iOS will not relaunch a swipe-killed app for BLE events, ever. Do not
  build or message a "your phone will find pieces even when the app is
  fully closed" promise into the product.
