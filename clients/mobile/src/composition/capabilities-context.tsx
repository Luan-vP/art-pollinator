import React, { createContext, useContext, useMemo } from "react";

// This is the one seam in the whole app that resolves per-platform: Metro
// picks composition-root.web.ts for the web bundle and
// composition-root.native.ts for iOS/Android, purely by filename extension
// (issue #30). Everything below this line is ordinary, platform-agnostic
// React.
import { createCompositionRoot } from "./composition-root";
import type { ClientCapabilities, CompositionRootServices } from "./types";

const CapabilitiesContext = createContext<ClientCapabilities | undefined>(undefined);
const ServicesContext = createContext<CompositionRootServices | undefined>(undefined);

/**
 * Constructs the composition root exactly once per app instance and
 * provides both its `capabilities` (issue #32, existing) and its
 * `services` (issue #37/#38: `SwapService`, `LibraryService`,
 * `SwapActivityLog` — see `types.ts`'s `CompositionRootServices`) down two
 * separate contexts. One root, one construction — `useMemo` guarantees
 * `createCompositionRoot()` (which wires real BLE/HTTP adapters and starts
 * automatic discovery-driven swapping, `composition-root-shared.ts`'s
 * `wireAutomaticSwap`) never runs more than once per app instance, even
 * across re-renders.
 */
export function CapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const root = useMemo(() => createCompositionRoot(), []);

  return (
    <CapabilitiesContext.Provider value={root.capabilities}>
      <ServicesContext.Provider value={root.services}>{children}</ServicesContext.Provider>
    </CapabilitiesContext.Provider>
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

/**
 * Read this composition root's real `app/`-layer services (issue #37/#38):
 * `swapService`, `libraryService`, `swapActivityLog`. The library and swap
 * screens (`../screens/library-screen.tsx`, `../screens/swap-screen.tsx`)
 * are the only consumers so far.
 */
export function useServices(): CompositionRootServices {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error("useServices() called outside a <CapabilitiesProvider>");
  }
  return services;
}
