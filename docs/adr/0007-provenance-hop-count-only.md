# ADR-0007: Provenance records hop count only, never an identified path

**Status:** Accepted
**Date:** 2026-08-04

> ⚠️ **This decision carries weight beyond code.** It determines what can be
> inferred about a user's physical movements from data that circulates
> between other people's devices, outside the user's own control once a
> token leaves their hands. Per AGENTS.md §3, it is flagged here and in this
> batch's PR description, not buried as a routine implementation detail.

## Context

SPEC.md §3.1 lists `provenance` as one of `MetadataToken`'s fields, without
fixing its shape. SPEC.md §7 and §11 (open question 1) flag the risk
explicitly:

> Nodes have persistent identities. People use rotating ephemeral IDs. ...
> Provenance can leak location history. If tokens record hop paths and
> nodes have stable identities, a token becomes a record of which venues its
> holder visited — readable by whoever receives it next. Prefer hop _count_
> over identified paths. **Open: final granularity.**

Two designs were on the table for what "provenance" actually records as a
token changes hands across a swap chain (device A → node B → device C →
...):

1. **An identified hop path** — an ordered list of the identities (node
   IDs, and/or person IDs) the token passed through, e.g.
   `["node:gallery-42", "person:xyz", "node:cafe-7"]`.
2. **A hop count** — a single integer, incremented once per hop, recording
   only _how many_ hands the token has passed through, never _whose_.

The `MetadataToken`/`Provenance` stub from an earlier batch
(`core/src/metadata/metadata-token.ts`) already anticipated this question
and deliberately shipped only a `hopCount: number` field, explicitly to
avoid foreclosing this decision either way. This ADR is that decision,
made formally, plus the work (issue #21) of actually wiring hop count to
increment correctly as a token moves through `SwapService`.

## Decision

**Provenance records hop count only. `core` never represents, stores, or
transmits an identified hop path — not for nodes, not for people, not as an
optional/richer field alongside the count.**

The `Provenance` interface remains exactly:

```ts
export interface Provenance {
  readonly hopCount: number;
}
```

`incrementHopCount(token)` (`core/src/metadata/metadata-token.ts`) is the
only way this value changes: `SwapService.swap` (`app/src/swap/swap-service.ts`)
calls it once per accepted item, at the moment this device _receives_ a
token from a peer — never when sending one, since sending is not a hop for
the sender. The hop count that lands in a device's own library is thus
always accurate for "how many times has this changed hands since it was
authored," and that is the _only_ lineage question this system answers.

Nodes have persistent identities (SPEC.md §7) specifically so a venue can
be recognized as the same node across visits — that persistence is
intentional and valuable for the swap protocol itself (mutual
authentication, trust decisions). The risk this ADR addresses is narrower:
combining that persistent node identity with a _recorded path_ inside the
token itself, which is what would let a receiver reconstruct "this piece
passed through node X, then node Y, then node Z" — and, if the holder is a
person carrying it between those nodes, that sequence is a venue-visit
itinerary. A bare count carries none of that: two tokens with `hopCount: 3`
are indistinguishable regardless of which three hops actually happened.

## Alternatives considered and rejected

- **An identified hop path (list of node/person IDs).** Rejected outright,
  per SPEC.md §7's own explicit warning. This is exactly the design the
  spec pre-emptively rules out: node identities are persistent by design
  (needed for node-to-node trust and repeat-visit recognition), so an
  identified path directly reconstructs a venue-visit sequence for whoever
  the token reaches next. Even restricting the path to _node_ IDs only
  (never person IDs) does not fix this — venues are exactly the "place" in
  "place-based" (SPEC.md §1), and a sequence of venue names _is_ a movement
  record. There is no partial version of this alternative that avoids the
  leak; the entire category is rejected.
- **A hop path of unlinkable, per-hop random tokens (no stable identity, just a length-N list of opaque markers) to preserve "how" without preserving "where."** Considered briefly and rejected as solving a problem nobody has: if the markers are truly unlinkable to any place or person, the only information the list adds over a bare count is its own length, which a plain integer already carries at a fraction of the size (and size is a fixed, scarce budget — AGENTS.md §6, under ~5 KB). It adds complexity and token bytes for zero additional signal.
- **Signed hop-count attestations (each hop's device co-signs the incremented count) to make hop count tamper-evident.** Not rejected as a future direction — the original `Provenance` stub's doc comment explicitly left room for this — but out of scope for this ADR and this issue. It would need issue #58's signing infrastructure extended to cover a per-hop, multi-signer chain (distinct from the single-signer-per-token scheme #58 actually implements), and doesn't change this ADR's core granularity decision either way: whether or not hop count is ever made tamper-evident, it stays a bare count, never a path.
- **Storing the path only locally (never transmitted), for the holder's own reference (e.g. "where did I pick this up?"), while transmitting only the count onward.** Considered and rejected for this batch: it would require a second, node-identified data structure alongside `MetadataToken` with its own persistence and privacy analysis (whose device stores it, for how long, is it itself discoverable by an attacker with device access), which is exactly the kind of scope creep AGENTS.md §3 warns against inventing unprompted. If a future issue wants "let me see where my own pieces came from" as a _local, never-transmitted_ feature, it deserves its own ADR weighing device-compromise risk on its own terms — this ADR only settles what travels in the wire-visible `MetadataToken`.

## Consequences

- `MetadataToken.provenance` will never grow a field that names a node,
  person, or place, however indirectly (no venue slugs, no geographic
  coordinates, no "first seen at" timestamps tied to a location). Any
  future issue proposing such a field must open a new ADR explicitly
  superseding this one, per AGENTS.md §2's "if a change requires bending
  one of these rules, stop and write an ADR."
- Hop count is a weaker priority/trust signal than an identified path would
  have been (e.g. `PriorityPolicy` cannot know "this piece got here via a
  particularly trusted venue," only "this piece has changed hands N
  times"). This is an accepted trade — SPEC.md §7 already made this call
  in principle; this ADR just confirms `core`'s implementation matches it
  in practice and closes §11's open question.
- Because the signed payload (`canonicalizeTokenForSigning`, issue #58)
  deliberately excludes `provenance`, incrementing hop count on every hop
  never invalidates a token's original signature — no re-signing
  infrastructure is needed for lineage tracking to work, which would have
  been a much larger problem had an identified path (needing each
  intermediate holder's own signature) been chosen instead.
- If a later issue (e.g. #60, metadata uniformity) wants tokens to be
  harder to fingerprint by their `hopCount` value specifically (e.g. very
  high or very low counts standing out), that is a separate, addressable
  concern layered on top of this decision, not a reason to revisit hop
  count vs. path.
