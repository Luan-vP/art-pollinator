import { StyleSheet, Text, View } from "react-native";

import { useCapabilities } from "../composition/capabilities-context";

/**
 * The single scaffold screen (issues #29, #32). Deliberately unstyled
 * beyond basic layout — real UX is Phase 3 (IMPLEMENTATION.md #55).
 *
 * Its job right now is to prove the capability wiring end to end: the BLE
 * section below is entirely absent on web, not rendered-and-disabled,
 * because `capabilities.ble` was decided once at the composition root
 * (issue #30) by which platform-specific module Metro bundled in — no
 * `Platform.OS` check appears anywhere in this file or its imports.
 */
export function LibraryScreen() {
  const capabilities = useCapabilities();

  return (
    <View style={styles.container} testID="library-screen">
      <Text style={styles.heading}>ArtPollinator</Text>
      <Text style={styles.body}>Library: 0 / 10 slots (0 locked, 0 swappable in use)</Text>

      <View style={styles.section} testID="wifi-node-swap-section">
        <Text style={styles.sectionHeading}>Swap with a nearby node</Text>
        <Text style={styles.body}>
          Wi-Fi node swaps are supported on this platform. The transport adapter has not landed yet
          (issue #43/#44).
        </Text>
      </View>

      {capabilities.ble ? (
        <View style={styles.section} testID="ble-section">
          <Text style={styles.sectionHeading}>Nearby people</Text>
          <Text style={styles.body}>
            BLE peer discovery is supported on this platform. The adapter has not landed yet (issue
            #33/#34) — see docs/spikes/0028-background-ble-feasibility.md.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  heading: {
    fontSize: 24,
    fontWeight: "600",
  },
  section: {
    gap: 4,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "600",
  },
  body: {
    fontSize: 14,
  },
});
