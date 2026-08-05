/**
 * `@art-pollinator/transport-http` — `TransportPort` over HTTP (issue #43,
 * pulled forward from Phase 2 per IMPLEMENTATION.md: without it, the
 * browser target has no acquisition path at Phase 1 exit, SPEC.md §8).
 * See `./http-transport-server.ts` and `./http-transport-client.ts` for the
 * two halves and the rendezvous protocol connecting them.
 */
export * from "./http-transport-server.js";
export * from "./http-transport-client.js";
