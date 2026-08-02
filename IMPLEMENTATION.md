# ArtPollinator — Implementation Plan

**Version 0.2** · Companion to [`SPEC.md`](./SPEC.md) and [`AGENTS.md`](./AGENTS.md)

Work is ordered so each step is testable against the previous one. The domain core is fully exercised through in-memory fakes before any real transport, device or network exists.

---

## Critical path

Three items gate a disproportionate amount of the rest. Schedule them early regardless of which phase they sit in.

| Gate | Why it blocks | Do it by |
| --- | --- | --- |
| **Priority model** (#7) | All four policy seams read an ordering nothing defines | Start of Phase 1a |
| **Background BLE spike** (#28) | iOS peripheral-in-background is the largest technical risk | Before committing Phase 1b timelines |
| **Security model** (#49) | A node accepting arbitrary connections is the sharpest attack surface | Start of Phase 2, not the end |

> **Cleared:** content-addressing is resolved — blobs are always addressed by content hash, since deduplication requires it.

---

## Phase 0 — Foundation

1. **Monorepo workspace** — `core/` (zero deps), `app/`, `adapters/*`, `clients/*`. A dependency-direction lint rule must fail the build if `core` reaches outward.
2. **Toolchain baseline** — TypeScript strict, formatter, linter, pre-commit hooks.
3. **Test harness** — separate suites for `core` (pure) and adapters (integration). The core suite must need no network, filesystem or device.
4. **CI across all three targets** — lint, typecheck, both suites, plus iOS, Android and web builds on every PR.
5. **ADR process** — `docs/adr/` with a template. ADR-0001 hexagonal architecture; ADR-0002 React Native across three targets.
6. **Spec into the repo** — `SPEC.md`, `IMPLEMENTATION.md`, `AGENTS.md` as the implementer-facing source of truth.

---

## Phase 1a — Domain core

*Pure domain. No I/O, no device, no network. Everything below is testable in memory.*

7. **Priority model** — an explicit domain concept. Candidate signals: user ranking, recency, hop count, dwell time. **Blocker.**
8. **`PriorityPolicy` seam** — scoring is tunable, so it lives behind a strategy interface resolved at the composition root, not hardcoded in the Library aggregate.
9. **`MetadataToken` type** — text plus blob pointer, no embedded image. Validator enforces the sub-5 KB budget; property test asserts serialised size for realistic inputs.
10. **`Slot` / `Library` aggregate** — 10 slots: up to 5 lockable (never evictable) and 5 swappable. Locking a 6th item is rejected.
11. **Lock configuration** — deterministic reclassification when locks change; sane behaviour at 0 and 5 locked.
12. **`OfferPolicy`** + naive default (`offer all swappable`) — **never offers a locked item.** Receives a bare `PeerKind` discriminator.
13. **`AcceptPolicy`** + naive default (`accept what fits`).
14. **`EvictionPolicy`** + naive default (`lowest priority first`) — **never evicts a locked item.**
15. **Policy contract suite** — one reusable suite all four seams must pass.
16. **Swap state machine** — pure, exhaustively tested, illegal transitions rejected. **Must support asymmetric (one-way) flows.**
17. **All driven port interfaces** — `TransportPort`, `DiscoveryPort`, `MetadataRepositoryPort`, `BlobStorePort`, `IdentityPort`, `ClockPort`, `EncounterLogPort`, `SchedulerPort`.
18. **In-memory fakes for every port** — a full swap must run end to end with no external dependency.
19. **`SwapService`** — orchestrates discovery → negotiate → transfer → reconcile, depending only on ports.
20. **Encounter memory** — **item-scoped, keyed by content hash.** Not peer-scoped: people use rotating identities, so "I already declined this person" is unrepresentable. Re-encountering must not re-offer previously declined or evicted items within a configurable window.
21. **Provenance and lineage** — within the size budget. ⚠️ **Resolve granularity first:** identified hop paths plus persistent node IDs leak a user's venue history to whoever next receives the token. Prefer hop count.
22. **Swap protocol message schema** — transport-agnostic; identical over BLE and HTTP. Version field and negotiation.
23. **Content hashing and deduplication** — dedupe by hash; duplicates must never consume a slot.
24. **Wire format and codec** — canonical, versioned, lossless round-trip.
25. **SQLite repository adapter** — passes the port contract suite; state survives restart.
26. **Repository contract suite** — fake and SQLite pass identically.
27. **Schema migrations** — versioned, runs on startup, downgrade path documented.

---

## Phase 1b — Mobile client and BLE

**Exit criteria:** a cross-platform app that scans for peers over BLE, gossips metadata on contact, and defers blob fetching to Wi-Fi.

28. **SPIKE: background BLE feasibility** — iOS state restoration and the peripheral (advertising) role in background. Written findings and a go/no-go. **Blocker for #33–34.**
29. **React Native scaffold** — one codebase, three targets, all building in CI.
30. **Capability negotiation at composition root** — each target declares which adapters it registers. The browser registers **no BLE adapter**; `core` is unaware. No platform conditionals leak into `core`.
31. **RN Web compatibility gate in CI** — a native-only import (e.g. `react-native-ble-plx`) reaching the web bundle **fails the build.** Same constraint applies to the node server build.
32. **Capability-aware UI** — BLE affordances **absent, not disabled**, where unsupported.
33. **BLE transport adapter** — passes the same contract suite as HTTP.
34. **BLE discovery adapter** — mutual advertise plus scan; two devices discover each other within a short contact window.
35. **Scan scheduling (`SchedulerPort`)** — **all frequencies configurable**: duty cycle, window, interval, backoff. Battery cost of defaults measured and recorded.
36. **Short-contact swap profile** — metadata-only, tuned for a 2–10 second encounter.
37. **Client composition root** — uses the identical `core` package as the node server; no duplicated domain logic.
38. **Minimal library and swap screens** — deliberately unstyled. View slots, lock/unlock items, see incoming swaps. Real UX is Phase 3.
39. **Blob reference type** — ⚠️ must be **resolvable-anywhere**. Phase 1 resolves locally, but a pointer assuming filesystem paths will need rewriting when buckets arrive.
40. **Local filesystem blob adapter** — passes port contract tests; integrity verified on fetch by content hash.
41. **Deferred blob queue** — **Wi-Fi only, never over BLE, not on metered connections by default.** Survives restart, retries with backoff, never blocks a metadata swap.
42. **Placeholder seed adapter** — dev-only, deletable without touching `core`. ⚠️ **Scraped third-party artwork must never reach a public node or shipped build.** Gate behind a dev flag.
43. **HTTP transport adapter** *(pulled forward from Phase 2)*.
44. **LAN discovery adapter** *(pulled forward from Phase 2)* — without #43–44 the browser target has no acquisition path and is inert at Phase 1 exit.

---

## Phase 2 — Stationary node server

**Exit criteria:** a Linux- and macOS-friendly server listening on the local network, holding a larger collection, swapping with devices as they join.

45. **Node composition root** — runnable long-lived TypeScript/Node service on Linux and macOS. Shares `core`.
46. **Node capacity configuration** — larger than a phone, still bounded by design to preserve curation pressure.
47. **Interrupted-swap handling** — no partial or corrupt state after abrupt disconnect. Test simulates the drop.
48. **End-to-end test: client ↔ node** — two processes, real swap over HTTP, in CI.
49. **Security model and evaluation** — pairing and authentication, transport security, content validation on ingest, resource-exhaustion defence, explicit threat model. **Scheduled at the start of the phase, not the end.**
50. **Node operator experience** — install, seed, administer, moderate, behind an `AdminService` driving port.
51. **Moderation and takedown** — revocation propagating opportunistically; defined behaviour for offline devices holding revoked content.
52. **Observability** — structured logs for swap lifecycle events, health endpoint.

---

## Phase 3 — Authoring and curation UX

**Exit criteria:** users add their own art and manage their slots; placeholder content retired.

53. **Ingestion path** — an `IngestionService` driving port covering venue seeding and artist publishing.
54. **Rights and licensing model** — how artists consent that work circulates, is copied, is evicted. **Blocker; must precede any real content.** Not an engineering task — start the conversation early.
55. **Metadata authoring UX** — a user adds a piece end to end and it swaps successfully.
56. **Retire placeholder content** — seed adapter removed; no scraped work in any shipped build.

---

## Cross-cutting

*Can run in parallel from Phase 1a onward.*

57. **Identity: keypair generation and secure storage** — persistent for nodes, rotating ephemeral for people.
58. **Token signing and verification** — tampered tokens rejected; unsigned tokens rejected by policy.
59. **Anti-abuse and trust model** — ⚠️ **one-way seeding is permitted**, so a hostile node can push without receiving. Accept-side filtering and rate limiting are the primary defence against flooding.
60. **Metadata uniformity review** — uniform token size and shape to resist fingerprinting in circulation. Tension with #21 provenance.
61. **Non-functional budgets** — storage enforced in **bytes** alongside the slot cap; measured battery cost for default scan settings.

---

## Parallelisation notes

- Phase 0 → 1a → 1b is effectively sequential; the protocol is only real once the client runs.
- **Identity work (#57–58) should start during Phase 1a** — signing affects the wire format, and landing it after #24 means revising the codec.
- Phase 2's transport adapters have moved forward into 1b, so Phase 2 begins with the node runtime rather than transport.
- **Phase 3 is gated on the licensing decision (#54)**, not engineering readiness. That conversation takes longer than code.
