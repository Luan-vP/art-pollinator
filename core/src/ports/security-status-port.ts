/**
 * SecurityStatusPort — a read-only view into the transport layer's current
 * connection/authentication/rate-limit state, for `AdminService` (issue #50)
 * to surface to a node operator.
 *
 * The actual state this reports (open sockets, authenticated peers, recent
 * rate-limit rejections) lives inside `HttpTransportServer`
 * (`adapters/transport-http`) — real I/O-adjacent, per-connection bookkeeping
 * that has no business inside `app`'s `AdminService` (AGENTS.md §2 rule 2).
 * This port is the seam: the node composition root wraps its own
 * `HttpTransportServer` instance to satisfy this interface, and hands that
 * wrapper to `AdminService` — the identical "domain owns the interface,
 * adapter supplies the implementation" shape every other driven port in
 * this codebase already uses.
 */
export interface SecurityStatusSnapshot {
  /** Number of currently open transport-level connections. */
  readonly activeConnections: number;
  /** Number of distinct peer identities currently holding a valid authenticated session (issue #49's handshake). */
  readonly authenticatedPeerCount: number;
  /** Number of swap-attempt rate-limit rejections observed since the process started. */
  readonly rateLimitRejectionCount: number;
  /** Number of failed authentication attempts observed since the process started. */
  readonly authFailureCount: number;
  /** `true` if the transport is currently listening with TLS enabled. */
  readonly tlsEnabled: boolean;
}

export interface SecurityStatusPort {
  getStatus(): SecurityStatusSnapshot;
}
