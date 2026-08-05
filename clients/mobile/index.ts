import { registerRootComponent } from "expo";

import App from "./src/App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// It also ensures the environment is set up appropriately whether the app
// loads in a development build or a native build (Expo Go is not used for
// this project — see README.md — because the mobile composition root is
// expected to register a custom-native-module BLE adapter in #33/#34, which
// Expo Go cannot load).
registerRootComponent(App);
