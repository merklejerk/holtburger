# Holtburger Architecture Overview 🍔

Welcome to the root architecture guide for the Holtburger project. This document explains how the workspace crates fit together to form a cohesive Asheron's Call client stack today, while still leaving room for a future full 3D client.

## Architectural Philosophy

Holtburger is designed around **deliberate crate boundaries**. The wire protocol stays separate from world authority, the world model stays separate from transport, and the frontend talks to the engine through commands, queries, and semantic event streams instead of reaching into hidden engine state.

By separating concerns into discrete library crates, we achieve:
1. **Coherent ownership**: `session` owns transport, `world` owns authoritative gameplay state, and `core` owns orchestration plus reusable client behavior.
2. **Performance**: Heavy tasks such as UDP chunk reassembly, DAT access, and world mutation stay off the rendering path.
3. **Ergonomics**: Frontends consume `ClientViewEvent`s and pure world-query helpers, so they can keep local projection state without needing shared mutable access to engine internals.

---

## Crate Dependency Graph

```mermaid
graph TD
    Common[holtburger-common<br/>Bedrock Primitives]
    Protocol[holtburger-protocol<br/>Serialization Rules]
    Dat[holtburger-dat<br/>File Parsing]
    Session[holtburger-session<br/>UDP / Crypto]
    World[holtburger-world<br/>State Authority]
    Core[holtburger-core<br/>Engine Orchestrator]
    CLI[holtburger-cli<br/>Terminal UI]

    %% Dependencies
    Protocol --> Common
    Dat --> Common
    World --> Common
    Session --> Protocol
    Core --> Session
    Core --> World
    Core --> Protocol
    Core --> Dat
    CLI --> Core
    
    classDef bedrock fill:#2d3748,stroke:#4a5568,color:#e2e8f0;
    classDef internal fill:#2c5282,stroke:#3182ce,color:#ebf8ff;
    classDef engine fill:#702459,stroke:#b83280,color:#fff5f5;
    classDef app fill:#22543d,stroke:#38a169,color:#f0fff4;

    class Common bedrock;
    class Protocol,Dat,Session,World internal;
    class Core engine;
    class CLI app;
```

---

## The Crates

### 1. The Bedrock: [`holtburger-common`](crates/holtburger-common/ARCHITECTURE.md)
The foundational layer. It contains pure, stateless primitives that every other crate relies on. It enforces the rule of having no upstream workspace dependencies.
- **Provides**: Vectors, Quaternions, global `Guid` representations, Property Enums, and Protocol Serialization Traits.

### 2. The Language: [`holtburger-protocol`](crates/holtburger-protocol/ARCHITECTURE.md)
Contains zero-logic data structures and deterministic serialization rules corresponding 1:1 with the Asheron's Call protocol (based directly on ACE Server ground truth).
- **Provides**: `GameOpcode`, packet representations, and binary `pack/unpack` implementations.

### 3. The Library: [`holtburger-dat`](crates/holtburger-dat/ARCHITECTURE.md)
Responsible for reading, mounting, and querying static local Asheron's Call data files (`.dat`). 
- **Provides**: Fast, memory-mapped queries for structural templates (Weenies), 3D models, and multi-layered Landblocks.

### 4. The Transport: [`holtburger-session`](crates/holtburger-session/ARCHITECTURE.md)
Encapsulates pure networking logic. It handles the lowest levels of transport without knowing anything about the game world.
- **Provides**: UDP fragment reassembly, packet sequencing, RC4 stream encryption/decryption, and socket loops.

### 5. The Authority: [`holtburger-world`](crates/holtburger-world/ARCHITECTURE.md)
The authoritative in-memory world model for the client. It tracks hydrated entities, player state, spatial placement, retention/liveness rules, trade or vendor state, and world-domain helpers that other crates can query without re-deriving gameplay semantics.
- **Provides**: `WorldState`, `PlayerState`, entity hydration, spatial and retention helpers, trade or vendor state, and world query surfaces.

### 6. The Brain: [`holtburger-core`](crates/holtburger-core/ARCHITECTURE.md)
The primary engine orchestrator. It ties networking (`session`) and authority (`world`) together, executes movement and interaction primitives, and projects raw protocol plus world changes into frontend-safe semantic events.
- **Provides**: Handshake coordination, primitive movement execution and prediction, protocol-to-world orchestration, optional reusable controllers, and `ClientViewEvent` streams for applications to consume.

### 7. The Frontend: [`holtburger-cli`](apps/holtburger-cli/ARCHITECTURE.md)
The current interactive frontend. It is a terminal UI built on ratatui that consumes `ClientViewEvent`s, maintains local projection state for rendering, and owns frontend-specific control policy such as when to drive optional navigation or combat helpers.
- **Provides**: Real-time ratatui screens, input mapping, local projection and modal state, and frontend orchestration around shared core controllers.

---

## System Data Flow

The architecture avoids a single frontend-owned monolith by keeping authority in `world`, orchestration in `core`, and presentation or control policy in the app. Here is the life of a packet:

```mermaid
sequenceDiagram
    participant Srv as Server (UDP)
    participant Sess as Session Layer
    participant Proto as Protocol Layer
    participant Core as Core Engine
    participant World as World State
    participant UI as CLI / App

    Srv->>Sess: Inbound Encrypted Bytes
    Sess->>Sess: Decrypt & Assemble Fragment Chunk
    Sess->>Proto: Deserialize Buffer
    Proto->>Sess: Unpacked GameMessage
    Sess->>Core: Emit WireEvent (Raw Protocol)
    
    Core->>World: Issue Mutation Command (e.g., spawn, update vitals)
    World->>Core: Emit StateEvent (Authority Updated)
    
    Core->>UI: Broadcast ClientViewEvent (Semantic Delta)
    UI->>UI: Update Local Projection / Controller State / Redraw
```

1. **Networking (`session`)** tracks sequence numbers and decrypts data.
2. **Parser (`protocol`)** turns data into Rust struct representations.
3. **Engine (`core`)** coordinates protocol handling, movement execution, and world mutation requests.
4. **Authority (`world`)** applies the mutation, preserves world invariants, and tells the engine what observably changed.
5. **App (`cli`)** receives semantic deltas, updates its local projection, and may feed optional shared controllers with world-derived inputs before issuing new commands.
