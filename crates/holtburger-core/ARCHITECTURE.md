# Core Engine Architecture ⚙️

This crate is the "Brain" and behavior host of the client. It binds together the pure networking from [`holtburger-session`](../holtburger-session) and the data tracking from [`holtburger-world`](../holtburger-world) into a single, cohesive engine.

In addition to orchestration, this crate is allowed to provide reusable client-side behaviors when they are broadly useful across multiple frontends. The key boundary is not "high-level vs low-level" in the abstract, but whether a behavior is a reusable engine capability or a frontend-specific policy.

This crate translates complex network packets into meaningful gameplay events without suffocating the application in massive struct clones or lock contention, and it may also host optional controllers that sit on top of the core movement and interaction primitives.

## Key Components

### 1. The Client ([src/client/mod.rs](src/client/mod.rs))
The top-level entry point. It instantiates the `Session` (networking) from `holtburger-session` and the `WorldState` (data graph) from `holtburger-world`, driving the main async event loop.

#### Bootstrap & Config
To instantiate a client, we use the `ClientBuilder` ([src/client/builder.rs](src/client/builder.rs)). This configures credentials, server endpoints, and optional debug features.

#### Event Streams
We use a 3-layer event model to separate protocol fidelity from UI ergonomics, solving the monolithic object-cloning problem via highly granular Delta Events:

1. **`WireEvent`** (Protocol): 1:1 raw packet semantics from `holtburger-session`. Used for logging, debugging, or deep client control.
2. **`StateEvent`** (World): Authoritative state mutations managed by `holtburger-world` (e.g., `EntitySpawned`, `PropertyUpdated`).
3. **`WorldViewEvent`** ([src/client/types.rs](src/client/types.rs)): The unified semantic delta-event feed. The core listens to incoming `WireEvent`s and `StateEvent`s and collapses them onto THIS SINGLE CHANNEL line.
   - Consumers (like `holtburger-cli`) **ONLY** subscribe to `WorldViewEvent` because it is lightweight. It broadcasts granular semantic delta-events (like `PropertyUpdated { guid, update }`) instead of massive `Box<Entity>` clones.

#### Interaction
- **ClientCommand**: Commands sent from the UI to the engine (e.g., `TurnTo`, `ApproachTarget`, `Use`). Handled in [src/client/commands.rs](src/client/commands.rs).
- **Producer-Only Pattern**: The Core Engine is strictly *producer-only* for the event streams. It never consumes its own broadcast events internally (that would introduce latency and state drift). It uses synchronous direct logic to move from Wire -> State -> View.

### Command and Controller Boundary

The core crate exposes two layers of client-facing behavior:

1. **Primitives**: low-level commands and systems that directly map to protocol or authoritative local-state responsibilities.
    - Examples: `TurnTo`, `SetState`, `StopMoving`, movement prediction, position sync, and handling server-controlled movement.
2. **Controllers**: optional, reusable higher-level behaviors built on top of those primitives.
    - Examples: approach a target until an arrival distance, follow a target, combat-facing assistance, or sticky-melee steering.

Applications are free to use these controllers, ignore them, or layer their own policies above the primitive command surface. The core crate should not force every client into one control model, but it may provide shared controllers when the behavior is likely to be useful across a TUI, a 3D client, tools, or automated harnesses.

The current kernel lives under [src/client/controllers/mod.rs](src/client/controllers/mod.rs). It is intentionally provisional and currently standardizes only:

- a broad controller trait shape
- coarse lifecycle status
- a small structured update containing `status` and controller-defined `effects`

It intentionally does not standardize a scheduler, claim system, universal reason ontology, or one closed effect enum. Those decisions stay outside the kernel until real controller implementations force a clearer common model.

### 2. Specialized Systems

#### Auth & Connection ([src/client/auth.rs](src/client/auth.rs))
Manages the multi-stage handshake with GLS (Global Login Service) and the World server. Handles ticket exchange and character selection.

#### Movement ([src/client/movement.rs](src/client/movement.rs))
The `MovementSystem` runs on a fixed 30ms async interval, calculating physics ticks, client-side prediction, and pushing reliable synchronization with the server's authoritative position.

Today, this module hosts an explicit `ApproachTargetController` that is ticked by the movement system and currently seeded through `ClientCommand::ApproachTarget`. That trigger command is a temporary bridge for the existing app-to-core command channel, not the final reusable-controller API.

## Movement Model

Movement in `holtburger-core` should converge on three distinct layers:

1. **Protocol and authority plumbing**
    - Format and send movement-related game actions.
    - Handle server-driven movement and forced reposition.
    - Maintain prediction and synchronization with the authoritative server state.
2. **Primitive client actions**
    - Set heading.
    - Set movement state.
    - Start or stop locally driven locomotion.
    - Emit sync pulses and other direct control inputs.
3. **Optional reusable controllers**
    - Approach target until arrival distance.
    - Follow or maintain range.
    - Combat-facing assist.
    - Shared stuck detection, retry cadence, and cancellation rules.

This structure keeps the core crate powerful without baking one frontend's control policy directly into the engine loop.

## Current State and Intended Direction

The current `ClientCommand::ApproachTarget` flow is effectively a built-in controller:

1. A client issues `ApproachTarget`.
2. Core stores controller state in the movement subsystem.
3. The fixed physics tick advances that controller until it reaches the target or aborts.

That behavior is not wrong. The issue is that it is currently modeled as an ad hoc special case instead of as part of a clearer "optional controller" layer. The intended direction is to preserve useful shared behavior while making the abstraction boundaries more explicit.

## Internal Data Flow

```mermaid
sequenceDiagram
    participant Net as Session (UDP Transport)
    participant Core as Client Engine (Orchestrator)
    participant World as WorldState (Data Authority)
    participant View as WorldViewEvent (Delta Stream)
    participant UI as Consumer (TUI/Local Projection)

    Net->>Core: WireEvent (Unpacked Packet)
    Core->>World: Mutate Authority (e.g. Spawn)
    World->>Core: StateEvent (e.g EntitySpawned)
    Core->>View: Emit as Semantic Delta
    View->>UI: Process In-Place Projection Update
```

1. **Networking**: `holtburger-session` parses UDP packets.
2. **Engine**: `Client` processes the `WireEvent` and emits intents to `holtburger-world`'s `WorldState`.
3. **Authority**: `WorldState` performs the mutation and emits a `StateEvent`.
4. **Projection**: `Client` translates the `StateEvent` directly into a granular `WorldViewEvent` delta snapshot.
5. **UI**: Consumers receive the delta and mutate their local cached models safely without lock contention (`Arc<RwLock>`) or massive memory allocations.

## 🛠️ Developer Onboarding

### Adding a new Message Handler
1. **Identify**: Find the opcode in the ACE Server source (ground truth).
2. **Update Protocol**: Add the message structure to `holtburger-protocol`.
3. **Handle in Core**: Add a case to the core loop in [src/client/messages.rs](src/client/messages.rs).
4. **Update State**: If the message changes the world, add a method to `holtburger-world` and emit a `StateEvent`.
5. **Map to View**: Update the `WorldViewEvent` stream in `emit_wire_event` or `emit_world_view_projection` inside [src/client/mod.rs](src/client/mod.rs) to share the new delta with the UI.

### Adding or Refactoring a Reusable Controller
1. **Prove the behavior is shared**: Confirm that the behavior is likely useful across multiple clients or modes of control.
2. **Identify the primitive surface**: Separate the controller's decision-making from the low-level commands it needs to emit.
3. **Make state explicit**: Keep controller state isolated from the transport and world-plumbing responsibilities.
4. **Define lifecycle and interruption rules**: Be explicit about what blocks, pauses, interrupts, cancels, or completes the controller.
5. **Keep adoption optional**: Frontends should opt into controllers rather than being forced through them.
6. **Treat the kernel as provisional**: Prefer small reusable controller-local vocabularies and refine the shared kernel only after multiple real controllers exist.

## Migration Path Toward Reusable Controllers

We do not need a flag day refactor. The current movement behavior can evolve incrementally:

1. **Document current controllers explicitly**
    - Treat `ApproachTarget` as a temporary controller-triggering API rather than a raw movement primitive.
2. **Separate primitive helpers from controller logic**
    - Extract helpers for heading changes, locomotion state, stop/cancel, and sync from the current approach loop.
3. **Isolate controller state**
    - Keep approach-specific state and heuristics grouped together behind a clearer controller boundary.
4. **Introduce additional reusable controllers**
    - Examples include combat-facing assistance or maintain-range behavior.
5. **Let applications arbitrate controller usage**
    - Frontends decide when to invoke or suspend a controller based on local UX needs.

The end state is a core library that owns robust movement and interaction primitives, plus a catalog of optional higher-level controllers that clients can compose as needed.

## Dependencies
- **`holtburger-session`**: Network tracking, transport, and packet parsing.
- **`holtburger-world`**: The World State graph and entity tracking.
- **`holtburger-protocol`**: Binary packet structures.
- **`holtburger-dat`**: File access (DATs).
