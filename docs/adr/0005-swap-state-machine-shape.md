# ADR-0005: Swap state machine — phases, events, and one-way flows

**Status:** Accepted
**Date:** 2026-08-04

## Context

Issue #16 (IMPLEMENTATION.md Phase 1a item 16) asks for a pure, exhaustively
tested state machine modelling one swap's lifecycle per SPEC.md §6.2
(discover → negotiate → transfer → reconcile), with illegal transitions
rejected and one-way (asymmetric) flows supported as a first-class path
(SPEC.md §6.3), not a special case. The issue leaves the exact
states/events, and how illegal transitions are signalled, undefined.

Two things needed deciding: (1) how rejection is reported, and (2) how a
one-way swap is represented without a second code path.

## Decision

**Rejection shape.** `transition(state, event) -> SwapTransitionResult`
returns `{ ok: true, state } | { ok: false, error }` — the exact shape
`Library.addItem`/`lockItem`/`unlockItem` already use
(`core/src/library/library.ts`). Never throws.

**Phases.** `idle -> discovered -> negotiating -> negotiated -> transferred
-> completed`, plus a terminal `aborted` reachable via an `ABORT` event from
any non-terminal phase. Five events drive the happy path
(`PEER_DISCOVERED`, `BEGIN_NEGOTIATION`, `NEGOTIATION_COMPLETE`,
`TRANSFER_COMPLETE`, `RECONCILE_COMPLETE`), matching SPEC.md §6.2's five
numbered steps one-for-one.

**One-way flows.** `NEGOTIATION_COMPLETE` carries `toSend`/`toReceive` and
`TRANSFER_COMPLETE` carries `sent`/`received` — both always
`readonly Item[]`, and an empty array on either or both sides is exactly as
legal as a non-empty one. There is no separate "one-way" event, phase, or
branch: a swap where only one side offers, or only one side accepts, or
neither, walks the identical five-event sequence to `completed` as a fully
mutual swap. `core/src/swap/swap-state-machine.test.ts` includes an explicit
test asserting the phase sequence is byte-for-byte identical between a
one-way and a two-way run.

## Alternatives considered and rejected

- **A discriminated `SwapKind: "one-way" | "two-way"` tag on the state,
  decided up front.** Rejected: it would have to be decided at
  `PEER_DISCOVERED` time, before either side's `OfferPolicy`/`AcceptPolicy`
  has run — but whether a swap turns out to be one-way is an _outcome_ of
  negotiation, not an input to it. Baking the tag in early would also
  create a state that can lie (tagged "two-way" but negotiation still
  produces an empty `toReceive`), which is exactly the kind of
  special-casing issue #16 asks to avoid.
- **Throwing a exception on illegal transitions instead of returning a
  result.** Rejected for consistency: every other pure operation in `core`
  that can be rejected (`Library.addItem`, `lockItem`, `unlockItem`) reports
  failure as a return value, never a thrown exception. Matching that
  keeps `SwapService` (issue #19) able to handle every `core` rejection the
  same way, and keeps the state machine trivially testable by asserting on
  a plain returned value.
- **No `ABORT` event at all, since interrupted-swap _handling_ is issue
  #47 (Phase 2).** Rejected: the state machine itself needing to be able to
  _represent_ "a swap that stopped partway" is a much smaller ask than
  handling the interruption, and leaving no terminal-but-incomplete phase
  would force a later batch to widen every existing phase's type. Adding
  `aborted` now, legal from any non-terminal phase, costs little and avoids
  that later breakage. Issue #47's actual recovery/cleanup behaviour is
  still out of scope here.

## Consequences

- `SwapService` (issue #19) drives this machine by calling `transition`
  once per step and unwrapping the `ok: true` case; an illegal call (e.g. a
  bug that tries to reconcile before transferring) surfaces as a thrown
  `Error` from `SwapService`'s own unwrap helper, not a silent no-op —
  `core` itself never throws here, `app` chooses to escalate a rejection to
  an exception.
- Because `toSend`/`toReceive`/`sent`/`received` are always plain arrays
  with no "is this one-way?" flag anywhere, any future policy or transport
  change that makes swaps _more_ often asymmetric (e.g. a smarter
  `AcceptPolicy` that routinely declines everything) needs zero changes to
  this module.
- If a future issue needs richer failure detail than a string (e.g. a
  structured reason enum for telemetry, SPEC.md §11 item 3, no position
  taken yet), that only touches `illegal`'s return value, not any call
  site's control flow.
