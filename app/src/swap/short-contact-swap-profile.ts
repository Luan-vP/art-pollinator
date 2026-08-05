/**
 * Short-contact swap profile — issue #36. Tunes how `SwapService` is used
 * (not `SwapService` itself, which needs no changes: it already exchanges
 * metadata tokens only, in exactly two round trips — offer, then accept —
 * per SPEC.md §6.2, and blob transfer isn't wired up yet regardless) for a
 * 2–10 second person-to-person BLE contact window (SPEC.md §3.1, ADR-0010's
 * "foreground-first" model: a user opens the app during a brief encounter).
 *
 * ## What this profile actually constrains
 *
 * `SwapService` has no internal timeouts or retry loops to tune — it
 * simply awaits `TransportPort.send`/`receive` in sequence. The one
 * variable that determines how long a swap actually takes on a real BLE
 * link is **how much data crosses the wire**, which is a function of how
 * many items get offered. `maxItemsPerOffer` is this profile's actual
 * knob: a caller (composition root or `OfferPolicy`) constrains
 * `library`/`OfferPolicy.selectOffer` output to at most this many items
 * before handing it to `SwapService`, keeping worst-case transfer volume
 * bounded regardless of how large the caller's library is.
 *
 * ## The throughput number is a documented ASSUMPTION, not a measurement
 *
 * `assumedThroughputBytesPerSecond` is **not** measured on real hardware —
 * this sandbox has no BLE radio (`docs/spikes/0028-background-ble-feasibility.md`).
 * `10 * 1024` B/s is chosen to be consistent with SPEC.md §3.1's own
 * framing that a single ~5KB token "transfers in well under a second over
 * BLE" (at 10 KB/s, 5KB transfers in ~0.5s — comfortably "well under," not
 * borderline) and is a commonly-cited conservative figure for BLE 4.2+
 * effective GATT throughput with a reasonably negotiated MTU (>=185 bytes,
 * per `@art-pollinator/transport-ble`'s chunking doc comment). Real-device
 * measurement is a genuine follow-up, the same category of gap issue #35
 * already discloses for battery cost — not fabricated here.
 */
import { METADATA_TOKEN_MAX_BYTES } from "@art-pollinator/core";

export interface ShortContactSwapProfile {
  readonly minWindowSeconds: number;
  readonly maxWindowSeconds: number;
  /** Upper bound on items either side offers in one swap — the actual lever that bounds transfer volume/time. */
  readonly maxItemsPerOffer: number;
  /** A documented ASSUMPTION (see this file's doc comment), not a real-device measurement. */
  readonly assumedThroughputBytesPerSecond: number;
}

/**
 * Defaults chosen so the worst case (every offered item at the full
 * {@link METADATA_TOKEN_MAX_BYTES} budget, both sides offering the maximum)
 * lands well inside the 2–10s window at the assumed throughput —
 * see `estimateWorstCaseOfferTransferMs`'s doc comment and this profile's
 * own test for the arithmetic.
 */
export const SHORT_CONTACT_SWAP_PROFILE: ShortContactSwapProfile = {
  minWindowSeconds: 2,
  maxWindowSeconds: 10,
  maxItemsPerOffer: 3,
  assumedThroughputBytesPerSecond: 10 * 1024,
};

/**
 * Estimated worst-case wall-clock time (ms) for both sides' `offer`
 * messages to cross the wire in a swap where each side offers up to
 * `itemCount` items at the full token size budget — the dominant cost of
 * a swap (`accept` messages carry only content hashes, negligible by
 * comparison, and are not included). This is an ESTIMATE derived from
 * `profile.assumedThroughputBytesPerSecond` (see this file's doc comment)
 * and `@art-pollinator/core`'s real, measured `METADATA_TOKEN_MAX_BYTES`
 * constant — not a real-device measurement itself.
 */
export function estimateWorstCaseOfferTransferMs(
  itemCount: number,
  profile: ShortContactSwapProfile = SHORT_CONTACT_SWAP_PROFILE,
): number {
  const bytesOneWay = itemCount * METADATA_TOKEN_MAX_BYTES;
  const totalBytesBothWays = bytesOneWay * 2;
  return (totalBytesBothWays / profile.assumedThroughputBytesPerSecond) * 1000;
}

/** Whether offering `itemCount` items per side fits inside `profile`'s window, under the throughput assumption above. */
export function fitsWithinShortContactWindow(
  itemCount: number,
  profile: ShortContactSwapProfile = SHORT_CONTACT_SWAP_PROFILE,
): boolean {
  return estimateWorstCaseOfferTransferMs(itemCount, profile) <= profile.maxWindowSeconds * 1000;
}
