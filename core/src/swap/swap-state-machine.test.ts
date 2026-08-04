import { describe, expect, it } from "vitest";
import type { MetadataToken } from "../metadata/metadata-token.js";
import {
  createInitialSwapState,
  isTerminal,
  transition,
  type SwapEvent,
  type SwapState,
} from "./swap-state-machine.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { contentHash },
    contentHash,
    signature: "",
  };
}

function expectOk(state: SwapState, event: SwapEvent): SwapState {
  const result = transition(state, event);
  if (!result.ok) {
    throw new Error(`expected an ok transition, got rejected: ${result.error}`);
  }
  return result.state;
}

function expectRejected(state: SwapState, event: SwapEvent): string {
  const result = transition(state, event);
  if (result.ok) {
    throw new Error(
      `expected transition to be rejected, but it succeeded: ${JSON.stringify(result.state)}`,
    );
  }
  return result.error;
}

/** The full, legal happy-path sequence of events for a two-way swap. */
function driveToCompletion(peerKind: "node" | "person" = "person"): SwapState {
  let state = createInitialSwapState();
  state = expectOk(state, { type: "PEER_DISCOVERED", peerKind });
  state = expectOk(state, { type: "BEGIN_NEGOTIATION" });
  state = expectOk(state, {
    type: "NEGOTIATION_COMPLETE",
    toSend: [token("out-1")],
    toReceive: [token("in-1")],
  });
  state = expectOk(state, {
    type: "TRANSFER_COMPLETE",
    sent: [token("out-1")],
    received: [token("in-1")],
  });
  state = expectOk(state, { type: "RECONCILE_COMPLETE", evicted: [] });
  return state;
}

describe("swap state machine: happy path", () => {
  it("starts in the idle phase", () => {
    expect(createInitialSwapState()).toEqual({ phase: "idle" });
  });

  it("walks discover -> negotiate -> transfer -> reconcile to completion", () => {
    const state = driveToCompletion();
    expect(state.phase).toBe("completed");
  });

  it("carries peerKind through every phase", () => {
    let state = createInitialSwapState();
    state = expectOk(state, { type: "PEER_DISCOVERED", peerKind: "node" });
    expect(state).toMatchObject({ phase: "discovered", peerKind: "node" });
    state = expectOk(state, { type: "BEGIN_NEGOTIATION" });
    expect(state).toMatchObject({ phase: "negotiating", peerKind: "node" });
    state = expectOk(state, { type: "NEGOTIATION_COMPLETE", toSend: [], toReceive: [] });
    expect(state).toMatchObject({ phase: "negotiated", peerKind: "node" });
  });

  it("carries the negotiated sent/received sets through transfer into the completed state", () => {
    const sent = [token("out-1"), token("out-2")];
    const received = [token("in-1")];
    let state = createInitialSwapState();
    state = expectOk(state, { type: "PEER_DISCOVERED", peerKind: "person" });
    state = expectOk(state, { type: "BEGIN_NEGOTIATION" });
    state = expectOk(state, { type: "NEGOTIATION_COMPLETE", toSend: sent, toReceive: received });
    state = expectOk(state, { type: "TRANSFER_COMPLETE", sent, received });
    const evicted = [token("evicted-1")];
    state = expectOk(state, { type: "RECONCILE_COMPLETE", evicted });
    expect(state).toEqual({
      phase: "completed",
      peerKind: "person",
      sent,
      received,
      evicted,
    });
  });

  it("isTerminal is true only for completed and aborted phases", () => {
    expect(isTerminal({ phase: "idle" })).toBe(false);
    expect(isTerminal({ phase: "discovered", peerKind: "person" })).toBe(false);
    expect(isTerminal({ phase: "negotiating", peerKind: "person" })).toBe(false);
    expect(isTerminal({ phase: "negotiated", peerKind: "person", toSend: [], toReceive: [] })).toBe(
      false,
    );
    expect(isTerminal({ phase: "transferred", peerKind: "person", sent: [], received: [] })).toBe(
      false,
    );
    expect(
      isTerminal({
        phase: "completed",
        peerKind: "person",
        sent: [],
        received: [],
        evicted: [],
      }),
    ).toBe(true);
    expect(isTerminal({ phase: "aborted", reason: "x" })).toBe(true);
  });
});

describe("swap state machine: one-way (asymmetric) flows are a first-class terminal path", () => {
  it("reaches completed when only this side offers and the peer sends nothing back", () => {
    let state = createInitialSwapState();
    state = expectOk(state, { type: "PEER_DISCOVERED", peerKind: "person" });
    state = expectOk(state, { type: "BEGIN_NEGOTIATION" });
    state = expectOk(state, {
      type: "NEGOTIATION_COMPLETE",
      toSend: [token("seed-1"), token("seed-2")],
      toReceive: [],
    });
    state = expectOk(state, {
      type: "TRANSFER_COMPLETE",
      sent: [token("seed-1"), token("seed-2")],
      received: [],
    });
    state = expectOk(state, { type: "RECONCILE_COMPLETE", evicted: [] });
    expect(state.phase).toBe("completed");
    expect(state).toMatchObject({ received: [], sent: [token("seed-1"), token("seed-2")] });
  });

  it("reaches completed when only this side receives and nothing is sent out", () => {
    let state = createInitialSwapState();
    state = expectOk(state, { type: "PEER_DISCOVERED", peerKind: "node" });
    state = expectOk(state, { type: "BEGIN_NEGOTIATION" });
    state = expectOk(state, {
      type: "NEGOTIATION_COMPLETE",
      toSend: [],
      toReceive: [token("gift-1")],
    });
    state = expectOk(state, {
      type: "TRANSFER_COMPLETE",
      sent: [],
      received: [token("gift-1")],
    });
    state = expectOk(state, { type: "RECONCILE_COMPLETE", evicted: [token("evicted-1")] });
    expect(state.phase).toBe("completed");
    expect(state).toMatchObject({ sent: [], received: [token("gift-1")] });
  });

  it("reaches completed when neither side offers or accepts anything (a degenerate mutual pass)", () => {
    let state = createInitialSwapState();
    state = expectOk(state, { type: "PEER_DISCOVERED", peerKind: "person" });
    state = expectOk(state, { type: "BEGIN_NEGOTIATION" });
    state = expectOk(state, { type: "NEGOTIATION_COMPLETE", toSend: [], toReceive: [] });
    state = expectOk(state, { type: "TRANSFER_COMPLETE", sent: [], received: [] });
    state = expectOk(state, { type: "RECONCILE_COMPLETE", evicted: [] });
    expect(state.phase).toBe("completed");
  });

  it("the one-way and two-way flows pass through the identical phase sequence, not a distinct branch", () => {
    const twoWayPhases: string[] = [];
    let state = createInitialSwapState();
    twoWayPhases.push(state.phase);
    state = expectOk(state, { type: "PEER_DISCOVERED", peerKind: "person" });
    twoWayPhases.push(state.phase);
    state = expectOk(state, { type: "BEGIN_NEGOTIATION" });
    twoWayPhases.push(state.phase);
    state = expectOk(state, {
      type: "NEGOTIATION_COMPLETE",
      toSend: [token("a")],
      toReceive: [token("b")],
    });
    twoWayPhases.push(state.phase);
    state = expectOk(state, {
      type: "TRANSFER_COMPLETE",
      sent: [token("a")],
      received: [token("b")],
    });
    twoWayPhases.push(state.phase);
    state = expectOk(state, { type: "RECONCILE_COMPLETE", evicted: [] });
    twoWayPhases.push(state.phase);

    const oneWayPhases: string[] = [];
    let oneWay = createInitialSwapState();
    oneWayPhases.push(oneWay.phase);
    oneWay = expectOk(oneWay, { type: "PEER_DISCOVERED", peerKind: "person" });
    oneWayPhases.push(oneWay.phase);
    oneWay = expectOk(oneWay, { type: "BEGIN_NEGOTIATION" });
    oneWayPhases.push(oneWay.phase);
    oneWay = expectOk(oneWay, {
      type: "NEGOTIATION_COMPLETE",
      toSend: [token("only-out")],
      toReceive: [],
    });
    oneWayPhases.push(oneWay.phase);
    oneWay = expectOk(oneWay, {
      type: "TRANSFER_COMPLETE",
      sent: [token("only-out")],
      received: [],
    });
    oneWayPhases.push(oneWay.phase);
    oneWay = expectOk(oneWay, { type: "RECONCILE_COMPLETE", evicted: [] });
    oneWayPhases.push(oneWay.phase);

    expect(oneWayPhases).toEqual(twoWayPhases);
  });
});

describe("swap state machine: illegal transitions are rejected, exhaustively", () => {
  it("rejects BEGIN_NEGOTIATION from idle (no peer discovered yet)", () => {
    const error = expectRejected(createInitialSwapState(), { type: "BEGIN_NEGOTIATION" });
    expect(error).toMatch(/idle/);
  });

  it("rejects NEGOTIATION_COMPLETE from idle", () => {
    expectRejected(createInitialSwapState(), {
      type: "NEGOTIATION_COMPLETE",
      toSend: [],
      toReceive: [],
    });
  });

  it("rejects TRANSFER_COMPLETE from idle — cannot transfer before discovering a peer", () => {
    expectRejected(createInitialSwapState(), {
      type: "TRANSFER_COMPLETE",
      sent: [],
      received: [],
    });
  });

  it("rejects RECONCILE_COMPLETE from idle — cannot reconcile before anything else has happened", () => {
    expectRejected(createInitialSwapState(), { type: "RECONCILE_COMPLETE", evicted: [] });
  });

  it("rejects a second PEER_DISCOVERED once already discovered", () => {
    const discovered = expectOk(createInitialSwapState(), {
      type: "PEER_DISCOVERED",
      peerKind: "person",
    });
    const error = expectRejected(discovered, { type: "PEER_DISCOVERED", peerKind: "node" });
    expect(error).toMatch(/discovered/);
  });

  it("rejects TRANSFER_COMPLETE before negotiating — cannot transfer before negotiation begins", () => {
    const discovered = expectOk(createInitialSwapState(), {
      type: "PEER_DISCOVERED",
      peerKind: "person",
    });
    expectRejected(discovered, { type: "TRANSFER_COMPLETE", sent: [], received: [] });
  });

  it("rejects TRANSFER_COMPLETE before negotiation *completes* — negotiating is not negotiated", () => {
    const discovered = expectOk(createInitialSwapState(), {
      type: "PEER_DISCOVERED",
      peerKind: "person",
    });
    const negotiating = expectOk(discovered, { type: "BEGIN_NEGOTIATION" });
    const error = expectRejected(negotiating, {
      type: "TRANSFER_COMPLETE",
      sent: [],
      received: [],
    });
    expect(error).toMatch(/negotiating/);
  });

  it("rejects RECONCILE_COMPLETE before the transfer completes", () => {
    const discovered = expectOk(createInitialSwapState(), {
      type: "PEER_DISCOVERED",
      peerKind: "person",
    });
    const negotiating = expectOk(discovered, { type: "BEGIN_NEGOTIATION" });
    const negotiated = expectOk(negotiating, {
      type: "NEGOTIATION_COMPLETE",
      toSend: [],
      toReceive: [],
    });
    const error = expectRejected(negotiated, { type: "RECONCILE_COMPLETE", evicted: [] });
    expect(error).toMatch(/negotiated/);
  });

  it("rejects BEGIN_NEGOTIATION twice in a row", () => {
    const discovered = expectOk(createInitialSwapState(), {
      type: "PEER_DISCOVERED",
      peerKind: "person",
    });
    const negotiating = expectOk(discovered, { type: "BEGIN_NEGOTIATION" });
    expectRejected(negotiating, { type: "BEGIN_NEGOTIATION" });
  });

  it("rejects NEGOTIATION_COMPLETE twice in a row", () => {
    const discovered = expectOk(createInitialSwapState(), {
      type: "PEER_DISCOVERED",
      peerKind: "person",
    });
    const negotiating = expectOk(discovered, { type: "BEGIN_NEGOTIATION" });
    const negotiated = expectOk(negotiating, {
      type: "NEGOTIATION_COMPLETE",
      toSend: [],
      toReceive: [],
    });
    expectRejected(negotiated, { type: "NEGOTIATION_COMPLETE", toSend: [], toReceive: [] });
  });

  it("rejects TRANSFER_COMPLETE twice in a row", () => {
    const discovered = expectOk(createInitialSwapState(), {
      type: "PEER_DISCOVERED",
      peerKind: "person",
    });
    const negotiating = expectOk(discovered, { type: "BEGIN_NEGOTIATION" });
    const negotiated = expectOk(negotiating, {
      type: "NEGOTIATION_COMPLETE",
      toSend: [],
      toReceive: [],
    });
    const transferred = expectOk(negotiated, { type: "TRANSFER_COMPLETE", sent: [], received: [] });
    expectRejected(transferred, { type: "TRANSFER_COMPLETE", sent: [], received: [] });
  });

  it("rejects every event once completed — completed is terminal", () => {
    const completed = driveToCompletion();
    const events: SwapEvent[] = [
      { type: "PEER_DISCOVERED", peerKind: "person" },
      { type: "BEGIN_NEGOTIATION" },
      { type: "NEGOTIATION_COMPLETE", toSend: [], toReceive: [] },
      { type: "TRANSFER_COMPLETE", sent: [], received: [] },
      { type: "RECONCILE_COMPLETE", evicted: [] },
      { type: "ABORT", reason: "too late" },
    ];
    for (const event of events) {
      expectRejected(completed, event);
    }
  });

  it("rejects every event once aborted — aborted is terminal", () => {
    const aborted = expectOk(createInitialSwapState(), { type: "ABORT", reason: "peer vanished" });
    expect(aborted.phase).toBe("aborted");
    const events: SwapEvent[] = [
      { type: "PEER_DISCOVERED", peerKind: "person" },
      { type: "BEGIN_NEGOTIATION" },
      { type: "NEGOTIATION_COMPLETE", toSend: [], toReceive: [] },
      { type: "TRANSFER_COMPLETE", sent: [], received: [] },
      { type: "RECONCILE_COMPLETE", evicted: [] },
      { type: "ABORT", reason: "again" },
    ];
    for (const event of events) {
      expectRejected(aborted, event);
    }
  });
});

describe("swap state machine: ABORT", () => {
  it("is legal from every non-terminal phase", () => {
    const nonTerminalStates: SwapState[] = [
      { phase: "idle" },
      { phase: "discovered", peerKind: "person" },
      { phase: "negotiating", peerKind: "person" },
      { phase: "negotiated", peerKind: "person", toSend: [], toReceive: [] },
      { phase: "transferred", peerKind: "person", sent: [], received: [] },
    ];
    for (const state of nonTerminalStates) {
      const result = transition(state, { type: "ABORT", reason: "connection dropped" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state).toEqual({ phase: "aborted", reason: "connection dropped" });
      }
    }
  });

  it("never transitions out of aborted, including via another ABORT", () => {
    const aborted = expectOk(createInitialSwapState(), { type: "ABORT", reason: "first" });
    const error = expectRejected(aborted, { type: "ABORT", reason: "second" });
    expect(error).toMatch(/aborted/);
  });
});
