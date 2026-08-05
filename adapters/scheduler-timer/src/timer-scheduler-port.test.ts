/**
 * Real-timer tests for `TimerSchedulerPort` — genuinely uses
 * `setTimeout`/`setInterval` under the hood (issue #35's "REAL (non-fake)
 * implementation" requirement), so these tests wait on real, short elapsed
 * time rather than driving a fake clock.
 */
import { describe, expect, it } from "vitest";
import { TimerSchedulerPort } from "./timer-scheduler-port.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("TimerSchedulerPort", () => {
  it("scheduleDelayed runs the task once, after the delay, not before", async () => {
    const scheduler = new TimerSchedulerPort();
    let ran = false;
    scheduler.scheduleDelayed(30, () => {
      ran = true;
    });
    await wait(10);
    expect(ran).toBe(false);
    await wait(40);
    expect(ran).toBe(true);
  });

  it("scheduleRecurring runs the task repeatedly until cancelled", async () => {
    const scheduler = new TimerSchedulerPort();
    let count = 0;
    const handle = scheduler.scheduleRecurring(20, () => {
      count += 1;
    });
    await wait(70);
    scheduler.cancel(handle);
    const countAtCancel = count;
    expect(countAtCancel).toBeGreaterThanOrEqual(2);
    await wait(60);
    expect(count).toBe(countAtCancel); // no further firings after cancel
  });

  it("cancel is a no-op for an unknown or already-fired handle", async () => {
    const scheduler = new TimerSchedulerPort();
    const handle = scheduler.scheduleDelayed(10, () => undefined);
    await wait(30);
    expect(() => {
      scheduler.cancel(handle);
    }).not.toThrow();
    expect(() => {
      scheduler.cancel({ id: "never-existed" });
    }).not.toThrow();
  });

  it("cancelling a delayed task before it fires prevents it from ever running", async () => {
    const scheduler = new TimerSchedulerPort();
    let ran = false;
    const handle = scheduler.scheduleDelayed(20, () => {
      ran = true;
    });
    scheduler.cancel(handle);
    await wait(50);
    expect(ran).toBe(false);
  });

  it("cancelAll stops every pending timer this instance holds", async () => {
    const scheduler = new TimerSchedulerPort();
    let recurringCount = 0;
    let delayedRan = false;
    scheduler.scheduleRecurring(10, () => {
      recurringCount += 1;
    });
    scheduler.scheduleDelayed(15, () => {
      delayedRan = true;
    });
    scheduler.cancelAll();
    await wait(60);
    expect(recurringCount).toBe(0);
    expect(delayedRan).toBe(false);
  });
});
