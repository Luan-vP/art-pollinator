/**
 * `@art-pollinator/app` — use cases (SwapService, LibraryService).
 *
 * Depends on `core` only (AGENTS.md §2). Real use cases land in Phase 1a
 * (IMPLEMENTATION.md items 12-19: OfferPolicy, AcceptPolicy, EvictionPolicy,
 * SwapService). This module currently exists to prove the workspace wiring:
 * `app` can import `core`, and the dependency-direction lint rule (#1)
 * permits it.
 */
export * from "./validate-lock-request.js";
