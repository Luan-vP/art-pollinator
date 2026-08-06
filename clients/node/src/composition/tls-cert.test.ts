import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as https from "node:https";
import { ensureSelfSignedCert } from "./tls-cert.js";
import { HttpTransportServer } from "@art-pollinator/transport-http";

let dir: string | undefined;
let server: HttpTransportServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close().catch(() => undefined);
    server = undefined;
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("ensureSelfSignedCert (issue #49)", () => {
  it("generates a certificate and key on first use", () => {
    dir = mkdtempSync(join(tmpdir(), "art-pollinator-tls-cert-"));
    const material = ensureSelfSignedCert(dir, "127.0.0.1");
    expect(material.cert).toContain("BEGIN CERTIFICATE");
    expect(material.key).toContain("PRIVATE KEY");
  });

  it("reuses the same persisted certificate/key on a second call — a stable, TOFU-pinnable identity across restarts", () => {
    dir = mkdtempSync(join(tmpdir(), "art-pollinator-tls-cert-"));
    const first = ensureSelfSignedCert(dir, "127.0.0.1");
    const second = ensureSelfSignedCert(dir, "127.0.0.1");
    expect(second.cert).toBe(first.cert);
    expect(second.key).toBe(first.key);
  });

  it("the generated certificate works as a real TLS listener a client can connect to (pinned trust, not disabled verification)", async () => {
    dir = mkdtempSync(join(tmpdir(), "art-pollinator-tls-cert-"));
    const material = ensureSelfSignedCert(dir, "127.0.0.1");

    const s = new HttpTransportServer({
      tls: { cert: material.cert, key: material.key },
      longPollTimeoutMs: 500, // the test's GET below has nothing queued — bound how long it waits before a 204
    });
    server = s;
    const { baseUrl, port } = await s.listen(0, "127.0.0.1");
    expect(baseUrl).toMatch(/^https:\/\//);

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = https.request(
        { host: "127.0.0.1", port, path: "/messages?peer=x", method: "GET", ca: material.cert },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
    // 204 or 200 from a real long-poll — the point is the TLS handshake
    // succeeded against the pinned cert (an untrusted cert would reject
    // before any HTTP status was ever received).
    expect(status).toBeDefined();
  });

  it("persists the cert/key files at the documented paths under storageDir/tls/", () => {
    dir = mkdtempSync(join(tmpdir(), "art-pollinator-tls-cert-"));
    const material = ensureSelfSignedCert(dir, "127.0.0.1");
    expect(material.certPath).toBe(join(dir, "tls", "cert.pem"));
    expect(material.keyPath).toBe(join(dir, "tls", "key.pem"));
    expect(readFileSync(material.certPath, "utf8")).toBe(material.cert);
  });
});
