# `@art-pollinator/discovery-lan`

Issue #44 (`DiscoveryPort` over Wi-Fi/LAN, pulled forward from Phase 2).

## Design choice: HTTP probe-and-respond, not mDNS or raw UDP

The task brief for this issue named two legitimate options: an mDNS/Bonjour
library, or a UDP broadcast probe-and-respond protocol. This adapter uses
**neither** — it generalizes the second option to plain HTTP.

Why: issue #44's own acceptance criteria requires this adapter to "work
from the browser target (no BLE dependency)." A browser has **no** mDNS API
and **no** raw UDP socket API — both are unavailable regardless of BLE.
`fetch` is the one real networking primitive every AGENTS.md §5 target
(iOS, Android, browser) actually has. Adopting an mDNS library (e.g.
`bonjour-service`) would still need `dgram` under the hood, which doesn't
exist in a browser runtime — it would just relocate the "doesn't work on
web" problem rather than solve it, while adding a dependency the web build
could never actually use.

This also reuses the same "real `node:http` server + `fetch` client" shape
`@art-pollinator/transport-http` (#43) already establishes, instead of
introducing a second, unrelated networking dependency for a conceptually
similar "probe a known port" need.

### The tradeoff this accepts

Unlike mDNS (resolves peers by name, no pre-known IP list needed) or a UDP
broadcast (reaches an entire subnet with one packet), this adapter can only
discover a peer whose host it already has as a candidate —
`candidateHosts` must be supplied by the caller. Real subnet enumeration
(`node:os`'s interface listing isn't available in React Native anyway, so
this was never a one-line fix for the mobile client specifically) is a real
gap, left for whatever composition-root wiring eventually supplies
`candidateHosts` in practice — not hidden behind this adapter's interface.

## How it works — three classes, split by what can run where

- **`LanDiscoveryProber`** (`DiscoveryPort`, `fetch`-only, zero `node:*`
  imports): periodically (`SchedulerPort`-driven, configurable interval)
  probes each not-yet-discovered candidate host on a known port
  (`DEFAULT_LAN_DISCOVERY_PORT = 47821`, SPEC.md §6.1's "known port(s)");
  a successful, well-formed response fires `onPeerFound` exactly once per
  peer id. Safe to construct anywhere, **including a browser bundle** —
  this is what `clients/mobile`'s web composition root uses directly.
- **`LanDiscoveryResponder`** (not a `DiscoveryPort` itself — "make this
  device findable"): a real `node:http` server answering
  `GET /art-pollinator-node` with this device's own peer id and `PeerKind`
  as JSON. Node/native only — a browser can never accept an inbound
  connection, so it can never run this.
- **`HttpProbeLanDiscoveryAdapter`** (`DiscoveryPort`): composes both of
  the above for a device that wants to be simultaneously discoverable
  _and_ discovering — mirroring BLE's mutual advertise-and-scan (SPEC.md
  §6.1), just over HTTP. Node/native use only (a stationary node, or a
  native mobile client that also wants to seed others) — **never import
  this from a browser bundle**, since its constructor builds a real
  `node:http` server.

### Design history: why the prober had to be split out

An earlier version of this package fused probing and responding into one
class. Wiring LAN discovery into `clients/mobile`'s web composition root
surfaced the problem directly: that class's constructor unconditionally
built a `node:http` server, so merely _importing_ it — even on a path that
never called `.listen()` — would have pulled `node:http` into the web
bundle, which has no such module. That would have silently violated this
package's own "works from the browser target" requirement the moment it
was actually wired up, rather than at the time it was written. Splitting
`LanDiscoveryProber` out (zero Node-only imports, verified by a source-level
test in `lan-discovery-prober.test.ts`) is the fix, and it also better
matches the real shape of the problem: a browser is always a LAN-discovery
_client_, never a responder, since it fundamentally cannot accept inbound
connections.

## Testing

`src/http-probe-lan-discovery-adapter.test.ts` runs two real instances
bound to two distinct loopback addresses — `127.0.0.1` and `127.0.0.2`
(both are valid, independently bindable loopback addresses on Linux's
`127.0.0.0/8`, verified directly in this environment) — on the _same_
known port, and asserts they discover each other for real: real
`node:http` servers, real `fetch` probes, a real `TimerSchedulerPort`
driving the probe cadence. Nothing in this package is mocked.
