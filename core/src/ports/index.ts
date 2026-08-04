/**
 * All driven port interfaces (IMPLEMENTATION.md Phase 1a item 17). Every
 * interface here is owned by the domain and shaped by what `core` needs,
 * not by what any particular library exposes (AGENTS.md §2 rule 3). None of
 * these are implemented yet — no BLE, no SQLite, no filesystem — that
 * begins with the in-memory fakes (issue #18) and real adapters in later
 * batches.
 */
export * from "./clock-port.js";
export * from "./transport-port.js";
export * from "./discovery-port.js";
export * from "./metadata-repository-port.js";
export * from "./blob-store-port.js";
export * from "./identity-port.js";
export * from "./encounter-log-port.js";
export * from "./scheduler-port.js";
