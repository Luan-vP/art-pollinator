/**
 * NodeIdentityAdapter — the real `IdentityPort` implementation for a Node
 * environment (issue #57). Node's built-in `node:crypto` (Ed25519 —
 * fast, small signatures, well-supported) and `node:fs` for persistence.
 *
 * This is exactly the I/O `core` is forbidden from doing itself (AGENTS.md
 * §2 rule 1): real keypair generation needs a CSPRNG, and secure storage
 * needs a filesystem. `IdentityPort`'s interface (`@art-pollinator/core`)
 * is unchanged — this adapter only implements it.
 *
 * ## Two identity modes, one class (SPEC.md §7)
 *
 * - **`"node"`** — persistent. Generated once, on first use, and reused
 *   across restarts by reading the same file back. `rotateIdentity()` is a
 *   documented no-op for this mode (returns the current identity unchanged)
 *   rather than throwing — `IdentityPort`'s own doc comment explicitly
 *   allows "reject or no-op," and no-op is the gentler choice: a caller
 *   that unconditionally calls `rotateIdentity()` (e.g. a future generic
 *   "rotate before each swap" policy) should not have to special-case node
 *   identities to avoid an exception.
 * - **`"person"`** — rotating/ephemeral. Generated on first use, then
 *   automatically rotated once {@link DEFAULT_PERSON_ROTATION_INTERVAL_MS}
 *   (or a caller-supplied `rotationIntervalMs`) has elapsed since the
 *   current identity was created — checked lazily on every
 *   `getCurrentIdentity()` call, so nothing needs a background timer.
 *   `rotateIdentity()` can also be called explicitly at any time (e.g. a
 *   future "rotate per encounter" policy) to force rotation regardless of
 *   elapsed time. See `docs/adr/0007-provenance-hop-count-only.md`'s
 *   sibling privacy concern — rotation cadence is a related but distinct
 *   design call, documented here rather than in a separate ADR since it's
 *   a parameter choice, not an architectural one: 1 hour is a reasonable
 *   default balance between linkability (shorter is better for privacy)
 *   and the cost of re-establishing trust/signatures each rotation (longer
 *   is cheaper) for a Phase 1a placeholder; Phase 2's security model
 *   (issue #49) is the right place to revisit this with real threat
 *   modelling.
 *
 * The *creation timestamp* (not just the current key) is persisted to
 * disk, so a process restart does not reset the rotation clock — rotation
 * cadence is measured in real wall-clock time regardless of how many times
 * the process has restarted in between.
 *
 * ## Storage: filesystem with restrictive permissions, not a platform keychain
 *
 * Issue #57 asks for "platform keychain/keystore where available." A
 * cross-platform Node keychain binding (e.g. macOS Keychain, Windows
 * Credential Manager, libsecret) would be a real npm dependency, and this
 * adapter is explicitly scoped to "works for the node server target"
 * (SPEC.md §9 Phase 2, this task's own framing) — a long-lived Linux/macOS
 * service process, not a desktop app where an interactive OS keychain
 * prompt makes sense. For that target, a private key file under a
 * `0o700` directory with `0o600` permissions (owner read/write only) is the
 * practical, dependency-free equivalent, and is what this adapter does.
 * **Gap, noted rather than solved:** a real platform-keychain-backed
 * adapter (for a future desktop/mobile composition root) is out of scope
 * here and would be a separate adapter package, not an extension of this
 * one — `adapters/*` packages name their technology (AGENTS.md §5), and
 * "identity-node" specifically means this one.
 */
import * as nodeCrypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hexEncode, type DeviceIdentity, type IdentityPort } from "@art-pollinator/core";

export type NodeIdentityMode = "node" | "person";

/** Default rotation cadence for `"person"` identities — see this file's doc comment for the reasoning. */
export const DEFAULT_PERSON_ROTATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface NodeIdentityAdapterOptions {
  readonly mode: NodeIdentityMode;
  /** Directory the identity file is stored in. Defaults to `~/.art-pollinator/identity`. Override in tests to use a temp directory. */
  readonly storageDir?: string;
  /** `"person"` mode only — how long a rotating identity lives before `getCurrentIdentity()` automatically rotates it. Defaults to {@link DEFAULT_PERSON_ROTATION_INTERVAL_MS}. Ignored for `"node"` mode. */
  readonly rotationIntervalMs?: number;
}

interface StoredIdentity {
  readonly id: string;
  readonly createdAtEpochMs: number;
  readonly publicKeyJwk: nodeCrypto.JsonWebKey;
  readonly privateKeyJwk: nodeCrypto.JsonWebKey;
}

interface LoadedIdentity {
  readonly id: string;
  readonly publicKey: Uint8Array;
  readonly privateKey: nodeCrypto.KeyObject;
  readonly createdAtEpochMs: number;
}

function jwkPublicKeyBytes(jwk: nodeCrypto.JsonWebKey): Uint8Array {
  if (!jwk.x) {
    throw new Error("NodeIdentityAdapter: JWK is missing its 'x' (public key) field.");
  }
  return new Uint8Array(Buffer.from(jwk.x, "base64url"));
}

export class NodeIdentityAdapter implements IdentityPort {
  private readonly mode: NodeIdentityMode;
  private readonly filePath: string;
  private readonly rotationIntervalMs: number;
  private current: LoadedIdentity | undefined;

  constructor(options: NodeIdentityAdapterOptions) {
    this.mode = options.mode;
    const dir = options.storageDir ?? join(homedir(), ".art-pollinator", "identity");
    this.filePath = join(dir, `${options.mode}-identity.json`);
    this.rotationIntervalMs = options.rotationIntervalMs ?? DEFAULT_PERSON_ROTATION_INTERVAL_MS;
  }

  async getCurrentIdentity(): Promise<DeviceIdentity> {
    this.ensureLoaded();
    if (this.mode === "person" && this.rotationDue()) {
      this.generateAndPersist();
    }
    return this.toDeviceIdentity();
  }

  sign(data: Uint8Array): Promise<Uint8Array> {
    this.ensureLoaded();
    const current = this.current;
    if (!current) {
      throw new Error("NodeIdentityAdapter: identity failed to load.");
    }
    const signature = nodeCrypto.sign(null, Buffer.from(data), current.privateKey);
    return Promise.resolve(new Uint8Array(signature));
  }

  /**
   * `"person"` mode: forces immediate rotation regardless of elapsed time.
   * `"node"` mode: a documented no-op — returns the current identity
   * unchanged (see this file's doc comment on why no-op rather than reject).
   */
  rotateIdentity(): Promise<DeviceIdentity> {
    this.ensureLoaded();
    if (this.mode === "node") {
      return Promise.resolve(this.toDeviceIdentity());
    }
    this.generateAndPersist();
    return Promise.resolve(this.toDeviceIdentity());
  }

  private rotationDue(): boolean {
    const current = this.current;
    if (!current) return false;
    return Date.now() - current.createdAtEpochMs >= this.rotationIntervalMs;
  }

  private ensureLoaded(): void {
    if (this.current) return;
    if (existsSync(this.filePath)) {
      this.loadFromDisk();
    } else {
      this.generateAndPersist();
    }
  }

  private loadFromDisk(): void {
    const raw = readFileSync(this.filePath, "utf8");
    const stored = JSON.parse(raw) as StoredIdentity;
    const privateKey = nodeCrypto.createPrivateKey({ key: stored.privateKeyJwk, format: "jwk" });
    this.current = {
      id: stored.id,
      publicKey: jwkPublicKeyBytes(stored.publicKeyJwk),
      privateKey,
      createdAtEpochMs: stored.createdAtEpochMs,
    };
  }

  private generateAndPersist(): void {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ed25519");
    const publicKeyJwk = publicKey.export({ format: "jwk" });
    const privateKeyJwk = privateKey.export({ format: "jwk" });
    const publicKeyBytes = jwkPublicKeyBytes(publicKeyJwk);
    const id = `ed25519:${hexEncode(publicKeyBytes)}`;
    const createdAtEpochMs = Date.now();

    this.persist({ id, createdAtEpochMs, publicKeyJwk, privateKeyJwk });
    this.current = { id, publicKey: publicKeyBytes, privateKey, createdAtEpochMs };
  }

  private persist(stored: StoredIdentity): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.filePath, JSON.stringify(stored), { mode: 0o600 });
    try {
      // Belt-and-suspenders: some platforms/filesystems ignore writeFileSync's
      // `mode` option on an existing file. Best-effort — POSIX permission
      // bits don't universally apply (e.g. Windows), so failures here are
      // swallowed rather than treated as fatal.
      chmodSync(this.filePath, 0o600);
    } catch {
      // best-effort only
    }
  }

  private toDeviceIdentity(): DeviceIdentity {
    const current = this.current;
    if (!current) {
      throw new Error("NodeIdentityAdapter: identity failed to load.");
    }
    return { id: current.id, publicKey: current.publicKey };
  }
}
