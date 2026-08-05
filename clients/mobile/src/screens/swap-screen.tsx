import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SwapOutcome } from "@art-pollinator/app";

import { useServices } from "../composition/capabilities-context";

/**
 * The swap screen (issue #38: "swap screen shows incoming offers as they
 * occur"). Deliberately unstyled — real UX is Phase 3.
 *
 * A simple event log driven by `SwapActivityLog`
 * (`@art-pollinator/app`, issue #38's minimal observer mechanism —
 * `SwapService` records to it once, at the end of every completed swap,
 * whether that swap was triggered by this screen or — the actual case on a
 * real device — a background discovery loop this screen never called
 * itself; see `../composition/composition-root-shared.ts`'s
 * `wireAutomaticSwap`). This screen only reads `history()` once for
 * whatever already happened before it mounted, then subscribes for
 * everything after.
 */
export function SwapScreen() {
  const { swapActivityLog } = useServices();
  const [outcomes, setOutcomes] = useState<readonly SwapOutcome[]>(() => swapActivityLog.history());

  useEffect(() => {
    return swapActivityLog.subscribe((outcome) => {
      setOutcomes((previous) => [...previous, outcome]);
    });
  }, [swapActivityLog]);

  return (
    <View style={styles.container} testID="swap-screen">
      <Text style={styles.heading}>Swap activity</Text>
      {outcomes.length === 0 ? (
        <Text style={styles.body} testID="swap-activity-empty">
          No swaps yet.
        </Text>
      ) : null}
      {outcomes.map((outcome, index) => (
        // `SwapOutcome` (`@art-pollinator/app`) has no unique id of its own
        // — this is an append-only log rendered strictly in arrival order,
        // so the array position is a stable-enough key for this
        // deliberately unstyled screen.
        <View style={styles.entry} key={index} testID={`swap-activity-${String(index)}`}>
          <Text style={styles.body}>
            Swap #{index + 1} — accepted {outcome.accepted.length}, sent {outcome.sent.length},
            evicted {outcome.evicted.length}
            {outcome.rejectedUnverified.length > 0
              ? `, rejected ${String(outcome.rejectedUnverified.length)} unverified`
              : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: "600",
  },
  body: {
    fontSize: 14,
  },
  entry: {
    paddingVertical: 4,
  },
});
