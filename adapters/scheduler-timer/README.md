# `@art-pollinator/scheduler-timer`

Issue #35: a real scan-scheduling implementation, split into two pieces.

## `TimerSchedulerPort`

The real, production `SchedulerPort` (`core`'s port interface), backed by
actual `setTimeout`/`setInterval`. This is what a composition root
registers; `core`'s own `InMemorySchedulerPort` fake is for tests only and
never fires anything on its own.

## `ScanScheduler`

The actual duty-cycle/window/interval/backoff policy SPEC.md §6.1 and
AGENTS.md §6 ask for ("all scan frequencies configurable"). `SchedulerPort`
is only the generic scheduling primitive; `ScanScheduler` composes it (plus
`ClockPort`) into the scan-specific policy: run a scan **window** for
`windowMs`, then wait until `intervalMs` has elapsed since the window
started before running the next one (**duty cycle** = `windowMs /
intervalMs`), and **back off** the effective interval (multiplying by
`backoffMultiplier`, capped at `maxIntervalMs`) after
`emptyWindowsBeforeBackoff` consecutive windows report no peers found —
resetting back to baseline the moment a window does find one.

A composition root wires `ScanScheduler.start(onWindowStart, onWindowEnd)`
to `DiscoveryPort.startDiscovery`/`stopDiscovery` (or a BLE adapter's own
scan start/stop) — this package has no dependency on `DiscoveryPort`
itself, deliberately: the duty-cycle policy is generic scheduling, not
discovery-specific.

### Defaults and why

| Parameter                   | Default   | Rationale                                                                                                                                                                                                   |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `windowMs`                  | 4,000 ms  | Comfortably under Android's 30s unfiltered-scan auto-stop (`docs/spikes/0028-background-ble-feasibility.md`); short enough that a 2–10s foreground contact window (ADR-0010, issue #36) sees a full window. |
| `intervalMs`                | 8,000 ms  | A restart every 8s is ≈3.75 restarts/30s — safely under the "5 restarts per 30s" Android throttle the spike documents — while keeping a ~50% duty cycle rather than a token sliver.                         |
| `backoffMultiplier`         | 2         | Standard exponential doubling.                                                                                                                                                                              |
| `maxIntervalMs`             | 60,000 ms | Caps backoff at one attempt/minute once an area is genuinely quiet.                                                                                                                                         |
| `emptyWindowsBeforeBackoff` | 3         | ~24s of sustained silence before backing off — a single temporarily-out-of-range peer doesn't trigger it.                                                                                                   |

See `src/scan-scheduler.ts`'s doc comment for the full reasoning; see
`docs/spikes/0028-background-ble-feasibility.md` for the Android throttle
numbers these defaults are tuned against.

### What this package does NOT do

**It does not measure real battery cost.** This environment has no
physical device and no BLE radio (same constraint the BLE spike documents).
Issue #35 asks for "battery cost of default settings measured and
recorded" — that is a genuine gap, tracked against issue #61
(non-functional budgets), not fabricated here. Whoever picks up real-device
verification for #33/#34 should measure it against these exact defaults
first, since a wrong default is cheaper to change before it ships than
after.

## Testing approach

`TimerSchedulerPort`'s tests use real (short) timers — it genuinely is one.
`ScanScheduler`'s tests use a small hand-rolled `SchedulerPort` test double
(`ManualScheduler` in `scan-scheduler.test.ts`) rather than `core`'s
`InMemorySchedulerPort`; see that test file's header comment for why
(`InMemorySchedulerPort.fireAll()`'s live `Map` iteration re-enters when a
fired callback schedules a new task, which is exactly what
`ScanScheduler`'s self-rescheduling window chain does — this was caught
empirically as a "Map maximum size exceeded" crash before the test was
rewritten around `ManualScheduler`). This is a quirk of driving a
self-rescheduling chain through `fireAll()` specifically, not a bug in
`ScanScheduler` itself; noted here rather than filed as a `core` fix since
no other current caller of `InMemorySchedulerPort` reschedules from within
a firing callback.
