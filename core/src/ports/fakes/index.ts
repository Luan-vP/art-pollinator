/**
 * In-memory fakes for every driven port (issue #18, IMPLEMENTATION.md
 * Phase 1a item 18). See `docs/adr/0004-in-memory-port-fakes-live-in-core.md`
 * for why these live in `core` rather than a new `adapters/in-memory`
 * package: they have zero real I/O, so they don't violate `core`'s
 * zero-I/O rule merely by residing here.
 */
export * from "./in-memory-clock-port.js";
export * from "./in-memory-transport-port.js";
export * from "./in-memory-discovery-port.js";
export * from "./in-memory-metadata-repository-port.js";
export * from "./in-memory-blob-store-port.js";
export * from "./in-memory-identity-port.js";
export * from "./in-memory-encounter-log-port.js";
export * from "./in-memory-scheduler-port.js";
export * from "./in-memory-signature-verifier-port.js";
