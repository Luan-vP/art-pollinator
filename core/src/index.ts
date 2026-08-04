/**
 * `@art-pollinator/core` — pure domain package.
 *
 * ZERO I/O. ZERO external dependencies. See AGENTS.md §2.
 *
 * Domain types, policies, and state machines land here through Phase 1a
 * (IMPLEMENTATION.md items 7-27). This entry point re-exports the fixed
 * domain constants scaffolded in Phase 0, the first Phase 1a slice (Priority
 * model #7, PriorityPolicy seam #8, MetadataToken type #9, Slot/Library
 * aggregate #10/#11, driven port interfaces #17), and this batch's slice:
 * OfferPolicy (#12), AcceptPolicy (#13), EvictionPolicy (#14), the policy
 * contract suite (#15), and in-memory port fakes (#18).
 */
export * from "./constants.js";
export * from "./priority/priority.js";
export * from "./policies/priority-policy.js";
export * from "./policies/policy-types.js";
export * from "./policies/offer-policy.js";
export * from "./policies/accept-policy.js";
export * from "./policies/eviction-policy.js";
export * from "./policies/policy-contract-suite.js";
export * from "./metadata/metadata-token.js";
export * from "./library/library.js";
export * from "./ports/index.js";
export * from "./ports/fakes/index.js";
