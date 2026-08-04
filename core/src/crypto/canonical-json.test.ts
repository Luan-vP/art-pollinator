import { describe, expect, it } from "vitest";
import { canonicalStringify } from "./canonical-json.js";

describe("canonicalStringify", () => {
  it("produces identical output regardless of key insertion order", () => {
    const a = { title: "A", creator: "B", contentHash: "c" };
    const b = { contentHash: "c", title: "A", creator: "B" };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("sorts keys recursively in nested objects", () => {
    const nested = { outer: { z: 1, a: 2 }, alpha: 1 };
    expect(canonicalStringify(nested)).toBe('{"alpha":1,"outer":{"a":2,"z":1}}');
  });

  it("preserves array order (arrays are ordered, unlike object keys)", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined-valued object properties, matching JSON.stringify", () => {
    const withUndefined = { a: 1, b: undefined };
    expect(canonicalStringify(withUndefined)).toBe(JSON.stringify({ a: 1 }));
  });

  it("an omitted optional property and an explicit undefined canonicalize identically", () => {
    interface Shape {
      readonly a: number;
      readonly b?: string | undefined;
    }
    const omitted: Shape = { a: 1 };
    const explicit: Shape = { a: 1, b: undefined };
    expect(canonicalStringify(omitted)).toBe(canonicalStringify(explicit));
  });

  it("round-trips through JSON.parse for a representative nested shape", () => {
    const value = { z: [1, 2, { y: "x", w: 3 }], a: "hello", nested: { b: null } };
    const parsed: unknown = JSON.parse(canonicalStringify(value));
    expect(parsed).toEqual(value);
  });

  it("handles non-ASCII text without altering the round-tripped value", () => {
    const value = { title: "日本語アート 🎨", note: "café" };
    const parsed: unknown = JSON.parse(canonicalStringify(value));
    expect(parsed).toEqual(value);
  });
});
