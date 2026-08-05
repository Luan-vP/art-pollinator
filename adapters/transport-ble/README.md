# `@art-pollinator/transport-ble`

Issue #33: `TransportPort` over BLE GATT.

## Scope: Central role only, this batch

`react-native-ble-plx` only implements the BLE Central role (spike 0028,
ADR-0010). A single real GATT connection needs exactly one Central and one
Peripheral. `BleTransportAdapter` implements the **Central** half:
connect out to a peer, write outbound bytes (chunked — see below) to the
peer's inbox characteristic, and monitor the peer's outbox characteristic
for notifications, reassembling them.

**The Peripheral half — this device hosting its own GATT server
characteristics so an inbound Central connection can write to and be
notified by it — is not implemented in this batch.** That depends on
`munim-bluetooth`'s GATT-server/peripheral API (ADR-0011), which this
codebase has only spiked at the advertising level
(`@art-pollinator/discovery-ble`), not the GATT-server-characteristic
level. This is a disclosed, real gap, not a bug: closing it is real,
scoped follow-up work, tracked alongside the "no physical BLE hardware to
verify any of this against" gap below.

## Message framing: chunking over a small MTU

SPEC.md §3.1 budgets a `MetadataToken` near 5KB; BLE's usable payload per
write/notify is the negotiated ATT MTU minus a 3-byte header — as low as 20
bytes at the unnegotiated default MTU of 23. `src/ble-chunking.ts` splits
outbound messages into MTU-sized chunks (a single leading `isLast` byte per
chunk, no separate length/index — the swap protocol this carries is
strictly one in-flight message per direction, so a single reassembly
buffer per peer is sufficient) and reassembles them on receive. This logic
is pure and dependency-free, and is tested with **no** BLE mocking at all
(`ble-chunking.test.ts`) — including an explicit round-trip of a ~5KB
payload at MTU 23.

## Testing: mocked BLE surface, not real hardware

Every adapter-level test in this package runs against a fake shaped to
`react-native-ble-plx`'s public API (`src/ble-central-library.ts`'s
interface; `src/fake-ble-central-library.ts`'s fake implementation) — never
a real BLE stack, since this sandbox has no BLE radio and no iOS/Android
device or simulator (`docs/spikes/0028-background-ble-feasibility.md`'s own
method section). These tests prove:

- Large messages are actually split into multiple GATT writes, each within
  the MTU budget, and reassemble to the original bytes.
- Small messages that fit in one chunk aren't needlessly split.
- A connection is reused across multiple sends to the same peer (no
  reconnect per message).
- `receive()` correctly reassembles a message delivered across several
  simulated notification events, including a real `@art-pollinator/core`
  wire-protocol `offer` message.
- The same `TransportPort` contract suite (`@art-pollinator/core`'s
  `transportPortContractCases`) every other transport in this codebase
  passes — see `src/fake-ble-central-library.ts`'s doc comment for the one
  deliberate simplification this requires (letting both sides of the fake
  fabric register as notification recipients under their own id, which a
  real Central role cannot do — only a real Peripheral's GATT server can;
  this is a test convenience for exercising `BleTransportAdapter`'s own
  logic, not a claim about real BLE symmetry).

**What is NOT verified here, and remains a real-hardware follow-up:** live
two-device BLE pairing and data transfer. Nothing in this package has been
run against an actual `react-native-ble-plx` instance or physical Bluetooth
radio — that requires real iOS/Android hardware this environment does not
have, the same gap already disclosed for the BLE discovery adapter and the
spike itself.
