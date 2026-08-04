/**
 * SchedulerPort — schedule and cancel recurring or delayed work.
 *
 * Needed for scan duty cycles and similar background work (SPEC.md §6.1:
 * "All scan frequencies configurable — duty cycle, window, interval,
 * backoff"). `core` must not call `setInterval`/`setTimeout` directly (that
 * would be an ambient runtime dependency, same reasoning as `ClockPort` not
 * calling `Date.now()` — AGENTS.md §5) — anything needing recurring or
 * delayed work goes through this port instead. Full scheduling behaviour
 * (actual duty-cycle tuning) is issue #35, a later batch; this is the seam
 * it will be built behind.
 */

export interface SchedulerHandle {
  readonly id: string;
}

export interface SchedulerPort {
  /** Run `task` every `intervalMs`, starting after the first interval elapses. */
  scheduleRecurring(intervalMs: number, task: () => void): SchedulerHandle;

  /** Run `task` once, after `delayMs`. */
  scheduleDelayed(delayMs: number, task: () => void): SchedulerHandle;

  /** Cancel a previously-scheduled recurring or delayed task. A no-op if already cancelled or fired. */
  cancel(handle: SchedulerHandle): void;
}
