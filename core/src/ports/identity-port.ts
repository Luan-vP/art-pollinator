/**
 * IdentityPort — this device's identity keypair.
 *
 * SPEC.md §7: nodes have persistent identities, people use rotating
 * ephemeral ones. Full identity generation, rotation policy, and secure
 * storage is issue #57 (a later, cross-cutting batch) — this port
 * deliberately only fixes the shape `core` needs *now* (get the current
 * identity, sign bytes with it, ask for rotation) and does not encode
 * *which* persistence model a given caller uses. `rotateIdentity` is
 * included because the domain (SPEC.md §7) requires rotation to exist as a
 * capability; whether a given adapter honours it (people) or treats it as a
 * no-op/rejection (nodes, which are persistent by design) is left to that
 * adapter, not decided here — encoding that choice in this interface would
 * foreclose issue #57's design rather than leave room for it.
 */

/** This device or user's current identity, as `core` needs to see it: an id and a public key. Never a private key — that stays inside the adapter. */
export interface DeviceIdentity {
  readonly id: string;
  readonly publicKey: Uint8Array;
}

export interface IdentityPort {
  /** The identity currently in effect for this device/user. */
  getCurrentIdentity(): Promise<DeviceIdentity>;

  /** Sign opaque bytes with the current identity's private key. */
  sign(data: Uint8Array): Promise<Uint8Array>;

  /**
   * Request rotation to a new ephemeral identity. Adapters for
   * persistent-identity nodes may reject or no-op this; adapters for
   * rotating-identity people are expected to honour it. See issue #57.
   */
  rotateIdentity(): Promise<DeviceIdentity>;
}
