import { useEffect, useState } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import type { Library } from "@art-pollinator/core";
import { lockedItems, swappableItems } from "@art-pollinator/core";

import { useCapabilities, useServices } from "../composition/capabilities-context";

/**
 * The library screen (issues #29, #32, #38). Deliberately unstyled beyond
 * basic layout — real UX is Phase 3 (IMPLEMENTATION.md #55).
 *
 * Issue #38's DoD: "Library screen lists slots (locked + swappable) with
 * lock/unlock controls." Both pools render as their own section, each item
 * with a single button that either locks or unlocks it, driven by
 * `LibraryService` (`../composition/capabilities-context.tsx`'s
 * `useServices()`) — `core`'s `lockItem`/`unlockItem` rejection cases
 * (pool full, item absent) surface as a plain inline error message rather
 * than anything richer; this screen's whole point right now is proving the
 * wiring works end to end, not polished error UX.
 *
 * The BLE section below is entirely absent on web, not rendered-and-disabled,
 * because `capabilities.ble` was decided once at the composition root
 * (issue #30) by which platform-specific module Metro bundled in — no
 * `Platform.OS` check appears anywhere in this file or its imports.
 */
export function LibraryScreen() {
  const capabilities = useCapabilities();
  const { libraryService } = useServices();
  const [library, setLibrary] = useState<Library>(() => libraryService.getLibrary());
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    return libraryService.subscribe(setLibrary);
  }, [libraryService]);

  const locked = lockedItems(library);
  const swappable = swappableItems(library);

  function handleLock(contentHash: string) {
    const result = libraryService.lock(contentHash);
    setError(result.ok ? undefined : result.error);
  }

  function handleUnlock(contentHash: string) {
    const result = libraryService.unlock(contentHash);
    setError(result.ok ? undefined : result.error);
  }

  return (
    <View style={styles.container} testID="library-screen">
      <Text style={styles.heading}>ArtPollinator</Text>
      <Text style={styles.body}>
        Library: {locked.length + swappable.length} / 10 slots ({locked.length} locked,{" "}
        {swappable.length} swappable in use)
      </Text>
      {error ? (
        <Text style={styles.error} testID="library-error">
          {error}
        </Text>
      ) : null}

      <View style={styles.section} testID="locked-section">
        <Text style={styles.sectionHeading}>Locked (never evicted, never offered)</Text>
        {locked.length === 0 ? <Text style={styles.body}>Nothing locked.</Text> : null}
        {locked.map((token) => (
          <View style={styles.item} key={token.contentHash} testID={`item-${token.contentHash}`}>
            <Text style={styles.itemTitle}>
              {token.title} — {token.creator}
            </Text>
            <Pressable onPress={() => handleUnlock(token.contentHash)}>
              <Text style={styles.action}>Unlock</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.section} testID="swappable-section">
        <Text style={styles.sectionHeading}>Swappable</Text>
        {swappable.length === 0 ? <Text style={styles.body}>Nothing in this slot yet.</Text> : null}
        {swappable.map((token) => (
          <View style={styles.item} key={token.contentHash} testID={`item-${token.contentHash}`}>
            <Text style={styles.itemTitle}>
              {token.title} — {token.creator}
            </Text>
            <Pressable onPress={() => handleLock(token.contentHash)}>
              <Text style={styles.action}>Lock</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.section} testID="wifi-node-swap-section">
        <Text style={styles.sectionHeading}>Swap with a nearby node</Text>
        <Text style={styles.body}>
          Wi-Fi node swaps are supported on this platform (issues #43/#44). See the swap screen for
          incoming activity.
        </Text>
      </View>

      {capabilities.ble ? (
        <View style={styles.section} testID="ble-section">
          <Text style={styles.sectionHeading}>Nearby people</Text>
          <Text style={styles.body}>
            BLE peer discovery is supported on this platform (issues #33/#34) — see
            docs/spikes/0028-background-ble-feasibility.md.
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
  error: {
    fontSize: 14,
    color: "red",
  },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTitle: {
    fontSize: 14,
    flexShrink: 1,
  },
  action: {
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
