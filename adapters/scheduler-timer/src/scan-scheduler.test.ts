/**
 * `ScanScheduler` tests — deterministic, driven by a tiny hand-rolled
 * `SchedulerPort` test double rather than `core`'s `InMemorySchedulerPort`.
 *
 * Why not `InMemorySchedulerPort` + `fireAll()`: `ScanScheduler` schedules a
 * *new* delayed task from *within* the callback of the one just fired
 * (window end -> schedules the next window; next window -> schedules its
 * own window end). `InMemorySchedulerPort.fireAll()` iterates its task map
 * with a live `for...of` over `Map.values()` — a JS `Map` iterator visits
 * entries inserted during iteration, so a single `fireAll()` call ends up
 * re-entrantly firing the newly-scheduled task too, cascading into an
 * effectively infinite loop (confirmed empirically: this crashed with
 * "Map maximum size exceeded" before this file was rewritten). That's a
 * property of `fireAll()` driving a self-rescheduling chain, not a
 * `ScanScheduler` bug — this suite instead uses `ManualScheduler` below,
 * which holds at most one pending callback (matching how `ScanScheduler`
 * actually uses `SchedulerPort` — it never has more than one delayed call
 * outstanding at a time) and fires it explicitly and singly per test step.
 */
import { describe, expect, it } from "vitest";
import type { SchedulerHandle, SchedulerPort } from "@art-pollinator/core";
import { DEFAULT_SCAN_SCHEDULE_CONFIG, ScanScheduler } from "./scan-scheduler.js";

/** A `SchedulerPort` test double holding at most one pending delayed callback, fired explicitly and only once per `fireNext()` call — no live-iteration re-entrancy hazard. */
class ManualScheduler implements SchedulerPort {
  private pending: { readonly id: string; readonly task: () => void } | undefined;
  private nextId = 0;

  scheduleRecurring(): SchedulerHandle {
    throw new Error("ManualScheduler: scheduleRecurring is not used by ScanScheduler");
  }

  scheduleDelayed(_delayMs: number, task: () => void): SchedulerHandle {
    this.nextId += 1;
    const handle = { id: `manual-${String(this.nextId)}` };
    this.pending = { id: handle.id, task };
    return handle;
  }

  cancel(handle: SchedulerHandle): void {
    if (this.pending?.id === handle.id) {
      this.pending = undefined;
    }
  }

  /** Fire the single currently-pending delayed callback, if any. Clears it before invoking, so a callback that schedules a new one leaves that new one (and only that one) pending afterwards. */
  fireNext(): void {
    const next = this.pending;
    this.pending = undefined;
    next?.task();
  }

  get hasPending(): boolean {
    return this.pending !== undefined;
  }
}

const clock = { now: () => 0 };

describe("ScanScheduler", () => {
  it("starts the first window immediately on start()", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({ scheduler, clock });
    let starts = 0;
    s.start(
      () => {
        starts += 1;
      },
      () => undefined,
    );
    expect(starts).toBe(1);
  });

  it("ends the window after windowMs and schedules the next window after intervalMs total", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({
      scheduler,
      clock,
      config: { windowMs: 100, intervalMs: 200 },
    });
    const events: string[] = [];
    s.start(
      () => events.push("start"),
      () => events.push("end"),
    );
    expect(events).toEqual(["start"]);

    scheduler.fireNext(); // fires the "window end" delayed task
    expect(events).toEqual(["start", "end"]);

    scheduler.fireNext(); // fires the "next window" delayed task
    expect(events).toEqual(["start", "end", "start"]);
  });

  it("stop() prevents any further windows from starting", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({
      scheduler,
      clock,
      config: { windowMs: 100, intervalMs: 200 },
    });
    const events: string[] = [];
    s.start(
      () => events.push("start"),
      () => events.push("end"),
    );
    s.stop();
    expect(scheduler.hasPending).toBe(false); // stop() cancelled the pending window-end
    scheduler.fireNext(); // no-op: nothing pending
    expect(events).toEqual(["start"]);
  });

  it("backs off the effective interval after emptyWindowsBeforeBackoff consecutive empty windows", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({
      scheduler,
      clock,
      config: {
        windowMs: 100,
        intervalMs: 200,
        backoffMultiplier: 2,
        maxIntervalMs: 1_000,
        emptyWindowsBeforeBackoff: 2,
      },
    });
    s.start(
      () => undefined,
      () => undefined,
    );
    expect(s.currentIntervalMs).toBe(200);

    // Window 1: empty (no reportPeersFoundThisWindow call).
    scheduler.fireNext(); // window 1 ends
    expect(s.currentIntervalMs).toBe(200); // only 1 empty window so far
    scheduler.fireNext(); // window 2 starts

    // Window 2: empty too -> 2 consecutive empty windows, backoff triggers.
    scheduler.fireNext(); // window 2 ends
    expect(s.currentIntervalMs).toBe(400); // 200 * 2
  });

  it("caps backoff at maxIntervalMs", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({
      scheduler,
      clock,
      config: {
        windowMs: 10,
        intervalMs: 20,
        backoffMultiplier: 10,
        maxIntervalMs: 50,
        emptyWindowsBeforeBackoff: 1,
      },
    });
    s.start(
      () => undefined,
      () => undefined,
    );
    // Repeatedly end+start windows, all empty, letting backoff run past the cap.
    for (let i = 0; i < 5; i++) {
      scheduler.fireNext(); // end
      scheduler.fireNext(); // next start
    }
    expect(s.currentIntervalMs).toBe(50);
  });

  it("a window that finds a peer resets backoff back to the baseline interval", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({
      scheduler,
      clock,
      config: {
        windowMs: 10,
        intervalMs: 20,
        backoffMultiplier: 2,
        maxIntervalMs: 1_000,
        emptyWindowsBeforeBackoff: 1,
      },
    });
    s.start(
      () => undefined,
      () => undefined,
    );
    scheduler.fireNext(); // window 1 ends empty -> backs off to 40
    expect(s.currentIntervalMs).toBe(40);
    scheduler.fireNext(); // window 2 starts

    s.reportPeersFoundThisWindow(true);
    scheduler.fireNext(); // window 2 ends, found a peer -> resets to baseline
    expect(s.currentIntervalMs).toBe(20);
  });

  it("rejects a config where windowMs exceeds intervalMs", () => {
    const scheduler = new ManualScheduler();
    expect(
      () =>
        new ScanScheduler({
          scheduler,
          clock,
          config: { windowMs: 500, intervalMs: 100 },
        }),
    ).toThrow();
  });

  it("default config keeps baseline restarts comfortably under the Android 5-per-30s throttle", () => {
    const restartsPerWindow = 30_000 / DEFAULT_SCAN_SCHEDULE_CONFIG.intervalMs;
    expect(restartsPerWindow).toBeLessThan(5);
  });

  it("default config keeps each window comfortably under Android's 30s unfiltered-scan auto-stop", () => {
    expect(DEFAULT_SCAN_SCHEDULE_CONFIG.windowMs).toBeLessThan(30_000);
  });

  it("start() is idempotent — calling it again while already running does not restart the window", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({ scheduler, clock, config: { windowMs: 10, intervalMs: 20 } });
    let starts = 0;
    const onStart = (): void => {
      starts += 1;
    };
    s.start(onStart, () => undefined);
    s.start(onStart, () => undefined);
    expect(starts).toBe(1);
  });

  it("stop() is idempotent and safe to call before start()", () => {
    const scheduler = new ManualScheduler();
    const s = new ScanScheduler({ scheduler, clock });
    expect(() => {
      s.stop();
    }).not.toThrow();
    s.start(
      () => undefined,
      () => undefined,
    );
    s.stop();
    expect(() => {
      s.stop();
    }).not.toThrow();
  });
});
