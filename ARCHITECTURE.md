# Holtburger Architecture Overview

Holtburger is a multi-crate Asheron's Call client stack built around strict ownership boundaries: wire serialization stays separate from transport, transport stays separate from authoritative world state, shared orchestration stays separate from static archive discovery, and frontend UX policy stays inside each frontend application.

## Architectural Principles

1. **Coherent Ownership**: `session` owns UDP transport and cryptography, `content` owns archive discovery and bootstrap assembly, `world` owns authoritative gameplay and canonical runtime body state, `core` owns session-to-world orchestration and reusable client workflows, and each frontend owns presentation and UX control policy.
2. **One Fact, One Channel**: Shared domain semantics are derived once at their owning authority (`world` or `core`) and published over typed snapshots and semantic delta streams rather than re-derived from raw bitmasks or parallel side-events in frontends.
3. **Mirrored Read Projections**: Frontends and scripts consume `ClientViewEvent` deltas, entity snapshots, and static content queries without holding shared mutable locks over `WorldState` or running a second movement/physics authority.

---

## Workspace Dependency Graph

```mermaid
graph TD
    Common["holtburger-common<br/>Shared Primitives & Stats"]
    Protocol["holtburger-protocol<br/>Wire Codecs & Opcodes"]
    Dat["holtburger-dat<br/>DAT Archive Decoding"]
    Content["holtburger-content<br/>HBA Discovery & Bootstrap"]
    Session["holtburger-session<br/>UDP Sequencing & Crypto"]
    World["holtburger-world<br/>Authoritative World & Physics"]
    Core["holtburger-core<br/>Client Runtime & Workflows"]
    LiveApi["holtburger-live-api<br/>Live API Engine & Localhost Server"]
    Scripting["holtburger-scripting<br/>In-Process V8 Scripting Runtime"]
    CLI["apps/holtburger-cli<br/>Terminal Client (TUI)"]
    H3D["apps/holtburger-3d<br/>3D Client & Explorer (Electron + WebGL2)"]

    Protocol --> Common
    Dat --> Common
    World --> Common
    World --> Protocol
    World --> Dat
    Content --> Dat
    Content --> World
    Session --> Protocol
    Core --> Session
    Core --> World
    Core --> Protocol
    LiveApi --> Core
    LiveApi --> World
    Scripting --> LiveApi
    CLI --> Content
    CLI --> Core
    CLI --> LiveApi
    CLI --> Scripting
    H3D --> Content
    H3D --> Core
    H3D --> LiveApi
```

---

## Crates and Applications

### 1. [`holtburger-common`](crates/holtburger-common/ARCHITECTURE.md)
Dependency-free bedrock primitives shared across the stack: `Guid`, coordinates and math types, property enums, stat/skill/magic-school taxonomies (`MagicSchool`, `SpellSchool`), and binary codec traits.

### 2. [`holtburger-protocol`](crates/holtburger-protocol/ARCHITECTURE.md)
Deterministic wire-level packet definitions, opcodes, and binary `pack`/`unpack` implementations matching the Asheron's Call network protocol with zero gameplay state.

### 3. [`holtburger-dat`](crates/holtburger-dat/ARCHITECTURE.md)
Static client `.dat` archive access and binary record decoders for setups, animations, physics scripts, environments, landblocks, textures, sounds, and tables.

### 4. [`holtburger-content`](crates/holtburger-content/ARCHITECTURE.md)
Runtime content discovery over mounted HBA/DAT sources, parsed `WorldBootstrap` assembly for `world`/`core`, and static reference-data queries consumed by frontends.

### 5. [`holtburger-session`](crates/holtburger-session/ARCHITECTURE.md)
UDP socket management, packet sequencing, fragment reassembly, checksums, and stream encryption/decryption, independent of gameplay state.

### 6. [`holtburger-world`](crates/holtburger-world/ARCHITECTURE.md)
Authoritative in-memory world model (`WorldState` and `PlayerState`), entity hydration and retention lifecycle, canonical `SpatialScene` / `CollisionScene` / `MotionRuntimeRegistry` simulation state, semantic entity facts and inspection, and pure `WorldContext` queries.

### 7. [`holtburger-core`](crates/holtburger-core/ARCHITECTURE.md)
Client runtime orchestrator (`ClientRuntime` and `ClientRuntimeBuilder`) binding `session` and `world` together. Owns connection/character/portal session lifetimes, `ControlSource` (`User` vs `Automation`) command admission and pause gating, read-only query closures (`ClientRuntimeHandle::read`), fixed-tick simulation and shared local steering (`MoveTo`/`Approach`/`Follow`/`Face*`), guarded multi-step client workflows (inventory, equipment, vendor, trade, salvage, housing), reusable camera collision (`KinematicBoomController`), and the `ClientViewEvent` stream.

### 8. [`holtburger-live-api`](crates/holtburger-live-api/ARCHITECTURE.md)
Shared Live Automation API engine (`LiveApiEngine`) and opt-in localhost-only REST/WebSocket/OpenAPI 3.1 server backed directly by `ClientRuntimeHandle`. Derives advertised capabilities from mounted frontend hooks (`ClientUiHook`, `ClientHudHook`) and `StaticReferenceCatalogs`.

### 9. `holtburger-scripting`
Embedded V8/Deno JavaScript runtime running on a dedicated non-Tokio OS thread directly over `holtburger-live-api::LiveApiEngine` via three generic ops (`op_api_query`, `op_api_command`, `op_api_poll_events`) plus script-local config/data/HTTP helpers.

### 10. [`apps/holtburger-cli`](apps/holtburger-cli/ARCHITECTURE.md)
Interactive `ratatui` terminal client over `holtburger-core`, owning TUI-local layout, keybindings, script discovery/lifecycle over `LiveApiEngine`, and optional `--api` localhost server hosting.

### 11. [`apps/holtburger-3d`](apps/holtburger-3d/ARCHITECTURE.md)
Full 3D desktop client and content Explorer built with Electron, Svelte 5, WebGL2, and a mode-specific Rust host sidecar (`apps/holtburger-3d/host`) keeping live Client authority (including opt-in Live API server + HUD hooks) separate from offline Explorer authority.

---

## End-to-End Runtime Flow

```mermaid
sequenceDiagram
    participant App as Frontend (3D Host / TUI)
    participant Content as holtburger-content
    participant Sess as holtburger-session
    participant Core as holtburger-core
    participant World as holtburger-world

    App->>Content: Discover HBA/DAT sources
    Content-->>App: WorldBootstrap + static asset queries
    App->>Core: Build ClientRuntime with WorldBootstrap
    Sess->>Core: Reassembled inbound packet bytes
    Core->>Core: Decode GameMessage
    Core->>World: WorldState::handle_message(GameMessage)
    World-->>Core: Vec<WorldEvent>
    Core-->>App: ClientViewEvent + DynamicEntity / EntityFacts deltas
```
