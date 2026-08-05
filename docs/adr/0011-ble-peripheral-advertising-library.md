# ADR-0011: BLE peripheral/advertising library — `munim-bluetooth`

**Status:** Accepted
**Date:** 2026-08-05

## Context

Spike 0028 (`docs/spikes/0028-background-ble-feasibility.md`) and
ADR-0010 established that `react-native-ble-plx` (ADR-0002) only implements
the BLE **Central/scan** role. SPEC.md §6.1's mutual advertise-and-scan
model for person-to-person street encounters needs a **second** dependency
(or a custom native module) for the **Peripheral/advertise** role. The
spike time-boxed this exact choice as new, unresolved scope for #34 to
close before implementation, and named four candidates in descending order
of maturity as of the spike's writing:

| Package                       | Role coverage                                       | Maintenance signal as surveyed                                                                                                                                     |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `react-native-peripheral`     | Peripheral only, iOS-focused                        | Small, low adoption, stale                                                                                                                                         |
| `react-native-ble-advertiser` | Peripheral + basic scan, Android-first              | ~100 weekly downloads, 65 stars, effectively unmaintained (last publish years ago per the spike; a follow-up search today still shows no meaningful 2026 activity) |
| `munim-bluetooth`             | Central + peripheral, cross-platform, Nitro modules | Actively released through 2026 (GitHub activity as recent as May 2026 per a follow-up search), single maintainer, no long production track record                  |
| Custom native module          | Whatever is built                                   | Full control, full cost                                                                                                                                            |

A follow-up web search (this ADR) confirms the spike's ranking still holds:
`react-native-ble-advertiser` and `react-native-peripheral` show no material
2026 activity; `munim-bluetooth` is the only peripheral-capable candidate
with an active 2026 release cadence, and it explicitly documents Expo
managed-workflow support (SDK 50+) — `clients/mobile` is Expo SDK ~57, so it
is compatible without ejecting.

## Decision

**Use `munim-bluetooth` for the Peripheral/advertise role**, alongside
`react-native-ble-plx` for the Central/scan role, as ADR-0010 already
specified. `BleDiscoveryAdapter` (`adapters/discovery-ble/`) internally
composes both libraries behind the single `DiscoveryPort` interface:
`react-native-ble-plx` drives scanning and peer discovery events;
`munim-bluetooth` drives this device's own advertisement so the other side
can find it. Neither library is exposed to `DiscoveryPort`'s callers —
AGENTS.md §2 rule 3 holds exactly as it does for every other adapter.

`munim-bluetooth` is chosen over the alternatives because:

- It is the only candidate that actually implements the peripheral role on
  **both** iOS and Android (the other two libraries are single-platform or
  effectively abandoned).
- It works inside the Expo managed workflow already in use in
  `clients/mobile` — the other candidates either predate widespread Expo
  config-plugin support or don't document it.
- It has a real, dated 2026 release history, unlike the alternatives.

This does **not** mean `munim-bluetooth` is low-risk. It has "no long
production track record" (the spike's own phrase, still true): it is the
newest of the three off-the-shelf options and carries a single-maintainer
bus-factor risk. This ADR accepts that risk as strictly better than the
alternatives, not as a risk that has gone away.

## Alternatives considered and rejected

- **`react-native-peripheral`** — rejected: iOS-only in practice (per the
  spike), which fails SPEC.md §6.1's cross-platform mutual-advertise
  requirement outright; low adoption and stale.
- **`react-native-ble-advertiser`** — rejected: effectively unmaintained
  (last meaningful publish years prior per both the original spike and this
  ADR's follow-up search); Android-first with only basic scan support, so
  it would still need pairing with something else for iOS peripheral mode,
  which erases its simplicity advantage.
- **Custom native module wrapping `CBPeripheralManager` /
  `BluetoothLeAdvertiser` directly** — rejected for this batch: full control
  is real, but so is full cost — building and maintaining two native
  modules (Swift + Kotlin) is a materially larger and slower-to-ship
  undertaking than adopting an existing cross-platform library, and nothing
  found in the spike or this ADR's research indicates the off-the-shelf
  options are broken in a way that would force this. Revisit if
  `munim-bluetooth` proves unworkable on real hardware (tracked as a
  first task for #33/#34, see below) — at that point a custom module
  becomes the fallback, not a startup default.
- **Replace `react-native-ble-plx` too, adopting a single library for both
  roles** — rejected: `munim-bluetooth` itself supports both roles, so this
  was considered, but ADR-0010 already confirmed `react-native-ble-plx`'s
  Central-role maturity (including iOS state restoration) as sound and
  worth keeping; swapping a working, mature dependency for an unproven one
  on the role it already does well would trade a solved problem for a new
  unknown, for no benefit. `BleDiscoveryAdapter`/`BleTransportAdapter` use
  `react-native-ble-plx` for scan/GATT and `munim-bluetooth` only for
  advertising — the narrowest change that closes the actual gap.

## Consequences

- `adapters/discovery-ble/` takes both `react-native-ble-plx` and
  `munim-bluetooth` as dependencies; `adapters/transport-ble/` (GATT
  read/write/notify) only needs `react-native-ble-plx`, since a connected
  GATT session is a Central-role concern once discovery has already
  happened.
- Neither library has been exercised against real hardware in this
  environment (no BLE radio, no device, no simulator — see this batch's PR
  description and the adapters' own test files). Both adapters are tested
  here against **mocked** library surfaces shaped to match each library's
  public API as documented; live two-device pairing through
  `munim-bluetooth`'s peripheral mode remains a real-hardware follow-up, the
  same honesty pattern the BLE spike already established for iOS/Android
  builds in CI.
- `scripts/check-web-bundle-native-imports.mjs`'s `BANNED_NATIVE_PACKAGES`
  list already named `munim-bluetooth` pre-emptively (added when the spike
  was written) — no gate change is needed to keep it out of the web bundle.
- If real-device testing (a first task for whoever verifies #33/#34 on
  physical hardware) finds `munim-bluetooth` unworkable — its "no long
  production track record" risk materializing — this ADR is the one to
  revisit, most likely by falling back to the custom-native-module
  alternative above, not by re-litigating ADR-0002 or ADR-0010.
