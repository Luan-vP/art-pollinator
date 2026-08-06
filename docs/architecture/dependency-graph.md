# Dependency graph

Generated from the actual workspace `package.json` files and `implements` clauses on
`main` — not hand-drawn from memory. Companion to [`../adr/0001-hexagonal-architecture.md`](../adr/0001-hexagonal-architecture.md),
which explains *why* the codebase is shaped this way; this doc shows *what it actually
looks like* right now.

## 1. Workspace dependency graph

Every arrow means "depends on" (imports from). The one rule this diagram exists to make
checkable at a glance: **nothing points into `core`** except `app` and the adapters —
and `core` itself points at nothing.

```mermaid
flowchart TD
    subgraph clients["clients/ — composition roots"]
        mobile["📱 mobile<br/><small>Expo · iOS / Android / Web</small>"]
        node["🖥️ node<br/><small>long-lived Node service</small>"]
    end

    subgraph adapters["adapters/ — port implementations"]
        transportHttp["transport-http"]
        transportBle["transport-ble"]
        discoveryLan["discovery-lan"]
        discoveryBle["discovery-ble"]
        identityNode["identity-node"]
        sqliteRepo["metadata-repository-sqlite"]
        blobFs["blob-store-filesystem"]
        schedulerTimer["scheduler-timer"]
        seedPlaceholder["seed-placeholder-dev<br/><small>⚠️ dev-only, default off</small>"]
    end

    subgraph app["app/ — use cases"]
        appPkg["SwapService · LibraryService<br/>IngestionService · AdminService<br/>DeferredBlobQueue"]
    end

    subgraph core["core/ — pure domain (zero deps, zero I/O)"]
        corePkg["Library · MetadataToken · Priority<br/>4 policies · swap state machine<br/>wire protocol · crypto · security<br/>14 ports (interfaces only)"]
    end

    mobile --> transportHttp
    mobile --> transportBle
    mobile --> discoveryLan
    mobile --> discoveryBle
    mobile --> schedulerTimer
    mobile -.->|"dev flag, default off"| seedPlaceholder
    mobile --> app
    mobile --> core

    node --> transportHttp
    node --> discoveryLan
    node --> identityNode
    node --> sqliteRepo
    node --> app
    node --> core

    transportHttp --> core
    transportBle --> core
    discoveryLan --> core
    discoveryBle --> core
    identityNode --> core
    sqliteRepo --> core
    blobFs --> core
    schedulerTimer --> core
    seedPlaceholder --> core

    app --> core

    style core fill:#2d3748,color:#fff,stroke:#4a5568
    style app fill:#2c5282,color:#fff,stroke:#4a5568
    style adapters fill:#285e61,color:#fff,stroke:#4a5568
    style clients fill:#744210,color:#fff,stroke:#4a5568
```

Note `blob-store-filesystem` has no client wired to it yet — `DeferredBlobQueue` (in
`app/`) is built and tested against the in-memory `BlobStorePort` fake, but no
composition root instantiates the real filesystem adapter yet. That's a real gap, not
a diagramming error.

## 2. Ports and their adapters

`core` owns 14 port interfaces and depends on none of their implementations — this is
the actual hexagonal boundary, and it's a more useful picture of "what talks to what"
than the package graph above. Ports with no adapter row only have an in-memory fake
(`core/src/ports/fakes/`); nothing outside tests has wired a real implementation yet.

```mermaid
flowchart LR
    subgraph ports["core — ports (interfaces)"]
        TransportPort
        DiscoveryPort
        MetadataRepositoryPort
        BlobStorePort
        BlobFetchQueueStorePort
        IdentityPort
        SignatureVerifierPort
        ClockPort
        SchedulerPort
        EncounterLogPort
        NetworkStatusPort
        RevocationLogPort
        SecurityStatusPort
        LoggerPort
    end

    HttpTransportServer -->|implements| TransportPort
    HttpTransportClient -->|implements| TransportPort
    BleTransportAdapter -->|implements| TransportPort

    HttpProbeLanDiscoveryAdapter -->|implements| DiscoveryPort
    LanDiscoveryProber -->|implements| DiscoveryPort
    BleDiscoveryAdapter -->|implements| DiscoveryPort

    SqliteMetadataRepository -->|implements| MetadataRepositoryPort
    FilesystemBlobStorePort -->|implements| BlobStorePort
    FileBlobFetchQueueStorePort -->|implements| BlobFetchQueueStorePort
    NodeIdentityAdapter -->|implements| IdentityPort
    NodeSignatureVerifier -->|implements| SignatureVerifierPort
    TimerSchedulerPort -->|implements| SchedulerPort

    SystemClockPort["SystemClockPort<br/><small>clients/mobile, local</small>"] -->|implements| ClockPort
    JsonLinesLogger["JsonLinesLogger<br/><small>clients/node, local</small>"] -->|implements| LoggerPort

    style ports fill:#2d3748,color:#fff,stroke:#4a5568
```

`EncounterLogPort`, `NetworkStatusPort`, `RevocationLogPort`, and `SecurityStatusPort`
currently have only in-memory fakes — no real adapter package exists for any of them
yet. That's true today; check `core/src/ports/fakes/index.ts` against the list above
before trusting this note on a future read.

## 3. How to keep this diagram honest

Both diagrams above were built by actually reading every workspace `package.json`'s
`dependencies` and grepping for `implements \w+Port` across `adapters/` and `clients/`
— not transcribed from the PR history. If you add a package or a port implementation,
regenerate rather than hand-edit:

```bash
# package-level deps
for f in core app adapters/*/package.json clients/*/package.json; do :; done
node -e "const fs=require('fs'); for (const dir of [...fs.readdirSync('adapters').map(d=>'adapters/'+d), ...fs.readdirSync('clients').map(d=>'clients/'+d), 'core', 'app']) { try { const p=JSON.parse(fs.readFileSync(dir+'/package.json')); console.log(p.name, '->', Object.keys(p.dependencies||{}).filter(d=>d.startsWith('@art-pollinator/')).join(', ')); } catch {} }"

# port implementations
grep -rn "implements [A-Za-z]*Port" adapters/*/src/*.ts clients/*/src/**/*.ts | grep -v test
```
