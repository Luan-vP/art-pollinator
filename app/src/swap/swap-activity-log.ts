/**
 * SwapActivityLog — a minimal observer for `SwapService` outcomes (issue
 * #38's swap screen: "shows incoming swap activity as it happens").
 *
 * ## Why this exists: `SwapService.swap()`'s return value alone isn't enough for a UI
 *
 * Before this batch, the only way to learn a swap happened was to be the
 * caller that `await`ed `SwapService.swap(...)` and inspect its returned
 * `SwapOutcome` directly. That's fine for a test, but not for a UI: swaps
 * on a real device are driven by whatever is running `DiscoveryPort` in the
 * background (a scan-scheduler task discovering a peer and triggering a
 * swap on its own), not by a button a screen's own code is awaiting. A
 * screen showing "incoming swap activity as it happens" needs to be
 * *notified*, not to be the one making the call — exactly the gap issue
 * #38 flags ("check whether there's any event/observer mechanism, add a
 * minimal one if not").
 *
 * ## Design: a tiny push-based log, not a general event-bus
 *
 * `SwapActivityLog` is deliberately small: `record` appends one entry and
 * notifies subscribers; `subscribe` registers a listener and returns an
 * unsubscribe function (the standard shape `clients/`'s React layer expects
 * — see `clients/mobile/src/composition/services-context.tsx`). There is
 * exactly one event kind (`SwapOutcome`, already `SwapService`'s own
 * return-value type — no new shape invented) and no filtering/routing;
 * anything richer belongs to a later, real UX pass (Phase 3), not this
 * minimal wiring.
 *
 * Stays pure — no I/O, no platform API — so it lives in `app/` alongside
 * `SwapService` itself (AGENTS.md §2 rule 2) and only ever *renders* inside
 * `clients/` (issue #38's own instruction: "staying pure in app/ and only
 * rendering in clients/").
 */
import type { SwapOutcome } from "./swap-service.js";

export type SwapActivityListener = (outcome: SwapOutcome) => void;

export class SwapActivityLog {
  private readonly entries: SwapOutcome[] = [];
  private readonly listeners = new Set<SwapActivityListener>();

  /** Every recorded outcome so far, oldest first. */
  history(): readonly SwapOutcome[] {
    return [...this.entries];
  }

  /** Record a new outcome and notify every current subscriber synchronously. */
  record(outcome: SwapOutcome): void {
    this.entries.push(outcome);
    for (const listener of this.listeners) {
      listener(outcome);
    }
  }

  /** Subscribe to future outcomes (not replayed past ones — call {@link history} first for those). Returns a function that unsubscribes. */
  subscribe(listener: SwapActivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
