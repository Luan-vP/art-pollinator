import { describe, expect, it } from "vitest";
import { InMemorySchedulerPort } from "./in-memory-scheduler-port.js";

describe("InMemorySchedulerPort", () => {
  it("does not run a delayed task until explicitly fired", () => {
    const scheduler = new InMemorySchedulerPort();
    let ran = false;
    scheduler.scheduleDelayed(1_000, () => {
      ran = true;
    });
    expect(ran).toBe(false);
  });

  it("fire(handle) runs a delayed task's callback exactly once", () => {
    const scheduler = new InMemorySchedulerPort();
    let count = 0;
    const handle = scheduler.scheduleDelayed(1_000, () => {
      count += 1;
    });
    scheduler.fire(handle);
    expect(count).toBe(1);
  });

  it("fire(handle) can run a recurring task's callback repeatedly", () => {
    const scheduler = new InMemorySchedulerPort();
    let count = 0;
    const handle = scheduler.scheduleRecurring(500, () => {
      count += 1;
    });
    scheduler.fire(handle);
    scheduler.fire(handle);
    scheduler.fire(handle);
    expect(count).toBe(3);
  });

  it("cancel prevents a task from firing again", () => {
    const scheduler = new InMemorySchedulerPort();
    let count = 0;
    const handle = scheduler.scheduleDelayed(1_000, () => {
      count += 1;
    });
    scheduler.cancel(handle);
    scheduler.fire(handle);
    expect(count).toBe(0);
    expect(scheduler.isScheduled(handle)).toBe(false);
  });

  it("cancel is a no-op for an unknown handle", () => {
    const scheduler = new InMemorySchedulerPort();
    expect(() => {
      scheduler.cancel({ id: "does-not-exist" });
    }).not.toThrow();
  });

  it("fireAll runs every non-cancelled scheduled task exactly once", () => {
    const scheduler = new InMemorySchedulerPort();
    const fired: string[] = [];
    scheduler.scheduleDelayed(100, () => fired.push("delayed"));
    scheduler.scheduleRecurring(200, () => fired.push("recurring"));
    const cancelledHandle = scheduler.scheduleDelayed(300, () => fired.push("should-not-fire"));
    scheduler.cancel(cancelledHandle);

    scheduler.fireAll();

    expect(fired.sort()).toEqual(["delayed", "recurring"]);
  });

  it("isScheduled is true immediately after scheduling and false after cancel", () => {
    const scheduler = new InMemorySchedulerPort();
    const handle = scheduler.scheduleRecurring(1_000, () => {
      /* no-op */
    });
    expect(scheduler.isScheduled(handle)).toBe(true);
    scheduler.cancel(handle);
    expect(scheduler.isScheduled(handle)).toBe(false);
  });
});
