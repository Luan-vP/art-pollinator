/**
 * Message framing/chunking over a small-MTU GATT link (issue #33).
 *
 * SPEC.md §3.1 budgets a `MetadataToken` at close to 5KB; a single BLE
 * characteristic write/notify payload is bounded by the negotiated ATT
 * MTU minus a 3-byte ATT header — commonly as low as 20 usable bytes
 * (unnegotiated default MTU 23) and rarely above ~500 even when a larger
 * MTU is negotiated. A ~5KB message therefore never fits in one GATT
 * write/notify and must be split into multiple chunks on send and
 * reassembled on receive — this is that framing, kept entirely separate
 * from any BLE library so it is pure, dependency-free logic testable
 * without mocking anything.
 *
 * ## Frame format
 *
 * Each chunk is `[isLastByte, ...payloadBytes]` — a single leading byte
 * (`0x00` = more chunks follow, `0x01` = this is the final chunk of the
 * message) followed by that chunk's slice of the original message. No
 * chunk-index or total-length is carried: the swap protocol this carries
 * is strictly one in-flight message per direction at a time (`SwapService`
 * always awaits a `receive()` before sending its next message — see
 * `app/src/swap/swap-service.ts`), so a single reassembly buffer per peer,
 * cleared when a final chunk arrives, is sufficient and keeps per-chunk
 * overhead to the minimum single byte.
 */

/** ATT protocol header overhead subtracted from the negotiated MTU to get the usable payload budget per write/notify. */
export const ATT_HEADER_OVERHEAD_BYTES = 3;
/** This framing's own per-chunk overhead: the one leading `isLast` byte. */
const FRAME_HEADER_BYTES = 1;

/** Split `message` into MTU-sized chunks, each carrying the one-byte `isLast` frame header described in this module's doc comment. */
export function chunkMessage(message: Uint8Array, mtu: number): readonly Uint8Array[] {
  const payloadPerChunk = Math.max(mtu - ATT_HEADER_OVERHEAD_BYTES - FRAME_HEADER_BYTES, 1);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  do {
    const slice = message.subarray(offset, offset + payloadPerChunk);
    const isLast = offset + slice.length >= message.length;
    const frame = new Uint8Array(slice.length + 1);
    frame[0] = isLast ? 1 : 0;
    frame.set(slice, 1);
    chunks.push(frame);
    offset += payloadPerChunk;
  } while (offset < message.length);
  return chunks;
}

/**
 * Accumulates chunks for one peer's in-flight message. `push` returns the
 * complete, reassembled message once a final chunk (`isLast = 1`) arrives,
 * and `undefined` while more chunks are still expected.
 */
export class MessageReassembler {
  private bytes: number[] = [];

  push(frame: Uint8Array): Uint8Array | undefined {
    if (frame.length === 0) {
      throw new Error("MessageReassembler: received an empty frame (missing isLast header byte)");
    }
    const isLast = frame[0] === 1;
    for (let i = 1; i < frame.length; i++) {
      const byte = frame[i];
      if (byte !== undefined) this.bytes.push(byte);
    }
    if (!isLast) return undefined;
    const result = new Uint8Array(this.bytes);
    this.bytes = [];
    return result;
  }
}
