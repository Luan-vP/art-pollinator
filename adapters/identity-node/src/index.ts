/**
 * `@art-pollinator/identity-node` — the Node adapter for `IdentityPort`
 * (issue #57) and `SignatureVerifierPort` (issue #58).
 *
 * Depends on `core`, never depended on by it (AGENTS.md §2). Real I/O
 * (filesystem, Ed25519 via `node:crypto`) lives here, never in `core`.
 * Scoped to the Node server target (SPEC.md §9 Phase 2); a browser/React
 * Native identity adapter is future work in a separate package.
 */
export * from "./node-identity-adapter.js";
export * from "./node-signature-verifier.js";
