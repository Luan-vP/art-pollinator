/**
 * DiscoveryPort — find nearby peers/nodes before a swap can begin.
 *
 * SPEC.md §6.1: BLE discovery is mutual advertise-and-scan between peers;
 * Wi-Fi discovery is probing a known port on joining a network. This
 * interface is deliberately shaped around the one thing both have in
 * common — "peers become discoverable over time, tell me about each one" —
 * not around either mechanism specifically (AGENTS.md §2 rule 3).
 */

import type { PeerAddress } from "./transport-port.js";

/**
 * SPEC.md §6.3 / §7: nodes have persistent identities, people use rotating
 * ephemeral ones. `OfferPolicy` (issue #12) reads this bare discriminator to
 * decide behaviour — no fuller peer context is passed (SPEC.md §6.3), partly
 * *because* richer peer context (e.g. a stable per-person identifier) is
 * exactly what would erode the rotating-identity privacy property for
 * people.
 */
export type PeerKind = "node" | "person";

export interface DiscoveredPeer {
  readonly address: PeerAddress;
  readonly kind: PeerKind;
}

export interface DiscoveryPort {
  /**
   * Begin discovering nearby peers/nodes. `onPeerFound` is invoked once per
   * newly-discovered peer; scan cadence (duty cycle, window, interval,
   * backoff — SPEC.md §6.1) is entirely the adapter's concern and
   * configured through `SchedulerPort`, not through this interface.
   */
  startDiscovery(onPeerFound: (peer: DiscoveredPeer) => void): Promise<void>;

  /** Stop discovering. Idempotent if discovery is already stopped. */
  stopDiscovery(): Promise<void>;
}
