/**
 * InMemorySecurityStatusPort — the in-memory fake for `SecurityStatusPort`
 * (issue #49/#50). Lets `AdminService` tests set an arbitrary snapshot
 * directly rather than standing up a real `HttpTransportServer`.
 */
import type { SecurityStatusPort, SecurityStatusSnapshot } from "../security-status-port.js";

const DEFAULT_SNAPSHOT: SecurityStatusSnapshot = {
  activeConnections: 0,
  authenticatedPeerCount: 0,
  rateLimitRejectionCount: 0,
  authFailureCount: 0,
  tlsEnabled: false,
};

export class InMemorySecurityStatusPort implements SecurityStatusPort {
  private snapshot: SecurityStatusSnapshot;

  constructor(initial: SecurityStatusSnapshot = DEFAULT_SNAPSHOT) {
    this.snapshot = initial;
  }

  getStatus(): SecurityStatusSnapshot {
    return this.snapshot;
  }

  /** Test/fake-only helper: replace the reported snapshot. */
  setStatus(snapshot: SecurityStatusSnapshot): void {
    this.snapshot = snapshot;
  }
}
