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
 *
 * ## Wire-level padding (issue #60 — metadata uniformity review)
 *
 * `docs/adr/0016-metadata-uniformity-vs-provenance.md` records the full
 * measured review: a realistic `MetadataToken` sample ranges from ~328
 * bytes to ~4,374 bytes (a 13x spread), driven almost entirely by
 * free-text field length (title/creator/description) — issue #21's
 * provenance hop count contributes at most ~2 bytes across any realistic
 * range and is not a meaningful part of that variance. The ADR's
 * recommendation, implemented here, is **not** to pad every message up to
 * the full ~5 KB token budget (that would multiply typical BLE transfer
 * volume by up to ~15x for the common small-swap case, for a privacy
 * benefit undermined anyway by other, larger side channels — see the ADR's
 * §"Alternatives considered") but to round every encoded message's length
 * up to the next multiple of {@link DEFAULT_WIRE_PADDING_BLOCK_BYTES} —
 * collapsing a continuous, byte-exact length signal into a small number of
 * coarse size buckets, at a worst-case overhead capped at one block's
 * width regardless of the message's real size.
 *
 * Padding is applied to the whole envelope (not per-token) via one extra
 * field, `__pad`, holding a filler string of ASCII digits — chosen
 * specifically because a digit never needs JSON-escaping, so appending N
 * more of them to an already-computed envelope grows the encoded output
 * by *exactly* N bytes, with no re-measurement loop needed. `__pad` is
 * stripped by {@link decodeSwapProtocolMessage} before returning — callers
 * never see it, and every existing round-trip/equality test in this
 * codebase is unaffected (see this module's own tests for the exact
 * "padding never corrupts real content" proof issue #60 asks for).
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
  "revocation",
]);

/** The envelope field carrying wire-level padding (see this module's doc comment). Never part of {@link SwapProtocolMessage}'s own type — always stripped on decode. */
const PADDING_FIELD = "__pad";

/** A character guaranteed to require no JSON escaping, so growing the padding string by N characters grows the encoded output by exactly N bytes. */
const PADDING_CHAR = "0";

/**
 * Default block size (bytes) {@link encodeSwapProtocolMessage} rounds every
 * encoded message's length up to a multiple of. 256 bytes was chosen
 * (`docs/adr/0016-metadata-uniformity-vs-provenance.md`) to collapse the
 * measured ~328–4,374 byte realistic token range into roughly 20
 * observable size buckets, while capping worst-case overhead at roughly 256 bytes
 * regardless of the message's real size — negligible for a several-KB
 * offer, at most roughly doubling the very smallest realistic messages
 * (an empty `accept`/`reconcile-ack`).
 */
export const DEFAULT_WIRE_PADDING_BLOCK_BYTES = 256;

export interface EncodeSwapProtocolMessageOptions {
  /**
   * Round the encoded message up to a multiple of this many bytes. Pass
   * `0` to disable padding entirely (raw canonical bytes, the pre-#60
   * behaviour) — useful for a caller that wants to reason about a
   * message's true, unpadded size (e.g. `app/src/swap/short-contact-swap-profile.test.ts`'s
   * own byte-budget arithmetic deliberately keeps using the default here,
   * since padding overhead is itself part of the *real* bytes that would
   * cross a real wire). Defaults to {@link DEFAULT_WIRE_PADDING_BLOCK_BYTES}.
   */
  readonly padToBlockBytes?: number;
}

/**
 * Encode a `SwapProtocolMessage` to canonical bytes for `TransportPort.send`,
 * padded (by default) to the next multiple of `options.padToBlockBytes` —
 * see this module's doc comment.
 */
export function encodeSwapProtocolMessage(
  message: SwapProtocolMessage,
  options: EncodeSwapProtocolMessageOptions = {},
): Uint8Array {
  const blockBytes = options.padToBlockBytes ?? DEFAULT_WIRE_PADDING_BLOCK_BYTES;
  if (!Number.isInteger(blockBytes) || blockBytes < 0) {
    throw new Error(
      `encodeSwapProtocolMessage: padToBlockBytes must be a non-negative integer, got ${String(blockBytes)}.`,
    );
  }
  if (blockBytes === 0) {
    return utf8Encode(canonicalStringify(message));
  }

  const withEmptyPad = { ...message, [PADDING_FIELD]: "" };
  const baseLength = utf8Encode(canonicalStringify(withEmptyPad)).length;
  const remainder = baseLength % blockBytes;
  const padLength = remainder === 0 ? 0 : blockBytes - remainder;

  const withPad = { ...message, [PADDING_FIELD]: PADDING_CHAR.repeat(padLength) };
  return utf8Encode(canonicalStringify(withPad));
}

/**
 * Decode bytes received via `TransportPort.receive` back into a
 * `SwapProtocolMessage`. Throws a descriptive error (never returns a
 * partially-valid value) if:
 * - the bytes aren't valid UTF-8 JSON,
 * - `version` is missing or unsupported (see `./swap-message.ts`'s
 *   negotiation strategy), or
 * - `kind` is missing or not one of the five known message kinds.
 *
 * Strips {@link PADDING_FIELD} (issue #60's wire-level padding, if present)
 * before returning — the caller sees the exact same shape it would have
 * without padding ever having existed.
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

  const withoutPadding = { ...(parsed as Record<string, unknown>) };
  delete withoutPadding[PADDING_FIELD];
  return withoutPadding as unknown as SwapProtocolMessage;
}
