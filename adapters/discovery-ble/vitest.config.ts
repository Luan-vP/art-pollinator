import { defineConfig } from "vitest/config";

// No BLE radio, no iOS/Android device or simulator in this sandbox
// (docs/spikes/0028-background-ble-feasibility.md). Every test here runs
// against mocked react-native-ble-plx/munim-bluetooth-shaped surfaces
// (`src/fake-ble-scan-and-advertise-fabric.ts`) — see README.md for what
// remains unverified pending real hardware.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    restoreMocks: true,
    passWithNoTests: false,
  },
});
