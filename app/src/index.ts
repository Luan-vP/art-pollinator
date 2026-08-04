/**
 * `@art-pollinator/app` — use cases (SwapService, LibraryService).
 *
 * Depends on `core` only (AGENTS.md §2). `SwapService` (issue #19,
 * IMPLEMENTATION.md Phase 1a item 19) is the first real use-case class
 * here: it orchestrates negotiate → transfer → reconcile against `core`'s
 * ports and policies, driving the swap state machine (issue #16) and
 * plugging in item-scoped encounter memory (issue #20). It now speaks
 * `core`'s real versioned swap protocol (issue #22/#24) and wires in
 * signature verification (issue #58) and provenance hop-count increment
 * (issue #21) — see `./swap/swap-service.ts`'s doc comment.
 * `signMetadataToken` (issue #58) is the async counterpart to `core`'s pure
 * `verifyMetadataTokenSignature`, living here because producing a
 * signature requires awaiting an `IdentityPort` (issue #57).
 */
export * from "./validate-lock-request.js";
export * from "./swap/swap-service.js";
export * from "./identity/sign-metadata-token.js";
