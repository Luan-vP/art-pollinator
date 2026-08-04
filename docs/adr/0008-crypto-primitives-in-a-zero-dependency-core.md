# ADR-0008: Crypto primitives in a zero-dependency `core` — hash inline, verify behind a port

**Status:** Accepted
**Date:** 2026-08-04

## Context

Two issues in this batch each need a real cryptographic primitive where
`core` previously had a placeholder:

- **#23 (content hashing)** needs a real hash function so
  `MetadataToken.contentHash`/`BlobPointer.contentHash` and `Library`'s
  dedup-by-hash logic are backed by genuine collision resistance, not the
  arbitrary placeholder strings (`"alpha"`, `"a"`, ...) earlier batches'
  fixtures used.
- **#58 (token signing and verification)** needs to verify an Ed25519
  signature over a token's canonical bytes, using a public key, message,
  and signature — and reject both tampered and unsigned tokens.

AGENTS.md §2 rule 1 is unconditional: "`core` imports nothing external. No
HTTP client, no filesystem, no BLE library, no framework, no platform API.
If you need one, you need a port." This is mechanically enforced by
`scripts/check-core-boundaries.mjs`, run via `npm run lint:boundaries`: any
bare (non-relative) import in `core/src` — including a Node built-in like
the crypto module — fails the build. There is no "but it's just a pure
function underneath" exception written into that rule, and this ADR does
not invent one.

Both hashing and signature verification are, at the level of pure
mathematics, deterministic functions of their input bytes: no randomness,
no filesystem, no network. That observation could argue for hand-rolling
_both_ directly in `core`, the same way `core/src/metadata/metadata-token.ts`
already hand-rolls UTF-8 encode/decode rather than depending on
`TextEncoder` (precedent: see that file's `utf8ByteLength` doc comment).
This ADR is the record of why the two primitives land on _opposite_ sides
of that question despite the shared "it's just math" framing.

## Decision

**SHA-256 (issue #23) is hand-rolled directly in `core`**
(`core/src/crypto/sha256.ts`), following FIPS 180-4 exactly, verified
against the official empty-string, one-block, two-block, and
million-character NIST test vectors (`core/src/crypto/sha256.test.ts`).
`hashContent` (an alias for `sha256Hex`) is the content hashing function
issue #23 asks for, usable for both tokens and blobs since both are just
bytes by the time they reach it.

**Ed25519 signature verification (issue #58) is NOT hand-rolled.** It stays
behind a new driven port, `SignatureVerifierPort`
(`core/src/ports/signature-verifier-port.ts`), with the real implementation
(`NodeSignatureVerifier`, using `node:crypto`'s audited Ed25519 support)
living in the new `adapters/identity-node` package (issue #57). `core` only
has a deterministic, non-cryptographic in-memory fake
(`InMemorySignatureVerifierPort`) for exercising the _orchestration logic_
(canonicalization, the unsigned/tampered-rejection rules) in pure `core`
tests — never real security guarantees.

Keypair generation (issue #57) follows the same logic as verification:
generating a real Ed25519 keypair needs a CSPRNG and, for anything
persistent, a filesystem or platform keystore — both textbook I/O, so this
was never in question for `core`. It lives entirely in
`adapters/identity-node`, behind the existing `IdentityPort` interface
(unchanged).

## Alternatives considered and rejected

- **Hand-roll Ed25519 point arithmetic in `core` too, matching SHA-256's
  treatment.** Rejected. A hash function has exactly one property to get
  right — given these bytes, produce this digest, checkable byte-for-byte
  against a handful of published test vectors. Elliptic-curve signature
  verification (point decompression including a modular square root
  choice, scalar multiplication, modular inverse, cofactor handling) has
  several subtle correctness pitfalls that don't show up as "wrong output
  for a known input" — they show up as **a forged or tampered signature
  verifying as valid**, which is not a wrong answer, it is a silent
  security failure with no test vector that reliably catches every class
  of implementation bug. Issue #58's explicit acceptance criterion is
  "tampered tokens rejected" — shipping a hand-rolled verifier the team
  cannot fully audit against that exact failure mode, in a system whose
  `AcceptPolicy` is already documented as "a security control, not a
  convenience filter" (AGENTS.md §7), is the wrong place to take that risk
  even though `core`'s dependency rule made SHA-256 an acceptable one.
- **Use Node's `crypto.subtle`/`node:crypto` directly inside `core`,
  treating it as "not really an external dependency, just a platform API."**
  Rejected. This is precisely the reading AGENTS.md §2 rule 1 forecloses by
  name ("no platform API"), and `scripts/check-core-boundaries.mjs` fails
  the build on it regardless of the runtime argument — see this ADR's
  Context section. Accepting this argument for `node:crypto` would also
  have no principled stopping point against accepting it for `fs`, `net`,
  or any other Node built-in "because it's deterministic under the hood."
- **Add a small, audited third-party Ed25519 library as a `core` dependency
  (e.g. a pure-JS package) instead of hand-rolling.** Rejected for the same
  reason as the previous alternative: "zero external dependencies" is
  AGENTS.md §2 rule 1's literal wording, not "zero dependencies we didn't
  audit ourselves." Any npm package, audited or not, is still a dependency
  edge `core`'s own rule forbids.
- **Treat hashing the same as signing — put `ContentHasher` behind a port
  too, for symmetry.** Considered, and it was the closer call of the two.
  Rejected because it buys nothing here: unlike Ed25519 verification,
  SHA-256 has no meaningfully-risky implementation surface once checked
  against standard test vectors, and every consumer of hashing so far
  (`Library`'s dedup, `MetadataToken.contentHash`) is inside `core` or
  `app` and gains nothing from indirection through a port that a fake would
  just wrap around the same real algorithm anyway. If a future need arises
  for a _different_ hash algorithm per deployment (e.g. hardware-accelerated
  hashing on a resource-constrained peer), revisit this — that's a genuine
  reason a `ContentHasher` port would earn its keep, and nothing here
  prevents introducing one later without touching `hashContent`'s existing
  call sites (they'd just delegate).

## Consequences

- `core/src/crypto/sha256.ts` is real, load-bearing cryptographic code that
  now lives outside `adapters/*`, which is an exception to "adapters own
  real I/O/platform code" only because this specific primitive has no I/O
  to own — the exact same reasoning ADR-0004 already established for the
  in-memory port fakes living in `core`. A future auditor grepping `core/`
  for "real crypto" should find this ADR, not be surprised by it.
- `SignatureVerifierPort` is a ninth driven port, beyond the eight from
  issue #17. AGENTS.md §2 rule 3 ("ports are owned by the domain, shaped by
  what the domain needs") does not cap the port count — this is the
  precedent for adding a port outside the original batch when a later issue
  needs one.
- Any future crypto primitive add to this codebase should ask this ADR's
  question explicitly: is a subtle implementation bug merely "the wrong
  answer" (hand-roll, verify against test vectors, keep in `core`), or "a
  silent security failure" (keep behind a port, delegate to an audited
  platform/library implementation in an adapter)? This ADR is the
  precedent to cite either way.
- `adapters/identity-node` is now the first real adapter package to exist
  in this repo (`adapters/` was a placeholder directory before this batch).
  It sets the pattern — `package.json` depending on `@art-pollinator/core`,
  its own `tsconfig.json`/`vitest.config.ts`, real I/O in its own test
  suite (AGENTS.md §5) — for every adapter package that follows it.
