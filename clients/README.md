# clients/

Placeholder directory. No client packages exist yet.

This directory will hold composition roots — e.g. `clients/mobile` (React
Native app for iOS/Android/web, IMPLEMENTATION.md item 29) and `clients/node`
(the stationary node server, item 45). Each client wires concrete adapters to
the ports `core`/`app` define, and is the only place platform capability is
decided (AGENTS.md §2 rule 2: no platform conditionals in `core` or `app`).

The root workspace glob `clients/*` already picks up any package added here
automatically — no root `package.json` change is needed when the first
client lands.
