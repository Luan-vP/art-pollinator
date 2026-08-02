# AGENTS.md

Working agreement for AI agents contributing to ArtPollinator.

Read this before your first commit. If something here conflicts with a task instruction, this file wins — raise the conflict in your PR description.

---

## 1. What this project is

ArtPollinator is an offline-first, place-based network for circulating curated art. Devices hold a deliberately small collection and exchange pieces when they meet — person to person over BLE, or with a stationary node on a local network.

**Scarcity is a feature.** Slot limits and eviction pressure are intentional design, not constraints to engineer around. If you find yourself proposing to raise a limit, cache more, or accumulate in the background, you have misread the intent.

See `SPEC.md` for the full design and `IMPLEMENTATION.md` for the ordered plan.

---

## 2. Architecture: hexagonal, strictly

The domain core is pure. Everything external enters through a port.

```
core/          Domain types, policies, state machines. ZERO I/O. ZERO dependencies.
app/           Use cases (SwapService, LibraryService). Depends on core only.
adapters/*     Implementations of ports. Depend on core. Never depended upon by core.
clients/*      Composition roots. Wire adapters to ports. Platform-specific.
```

### Non-negotiable rules

1. **`core` imports nothing external.** No HTTP client, no filesystem, no BLE library, no framework, no platform API. If you need one, you need a port.
2. **No platform conditionals in `core` or `app`.** No `if (Platform.OS === ...)`, no `typeof window !== 'undefined'`. Capability differences are resolved at the composition root by registering different adapters.
3. **Ports are owned by the domain.** The interface lives in `core` and is shaped by what the domain needs — not by what the library happens to expose.
4. **Every port ships with an in-memory fake.** The full swap flow must be runnable and testable with no network, device or filesystem.
5. **Every port ships with a contract test suite.** The fake and every real adapter must pass the identical suite. This is how BLE and HTTP transports stay interchangeable.

If a change requires bending one of these rules, that is a signal the design is wrong. Stop and write an ADR rather than adding an exception.

---

## 3. Autonomy and ADRs

**When you hit an undefined gap, decide, record an ADR, and carry on.** Do not stall waiting for input. No decision category is reserved for human sign-off.

ADRs live in `docs/adr/` using the template in that directory. One decision per ADR. Record the alternatives you rejected and why — the reasoning matters more than the verdict.

### Decisions that carry weight beyond code

Some decisions affect people who are not in the loop — artists whose work circulates, and users whose movements could be inferred. These are still yours to make under this agreement, but **flag them prominently in the PR description** rather than burying them:

- The licensing and consent model (how artists agree their work circulates, is copied, and is evicted)
- Anything determining whether placeholder or scraped content reaches a shipped build
- Anything affecting identity persistence, provenance granularity, or what can be inferred about a user's movements

A green test suite does not indicate these were decided well. Say so plainly when you touch them.

### Placeholder content — hard boundary

Scraped third-party artwork is permitted **only** as a local development fixture. It must never reach a public node, a shipped build, or any environment where it circulates to real users. This system exists to redistribute art; scraped work circulating is not a bug in a test, it is publication.

Gate it behind a dev flag. Treat the seed adapter as deletable.

---

## 4. Definition of done

A PR is done when:

- All tests pass
- All port contract suites are green
- The dependency-direction lint rule passes (`core` reaches nothing outward)
- All three client targets build: iOS, Android, web

No coverage threshold. No mandatory human review.

**Write the contract test suite before the adapter.** An adapter without one cannot be verified interchangeable, which defeats the architecture.

---

## 5. Conventions

**Language:** TypeScript, strict mode, everywhere — client and node server share the `core` package.

**Cross-platform:** The client targets iOS, Android **and browser** from one React Native codebase.

> ⚠️ The browser cannot do BLE. Web Bluetooth is Central-role only — a browser can never advertise — so mutual peer gossip is architecturally impossible there, regardless of vendor support. The browser build registers **no BLE adapter** and acquires content only via Wi-Fi node swaps. This is a capability tier, not a bug to fix.

**Native-only imports must never reach the shared path.** `react-native-ble-plx` has no web implementation. CI fails the build if it leaks into the web bundle. The node server build has the same constraint.

**Testing:** `core` tests are pure and fast — no network, filesystem or device. Adapter tests may use real I/O and live in a separate suite.

**Commits:** Conventional commits. One logical change per PR. Reference the issue number.

**Naming:** Ports end in `Port` (`TransportPort`). Policies end in `Policy` (`EvictionPolicy`). Adapters name their technology (`BleTransportAdapter`, `SqliteMetadataRepository`).

---

## 6. Fixed parameters — do not change without an ADR

| Parameter | Value |
| --- | --- |
| Total slots | 10 |
| Lockable slots (never evicted) | up to 5 |
| Swappable slots | 5 |
| Metadata token size budget | under ~5 KB |
| Token contents | text + blob pointer only — **no embedded image** |
| Thumbnails | deferred blobs, fetched over Wi-Fi |
| Blob addressing | **always by content hash** |
| Blob storage (Phase 1) | local filesystem only |
| Scan frequencies | all configurable — duty cycle, window, interval, backoff |
| Blob fetching | Wi-Fi only; never over BLE; not on metered connections by default |
| Licence | MIT |

**Locked items are never evicted and never offered.** This invariant must hold on every path — the aggregate, `OfferPolicy`, and `EvictionPolicy` each enforce it independently. Do not rely on a single chokepoint.

---

## 7. Traps specific to this codebase

- **`AcceptPolicy` is a security control.** One-way seeding is permitted, which means a hostile node can push without receiving. Accept-side filtering and rate limiting are the primary defence against flooding. Do not treat accept logic as a convenience filter.
- **Encounter memory is item-scoped, not peer-scoped.** People use rotating ephemeral IDs, so "I already declined this person" is unrepresentable. Remember pieces by content hash instead.
- **Provenance can leak location history.** Nodes have persistent identities. A token recording its hop path is a record of which venues its holder visited, readable by whoever receives it next. Prefer hop count over identified paths unless an ADR says otherwise.
- **Blob pointers must be resolvable-anywhere.** Phase 1 resolves locally, but a pointer type that assumes filesystem paths will need rewriting when buckets arrive. Design for both now.
- **Dedupe by content hash.** Duplicates must not consume slots.
