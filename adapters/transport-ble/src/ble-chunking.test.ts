/**
 * Pure logic tests for chunking/reassembly — no BLE mocking needed at all,
 * since `./ble-chunking.ts` has no dependency on any BLE library.
 */
import { describe, expect, it } from "vitest";
import { chunkMessage, MessageReassembler } from "./ble-chunking.js";

function roundTrip(message: Uint8Array, mtu: number): Uint8Array {
  const chunks = chunkMessage(message, mtu);
  const reassembler = new MessageReassembler();
  let result: Uint8Array | undefined;
  for (const chunk of chunks) {
    result = reassembler.push(chunk);
  }
  if (!result) throw new Error("test error: reassembly never completed");
  return result;
}

describe("chunkMessage + MessageReassembler", () => {
  it("a message that fits in one chunk produces exactly one, final chunk", () => {
    const message = new Uint8Array([1, 2, 3]);
    const chunks = chunkMessage(message, 23); // default unnegotiated MTU
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.[0]).toBe(1); // isLast
  });

  it("splits a message across multiple chunks when it exceeds the MTU budget", () => {
    const message = new Uint8Array(100).map((_, i) => i);
    const chunks = chunkMessage(message, 23); // usable payload = 23-3-1 = 19 bytes/chunk
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk[0]).toBe(0); // not last
    }
    expect(chunks.at(-1)?.[0]).toBe(1); // last
  });

  it("round-trips a small message through chunk+reassemble unchanged", () => {
    const message = new Uint8Array([10, 20, 30, 40, 50]);
    const result = roundTrip(message, 23);
    expect(Array.from(result)).toEqual(Array.from(message));
  });

  it("round-trips a ~5KB message (SPEC.md §3.1's MetadataToken budget) at the default unnegotiated MTU of 23", () => {
    const message = new Uint8Array(5_000).map((_, i) => i % 256);
    const chunks = chunkMessage(message, 23);
    // 23 - 3 (ATT header) - 1 (frame header) = 19 usable bytes/chunk
    expect(chunks.length).toBe(Math.ceil(5_000 / 19));
    const result = roundTrip(message, 23);
    expect(Array.from(result)).toEqual(Array.from(message));
  });

  it("round-trips the same ~5KB message at a larger negotiated MTU (e.g. 185, a common negotiated value), using far fewer chunks", () => {
    const message = new Uint8Array(5_000).map((_, i) => i % 256);
    const chunksSmallMtu = chunkMessage(message, 23);
    const chunksLargeMtu = chunkMessage(message, 185);
    expect(chunksLargeMtu.length).toBeLessThan(chunksSmallMtu.length);
    const result = roundTrip(message, 185);
    expect(Array.from(result)).toEqual(Array.from(message));
  });

  it("round-trips an empty message as a single final empty-payload chunk", () => {
    const message = new Uint8Array(0);
    const chunks = chunkMessage(message, 23);
    expect(chunks.length).toBe(1);
    const result = roundTrip(message, 23);
    expect(result.length).toBe(0);
  });

  it("MessageReassembler processes an interleaved-free sequence of chunks for one message correctly, then resets for the next", () => {
    const reassembler = new MessageReassembler();
    const first = chunkMessage(new Uint8Array([1, 2, 3, 4, 5]), 6); // forces multiple chunks: 6-3-1=2 bytes/chunk
    let firstResult: Uint8Array | undefined;
    for (const chunk of first) firstResult = reassembler.push(chunk);
    expect(Array.from(firstResult ?? [])).toEqual([1, 2, 3, 4, 5]);

    const second = chunkMessage(new Uint8Array([9, 8, 7]), 6);
    let secondResult: Uint8Array | undefined;
    for (const chunk of second) secondResult = reassembler.push(chunk);
    expect(Array.from(secondResult ?? [])).toEqual([9, 8, 7]);
  });

  it("throws on an empty frame (missing the isLast header byte)", () => {
    const reassembler = new MessageReassembler();
    expect(() => {
      reassembler.push(new Uint8Array(0));
    }).toThrow();
  });

  it("never produces a chunk smaller than 1 payload byte even at a pathologically tiny MTU", () => {
    const message = new Uint8Array([1, 2, 3]);
    const chunks = chunkMessage(message, 1); // smaller than the framing overhead itself
    // Every chunk still carries the 1-byte isLast header plus >=1 payload byte.
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThanOrEqual(2);
    }
    const result = roundTrip(message, 1);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });
});
