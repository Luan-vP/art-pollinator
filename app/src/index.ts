/**
 * `@art-pollinator/app` — use cases (SwapService, LibraryService).
 *
 * Depends on `core` only (AGENTS.md §2). `SwapService` (issue #19,
 * IMPLEMENTATION.md Phase 1a item 19) is the first real use-case class
 * here: it orchestrates negotiate → transfer → reconcile against `core`'s
 * ports and policies, driving the swap state machine (issue #16) and
 * plugging in item-scoped encounter memory (issue #20).
 */
export * from "./validate-lock-request.js";
export * from "./swap/swap-service.js";
export * from "./swap/swap-message-codec.js";
