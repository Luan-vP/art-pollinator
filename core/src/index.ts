/**
 * `@art-pollinator/core` — pure domain package.
 *
 * ZERO I/O. ZERO external dependencies. See AGENTS.md §2.
 *
 * Domain types, policies, and state machines land here through Phase 1a
 * (IMPLEMENTATION.md items 7-27). This entry point re-exports the fixed
 * domain constants scaffolded in Phase 0, the first Phase 1a slice (Priority
 * model #7, PriorityPolicy seam #8, MetadataToken type #9, Slot/Library
 * aggregate #10/#11, driven port interfaces #17), the policies/fakes batch
 * (OfferPolicy #12, AcceptPolicy #13, EvictionPolicy #14, the policy
 * contract suite #15, in-memory port fakes #18), the swap-flow batch (swap
 * state machine #16, item-scoped encounter memory #20), and this batch:
 * identity/signing (#57/#58, `SignatureVerifierPort` + fake), provenance hop
 * count (#21, `incrementHopCount`), the crypto primitives underneath
 * hashing and signing (`./crypto/*`, #23/#58 — see
 * `docs/adr/0008-crypto-primitives-in-a-zero-dependency-core.md`), and the
 * transport-agnostic swap protocol schema and codec (#22/#24, `./protocol/*`).
 * This batch (Phase 1b, #39/#40/#41): `BlobPointer` became a
 * resolvable-anywhere discriminated union (#39, `./metadata/metadata-token.js`),
 * the `BlobStorePort` contract suite (#40), and two new ports for the
 * deferred blob queue (#41) — `NetworkStatusPort` and
 * `BlobFetchQueueStorePort`, each with an in-memory fake.
 *
 * This batch (Phase 2, #49/#51/#52 — security model, moderation, and
 * observability): `./security/rate-limiter.js` (a pure sliding-window
 * limiter — the concrete teeth behind SPEC.md section 5's "AcceptPolicy is
 * a security control"), `./security/peer-auth.js` (challenge-response
 * verification, the domain half of connection-level authentication),
 * `./security/ingest-validation.js` (content validation on ingest, enforced
 * before anything reaches `AcceptPolicy`), `./security/revocation.js` and
 * `RevocationLogPort` (opportunistic moderation/takedown, issue #51 — see
 * that module's doc comment for the gossip design and authorization model),
 * `LoggerPort` (structured observability events, issue #52), and
 * `./library/library-capacity-bounds.js` (the shared bounds check behind
 * `AdminService`'s runtime capacity changes, issue #50).
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
export * from "./ports/metadata-repository-contract-suite.js";
export * from "./swap/swap-state-machine.js";
export * from "./encounter/encounter-memory.js";
export * from "./crypto/bytes.js";
export * from "./crypto/sha256.js";
export * from "./crypto/canonical-json.js";
export * from "./protocol/swap-message.js";
export * from "./protocol/swap-message-codec.js";
export * from "./ports/transport-port-contract-suite.js";
export * from "./ports/blob-store-contract-suite.js";
export * from "./security/rate-limiter.js";
export * from "./security/peer-auth.js";
export * from "./security/ingest-validation.js";
export * from "./security/revocation.js";
export * from "./library/library-capacity-bounds.js";
