import { StatusBar } from "expo-status-bar";
import { ScrollView, StyleSheet, View } from "react-native";

import { CapabilitiesProvider } from "./composition/capabilities-context";
import { LibraryScreen } from "./screens/library-screen";
import { SwapScreen } from "./screens/swap-screen";

/**
 * No navigation library is wired up (deliberately unstyled scope, issue
 * #38 — "real UX is Phase 3") — both screens simply stack in a
 * `ScrollView`, in a fixed order, rather than behind a router/tab bar this
 * batch does not need to build.
 */
export default function App() {
  return (
    <CapabilitiesProvider>
      <View style={styles.root}>
        <ScrollView>
          <LibraryScreen />
          <SwapScreen />
        </ScrollView>
        <StatusBar style="auto" />
      </View>
    </CapabilitiesProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
});
