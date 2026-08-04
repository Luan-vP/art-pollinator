/**
 * Swap state machine — a pure model of one swap's lifecycle with a single
 * peer, per SPEC.md §6.2 (Flow): discover → negotiate (offer/accept) →
 * transfer → reconcile (evict). Zero I/O (issue #16, IMPLEMENTATION.md
 * Phase 1a item 16): every transition is a plain function of its inputs,
 * exactly like `Library`'s own operations (`../library/library.ts`).
 *
 * ## Design: a `transition(state, event) -> Result` reducer, not a class
 *
 * `SwapService` (issue #19, in `app/`) is the actual orchestrator that calls
 * out to ports and policies; this module only has to answer "given where the
 * swap currently is, is this the next legal step, and if so what state does
 * it land in?" A plain `transition` function returning a
 * `{ ok: true, state } | { ok: false, error }` result — the same shape
 * `Library.addItem`/`lockItem` already use (`../library/library.ts`) — keeps
 * that answerable without any hidden state, mirrors the rest of `core`'s
 * error-reporting convention, and makes "illegal transitions are rejected,
 * not thrown past" trivially and exhaustively testable: every case is just
 * an assertion on a returned value.
 *
 * ## Design: one-way (asymmetric) swaps are the *same* phase sequence, not a branch
 *
 * SPEC.md §6.3: "One-way swaps are permitted. A node may seed generously
 * without receiving." A swap where nothing is offered, or nothing is
 * accepted, or both, must still flow through `negotiated -> transferred ->
 * completed` — it must not need a distinct "one-way" event, phase, or code
 * path. This module supports that by never requiring `toSend`/`toReceive`
 * (on `NEGOTIATION_COMPLETE`) or `sent`/`received` (on `TRANSFER_COMPLETE`)
 * to be non-empty: an empty array on either or both sides is exactly as
 * legal as a non-empty one, and reaches the identical terminal `completed`
 * phase. That symmetry in the *type* (both are always `readonly Item[]`,
 * never e.g. a separate `readonly Item` for "the one item transferred") is
 * what makes one-way a first-class path rather than a special case bolted
 * onto a fundamentally two-way model.
 */

import type { PeerKind } from "../ports/discovery-port.js";
import type { Item } from "../policies/policy-types.js";

/**
 * Every phase a swap can be in. `idle` is the starting phase before any peer
 * has been discovered. `completed` and `aborted` are the only terminal
 * phases — no event legally transitions out of either.
 */
export type SwapPhase =
  "idle" | "discovered" | "negotiating" | "negotiated" | "transferred" | "completed" | "aborted";

export interface SwapStateIdle {
  readonly phase: "idle";
}

export interface SwapStateDiscovered {
  readonly phase: "discovered";
  readonly peerKind: PeerKind;
}

export interface SwapStateNegotiating {
  readonly phase: "negotiating";
  readonly peerKind: PeerKind;
}

/**
 * `toSend`/`toReceive` are the negotiated sets — what `OfferPolicy` (this
 * side) and the peer's own accept decision agreed will move out, and what
 * `AcceptPolicy` (this side) agreed will move in. Either, or both, may be
 * empty — see the one-way design note above.
 */
export interface SwapStateNegotiated {
  readonly phase: "negotiated";
  readonly peerKind: PeerKind;
  readonly toSend: readonly Item[];
  readonly toReceive: readonly Item[];
}

export interface SwapStateTransferred {
  readonly phase: "transferred";
  readonly peerKind: PeerKind;
  readonly sent: readonly Item[];
  readonly received: readonly Item[];
}

export interface SwapStateCompleted {
  readonly phase: "completed";
  readonly peerKind: PeerKind;
  readonly sent: readonly Item[];
  readonly received: readonly Item[];
  readonly evicted: readonly Item[];
}

export interface SwapStateAborted {
  readonly phase: "aborted";
  readonly reason: string;
}

export type SwapState =
  | SwapStateIdle
  | SwapStateDiscovered
  | SwapStateNegotiating
  | SwapStateNegotiated
  | SwapStateTransferred
  | SwapStateCompleted
  | SwapStateAborted;

/** The starting state for a swap that has not yet discovered a peer. */
export function createInitialSwapState(): SwapState {
  return { phase: "idle" };
}

export type SwapEvent =
  | { readonly type: "PEER_DISCOVERED"; readonly peerKind: PeerKind }
  | { readonly type: "BEGIN_NEGOTIATION" }
  | {
      readonly type: "NEGOTIATION_COMPLETE";
      readonly toSend: readonly Item[];
      readonly toReceive: readonly Item[];
    }
  | {
      readonly type: "TRANSFER_COMPLETE";
      readonly sent: readonly Item[];
      readonly received: readonly Item[];
    }
  | { readonly type: "RECONCILE_COMPLETE"; readonly evicted: readonly Item[] }
  | { readonly type: "ABORT"; readonly reason: string };

export type SwapTransitionResult =
  { readonly ok: true; readonly state: SwapState } | { readonly ok: false; readonly error: string };

function illegal(state: SwapState, event: SwapEvent): SwapTransitionResult {
  return {
    ok: false,
    error: `Cannot apply event "${event.type}" while in phase "${state.phase}".`,
  };
}

/**
 * `true` if `state` is a terminal phase — no event legally transitions out
 * of it. Exposed for callers (e.g. `SwapService`) that want to guard against
 * driving an already-finished swap without re-deriving the phase list.
 */
export function isTerminal(state: SwapState): boolean {
  return state.phase === "completed" || state.phase === "aborted";
}

/**
 * Pure transition function: given the current `state` and an incoming
 * `event`, returns the next `SwapState` on success, or a descriptive
 * rejection on an illegal transition (e.g. transferring before negotiating,
 * reconciling before the transfer completes) — never throws.
 *
 * `ABORT` is legal from any non-terminal phase, modelling an interrupted
 * swap (full interrupted-swap *handling* is issue #47, a later Phase 2
 * batch; this only fixes that the state machine itself can represent "a
 * swap that stopped partway").
 */
export function transition(state: SwapState, event: SwapEvent): SwapTransitionResult {
  if (event.type === "ABORT") {
    if (isTerminal(state)) {
      return illegal(state, event);
    }
    return { ok: true, state: { phase: "aborted", reason: event.reason } };
  }

  switch (state.phase) {
    case "idle": {
      if (event.type === "PEER_DISCOVERED") {
        return { ok: true, state: { phase: "discovered", peerKind: event.peerKind } };
      }
      return illegal(state, event);
    }

    case "discovered": {
      if (event.type === "BEGIN_NEGOTIATION") {
        return { ok: true, state: { phase: "negotiating", peerKind: state.peerKind } };
      }
      return illegal(state, event);
    }

    case "negotiating": {
      if (event.type === "NEGOTIATION_COMPLETE") {
        return {
          ok: true,
          state: {
            phase: "negotiated",
            peerKind: state.peerKind,
            toSend: event.toSend,
            toReceive: event.toReceive,
          },
        };
      }
      return illegal(state, event);
    }

    case "negotiated": {
      if (event.type === "TRANSFER_COMPLETE") {
        return {
          ok: true,
          state: {
            phase: "transferred",
            peerKind: state.peerKind,
            sent: event.sent,
            received: event.received,
          },
        };
      }
      return illegal(state, event);
    }

    case "transferred": {
      if (event.type === "RECONCILE_COMPLETE") {
        return {
          ok: true,
          state: {
            phase: "completed",
            peerKind: state.peerKind,
            sent: state.sent,
            received: state.received,
            evicted: event.evicted,
          },
        };
      }
      return illegal(state, event);
    }

    case "completed":
    case "aborted":
      return illegal(state, event);
  }
}
