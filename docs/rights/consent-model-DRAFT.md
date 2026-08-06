# Rights and consent model — DRAFT

> ## ⚠️ DRAFT — proposal for artist/venue conversation, not a resolved policy.
>
> ## Requires real-world input and likely legal review before any real artist's work may circulate.

**Status:** Draft proposal, not adopted. No real artist or venue has reviewed
this document. **Do not treat any section below as a shipped decision.**

**Author's note (issue #54, this batch):** SPEC.md §10 and §11 open question
5, and AGENTS.md §3, are explicit and unambiguous that the consent model is
**not an engineering task** — "it is not an engineering task and depends on
conversations with artists and venues; start it early." An AI coding agent
cannot conduct that conversation, and this document does not pretend to. What
follows is a structured starting point: the concrete questions a real
conversation with artists and venues needs to answer, framed against what the
system actually, technically does — so that whoever has that conversation
isn't starting from a blank page, and isn't accidentally promising the system
guarantees it cannot keep. **This document does not gate-close issue #54.**
Issue #54's actual definition of done — "reviewed with at least one real
artist/venue conversation, not purely speculative," "recorded as an ADR or
equivalent decision doc" — cannot be satisfied by this batch, because that
review has not happened. This is the pre-read for that review, not the
review itself.

**Consequently:** this batch does **not** flip on real (non-placeholder)
content anywhere, and issue #56 (retire placeholder content) ships as a
_mechanism only_, left inactive — see `docs/adr/` (retirement switch,
`clients/mobile/src/composition/placeholder-retirement-switch.ts`) and this
batch's PR description. Shipping real artist content before a real,
artist-reviewed consent process exists would violate AGENTS.md §3's hard
boundary on placeholder/scraped content reaching a shipped build, applied
here to _any_ unconsented real content, not just scraped fixtures.

---

## 1. What the system actually does, in plain terms (the ground truth this conversation has to work against)

Before asking an artist to consent to anything, they need an honest,
non-marketing description of the mechanism. That description, as built:

- A piece an artist adds becomes a small **metadata token** (title, creator,
  description, a pointer to the full file, a content hash, an optional
  signature — SPEC.md §3.1) plus the **full file itself**, stored as a
  content-addressed blob.
- The token **circulates by opportunistic, decentralized gossip**: any device
  that holds it may offer it to any other device or node it happens to
  physically encounter (BLE street contact) or connect to (a stationary
  node's Wi-Fi swap), per SPEC.md §6. There is no central server approving
  each hop.
- **One-way seeding is permitted** (SPEC.md §6.3): a node can push copies
  outward without anyone requesting them.
- Once another device holds a copy, **that copy is a first-class citizen on
  that device** — it can be re-offered onward to a third device, a fourth,
  and so on, each hop being an ordinary copy, not a licensed reference back
  to an original. There is no copy-protection, no DRM, and none is planned;
  SPEC.md's design ethos section names this system's purpose as
  redistribution.
- **Devices have a hard, small capacity** (10 slots, SPEC.md §3.3). A copy on
  someone else's device can be **evicted** by that device's own curation
  pressure — a locked item never is, but nothing stops an accepting device
  from immediately un-eviction-protecting an accepted copy, and low-priority
  or unpopular items are, by design, the ones `EvictionPolicy` sheds first.
  **No persistence is guaranteed anywhere in this system**, for any content,
  by design (SPEC.md's whole "deliberate scarcity" premise, §2).
- **Revocation is opportunistic, not immediate or complete** — see §3 below.
  It is a real, working mechanism, not a stub, but it does not, and cannot,
  guarantee every copy in circulation disappears on request.

Any consent language built on top of this needs to say all of the above
plainly, in terms an artist without an engineering background can act on. A
consent flow that implies "you can take it back" or "you control who has a
copy" without qualification would be **false** given how this system works.

## 2. Opt-in: how does an artist agree to add work in the first place?

**Open — needs a real answer from artists and venues, not invented here.**
Questions to resolve in that conversation:

- Is opt-in per piece (an artist agrees each time they publish something new)
  or a standing agreement (an artist agrees once, then anything they publish
  through their identity is covered)?
- Does a **venue** seeding a piece on an artist's behalf (SPEC.md §4's
  "stationary node," e.g. a gallery adding scans of pieces on display) need a
  _separate_, documented agreement between the venue and the artist before
  the venue is allowed to ingest it — distinct from the artist's own
  agreement with the ArtPollinator system? (Engineering note: at the
  mechanics level, `IngestionService` — issue #53 — does not distinguish
  "venue seeding" from "artist publishing"; they are literally the same
  operation, framed differently in the UI. Whatever rights process is
  decided has to sit _above_ that shared mechanism, e.g. as a checkbox/terms
  step the authoring UI shows before calling `IngestionService.ingest`, or as
  an out-of-band agreement a venue signs before they are given ingestion
  access at all. Nothing in this batch builds that gate — see §6.)
- What, concretely, is an artist shown at the moment of opt-in? A plain-
  language version of §1 above is a reasonable starting draft; whether it
  needs to be a formal, signed agreement or a lighter in-app acknowledgment
  is a question for whoever handles the legal-review step this document's
  own header calls for.
- Age/capacity to consent, and what happens for public-domain, anonymous, or
  collectively-authored work (e.g. street art, a mural with no single
  identifiable rights holder) are real cases venues will hit early and are
  entirely unaddressed here.

## 3. What is being consented to, item by item

A candidate checklist for the real conversation — not final language:

1. **Redistribution via BLE gossip and node swaps.** The piece may be copied
   to any device that encounters it, without a per-recipient approval step,
   for as long as it continues to circulate (§1).
2. **Copying without central control.** Once copied, a device's copy is not
   remotely revocable in the way a centrally-hosted file would be — see §4.
3. **Eventual eviction.** A copy on someone else's device may be dropped at
   any time by that device's own curation, with no notice to the artist and
   no way for the artist to prevent it beyond declining to publish at all.
4. **No guaranteed persistence, anywhere.** There is no "the system keeps a
   permanent master copy" promise built into this design — the artist's own
   device (or the venue's) not evicting their own locked copy is the closest
   thing to a durability guarantee that exists, and even that only protects
   _their own_ copy, not copies already sent elsewhere.
5. **Attribution** — see §5.
6. **Compensation** — see §6. SPEC.md takes no position; this document
   invents none either.

## 4. Revocation: what the artist can actually invoke, and what it actually does

The **mechanism** is real and already built: `core/src/security/
revocation.ts` and `docs/adr/0015-opportunistic-revocation-protocol.md`
implement a signed, gossiped `RevocationEntry` — the same content-hash-keyed
takedown record a node operator's moderation tooling
(`AdminService.revokeContent`) already uses. What is **not** decided is the
_policy_ of when and why an artist would invoke it — that is squarely a
rights-conversation question, not an engineering one, and this document does
not answer it. Candidate questions for that conversation:

- Does the artist invoke revocation themselves (would need an
  artist-facing UI this batch does not build — the mechanism today is
  exposed only through `AdminService`, a node-operator tool), or do they
  request it through a venue/operator?
- Is there a reason to revoke short of a full takedown request — e.g. "stop
  offering this to new devices, but don't chase down existing copies"? The
  current mechanism does not distinguish these; it is a single "revoked"
  signal.
- What is communicated to the artist about what revocation will and won't
  achieve, per the honest limitation immediately below? A consent flow that
  lets an artist believe revocation deletes every copy everywhere would be a
  broken promise, not a technicality.

**The honest limitation, stated plainly (do not soften this in any real
consent language):** per ADR-0015, revocation propagates **opportunistically**
— device to device, only at the moment two devices actually swap, and only
onward from a device that has already learned of the revocation. A device
that:

- is offline and never swaps with anyone who knows about the revocation,
- has already evicted the content by the time the revocation would reach it
  (so there is nothing left to remove, but the copy may have already been
  passed on to a third device before eviction), or
- holds a copy whose original signer does not cryptographically match the
  revocation (ADR-0015's authorization model — a node's own moderation
  revocation of _someone else's_ signed work is binding only on that node's
  own collection, not network-wide, precisely so no single node can
  unilaterally force a deletion on every other device),

...will never remove that copy as a direct result of the revocation. This is
a deliberate, documented design trade-off (no central authority exists to
push a deletion authoritatively), not a bug slated to be fixed. **Any consent
language must say "this system will make a good-faith, best-effort attempt to
propagate a takedown to devices that continue to swap after the takedown is
issued — it cannot guarantee removal from every device that has ever held a
copy, particularly devices that go offline or that already passed the copy
along before hearing about the takedown."** Promising more than that would be
false.

## 5. Attribution

**Open — needs a real answer.** What the system already carries mechanically:
`MetadataToken.creator` (free text, artist-supplied) and, when signed,
`signerPublicKey`/`signature` cryptographically tying a token back to whoever
signed it (issue #58). What is not decided:

- Is `creator` required to be the artist's real name, or may it be a
  pseudonym/handle? (Given SPEC.md §7's emphasis on privacy for _people_
  passing content — rotating ephemeral identities — an artist may have
  reasons to want the same protection for authorship, not just carriage.)
- Is attribution guaranteed to survive every hop? Mechanically, yes — the
  signed fields (`canonicalizeTokenForSigning`) include `title`/`creator`/
  `description`, and a hop only ever increments `provenance.hopCount`
  (deliberately excluded from the signature, per `docs/adr/0007-provenance-hop-count-only.md`,
  precisely so hopping doesn't require re-signing and doesn't invalidate the
  artist's original attribution). So _if_ a piece keeps circulating with its
  original token intact, attribution travels with it. What is not
  mechanically enforced is a receiving device _choosing_ to keep that intact
  token rather than, say, stripping fields before re-offering — nothing in
  today's `OfferPolicy`/`AcceptPolicy` seam prevents a modified re-offer, and
  whether that should be prevented (and how) is itself a rights-model
  question, not resolved here.
- Is there any expectation of attribution being _displayed_ prominently in a
  future viewer UI (out of scope for this batch — no such UI exists yet)?

## 6. Compensation and economic model

**SPEC.md takes no position on this, and this document invents none.**
There is currently no payment, royalty, licensing-fee, or other economic
mechanism anywhere in this codebase, and building one is explicitly out of
scope for this batch — doing so would be exactly the kind of "decide the
licensing model" overreach the critical instruction for this batch rules
out. If a real artist/venue conversation surfaces a need for one, that is a
new, separate engineering effort with its own design, gated on whatever the
conversation actually decides — not a default this document should
pre-guess (e.g. "free," "revenue share," "one-time fee" are all live options
this document deliberately does not pick between).

## 7. Where a real decision, once made, should land

Once a real conversation with artists/venues has actually happened (issue
#54's DoD: "reviewed with at least one real artist/venue conversation, not
purely speculative"), the resulting decision belongs in an ADR (per
AGENTS.md §3's "flag prominently" instruction — this is exactly the category
of decision that carries weight beyond code), superseding or narrowing this
draft. Until then:

- This document stays named `consent-model-DRAFT.md` — the `-DRAFT` suffix
  is load-bearing, not decorative. Renaming it to drop `-DRAFT` should itself
  be treated as a signal that a real decision has landed, not a documentation
  tidy-up.
- Issue #56 (retire placeholder content) stays gated off — see
  `clients/mobile/src/composition/placeholder-retirement-switch.ts` and
  `scripts/retire-placeholder-content.mjs`'s own header comments, both of
  which point back at this file.
- No composition root in this codebase should be wired to accept real,
  non-placeholder, non-test artist content by default as a result of this
  batch. `IngestionService` (issue #53) is deliberately content-agnostic
  mechanism — the same class handles a synthetic demo blob in a test, a
  placeholder-seed token, or a real artist's real file — precisely because
  the rights _gate_ was always meant to sit above the mechanism (in an
  authoring flow's terms-of-use step, or in what a venue is permitted to
  ingest), not inside it. Building that gate is future work, blocked on a
  real decision this document does not make.
