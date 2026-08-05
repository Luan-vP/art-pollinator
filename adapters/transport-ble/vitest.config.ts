import { defineConfig } from "vitest/config";

// This sandbox has no BLE radio and no iOS/Android device or simulator
// (see docs/spikes/0028-background-ble-feasibility.md's own method
// section). Every test in this package runs against a MOCKED
// react-native-ble-plx-shaped surface (`src/fakes/`), never real
// hardware — live two-device BLE pairing remains an explicit,
// undischarged gap; see README.md.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
