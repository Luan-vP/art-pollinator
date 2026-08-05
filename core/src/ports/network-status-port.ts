/**
 * NetworkStatusPort — is the current connection Wi-Fi, and is it metered?
 *
 * AGENTS.md §6 (fixed parameters): "Blob fetching: Wi-Fi only; never over
 * BLE; not on metered connections by default." The deferred blob queue
 * (issue #41, `app/src/blob/deferred-blob-queue.ts`) needs a way to ask
 * "is it currently okay to start a blob fetch?" without `app` reaching for
 * a platform-specific connectivity API directly (AGENTS.md §2 rule 1/2) —
 * exactly the gap this port closes, following the same shape every other
 * driven port in this directory already uses (own file, own in-memory fake,
 * re-exported from `./index.ts`/`./fakes/index.ts`).
 *
 * ## Why "kind" is a closed set that does not include "ble"
 *
 * `NetworkConnectionKind` enumerates *IP network* connection types — BLE is
 * a device-to-device radio link, not an IP network, so it is not a case
 * this port ever reports. This is deliberate, not an oversight: it makes
 * "never fetch a blob over BLE" true *by construction* for any caller that
 * only ever triggers a fetch when `current().kind === "wifi"` — there is no
 * `"ble"` value such a check could ever accidentally admit. The BLE
 * transport (`@art-pollinator/transport-ble`) is a completely separate
 * code path from blob fetching and never calls this port at all.
 *
 * ## Why this is a poll (`current()`), not a subscription
 *
 * A push-based "notify me when connectivity changes" API is the richer
 * shape a real adapter (native `NetInfo`-style listener, or the browser's
 * `navigator.connection`) could still implement underneath — but the
 * deferred blob queue's actual need is simpler: "when I am about to attempt
 * a fetch, is it currently permitted?" A poll answers that directly, without
 * `app` having to manage a subscription's lifecycle just to ask one
 * yes/no question at the moment it matters. An adapter is free to serve
 * `current()` from its own internally-cached, push-updated state.
 */

/** Connection kinds this port distinguishes. Deliberately excludes BLE — see this file's doc comment. */
export type NetworkConnectionKind = "wifi" | "cellular" | "ethernet" | "none" | "unknown";

export interface NetworkStatus {
  readonly kind: NetworkConnectionKind;
  /** `true` if the current connection is metered (e.g. a cellular data plan, or Wi-Fi explicitly marked metered by the OS). Meaningless (but still present, as `false`) when `kind` is `"none"`. */
  readonly isMetered: boolean;
}

export interface NetworkStatusPort {
  /** The connection currently in effect, as best this adapter can determine it. */
  current(): Promise<NetworkStatus>;
}
