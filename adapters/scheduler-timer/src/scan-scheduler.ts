/**
 * ScanScheduler — the actual scan duty-cycle policy issue #35 asks for:
 * "All scan frequencies configurable — duty cycle, window, interval,
 * backoff" (SPEC.md §6.1, AGENTS.md §6). `SchedulerPort` (`core`) is only
 * the generic "run this later / run this repeatedly" primitive; this class
 * is the scan-specific policy layered on top, composing `SchedulerPort` +
 * `ClockPort` rather than calling `setTimeout` itself, so it works
 * identically against the real `TimerSchedulerPort` in this package and
 * against `core`'s in-memory fakes in tests (this file's own tests use the
 * fakes exclusively — see this file's test for why).
 *
 * ## What "duty cycle, window, interval, backoff" mean here
 *
 * - **Window**: how long each scan burst runs once started (`onWindowStart`
 *   fires, then `onWindowEnd` fires `windowMs` later).
 * - **Interval**: the time from the *start* of one window to the *start* of
 *   the next, while at baseline (no backoff yet in effect).
 * - **Duty cycle**: `windowMs / intervalMs` — the fraction of time actually
 *   spent scanning; this is a derived ratio of the two configured numbers,
 *   not a separate field.
 * - **Backoff**: after `emptyWindowsBeforeBackoff` consecutive windows in
 *   which the caller reports no peers found (via
 *   {@link ScanScheduler.reportPeersFoundThisWindow}), the effective
 *   interval multiplies by `backoffMultiplier`, capped at `maxIntervalMs`.
 *   A window that *does* find a peer resets the interval back to baseline
 *   and clears the empty-window count — backing off only while nothing is
 *   happening, and recovering promptly once something is.
 *
 * ## Where the defaults come from
 *
 * `docs/spikes/0028-background-ble-feasibility.md`'s Android findings are
 * the concrete inputs ADR-0010 already flagged as feeding #35's defaults:
 * starting/stopping a scan more than 5 times in a 30s window triggers
 * silent OS throttling, and an unfiltered scan running longer than 30s
 * without a `ScanFilter` is silently stopped. {@link DEFAULT_SCAN_SCHEDULE_CONFIG}
 * is chosen so that, at baseline, restarts happen well under that 5-per-30s
 * ceiling and each window stays comfortably under the 30s unfiltered-scan
 * limit — see the inline comments on the constant itself for the exact
 * arithmetic.
 *
 * ## What is NOT measured here
 *
 * Issue #35 also asks for "battery cost of default settings measured and
 * recorded." This environment has no physical device and no BLE radio (see
 * `docs/spikes/0028-background-ble-feasibility.md`'s own method section) —
 * there is no honest way to produce a real battery-drain number here, and
 * this file does not fabricate one. `docs/battery-cost-estimate.md`
 * (issue #61) computes a theoretical, duty-cycle-weighted estimate from
 * this file's own `DEFAULT_SCAN_SCHEDULE_CONFIG` and published BLE
 * power-consumption figures — clearly labeled as an estimate, not a
 * measurement. Real-device measurement remains the actual follow-up, the
 * same gap this codebase already discloses for BLE hardware verification
 * generally.
 */
import type { ClockPort, SchedulerHandle, SchedulerPort } from "@art-pollinator/core";

export interface ScanScheduleConfig {
  /** How long each scan burst runs, in ms. */
  readonly windowMs: number;
  /** Time from the start of one scan window to the start of the next, at baseline (before any backoff), in ms. Must be >= `windowMs`. */
  readonly intervalMs: number;
  /** Multiplier applied to the effective interval after `emptyWindowsBeforeBackoff` consecutive empty windows. */
  readonly backoffMultiplier: number;
  /** Upper bound the effective (backed-off) interval will never exceed, in ms. */
  readonly maxIntervalMs: number;
  /** How many consecutive windows with no peers found before backoff kicks in. */
  readonly emptyWindowsBeforeBackoff: number;
}

/**
 * Sane, documented defaults (issue #35's "default values chosen and
 * documented with rationale").
 *
 * - `windowMs: 4_000` — comfortably under Android's 30s unfiltered-scan
 *   auto-stop, and short enough that a foreground 2–10s contact window
 *   (ADR-0010, issue #36) sees at least one full window reliably.
 * - `intervalMs: 8_000` — a full window-start-to-window-start cycle every
 *   8s means at most `30 / 8 ≈ 3.75` restarts per 30s at baseline, safely
 *   under the "5 restarts per 30s" throttle threshold the BLE spike
 *   documents, while still giving a ~50% scanning duty cycle
 *   (`4_000 / 8_000`) rather than a token sliver of one.
 * - `backoffMultiplier: 2`, `maxIntervalMs: 60_000` — a standard doubling
 *   backoff capped at one scan attempt per minute once an area has
 *   genuinely gone quiet, trading discovery latency for battery only after
 *   sustained silence, not after a single empty window.
 * - `emptyWindowsBeforeBackoff: 3` — roughly 24s of sustained silence
 *   (3 × 8s baseline interval) before backing off, so a single
 *   temporarily-out-of-range peer doesn't trigger backoff prematurely.
 */
export const DEFAULT_SCAN_SCHEDULE_CONFIG: ScanScheduleConfig = {
  windowMs: 4_000,
  intervalMs: 8_000,
  backoffMultiplier: 2,
  maxIntervalMs: 60_000,
  emptyWindowsBeforeBackoff: 3,
};

export interface ScanSchedulerDeps {
  readonly scheduler: SchedulerPort;
  readonly clock: ClockPort;
  readonly config?: Partial<ScanScheduleConfig>;
}

export class ScanScheduler {
  private readonly scheduler: SchedulerPort;
  // Accepted as an explicit dependency (not read yet) so a future
  // real-device battery-cost investigation can timestamp windows without
  // changing this class's constructor shape — see this file's doc comment,
  // "What is NOT measured here."
  private readonly clock: ClockPort;
  private readonly config: ScanScheduleConfig;

  private effectiveIntervalMs: number;
  private consecutiveEmptyWindows = 0;
  private foundThisWindow = false;
  private running = false;
  private nextWindowHandle: SchedulerHandle | undefined;
  private windowEndHandle: SchedulerHandle | undefined;
  private onWindowStart: (() => void) | undefined;
  private onWindowEnd: (() => void) | undefined;

  constructor(deps: ScanSchedulerDeps) {
    this.scheduler = deps.scheduler;
    this.clock = deps.clock;
    this.config = { ...DEFAULT_SCAN_SCHEDULE_CONFIG, ...deps.config };
    if (this.config.windowMs > this.config.intervalMs) {
      throw new Error(
        `ScanScheduler: windowMs (${String(this.config.windowMs)}) must not exceed intervalMs (${String(this.config.intervalMs)})`,
      );
    }
    this.effectiveIntervalMs = this.config.intervalMs;
  }

  /** Begin duty-cycled scanning: the first window starts immediately. */
  start(onWindowStart: () => void, onWindowEnd: () => void): void {
    if (this.running) return;
    this.running = true;
    this.onWindowStart = onWindowStart;
    this.onWindowEnd = onWindowEnd;
    this.runWindow();
  }

  /** Stop duty-cycled scanning. Cancels any pending window. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.nextWindowHandle) this.scheduler.cancel(this.nextWindowHandle);
    if (this.windowEndHandle) this.scheduler.cancel(this.windowEndHandle);
    this.nextWindowHandle = undefined;
    this.windowEndHandle = undefined;
  }

  /** The caller reports whether >=1 peer was found during the window currently in progress (or just ended). Call any number of times per window; a single `true` call is enough to count the window as non-empty. */
  reportPeersFoundThisWindow(foundAtLeastOne: boolean): void {
    if (foundAtLeastOne) this.foundThisWindow = true;
  }

  /** The effective interval currently in force (baseline, or backed off). Exposed for tests/observability. */
  get currentIntervalMs(): number {
    return this.effectiveIntervalMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private runWindow(): void {
    this.foundThisWindow = false;
    this.onWindowStart?.();
    const handle = this.scheduler.scheduleDelayed(this.config.windowMs, () => {
      // Defensive self-cancel: `scheduleDelayed`'s contract is one-shot, but
      // not every `SchedulerPort` implementation necessarily forbids firing
      // an already-fired handle again (e.g. a fake driven by explicit
      // `fireAll()` calls across several test steps) — cancelling here
      // makes this class's own behaviour one-shot regardless of the
      // scheduler underneath.
      this.scheduler.cancel(handle);
      this.finishWindow();
    });
    this.windowEndHandle = handle;
  }

  private finishWindow(): void {
    this.onWindowEnd?.();
    if (this.foundThisWindow) {
      this.consecutiveEmptyWindows = 0;
      this.effectiveIntervalMs = this.config.intervalMs;
    } else {
      this.consecutiveEmptyWindows += 1;
      if (this.consecutiveEmptyWindows >= this.config.emptyWindowsBeforeBackoff) {
        this.effectiveIntervalMs = Math.min(
          this.effectiveIntervalMs * this.config.backoffMultiplier,
          this.config.maxIntervalMs,
        );
      }
    }
    if (!this.running) return;
    const offPeriodMs = this.effectiveIntervalMs - this.config.windowMs;
    const handle = this.scheduler.scheduleDelayed(Math.max(offPeriodMs, 0), () => {
      this.scheduler.cancel(handle); // see runWindow()'s matching comment
      if (this.running) this.runWindow();
    });
    this.nextWindowHandle = handle;
  }
}
