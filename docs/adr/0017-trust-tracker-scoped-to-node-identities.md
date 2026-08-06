# ADR-0017: Trust/reputation tracking (issue #59) is scoped to `peer.kind === "node"` only, never `"person"`

**Status:** Accepted
**Date:** 2026-08-06

## Context

SPEC.md §11 open question 6 and `docs/security/threat-model.md`'s "Open
questions carried forward" both name the same gap: the existing
`SlidingWindowRateLimiter` (issue #49) is a real, working defence against
flooding, but it is deliberately short-lived — a peer's bad behaviour is
forgotten the moment its trailing window passes. Issue #59 asks for
something longer-lived: "track... a rolling count of accepted-vs-
rejected/throttled interactions," so a peer that keeps getting throttled
_every_ window pays a compounding cost instead of the same flat cost every
time.

Building that is in direct tension with a decision this codebase already
made deliberately, for a documented reason. AGENTS.md §7 / SPEC.md §7:

> **Nodes have persistent identities. People use rotating ephemeral IDs.**
> Peer-scoped memory is unrepresentable for people; hence item-scoped
> encounter memory (§6.4).

`core/src/encounter/encounter-memory.ts` exists specifically because a
peer-scoped "I already declined this person" is impossible to build
honestly against a rotating identity, and building it anyway would either
not work (the person just looks new next time) or — worse — quietly work
by tracking something that erodes the rotation's whole privacy purpose. A
longer-lived trust tracker, by construction, is a stronger, more
persistent form of exactly the peer-scoped memory that design already
ruled out. `core/src/security/trust-tracker.ts`'s own doc comment states
this tension directly, as required by AGENTS.md §3 ("flag prominently in
the PR description," not bury it): the tracker is peer-scoped, and unlike
the rate limiter's self-erasing window, bad marks here are **not**
forgotten by time alone — only a subsequent reciprocal swap forgives one.
That is a real, lasting memory of a specific identity's behaviour, keyed
however the caller chooses to key it.

Nothing in `core`'s protocol layer _enforces_ identity rotation — a
person's client software rotating its keypair/`PeerAddress.id` between
encounters is a client-side discipline the wire protocol assumes but does
not require. If this tracker were wired up against every peer regardless
of kind, and some client implementation reused an identifier across many
encounters (whether by bug or by design), this feature would quietly
become a genuine longer-term behavioural profile of that specific device —
precisely the outcome AGENTS.md §7 exists to prevent.

## Decision

`TrustTracker.recordOutcome`/`acceptCapacityFraction` are only ever called
by `app/src/swap/swap-service.ts` when `peer.kind === "node"`. A `"person"`
peer never touches the tracker at all — not "forgiven quickly," genuinely
never written to (proven directly in
`app/src/swap/trust-model.test.ts`'s privacy-scoping test:
`trustTracker.trackedKeyCount()` stays `0` for a person-kind peer put
through the identical flooding pattern that visibly restricts a node-kind
peer).

This is possible with no new plumbing because `PeerKind` (`core/src/ports/discovery-port.ts`)
already exists for exactly this purpose — SPEC.md §6.3: "`OfferPolicy`
receives a bare `PeerKind` discriminator... to distinguish [node from
person]; no fuller peer context is passed." The same discriminator that
already lets `OfferPolicy` behave differently for a node vs. a person is
the enforcement point for this ADR's scoping rule — no new peer-context
field, no new privacy surface, reusing a seam SPEC.md already sanctioned.

The reasoning this scoping rests on: **a node's identity is a persistent
design commitment (SPEC.md §4 — "a machine on a Wi-Fi network," a venue's
fixed infrastructure), not something SPEC.md ever asked to be
unlinkable.** Building trust history against a node's stable identity
costs that identity nothing it wasn't already spending by being stable in
the first place — it is the same shape of trust a browser already places
in a CA it has seen issue valid certificates before, or an email client in
a domain with a long clean-sending history. A person's identity is
designed to be disposable _specifically so history cannot accumulate
against it_ — extending this tracker to people would undo that by the back
door, in service of a feature whose whole justification (SPEC.md §5's
named threat: "a hostile node can push without receiving") is already
about nodes.

## Alternatives considered and rejected

- **Track trust for both kinds, but with a much shorter retention window
  for `"person"` peers.** Rejected: a shorter window is still a window —
  it is a quantitative softening of the same qualitative problem, not a
  resolution of it. AGENTS.md §7's stance is that peer-scoped tracking of
  a rotating identity is _unrepresentable_, not merely "acceptable in
  small doses." A person who happens not to rotate within that shorter
  window (nothing prevents this) is still profiled for however long the
  window lasts, for no benefit `person`-kind swaps actually need — SPEC.md
  §5's named threat model is specifically about nodes.
- **Track trust for both kinds, but key it by something claimed to be
  more anonymous than `peer.address.id` (e.g. a hash of some rotating
  value).** Rejected: this does not remove the tension, it just moves it —
  any deterministic function of "this specific device's session" is still
  peer-scoped memory the moment it fails to change between two encounters
  with the same real device, which is exactly the scenario AGENTS.md §7 is
  worried about (an identity that a client _claims_ rotates but, in
  practice or by bug, does not).
- **Track trust for both kinds, and rely on the rate limiter's existing
  Sybil-evasion property as an implicit privacy safeguard** (the reasoning
  being: "a person who wants to stay unlinkable can just rotate, so the
  tracker's memory is self-limiting for anyone motivated to avoid it").
  Rejected: this inverts the burden. SPEC.md §7's rotating-identity design
  is meant to make privacy the _default_, not something a person must
  actively defend by remembering to rotate against a feature that
  otherwise profiles them. Scoping to `peer.kind === "node"` keeps privacy
  the default for people regardless of whether their client rotates
  correctly, consistently, or at all.
- **Do not build a longer-lived trust signal at all — rely on rate
  limiting alone, forever.** Rejected as the status quo issue #59 exists
  to move past: `docs/security/threat-model.md` already names "a
  reputation system... is a natural next step" as an open question, and a
  flooding _node_ (the adversary this signal is aimed at) genuinely does
  benefit from a defence that survives across the rate limiter's own
  windows — the scoped version below still delivers that, just without
  the privacy cost.

## Consequences

- The feature issue #59 asks for exists, and is tested end to end
  (`app/src/swap/trust-model.test.ts`'s "gets progressively more
  restricted" test) against exactly the adversary SPEC.md §5 names: a
  node that keeps getting throttled pays a growing cost, not a flat one.
- The feature provides **zero** additional defence against a flooding
  _person_ — that adversary is still defended against only by the
  existing rate limiter (issue #49) and ingest validation, unchanged by
  this batch. This is an accepted, deliberate gap, not an oversight: SPEC.md
  §5's own named threat ("a hostile node can push without receiving") is
  specifically about nodes, and a person-to-person encounter is bounded in
  scale by BLE's short contact window in a way a node's Wi-Fi-scale
  ingestion is not.
- If a future batch wants trust tracking for repeated encounters with the
  _same real device_ presenting as a person (e.g. a hostile actor
  deliberately not rotating to build a fake "clean history" and then
  spend it), that is a strictly harder problem than this ADR solves and
  should get its own ADR — it cannot piggyback on this tracker without
  reopening the exact tension this one resolves by scope restriction.
- `TrustTracker` itself (`core/src/security/trust-tracker.ts`) takes no
  position on what it's keyed by — like `SlidingWindowRateLimiter`, it is
  a generic, reusable primitive. This ADR's scoping decision lives entirely
  at the one call site (`app/src/swap/swap-service.ts`), not in `core`,
  which is the correct layer for a policy decision about _when_ to use a
  domain primitive rather than a constraint on the primitive itself.
