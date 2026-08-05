import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createCompositionRoot as createNativeCompositionRoot } from "./composition-root.native.js";
import { createCompositionRoot as createWebCompositionRoot } from "./composition-root.web.js";

// This test imports the platform-specific modules directly by filename
// because vitest (plain Node) has no concept of Metro's platform-extension
// resolution — that resolution only exists at Metro bundle time (issue
// #30). Reaching for the concrete file here is deliberate, not a
// workaround: it lets us assert the two platforms' capabilities actually
// differ, which the bundler-time resolution alone cannot prove.

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("capability negotiation at the composition root (issue #30)", () => {
  it("registers BLE capability on native (iOS/Android)", () => {
    expect(createNativeCompositionRoot().capabilities.ble).toBe(true);
  });

  it("registers NO BLE capability on web — Web Bluetooth cannot advertise (SPEC.md §8)", () => {
    expect(createWebCompositionRoot().capabilities.ble).toBe(false);
  });

  it("both platforms support Wi-Fi node swaps (SPEC.md §8 capability tiers table)", () => {
    expect(createNativeCompositionRoot().capabilities.wifiNodeSwap).toBe(true);
    expect(createWebCompositionRoot().capabilities.wifiNodeSwap).toBe(true);
  });

  it("neither composition-root variant registers a transport/discovery port yet", () => {
    // #33/#34/#43/#44 have not landed in this batch — both platforms leave
    // the port fields undefined rather than a no-op fake standing in.
    expect(createNativeCompositionRoot().ports.transport).toBeUndefined();
    expect(createNativeCompositionRoot().ports.discovery).toBeUndefined();
    expect(createWebCompositionRoot().ports.transport).toBeUndefined();
    expect(createWebCompositionRoot().ports.discovery).toBeUndefined();
  });

  // Matches an actual runtime conditional (a comparison against
  // Platform.OS/typeof window), not the doc comments in these same files
  // that *describe* the mechanism in prose — those legitimately mention
  // "Platform.OS" and "typeof window" as concepts without ever branching on
  // them, which is exactly the point being documented (AGENTS.md §2 rule 2).
  const RUNTIME_CONDITIONAL_PATTERN = /(Platform\.OS\s*[=!]==|typeof\s+window\s*[=!]==)/;

  it.each(["composition-root.native.ts", "composition-root.web.ts", "types.ts"])(
    "%s contains no Platform.OS or typeof window runtime conditional — the platform split is a file, not a runtime branch (AGENTS.md §2 rule 2)",
    (file) => {
      const contents = readFileSync(join(__dirname, file), "utf8");
      expect(contents).not.toMatch(RUNTIME_CONDITIONAL_PATTERN);
    },
  );
});
