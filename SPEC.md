# ArtPollinator — Development Spec

**Version 0.2** · Owner: Luan · Licence: MIT

> Companion documents: [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for the ordered build plan, [`AGENTS.md`](./AGENTS.md) for the contributor working agreement.

---

## TL;DR

ArtPollinator is an **offline-first, place-based social feed for curated art and culture** — artworks, links to talks, and similar resources. Instead of an infinite feed, you carry a **small, fixed set of slots** on your device. Because space is deliberately scarce, you have to **curate** what you keep rather than hoard.

You pick up and pass on content by **encountering others**. Passing someone in the street, your devices exchange pieces over Bluetooth. Visiting a venue that runs a **stationary node**, you swap with its larger collection over Wi-Fi. The art becomes a reason to physically show up.

What actually travels between devices is a tiny **metadata token** — a business card for a piece, text plus a pointer, no image — while the **heavy files** are fetched later over Wi-Fi. What you offer, accept, and evict is decided by **pluggable policy functions** that can be tuned over time. The client is **React Native**, running on iOS, Android and the browser from one codebase.

---

## 1. Concept

Content lives **latently on your device** under a **hard size limit** that forces regular curation. When your device meets a compatible peer — a person you pass, or a stationary node on a Wi-Fi network — a **swap** occurs: some of your content flows out, and you receive new content to view offline later.

The design ethos is **deliberate scarcity**. Limited space is a feature. It encourages curation rather than default accumulation.

The concept originates from **place-based community**: nodes live at venues, and scarce art is a reason to visit.

## 2. Design principles

- **Curation over accumulation.** Fixed slots and eviction pressure are intentional.
- **Offline-first.** Everything works with intermittent, opportunistic connectivity.
- **Pluggable behaviours.** Selection and eviction logic are injectable functions, tuned later.
- **Metadata / blob separation.** Small gossipable tokens travel freely; heavy blobs resolve over Wi-Fi.
- **No append-only log.** Unlike Secure Scuttlebutt, historicity is not preserved. State is a curated *set*, not an immutable history.

## 3. Core data model

### 3.1 Metadata token

A tiny, gossipable record that can be hot-swapped with someone passed in the street. It carries enough context to decide whether you want the full piece.

**Contents:** title, creator, description, provenance, content type, blob pointer, content hash, signature.

**Decision: text-plus-pointer only.** No embedded preview image. The thumbnail is a **deferred blob**, resolved later over a high-bandwidth link.

**Size budget: under ~5 KB**, ideally a few KB, so a token transfers in well under a second over BLE during a short contact window. For reference, 5 KB of plain text is roughly 5,000 characters; as structured JSON at ~40–60 bytes per labelled field, that is 80–100 fields — far more than needed.

Resist filling the budget. Tokens uniform in size and shape are harder to fingerprint as they circulate.

### 3.2 Blob

The heavy asset — image, video, audio. Stored **out of band** and resolved lazily when a high-bandwidth connection is available.

**Blobs are always addressed by content hash**, regardless of storage location. This enables integrity verification and deduplication across storage backends.

**Phase 1 stores blobs on the local filesystem only.** Cloud buckets — central or user-managed — come later. The pointer type must nonetheless be designed as resolvable-anywhere; a pointer assuming filesystem paths will need rewriting.

### 3.3 Slots

A fixed-capacity local store of **10 slots**:

- **Up to 5 lockable slots** — meaningful pieces the user designates as never-evictable. Locked items are never evicted and never offered.
- **5 swappable slots** — available for outbound swaps. Incoming pieces land here.

**Duplicates are deduplicated by content hash** and must not consume slots. (Encountering a duplicate is a popularity signal worth capturing eventually — deferred.)

## 4. Node types

**Peer (personal device).** Small footprint, tight slot limit, opportunistic street-level metadata swaps over BLE.

**Stationary node.** A machine on a Wi-Fi network with a larger disk, running the ArtPollinator service on a known port. Longer contact windows allow clean transfer of larger files. Still bounded by design to preserve curation pressure.

## 5. Policy seams

The architecture is built around these injectable functions. Their logic is deliberately undefined here — only the seams are fixed.

| Seam | Signature |
| --- | --- |
| `PriorityPolicy` | `score(item, context) -> priority` |
| `OfferPolicy` | `selectOffer(library, peerKind) -> Item[]` |
| `AcceptPolicy` | `selectAccept(offered, library) -> Item[]` |
| `EvictionPolicy` | `selectEvict(library, incoming) -> Item[]` |

Transport, discovery and storage treat these as black boxes.

**Priority is an explicit domain concept**, not something each policy invents. Candidate signals: user ranking, recency, hop count, dwell time.

**`AcceptPolicy` is a security control.** Since one-way seeding is permitted, accept-side filtering and rate limiting are the primary defence against a hostile node flooding a library.

## 6. Swap protocol

### 6.1 Discovery

- **BLE:** mutual advertise and scan for nearby peers. All scan frequencies configurable — duty cycle, window, interval, backoff.
- **Wi-Fi:** on joining a network, probe for the service on known port(s).

### 6.2 Flow

1. Discover a peer or node.
2. Exchange metadata tokens — cheap, fast.
3. Run `OfferPolicy` / `AcceptPolicy` to negotiate the swap set.
4. Transfer metadata immediately; defer blobs to Wi-Fi.
5. Run `EvictionPolicy` to reconcile slot limits.

The message schema is **transport-agnostic** — identical over BLE and HTTP.

### 6.3 Symmetry

**One-way swaps are permitted.** A node may seed generously without receiving. Person-to-person exchange is expected to be mutual. `OfferPolicy` receives a bare `PeerKind` discriminator (node | person) to distinguish; no fuller peer context is passed.

### 6.4 Encounter memory

Without a record of what has been seen or shed, revisiting a peer returns the same pieces and evicted items boomerang back.

**Encounter memory is item-scoped, not peer-scoped** — it remembers pieces by content hash, not who offered them. This is required because people use rotating identities (§7).

## 7. Identity and privacy

**Nodes have persistent identities. People use rotating ephemeral IDs.**

Two consequences:

- Peer-scoped memory is unrepresentable for people; hence item-scoped encounter memory (§6.4).
- **Provenance can leak location history.** If tokens record hop paths and nodes have stable identities, a token becomes a record of which venues its holder visited — readable by whoever receives it next. Prefer hop *count* over identified paths. **Open: final granularity.**

## 8. Client platform

**React Native**, targeting iOS, Android and the browser from one codebase. Chosen for `react-native-ble-plx`, the most battle-tested BLE option, including iOS state restoration — the mechanism that relaunches an app on a background BLE event.

*Alternatives considered:* Flutter (weaker peripheral/advertising role, background scanning needs foreground-service workarounds); Capacitor (capable, mirrors the Web Bluetooth API, but less proven for the background peripheral case).

### Capability tiers

| Capability | iOS / Android | Browser |
| --- | --- | --- |
| View library, manage slots | ✅ | ✅ |
| Swap with a stationary node (Wi-Fi) | ✅ | ✅ |
| Fetch blobs over Wi-Fi | ✅ | ✅ |
| BLE peer discovery and gossip | ✅ | ❌ |

**Web Bluetooth permits only the Central role — a browser can never advertise.** Since street swaps require both devices to advertise *and* scan, mutual BLE gossip is architecturally impossible in a browser. This is not a vendor-support gap that will close in time. Additionally, Firefox and all Safari versions lack Web Bluetooth entirely, and iOS forces every browser onto WebKit.

The browser is a **first-class target with a reduced capability set**, not a degraded port. It registers no BLE adapter; `core` is unaware.

**Node server runtime:** TypeScript/Node, sharing the same `core` package.

## 9. Phasing

**Phase 1 — Mobile peer-to-peer (BLE).** Exit: a cross-platform app that scans for peers over BLE, gossips metadata on contact, and defers blob fetching to Wi-Fi. 5 locked + 5 swappable slots; all scan frequencies configurable; placeholder art seeded locally.

**Phase 2 — Stationary node server.** Exit: a Linux- and macOS-friendly server listening on the local network, holding a larger collection, swapping with devices as they join. Includes the security model and its evaluation as a first-class deliverable.

**Phase 3 — Authoring and curation UX.** Exit: users add their own art, write metadata, manage slots. Placeholder content retired. Gated on the rights and licensing model.

> **Note:** BLE-first requires a native build from day one. A browser-only client is not viable for Phase 1, though the browser remains a supported target.

## 10. Rights and content

Scraped third-party artwork is permitted **only** as a local development fixture. It must never reach a public node or a shipped build. This system exists to redistribute art; scraped work circulating is publication, not testing.

The consent model — how artists agree that their work circulates, is copied, and is evicted — is **unresolved** and gates Phase 3. It is not an engineering task and depends on conversations with artists and venues; start it early.

The MIT licence covers **code only**. It is not the mechanism protecting artists' work.

## 11. Open questions

1. **Provenance granularity** — hop count only, or identified paths? Resolve the location-history leak in §7 before building lineage.
2. **`PeerKind` discriminator** — accept as specified in §6.3, or have `SwapService` branch before calling the policy.
3. **Telemetry stance** — no position taken. Agents will default to something.
4. **First-run experience** — empty library, or bootstrapped with placeholder content?
5. **Rights and consent model** — see §10. Gates Phase 3.
6. **Anti-abuse and trust model** — spam and flooding mitigations beyond accept-side rate limiting.
7. **Moderation and takedown** — revocation propagating opportunistically; behaviour for offline devices holding revoked content.

## 12. Resolved decisions

| Question | Resolution |
| --- | --- |
| Content addressing | Always by content hash — required by dedupe |
| Swap symmetry | One-way permitted; nodes may seed generously |
| Duplicates | Deduplicated by hash; must not consume slots |
| `peerContext` | Removed; replaced by a bare `PeerKind` discriminator |
| Peer identity | Persistent for nodes, rotating for people |
| Encounter memory scope | Item-scoped, by content hash |
| Node runtime | TypeScript/Node, shared `core` |
| Blob storage (Phase 1) | Local filesystem only |
| Client framework | React Native, three targets |
| Licence | MIT |
