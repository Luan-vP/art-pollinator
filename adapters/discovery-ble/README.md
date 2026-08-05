# `@art-pollinator/discovery-ble`

Issue #34: `DiscoveryPort` over BLE — mutual advertise-and-scan (SPEC.md
§6.1).

## Two libraries, one port

Per spike 0028 and ADR-0010, `react-native-ble-plx` only implements the
Central/scan role. `BleDiscoveryAdapter` composes it with `munim-bluetooth`
(ADR-0011, the chosen Peripheral/advertise-role library) internally — both
are hidden behind the single `DiscoveryPort` interface (AGENTS.md §2 rule
3); neither library is exposed to callers.

- **Scan** (Central): `react-native-ble-plx`, modeled by
  `src/ble-scan-library.ts`'s interface.
- **Advertise** (Peripheral): `munim-bluetooth`, modeled by
  `src/ble-advertise-library.ts`'s interface.

Neither the real native packages are dependencies of this package — see
each interface file's doc comment for why (this package needs to run
`npm test` in plain Node; the real native modules are only ever
constructed at the composition root,
`clients/mobile/src/composition/composition-root.native.ts`).

## How `PeerKind` is determined without connecting

A BLE advertisement's `serviceUUIDs` are visible to a scanner without a
GATT connection. This adapter advertises one of two fixed UUIDs
(`PERSON_DISCOVERY_SERVICE_UUID` / `NODE_DISCOVERY_SERVICE_UUID`) depending
on `selfKind`, and classifies a scanned device the same way in reverse —
cheap, and avoids parsing manufacturer data or connecting just to find out
what kind of peer was seen.

## Testing: mocked surfaces, not real hardware

`src/fake-ble-scan-and-advertise-fabric.ts` is a shared in-memory "BLE
airspace" two `BleDiscoveryAdapter` instances plug into, letting the test
suite prove:

- Two devices genuinely discover **each other** (mutual advertise-and-scan,
  not just one-directional).
- Each side classifies the other's `PeerKind` correctly from its
  advertised service UUID.
- A peer is reported at most once even if its advertisement recurs (real
  BLE devices re-advertise periodically).
- An advertisement using neither of this codebase's discovery UUIDs is
  ignored.
- `startDiscovery`/`stopDiscovery` lifecycle: idempotent, stopping both
  halts this device's own advertising and its scan.
- A scanner never "discovers" its own advertisement — the fake fabric
  filters this the way a real BLE radio does (it doesn't receive its own
  transmissions); see that file's header comment.

No formal `DiscoveryPort` contract suite (like `core`'s
`transportPortContractCases`) was written for this port. Unlike
`TransportPort` (where the in-memory fake, the HTTP adapter, and this
BLE-mocked adapter all share an easy, generic "connect a pair, send/receive
bytes" shape), `DiscoveryPort`'s three implementations trigger discovery
through materially different mechanisms — an explicit `simulateDiscovered`
call (`InMemoryDiscoveryPort`), a real periodic HTTP probe
(`@art-pollinator/discovery-lan`), and a mocked mutual-advertise event
(here) — that don't reduce to one reusable factory function as cleanly.
Per AGENTS.md's working agreement, this is noted as a real gap rather than
forced into a shared suite under time pressure; this package's own tests
hold the adapter to the same _behavioural_ bar
`core/src/ports/fakes/in-memory-discovery-port.test.ts` holds the in-memory
fake to, case by case, rather than through one shared suite.

**What is NOT verified here, and remains a real-hardware follow-up:** live
two-device BLE advertise-and-scan discovery. Nothing in this package has
run against a real `react-native-ble-plx` or `munim-bluetooth` instance, or
a physical Bluetooth radio — that needs real iOS/Android hardware this
environment does not have.
