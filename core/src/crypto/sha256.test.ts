import { describe, expect, it } from "vitest";
import { hexEncode, utf8Encode } from "./bytes.js";
import { hashContent, sha256, sha256Hex, sha256HexOfText } from "./sha256.js";

describe("sha256 — FIPS 180-4 / RFC test vectors", () => {
  it("hashes the empty string to the well-known empty-input digest", () => {
    expect(sha256HexOfText("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it('hashes "abc" to the FIPS 180-4 one-block test vector', () => {
    expect(sha256HexOfText("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the FIPS 180-4 two-block test vector", () => {
    expect(sha256HexOfText("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("hashes 1,000,000 repetitions of 'a' to the FIPS 180-4 long-input test vector", () => {
    expect(sha256HexOfText("a".repeat(1_000_000))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("sha256 returns a 32-byte digest matching sha256Hex's hex encoding", () => {
    const bytes = utf8Encode("hello world");
    const digest = sha256(bytes);
    expect(digest).toHaveLength(32);
    expect(hexEncode(digest)).toBe(sha256Hex(bytes));
  });

  it("is deterministic: identical input always produces identical output", () => {
    const bytes = utf8Encode("Study for a coastline at dusk");
    expect(sha256Hex(bytes)).toBe(sha256Hex(bytes));
  });

  it("a single changed byte produces a completely different digest (avalanche)", () => {
    const a = sha256HexOfText("content-hash-input-A");
    const b = sha256HexOfText("content-hash-input-B");
    expect(a).not.toBe(b);
  });

  it("hashContent is the same function as sha256Hex (the #23 'content hashing function')", () => {
    const bytes = utf8Encode("a piece of art, in bytes");
    expect(hashContent(bytes)).toBe(sha256Hex(bytes));
  });
});
