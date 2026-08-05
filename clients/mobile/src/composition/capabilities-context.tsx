import React, { createContext, useContext, useMemo } from "react";

// This is the one seam in the whole app that resolves per-platform: Metro
// picks composition-root.web.ts for the web bundle and
// composition-root.native.ts for iOS/Android, purely by filename extension
// (issue #30). Everything below this line is ordinary, platform-agnostic
// React.
import { createCompositionRoot } from "./composition-root";
import type { ClientCapabilities } from "./types";

const CapabilitiesContext = createContext<ClientCapabilities | undefined>(undefined);

export function CapabilitiesProvider({ children }: { children: React.ReactNode }) {
  // Computed once per app instance — the composition root only needs to run
  // once, not on every render.
  const capabilities = useMemo(() => createCompositionRoot().capabilities, []);

  return (
    <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>
  );
}

/**
 * Read the current platform's capabilities (issue #32). Screens use this to
 * decide whether to render a BLE affordance at all — SPEC.md §8 requires it
 * absent, not disabled, on platforms that lack it.
 */
export function useCapabilities(): ClientCapabilities {
  const capabilities = useContext(CapabilitiesContext);
  if (!capabilities) {
    throw new Error("useCapabilities() called outside a <CapabilitiesProvider>");
  }
  return capabilities;
}
