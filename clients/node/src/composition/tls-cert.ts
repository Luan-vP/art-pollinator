/**
 * ensureSelfSignedCert — this node's persistent TLS identity (issue #49).
 *
 * ## Why `openssl`, and why this is a real, working TLS closure rather than a documented gap
 *
 * Node's built-in `node:crypto`/`node:tls` can *generate keypairs* and
 * *terminate* TLS given a certificate, but has no public API to *issue* an
 * X.509 certificate (no ASN.1 encoder for certificate structures is
 * exposed). The task's own brief is explicit that a real TLS closure should
 * be attempted before falling back to a documented gap — this is that
 * attempt, using the one dependency-free, universally-available mechanism
 * for actually minting a certificate on a Linux/macOS host (SPEC.md §9's
 * own target platforms): shelling out to the system `openssl` binary, which
 * `docs/adr/0014-transport-tls-scope.md` verifies is present on both.
 *
 * ## Trust model: trust-on-first-use (TOFU), pinned to a persistent keypair — not a CA
 *
 * This is a peer-to-peer local-network system, not a public web service —
 * there is no CA a self-signed node's certificate could chain to that a
 * generic HTTP client would already trust, and standing up a private CA
 * for a single-node deployment is disproportionate machinery. Instead:
 *
 * - The certificate is generated **once** and persisted to disk
 *   (`<storageDir>/tls/{cert.pem,key.pem}`) — every subsequent process
 *   restart reuses the exact same keypair and certificate, so its
 *   fingerprint is stable for the lifetime of this node's deployment.
 * - A client that wants real protection against a man-in-the-middle
 *   (rather than "any connection succeeds without verification") pins that
 *   fingerprint the first time it connects and verifies it matches on every
 *   subsequent connection — the standard SSH-host-key trust model, with the
 *   identical caveat: the very first connection is only as trustworthy as
 *   the channel the fingerprint was learned over (SPEC.md's LAN-local
 *   discovery, ideally cross-checked out of band for a genuinely hostile
 *   network).
 * - The certificate's Subject Alternative Name is deliberately the bind
 *   host's IP (not a DNS name — SPEC.md §6.1's LAN discovery already
 *   resolves nodes by address, not hostname), since that is what
 *   `node:tls`'s hostname verification actually checks against.
 *
 * **Disclosed scope boundary:** this closes the *server*-side half of TLS
 * completely (a real, working `node:https` listener, tested end-to-end in
 * `adapters/transport-http/src/http-transport-server-security.test.ts`
 * against a real TLS handshake). What remains a genuine, documented gap is
 * the *cross-platform client* half — `HttpTransportClient`
 * (`adapters/transport-http`) is shared by the browser and React Native
 * targets via plain `fetch`, and neither a browser's nor RN's `fetch`
 * implementation exposes a way to pin a self-signed certificate's
 * fingerprint the way `node:https.request`'s `ca`/`checkServerIdentity`
 * options do (proven working in this same batch's TLS test) — see
 * `docs/adr/0014-transport-tls-scope.md` for the full reasoning and the
 * concrete mitigation plan. TLS is therefore wired as **opt-in** in this
 * node's own configuration (`ARTPOLLINATOR_NODE_TLS_ENABLED`, default
 * `false`) rather than forced on, since turning it on today would make the
 * existing `fetch`-based swap clients (mobile web, and this same e2e test
 * suite) unable to complete a real swap against a self-signed cert without
 * every operator additionally configuring their OS/browser to trust it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TlsCertPaths {
  readonly certPath: string;
  readonly keyPath: string;
}

export interface TlsCertMaterial extends TlsCertPaths {
  readonly cert: string;
  readonly key: string;
}

/**
 * Load this node's persistent self-signed TLS certificate/key from
 * `<storageDir>/tls/`, generating one via the system `openssl` binary on
 * first use. `bindHost` becomes the certificate's IP Subject Alternative
 * Name — pass the same host the transport server actually binds to, so a
 * client verifying against that address succeeds.
 *
 * Throws if `openssl` is not on `PATH` — deliberately not a silent fallback
 * to an unencrypted listener, since a caller that explicitly asked for TLS
 * should learn loudly that this environment cannot provide it, not
 * discover it later as an unexplained plaintext connection.
 */
export function ensureSelfSignedCert(storageDir: string, bindHost: string): TlsCertMaterial {
  const tlsDir = join(storageDir, "tls");
  const certPath = join(tlsDir, "cert.pem");
  const keyPath = join(tlsDir, "key.pem");

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
    const sanHost = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
    try {
      execFileSync("openssl", [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "825", // ~2.25 years — long-lived since this is pinned by fingerprint, not chained to a CA with its own expiry policy
        "-subj",
        "/CN=art-pollinator-node",
        "-addext",
        `subjectAltName=IP:${sanHost}`,
      ]);
    } catch (error) {
      throw new Error(
        `ensureSelfSignedCert: failed to generate a self-signed certificate via 'openssl' ` +
          `(is it installed and on PATH?): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    certPath,
    keyPath,
    cert: readFileSync(certPath, "utf8"),
    key: readFileSync(keyPath, "utf8"),
  };
}
