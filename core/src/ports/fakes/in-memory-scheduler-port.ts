/**
 * InMemorySchedulerPort — a `SchedulerPort` fake with no real timers.
 *
 * `core` must never call `setTimeout`/`setInterval` directly (AGENTS.md §5),
 * and a fake used in deterministic tests must not depend on real wall-clock
 * elapsed time either — a test that waited on a real timer would be slow
 * and flaky. Instead, this fake records scheduled work and only ever runs
 * it when a test explicitly asks it to, via {@link fireDelayed},
 * {@link fireRecurringOnce}, or {@link fireAll} (issue #18,
 * IMPLEMENTATION.md Phase 1a item 18).
 */
import type { SchedulerHandle, SchedulerPort } from "../scheduler-port.js";

interface ScheduledTask {
  readonly handle: SchedulerHandle;
  readonly kind: "recurring" | "delayed";
  readonly task: () => void;
  cancelled: boolean;
}

export class InMemorySchedulerPort implements SchedulerPort {
  private readonly tasksById = new Map<string, ScheduledTask>();
  private nextId = 0;

  private newHandle(): SchedulerHandle {
    this.nextId += 1;
    return { id: `scheduled-${String(this.nextId)}` };
  }

  scheduleRecurring(_intervalMs: number, task: () => void): SchedulerHandle {
    const handle = this.newHandle();
    this.tasksById.set(handle.id, { handle, kind: "recurring", task, cancelled: false });
    return handle;
  }

  scheduleDelayed(_delayMs: number, task: () => void): SchedulerHandle {
    const handle = this.newHandle();
    this.tasksById.set(handle.id, { handle, kind: "delayed", task, cancelled: false });
    return handle;
  }

  cancel(handle: SchedulerHandle): void {
    const entry = this.tasksById.get(handle.id);
    if (entry) {
      entry.cancelled = true;
    }
  }

  /** Test control: run a specific scheduled task's callback once now, if it hasn't been cancelled. No-op for an unknown or cancelled handle. */
  fire(handle: SchedulerHandle): void {
    const entry = this.tasksById.get(handle.id);
    if (entry && !entry.cancelled) {
      entry.task();
    }
  }

  /** Test control: run every currently-scheduled, non-cancelled task's callback exactly once. */
  fireAll(): void {
    for (const entry of this.tasksById.values()) {
      if (!entry.cancelled) {
        entry.task();
      }
    }
  }

  /** Test control: whether a handle is still scheduled and not cancelled. */
  isScheduled(handle: SchedulerHandle): boolean {
    const entry = this.tasksById.get(handle.id);
    return entry !== undefined && !entry.cancelled;
  }
}
