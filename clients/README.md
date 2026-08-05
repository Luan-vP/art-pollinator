# clients/

Holds composition roots — packages that wire concrete adapters to the ports
`core`/`app` define, and are the only place platform capability is decided
(AGENTS.md §2 rule 2: no platform conditionals in `core` or `app`).

- **`clients/mobile`** — the React Native (Expo) app for iOS, Android, and
  web (IMPLEMENTATION.md item 29). See its own README for structure, the
  platform-split composition-root mechanism (item 30), and what's
  real-and-verified vs. placeholder in this sandbox.
- **`clients/node`** — the stationary node server (item 45), not yet built.

The root workspace glob `clients/*` picks up any package added here
automatically — no root `package.json` change is needed when a new client
lands.
