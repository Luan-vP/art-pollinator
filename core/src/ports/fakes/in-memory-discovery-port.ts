/**
 * InMemoryDiscoveryPort — a `DiscoveryPort` fake with no real BLE/Wi-Fi
 * scanning underneath. A test drives "a peer was found" explicitly via
 * {@link simulateDiscovered} rather than this fake scanning for anything
 * (issue #18, IMPLEMENTATION.md Phase 1a item 18).
 */
import type { DiscoveredPeer, DiscoveryPort } from "../discovery-port.js";

export class InMemoryDiscoveryPort implements DiscoveryPort {
  private onPeerFound: ((peer: DiscoveredPeer) => void) | undefined;
  private discovering = false;

  startDiscovery(onPeerFound: (peer: DiscoveredPeer) => void): Promise<void> {
    this.onPeerFound = onPeerFound;
    this.discovering = true;
    return Promise.resolve();
  }

  stopDiscovery(): Promise<void> {
    this.discovering = false;
    this.onPeerFound = undefined;
    return Promise.resolve();
  }

  /** Test control: simulate discovering a peer. No-op if discovery isn't currently active — matches a real adapter delivering nothing once stopped. */
  simulateDiscovered(peer: DiscoveredPeer): void {
    if (this.discovering && this.onPeerFound) {
      this.onPeerFound(peer);
    }
  }

  /** Test control: whether `startDiscovery` has been called without a matching `stopDiscovery`. */
  get isDiscovering(): boolean {
    return this.discovering;
  }
}
