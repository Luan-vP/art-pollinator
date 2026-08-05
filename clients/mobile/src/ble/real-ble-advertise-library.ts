/**
 * Real `munim-bluetooth` shim for `@art-pollinator/discovery-ble`'s
 * `BleAdvertiseLibrary` (ADR-0011). The only place in this codebase that
 * actually imports `munim-bluetooth` (native-only) — lives under
 * `composition-root.native.ts`'s resolution path only.
 *
 * `munim-bluetooth` exports plain module-level functions
 * (`startAdvertising`/`stopAdvertising`), both synchronous, rather than a
 * class instance — this shim wraps them to match
 * `BleAdvertiseLibrary`'s `Promise`-returning shape (which exists so the
 * adapter package's own tests can drive it with an async fake uniformly
 * alongside `BleCentralLibrary`'s genuinely-async methods).
 *
 * **Real-hardware verification of this exact shim is undischarged** —
 * see `@art-pollinator/discovery-ble`'s README. `munim-bluetooth` itself
 * carries "no long production track record" (ADR-0011) — this shim has
 * been typechecked against its shipped type definitions but never run
 * against an actual BLE peripheral-mode radio.
 */
import { startAdvertising, stopAdvertising } from "munim-bluetooth";
import type { BleAdvertiseLibrary } from "@art-pollinator/discovery-ble";

export function createRealBleAdvertiseLibrary(): BleAdvertiseLibrary {
  return {
    startAdvertising: (options) => {
      startAdvertising({ serviceUUIDs: [...options.serviceUUIDs] });
      return Promise.resolve();
    },
    stopAdvertising: () => {
      stopAdvertising();
      return Promise.resolve();
    },
  };
}
