# Battery cost estimate for default BLE scan settings (issue #61)

**Status:** Theoretical estimate, pending real-device measurement · **Date:** 2026-08-06

## Method and its limits

`adapters/scheduler-timer/src/scan-scheduler.ts`'s own doc comment already
discloses the gap this document fills: "This environment has no physical
device and no BLE radio... there is no honest way to produce a real
battery-drain number here, and this file does not fabricate one." That
remains true. This document does not claim to have measured anything —
it computes a **theoretical, duty-cycle-weighted power estimate** from
`ScanScheduler`'s actual, already-implemented configuration and published
BLE power-consumption figures found via research, exactly as issue #61
asks for, and labels every number by its actual source (a real config
constant in this repo, vs. a third-party published figure, vs. an assumed
approximation).

This is the same honest-gap pattern already established for the BLE
feasibility spike (`docs/spikes/0028-background-ble-feasibility.md`) and
the short-contact swap profile's throughput assumption
(`app/src/swap/short-contact-swap-profile.ts`): desk research standing in
for hardware this sandbox does not have, clearly labeled, with a note on
what real-device verification would still need to confirm.

## Inputs

### 1. `ScanScheduler`'s real, already-implemented parameters

From `adapters/scheduler-timer/src/scan-scheduler.ts`'s
`DEFAULT_SCAN_SCHEDULE_CONFIG` (not an estimate — the actual shipped
default):

| Parameter                                                  | Value     |
| ---------------------------------------------------------- | --------- |
| `windowMs` (scan burst length)                             | 4,000 ms  |
| `intervalMs` (baseline window-start to window-start)       | 8,000 ms  |
| `backoffMultiplier`                                        | 2         |
| `maxIntervalMs` (interval ceiling after sustained silence) | 60,000 ms |
| `emptyWindowsBeforeBackoff`                                | 3         |

This gives two duty cycles worth estimating:

- **Baseline** (peers reliably found, backoff never engages):
  `dutyCycle = windowMs / intervalMs = 4,000 / 8,000 = 50%`.
- **Fully backed off** (an area gone quiet — no peers found for
  `emptyWindowsBeforeBackoff` consecutive windows, interval capped at
  `maxIntervalMs`): `dutyCycle = windowMs / maxIntervalMs = 4,000 / 60,000 ≈ 6.67%`.

### 2. Published BLE active-scan current draw (third-party research, not measured here)

Two independent sources converge on a similar order of magnitude:

- **Nordic Semiconductor's nRF52-series datasheets** specify **~6.5 mA**
  for the radio in RX mode with the DC/DC converter enabled — the mode a
  BLE chipset is in while actively scanning for advertising packets. This
  is a dedicated-chipset figure (a BLE SoC, not a full smartphone), used
  here as the single representative "active scanning" current for the
  arithmetic below.
- **Android's own documented scan-mode power bands** (per current
  published guidance on `ScanSettings` duty cycling) report
  `SCAN_MODE_LOW_POWER` (a ~512 ms scan / ~4.9 s sleep duty cycle, roughly
  9% duty cycle) at **~1–3 mA**, and `SCAN_MODE_BALANCED` (a 1.28 s
  scan / 1.28 s sleep duty cycle, 50% duty cycle) at **~5–10 mA**. Notably,
  `SCAN_MODE_BALANCED`'s duty cycle (50%) matches `ScanScheduler`'s own
  baseline duty cycle exactly, and its reported current range (5–10 mA)
  brackets this document's computed baseline figure below — a useful
  cross-check that the chipset-datasheet figure used for the main
  computation is in a plausible real-world range, not off by an order of
  magnitude.

Idle (non-scanning) baseline BLE radio current is treated as negligible
for this estimate — it is small relative to the active-scan figure above,
and the goal here is the _incremental_ cost this app's scan schedule adds,
not the phone's total baseline power draw.

### 3. Assumed phone battery capacity

No specific device is targeted by this app (SPEC.md §8: iOS, Android, and
browser from one codebase); this document uses a representative range of
**3,000–5,000 mAh**, spanning a smaller modern phone to a larger one,
rather than picking one specific model.

## Calculation

```
average current (mA) ≈ dutyCycle × activeScanCurrent(6.5 mA)
```

(idle current treated as ~0 for this incremental estimate, per above)

| Scenario                             | Duty cycle | Avg. current | mAh / hour | mAh / day (24h) | % of a 3,000 mAh battery / day | % of a 5,000 mAh battery / day |
| ------------------------------------ | ---------- | ------------ | ---------- | --------------- | ------------------------------ | ------------------------------ |
| Baseline (peers reliably found)      | 50%        | 3.25 mA      | 3.25 mAh   | 78 mAh          | ~2.6%                          | ~1.6%                          |
| Fully backed off (sustained silence) | 6.67%      | 0.43 mA      | 0.43 mAh   | 10.4 mAh        | ~0.35%                         | ~0.21%                         |

**Headline estimate: on the order of ~2.6% of a 3,000 mAh phone battery
per 24 hours of continuous baseline-duty-cycle scanning, dropping to
~0.35% per day once an area has gone quiet and backoff has fully
engaged.**

This is a theoretical upper bound in one important sense: `ScanScheduler`
only runs while the app is actively scanning at all, and ADR-0010's
"foreground-first" swap model means realistic usage is a user opening the
app during a brief encounter, not 24 hours of continuous background
scanning — so the 24-hour figures above are a deliberately pessimistic
ceiling ("if this ran non-stop all day"), not a claim about typical daily
battery impact under the app's actual intended usage pattern.

## What this estimate does NOT account for

Stated plainly, since each of these could move the real number in either
direction and none of them are modeled here:

- **CPU/OS wake-lock overhead** around each scan window (waking the radio,
  processing discovered-peer callbacks, any app logic that runs per
  discovery) — the 6.5 mA figure is radio-only RX current from a dedicated
  chipset datasheet, not a full smartphone BLE-stack measurement including
  OS scheduling overhead.
- **Connection/advertising cost** once a peer is actually found and a swap
  begins (a different, likely higher, current draw than passive scanning)
  — this estimate covers scanning only, the dominant _background_ cost per
  `ScanScheduler`'s own scope.
- **Screen-on cost** — since the intended usage model has a user actively
  looking at the app during an encounter, the phone's display is very
  likely also on and drawing far more current than the BLE radio during
  that window; this estimate isolates the BLE scanning increment only.
- **Real OS-level scan throttling** (Android's documented "5 restarts per
  30s" throttle, referenced in `scan-scheduler.ts`'s own doc comment) could
  make real behavior _more_ battery-efficient than this linear duty-cycle
  model assumes, by coalescing scans the OS itself decides to defer.
- **Device/chipset variation** — the 6.5 mA figure is one representative
  BLE SoC's datasheet number, not a survey of the actual radios inside
  every iOS/Android device this app targets.

## What real-device measurement would still need to confirm

A genuine measurement (per-device power profiling — Android's Battery
Historian / `dumpsys batterystats`, or Xcode's Energy Log instrument on
iOS) run against a real build with `DEFAULT_SCAN_SCHEDULE_CONFIG` active,
isolating the BLE-scanning component from the rest of the app's power
draw, is the concrete follow-up this document cannot substitute for — the
same category of gap already disclosed for BLE hardware verification
generally (`docs/spikes/0028-background-ble-feasibility.md`).

## Sources

- Nordic Semiconductor nRF52-series datasheets/product specifications
  (RX-mode current with DC/DC converter enabled, ~6.5 mA) — Nordic DevZone
  Q&A threads and nRF52840/nRF52805 product specifications.
- Android `ScanSettings` duty-cycle and power-band figures (`SCAN_MODE_LOW_POWER`
  ~1–3 mA at ~9% duty cycle, `SCAN_MODE_BALANCED` ~5–10 mA at 50% duty
  cycle) — third-party BLE power-optimization writeups summarizing
  Android's documented scan-mode behavior.
- `adapters/scheduler-timer/src/scan-scheduler.ts`'s
  `DEFAULT_SCAN_SCHEDULE_CONFIG` — this repository's actual shipped
  configuration, not a third-party figure.
