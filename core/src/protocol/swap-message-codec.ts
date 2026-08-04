/**
 * Wire codec for the swap protocol — issue #24. Canonical, versioned,
 * lossless round-trip encode/decode for every `SwapProtocolMessage`
 * (`./swap-message.ts`, issue #22).
 *
 * Supersedes the placeholder in `app/src/swap/swap-message-codec.ts`
 * (ADR-0006), which existed only because issues #22/#24 hadn't landed yet.
 * That file now delegates here.
 *
 * ## Canonical encoding
 *
 * `{@link canonicalStringify}` (`../crypto/canonical-json.ts`) gives a
 * deterministic byte representation — the same message always encodes to
 * the same bytes regardless of field construction order — then
 * `{@link utf8Encode}` (`../crypto/bytes.ts`) turns that into the
 * `Uint8Array` `TransportPort.send`/`receive` moves. This is deliberately
 * the same two-step shape `../metadata/metadata-token.ts`'s
 * `canonicalizeTokenForSigning` uses for the narrower "just the signed
 * fields" case (issue #58) — one canonicalization primitive, two call
 * sites.
 *
 * ## Version handling
 *
 * `decodeSwapProtocolMessage` checks `version` against
 * {@link isSupportedVersion} *before* trusting `kind` or `body` — an
 * unsupported version is rejected outright with a descriptive error, per
 * `./swap-message.ts`'s documented reject-on-mismatch negotiation strategy.
 */
import { canonicalStringify } from "../crypto/canonical-json.js";
import { utf8Decode, utf8Encode } from "../crypto/bytes.js";
import {
  isSupportedVersion,
  SWAP_PROTOCOL_VERSION,
  type SwapProtocolMessage,
} from "./swap-message.js";

const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "discover-ack",
  "offer",
  "accept",
  "transfer",
  "reconcile-ack",
]);

/** Encode a `SwapProtocolMessage` to canonical bytes for `TransportPort.send`. */
export function encodeSwapProtocolMessage(message: SwapProtocolMessage): Uint8Array {
  return utf8Encode(canonicalStringify(message));
}

/**
 * Decode bytes received via `TransportPort.receive` back into a
 * `SwapProtocolMessage`. Throws a descriptive error (never returns a
 * partially-valid value) if:
 * - the bytes aren't valid UTF-8 JSON,
 * - `version` is missing or unsupported (see `./swap-message.ts`'s
 *   negotiation strategy), or
 * - `kind` is missing or not one of the five known message kinds.
 */
export function decodeSwapProtocolMessage(bytes: Uint8Array): SwapProtocolMessage {
  const text = utf8Decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`decodeSwapProtocolMessage: invalid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("decodeSwapProtocolMessage: expected a JSON object envelope.");
  }
  const envelope = parsed as { version?: unknown; kind?: unknown; body?: unknown };

  if (typeof envelope.version !== "number" || !isSupportedVersion(envelope.version)) {
    throw new Error(
      `decodeSwapProtocolMessage: unsupported protocol version ${JSON.stringify(envelope.version)} ` +
        `(this build supports version ${String(SWAP_PROTOCOL_VERSION)}).`,
    );
  }
  if (typeof envelope.kind !== "string" || !KNOWN_KINDS.has(envelope.kind)) {
    throw new Error(
      `decodeSwapProtocolMessage: unknown message kind ${JSON.stringify(envelope.kind)}.`,
    );
  }

  return parsed as SwapProtocolMessage;
}
