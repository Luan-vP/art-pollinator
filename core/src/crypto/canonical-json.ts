/**
 * Canonical JSON — deterministic serialisation with recursively sorted
 * object keys.
 *
 * Issue #58's interim canonicalization ("a simple deterministic JSON
 * stringify with sorted keys is fine, to be superseded by #24's real wire
 * format") and issue #24's wire codec both need the same primitive: two
 * structurally-equal values must always serialise to the *same* bytes,
 * regardless of the order their fields happened to be constructed in.
 * Plain `JSON.stringify` does not guarantee this — it preserves insertion
 * order — so a token built with `{ title, creator, ... }` and one built
 * with `{ creator, title, ... }` would sign/hash differently despite being
 * the same token. This module is that one shared canonicalization, used by
 * both `../metadata/metadata-token.ts` (signing) and `../protocol/swap-message-codec.ts`
 * (the wire format).
 *
 * `undefined`-valued object properties are dropped, matching
 * `JSON.stringify`'s own behaviour — important for `MetadataToken`'s
 * optional `signerPublicKey` field (issue #58): an unsigned token and a
 * signed-then-stripped token must canonicalize identically whether the
 * property is omitted or explicitly `undefined`.
 */

/** Deterministically stringify `value`: object keys sorted recursively, arrays preserve order. */
export function canonicalStringify(value: unknown): string {
  return stringifyValue(value);
}

function stringifyValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // JSON.stringify(undefined) returns `undefined` (not a string); callers
    // only ever reach this branch for a *value* already known not to be
    // undefined at the object-property level (filtered below), or for
    // primitives where that's the correct behaviour to mirror.
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyValue(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stringifyValue(record[key])}`);
  return `{${entries.join(",")}}`;
}
