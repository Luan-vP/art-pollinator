/**
 * TimerSchedulerPort — the real, production `SchedulerPort` implementation
 * (issue #35), backed by actual `setTimeout`/`setInterval`. `core`'s own
 * `InMemorySchedulerPort` (`core/src/ports/fakes/`) exists purely for
 * deterministic tests and never fires anything on its own (see that file's
 * header comment) — this is its real counterpart, meant to be registered
 * in a composition root.
 */
import type { SchedulerHandle, SchedulerPort } from "@art-pollinator/core";

type TimerId = ReturnType<typeof setTimeout>;

export class TimerSchedulerPort implements SchedulerPort {
  private readonly timersById = new Map<string, TimerId>();
  private nextId = 0;

  private newHandle(): SchedulerHandle {
    this.nextId += 1;
    return { id: `timer-${String(this.nextId)}` };
  }

  scheduleRecurring(intervalMs: number, task: () => void): SchedulerHandle {
    const handle = this.newHandle();
    const timer = setInterval(task, intervalMs);
    this.timersById.set(handle.id, timer);
    return handle;
  }

  scheduleDelayed(delayMs: number, task: () => void): SchedulerHandle {
    const handle = this.newHandle();
    const timer = setTimeout(() => {
      this.timersById.delete(handle.id);
      task();
    }, delayMs);
    this.timersById.set(handle.id, timer);
    return handle;
  }

  cancel(handle: SchedulerHandle): void {
    const timer = this.timersById.get(handle.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timersById.delete(handle.id);
    }
  }

  /** Test/shutdown control: cancel every still-pending timer this instance holds. */
  cancelAll(): void {
    for (const timer of this.timersById.values()) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timersById.clear();
  }
}
