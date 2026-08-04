/**
 * `@art-pollinator/core` — pure domain package.
 *
 * ZERO I/O. ZERO external dependencies. See AGENTS.md §2.
 *
 * Domain types, policies, and state machines land here through Phase 1a
 * (IMPLEMENTATION.md items 7-27). This entry point re-exports the fixed
 * domain constants scaffolded in Phase 0, plus the first Phase 1a slice:
 * the Priority model (#7), PriorityPolicy seam (#8), MetadataToken type
 * (#9), Slot/Library aggregate (#10, #11), and the driven port interfaces
 * (#17).
 */
export * from "./constants.js";
export * from "./priority/priority.js";
export * from "./policies/priority-policy.js";
export * from "./metadata/metadata-token.js";
export * from "./library/library.js";
export * from "./ports/index.js";
