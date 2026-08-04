/**
 * A placeholder wire codec for `SwapService`'s two swap-protocol messages
 * (offer, ack), pending the real transport-agnostic message schema (issue
 * #22, a later batch) and the real wire format/codec (issue #24, a later
 * batch — "canonical, versioned, lossless round-trip"). This module is
 * deliberately *not* that: it is the minimal thing that lets `SwapService`
 * (issue #19) move `MetadataToken`s as `Uint8Array` bytes over a
 * `TransportPort` today, without waiting on either later design.
 *
 * `core`'s `tsconfig.json` sets `lib: ["ES2022"]` with no DOM/Node globals,
 * and neither does `app`'s (see `metadata-token.ts`'s `utf8ByteLength` doc
 * comment and `core/src/ports/fakes/fakes-integration.test.ts`, which
 * establishes this exact hand-rolled-UTF-8 pattern already) — so
 * `TextEncoder`/`TextDecoder` are not available here either. This file
 * reuses that same toy encode/decode approach rather than introducing a
 * dependency on a host global.
 */
import type { MetadataToken } from "@art-pollinator/core";

export interface SwapOfferMessage {
  readonly kind: "offer";
  readonly items: readonly MetadataToken[];
}

export interface SwapAckMessage {
  readonly kind: "ack";
  readonly acceptedContentHashes: readonly string[];
}

export type SwapMessage = SwapOfferMessage | SwapAckMessage;

function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) i++;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const byte0 = bytes[i];
    if (byte0 === undefined) break;
    if (byte0 <= 0x7f) {
      result += String.fromCodePoint(byte0);
      i += 1;
    } else if ((byte0 & 0xe0) === 0xc0) {
      const byte1 = bytes[i + 1] ?? 0;
      result += String.fromCodePoint(((byte0 & 0x1f) << 6) | (byte1 & 0x3f));
      i += 2;
    } else if ((byte0 & 0xf0) === 0xe0) {
      const byte1 = bytes[i + 1] ?? 0;
      const byte2 = bytes[i + 2] ?? 0;
      result += String.fromCodePoint(
        ((byte0 & 0x0f) << 12) | ((byte1 & 0x3f) << 6) | (byte2 & 0x3f),
      );
      i += 3;
    } else {
      const byte1 = bytes[i + 1] ?? 0;
      const byte2 = bytes[i + 2] ?? 0;
      const byte3 = bytes[i + 3] ?? 0;
      const codePoint =
        ((byte0 & 0x07) << 18) | ((byte1 & 0x3f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
      result += String.fromCodePoint(codePoint);
      i += 4;
    }
  }
  return result;
}

/** Encode a `SwapMessage` (offer or ack) to bytes for `TransportPort.send`. */
export function encodeSwapMessage(message: SwapMessage): Uint8Array {
  return encodeUtf8(JSON.stringify(message));
}

/** Decode bytes received via `TransportPort.receive` back into a `SwapMessage`. */
export function decodeSwapMessage(bytes: Uint8Array): SwapMessage {
  return JSON.parse(decodeUtf8(bytes)) as SwapMessage;
}
