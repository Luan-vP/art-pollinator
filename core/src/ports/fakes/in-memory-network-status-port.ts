/**
 * InMemoryNetworkStatusPort — a `NetworkStatusPort` fake with a manually
 * controlled connection state. Defaults to `{ kind: "none", isMetered:
 * false }` — a fresh fake reports no connectivity until a test explicitly
 * sets one, so "no fetch happens" is the default assumption a test has to
 * deliberately override, not something it gets by accident (issue #41).
 */
import type { NetworkStatus, NetworkStatusPort } from "../network-status-port.js";

export class InMemoryNetworkStatusPort implements NetworkStatusPort {
  private status: NetworkStatus;

  constructor(initial: NetworkStatus = { kind: "none", isMetered: false }) {
    this.status = initial;
  }

  current(): Promise<NetworkStatus> {
    return Promise.resolve(this.status);
  }

  /** Test control: replace the reported connection state. */
  set(status: NetworkStatus): void {
    this.status = status;
  }
}
