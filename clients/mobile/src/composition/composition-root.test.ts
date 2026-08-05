import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// `composition-root.native.ts` now wires real `react-native-ble-plx` /
// `munim-bluetooth` instances (issues #33/#34). Both packages ship
// Flow-typed runtime source that Vite/Rollup's SSR module transform cannot
// parse outside a Metro/Babel toolchain (confirmed empirically while
// wiring this up: a plain `import` of either package here failed with
// "Error: Expected '{', got 'type'" before this test file was updated to
// mock them) — this is exactly the class of problem AGENTS.md §5's
// "native-only imports must never reach the shared path" rule anticipates,
// just surfacing in a test tool instead of a shipped bundle. `vi.mock`
// replaces both packages with a minimal stand-in *before* Vite ever needs
// to load their real source, letting this suite still import and execute
// `composition-root.native.ts` for real, rather than falling back to
// source-text-only assertions.
vi.mock("react-native-ble-plx", () => ({
  BleManager: class {
    startDeviceScan(): void {
      /* no-op stand-in — see this file's header comment */
    }
    stopDeviceScan(): void {
      /* no-op stand-in */
    }
  },
}));
vi.mock("munim-bluetooth", () => ({
  startAdvertising: () => undefined,
  stopAdvertising: () => undefined,
}));

const { createCompositionRoot: createNativeCompositionRoot } =
  await import("./composition-root.native.js");
const { createCompositionRoot: createWebCompositionRoot } =
  await import("./composition-root.web.js");

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

  it("native registers BleTransportAdapter/BleDiscoveryAdapter for transport/discovery (issues #33/#34)", () => {
    const root = createNativeCompositionRoot();
    expect(root.ports.transport).toBeDefined();
    expect(root.ports.discovery).toBeDefined();
    expect(root.ports.transport?.constructor.name).toBe("BleTransportAdapter");
    expect(root.ports.discovery?.constructor.name).toBe("BleDiscoveryAdapter");
  });

  it("web registers HttpTransportClient/LanDiscoveryProber for transport/discovery (issues #43/#44)", () => {
    const root = createWebCompositionRoot();
    expect(root.ports.transport).toBeDefined();
    expect(root.ports.discovery).toBeDefined();
    expect(root.ports.transport?.constructor.name).toBe("HttpTransportClient");
    expect(root.ports.discovery?.constructor.name).toBe("LanDiscoveryProber");
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
