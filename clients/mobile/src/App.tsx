import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";

import { CapabilitiesProvider } from "./composition/capabilities-context";
import { LibraryScreen } from "./screens/library-screen";

export default function App() {
  return (
    <CapabilitiesProvider>
      <View style={styles.root}>
        <LibraryScreen />
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
