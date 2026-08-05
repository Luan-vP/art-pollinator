import { describe, expect, it } from "vitest";
import { isPlaceholderSeedEnabled } from "./placeholder-seed-gate.js";

describe("isPlaceholderSeedEnabled — defaults to disabled (issue #42 hard boundary)", () => {
  it("is FALSE when neither isDevBuild nor explicitOptIn is set — the real default for any normal (release) build", () => {
    expect(isPlaceholderSeedEnabled({ isDevBuild: false, explicitOptIn: false })).toBe(false);
  });

  it("is FALSE in a dev build without the explicit opt-in — being in a debug build alone is not enough", () => {
    expect(isPlaceholderSeedEnabled({ isDevBuild: true, explicitOptIn: false })).toBe(false);
  });

  it("is FALSE with the explicit opt-in set but NOT a dev build — this is the release-build case the DoD requires: even a misconfigured/leaked env flag cannot enable it in a release build", () => {
    expect(isPlaceholderSeedEnabled({ isDevBuild: false, explicitOptIn: true })).toBe(false);
  });

  it("is TRUE only when both isDevBuild AND explicitOptIn are true", () => {
    expect(isPlaceholderSeedEnabled({ isDevBuild: true, explicitOptIn: true })).toBe(true);
  });

  it("exhaustive truth table: only the (true, true) row is enabled", () => {
    const rows: readonly { isDevBuild: boolean; explicitOptIn: boolean; expected: boolean }[] = [
      { isDevBuild: false, explicitOptIn: false, expected: false },
      { isDevBuild: false, explicitOptIn: true, expected: false },
      { isDevBuild: true, explicitOptIn: false, expected: false },
      { isDevBuild: true, explicitOptIn: true, expected: true },
    ];
    for (const row of rows) {
      expect(isPlaceholderSeedEnabled(row)).toBe(row.expected);
    }
  });
});
