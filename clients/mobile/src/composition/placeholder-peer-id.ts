/**
 * A placeholder self-`PeerAddress` id for the HTTP/LAN adapters wired in
 * `composition-root.web.ts`/`composition-root.native.ts`.
 *
 * Real per-device identity (a stable node identity or a rotating
 * person identity, SPEC.md §6.3/§7) is `IdentityPort`'s job
 * (`adapters/identity-node`, issue #57) and is not threaded into this
 * composition root yet — that wiring is separate, later scope. This
 * generates a distinct-enough-for-one-process-lifetime string so
 * `HttpTransportClient`/`LanDiscoveryProber` have *something* non-empty to
 * identify this device by in the meantime, not a cryptographically
 * meaningful identity. Replace with a real `IdentityPort`-derived value
 * once that wiring lands; tracked as a disclosed gap, not hidden.
 */
export function placeholderSelfPeerId(): string {
  return `mobile-client-${Math.random().toString(36).slice(2)}`;
}
