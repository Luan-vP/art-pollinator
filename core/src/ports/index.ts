/**
 * All driven port interfaces (IMPLEMENTATION.md Phase 1a item 17, plus
 * `SignatureVerifierPort` added by issue #58 — see that port's own doc
 * comment for why the domain grew a 9th port beyond the original eight).
 * Every interface here is owned by the domain and shaped by what `core`
 * needs, not by what any particular library exposes (AGENTS.md §2 rule 3).
 * The real adapters land in `adapters/*` (issue #57's `adapters/identity-node`
 * is the first); everything else here still only has in-memory fakes.
 */
export * from "./clock-port.js";
export * from "./transport-port.js";
export * from "./discovery-port.js";
export * from "./metadata-repository-port.js";
export * from "./blob-store-port.js";
export * from "./identity-port.js";
export * from "./encounter-log-port.js";
export * from "./scheduler-port.js";
export * from "./signature-verifier-port.js";
