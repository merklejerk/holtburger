# Monolithic to Architecture A Refactor Plan

## 1. Context & Boundaries
- **Goal**: Transition the current monolithic architecture into distinct modular crates (`session`, `world`, `core`) while replacing the massive `Box<Entity>` full-state clone event system with a pure, fine-grained semantic "Delta-Event Stream" (Architecture A) to maintain decoupled event-sourcing without performance and memory bloat.
- **The Problem**: 
  - **The Starting Point (Current Monolith)**: The core engine and client orchestrator are tangled in the same crate. Furthermore, to keep the UI decoupled, the core currently pushes massive `Box<Entity>` clones via `ClientViewEvent::EntityUpserted` every time a tiny property changes. This causes extreme memory pressure and bloated payloads.
  - **The Failed Experiment (The `.bad-refactor`)**: We previously tried solving this by separating crates and utilizing an `Arc<RwLock<WorldState>>` to share state. That introduced devastating lock-contention between the synchronous UI render boundaries and the asynchronous `tokio` networking thread, making functional UI and future ECS integration non-viable.
- **The Solution**: We will blend the best of both worlds. 
  1. We will **keep the crate extraction** from the failed refactor, splitting networking, state, and orchestration.
  2. We will **reject the `Arc<RwLock>` shared state**. The UI will continue to maintain its own decoupled local cache projection exactly as it does currently.
  3. We will **fix the heavy payloads & leaky abstractions** by adopting "Architecture A". We will collapse the three disparate leaky event channels (`WireEvent`, `StateEvent`, `ClientViewEvent`) currently firing into the UI down to just **one** highly semantic `ClientViewEvent` stream. We will replace the heavy `Box<Entity>` clone payloads with lightweight, semantic delta events (`EntitySpawned`, `PropertyUpdated`, `VelocityChanged`, `EntityDespawned`).
  4. We will **eliminate logic duplication** by retaining existing pure trait boundaries (e.g., `WorldContext`) and properly exporting them. The UI can continue to execute AC logic locally without reinventing the wheel.
- **Scope**:
  - **In Scope**:
    - Splitting `holtburger-core` into `holtburger-session`, `holtburger-world`, and `holtburger-core`.
    - Collapsing leaky event streams so the UI ONLY consumes `ClientViewEvent`.
    - Redesigning `ClientViewEvent` into a granular semantic delta-event stream mapping back to changes over `StateEvent`.
    - Moving pure rule trait boundaries (`context.rs`) to `holtburger-world`.
    - Updating the existing `holtburger-cli` local cache to update via semantic deltas rather than absorbing massive boxed clones.
  - **Out of Scope**:
    - Changing the actual UDP transport or cryptography.
    - Transitioning to an actual 3D client.
    - Expanding gameplay features.

## 2. Identifying Ground Truth
- **Reference Sources**:
  - `docs/architecture_comparison.md` (Defines "Architecture A" — the Delta-Event Stream + Client Local Projections + Pure Trait Rules).
  - `docs/plans/core-architecture-refactor.md` (Historically relevant context for how extraction happens, excluding Phase 2/4/5 related to `Arc`).
  - `apps/holtburger-cli/src/ui/state/game.rs` (The existing client state representation that will consume the new event feed).
- **Existing Patterns**:
  - Elm-style `TEA` (The Elm Architecture) update loops already driving the CLI.
  - `holtburger-protocol`'s crate isolation standards.

## 3. Phased Implementation

### Phase 1: Crate Extraction (The Great Split)
- **Motivation**: Enforce logical boundaries. By isolating pure networking (`session`) and state graph tracking (`world`), we achieve cleaner architecture natively.
- **Deliverables**:
  - Extract the `session` folder from `holtburger-core` into `crates/holtburger-session`.
  - Extract the `world` folder from `holtburger-core` into `crates/holtburger-world`.
  - Migrate all `#[cfg(test)]` unit tests natively associated with `session` and `world` directly into their new respective crates.
  - Update `Cargo.toml` across the workspace and adjust imports in `holtburger-core` to temporarily wrap and re-export the two new crates to downstream consumers.
- **Acceptance Criteria**: The project compiles successfully (`cargo check --workspace`), tests run from their new hosts successfully (`cargo test --workspace`), and the system acts as it did previously without warnings.

### Phase 2: The Semantic Event Feed (The Single Source of Truth)
- **Motivation**: Stop the leaky abstractions and the massive heap allocation of full struct clones across channel boundaries.
- **Deliverables**:
  - Unhook `holtburger-cli` from receiving `WireEvent` and `StateEvent`. It must only ever receive `ClientViewEvent`.
  - Redesign the `ClientViewEvent` enum inside `holtburger-core`. Remove `EntityUpserted { entity: Box<Entity> }`. 
  - Mirror the internal data tracking graph with explicit granular delta events: `EntitySpawned { entity: Box<Entity> }` (sent just once on birth), `EntityPropertyUpdated { guid: Guid, update: PropertyUpdate }`, `EntityMoved { guid: Guid, pos: WorldPosition }`, `EntityDespawned { guid: Guid }`.
  - Expose external interaction messages currently in `WireEvent` (e.g. `ServerMessage`, `Chat`, `WeenieError`, `CharacterList`) as explicit variants in `ClientViewEvent`.
  - Update `Client::emit_world_view_projection` (for `StateEvent`s) and the base `Client` receive loop (for `WireEvent`s) to capture and map these disjoint events safely to `ClientViewEvent` before channel broadcast.
- **Acceptance Criteria**: `holtburger-core` unit tests pass, and it successfully maps inner world state mutations and raw protocol responses purely into the new generalized `ClientViewEvent` on *a singular channel line*.

### Phase 3: Pure Rule Abstractions (Defending `WorldContext`)
- **Motivation**: Prevent logic duplication. The pre-refactor codebase actually already solves this gracefully via `WorldContext` and `WorldContextExt` in `holtburger-core/src/world/context.rs`. We must protect it during the crate split.
- **Deliverables**:
  - Ensure `context.rs` is moved to `holtburger-world` instead of staying inside `holtburger-core`'s network space.
  - Expose `WorldContext` through the crate boundary so that `holtburger-cli`'s `GameData` can continue to `impl WorldContext for GameData`, thus inheriting the ability to run logic like `can_sell_to_vendor` locally.
- **Acceptance Criteria**: Core tests mapping interactions still pass. The CLI compiles and accurately performs pure logic via `world.can_sell_to_vendor` on its own cache.

### Phase 4: Client Projection Wiring
- **Motivation**: Update the UI's local cache to handle the new Delta Events instead of the old massive structs.
- **Deliverables**:
  - Update `holtburger-cli`'s update loop (`handle_client_view_event`) to listen to the granular event stream.
  - The UI's `GameData` should process `EntitySpawned` by initializing a new struct, and `PropertyUpdated` by mutating it in place.
  - Implement `InteractorContext` against the UI's local `GameData` (the local projection).
  - Adopt the "Upstream Explicit Query" pattern for massive debug states (`ClientCommand::QueryEntityDebugInfo(Guid)`).
- **Acceptance Criteria**: `holtburger-cli` successfully compiles and operates, accurately reflecting character movement, inventory states, and trades through processing delta streams instead of full object clones.

### Phase 5: Cleanup & De-duplication
- **Motivation**: Finalize architecture boundary strictness and pay off the technical debt allowed in earlier phases.
- **Deliverables**:
  - Remove all protective re-exports in `holtburger-core` that were temporarily placed in Phase 1 to float `holtburger-cli` builds.
  - Make `holtburger-cli` explicitly import `holtburger-session` or `holtburger-world` if they need internal structs.
- **Acceptance Criteria**: The project strictly enforces boundaries through direct cargo relationships, with `holtburger-core` ceasing to be an omni-module catch-all.

## 4. Risks & Mitigations
- **Risk**: Event stream synchronization loss. If the client misses an event or handles `PropertyUpdated` incorrectly, it introduces "State Drift," the main threat of Architecture A.
  - **Mitigation**: "Lossless Semantic Interpreter" principle. Ensure the Core's translation of underlying packet data into `ClientViewEvent` is completely exhaustive and strictly tested, reducing the logic burden on the UI. The UI blindly executes the changes it receives. We accept minor ghost mismatches mitigated by authoritative final verification at the `WorldState`/Server.
- **Risk**: The Big Bang Boot Sequence. Logging in dumps thousands of deltas rapidly through the channel before the UI finishes bootstrapping.
  - **Mitigation**: Ensure strict pipeline initialization. The `mpsc` receiver channel must be established and actively draining synchronously by the UI render context before the Toko network thread initiates the UDP AC-Handshake routine.
- **Risk**: Re-introduction of "Fat" UI Entities.
  - **Mitigation**: While replacing massive clones with delta events radically lowers CPU/Memory channel saturation, the UI still needs to hold the properties for rendering. This is marked as an "Accepted Sin" in the architecture comparison since a duplicated internal `HashMap` is vastly superior to locking a global `Arc<RwLock>`.

## 5. Definition of Done (DoD)
- [x] `holtburger-core` is successfully split into modular sub-crates.
- [x] Over 100% of event payload transmission logic has transitioned from `Box<Entity>` cloning to granular `ClientViewEvent` deltas.
- [x] System logic operates on `InteractorContext` (via `WorldContext`) traits to prevent duplicated rules.
- [x] The CLI maintains its own un-locked projection, processing the event stream effectively.
- [x] The workspace builds (`cargo check --workspace`), formats (`cargo fmt`), lints (`cargo clippy`), and passes all tests.

## 6. The Living Worksheet

### Task Checklist
**Phase 1: The Great Split**
- [x] Create `crates/holtburger-session` and move code.
- [x] Create `crates/holtburger-world` and move code.
- [x] Update all `Cargo.toml` dependencies and perform export wrap in `holtburger-core`.

**Phase 2: Semantic Event Feed**
- [x] Decouple UI receivers from `WireEvent` and `StateEvent`.
- [x] Define granular delta variants (entity property tracking) in `ClientViewEvent`.
- [x] Define UX protocol variants (`ServerMessage`, `CharacterList`) in `ClientViewEvent`.
- [x] Reconfigure Core -> UI payload translation layer to map `StateEvent` efficiently without clones.
- [x] Intercept raw `WireEvent` in Core and proxy purely UX necessary payloads into `ClientViewEvent`.

**Phase 3: Pure Rule Abstractions**
- [x] Move `context.rs` to `holtburger-world` safely.
- [x] Retain `GameData: WorldContext` capability in the UI.

**Phase 4: Client Projection Wiring**
- [x] Update `GameData` in the CLI to selectively process `PropertyUpdated`, `EntityMoved`, etc.
- [x] Strip old monolithic graph inference from UI rendering where possible.
- [x] Adopt the "Upstream Explicit Query" pattern for massive debug states (`ClientCommand::QueryEntityDebugInfo`).

**Phase 5: Cleanup & De-duplication**
- [x] Cut all temporary re-exports from `holtburger-core`.
- [x] Update `holtburger-cli` inputs to strictly target their independent origins.

### Decisions Log
- **Phase 3 Fast-Track**: `WorldContext` was already migrated safely during Phase 1 crate splits, so Phase 3 structurally fell into place without extensive rework. We retained the original pure rules context by having the CLI's `GameData` implement `WorldContext`.
- **Phase 4 Debug Query Pattern**: To abide by Architecture A's "lossy projection" concept without losing diagnostic power, we've implemented `ClientCommand::QueryEntityDebugInfo(guid)`. When the TUI requests an entity debug inspection, it explicitly asks the core network thread to respond with a rich `ClientViewEvent::EntityDebugInfoSnapshot` payload, which temporarily updates the UI's local cache without continuously spanning the channel with mega-clones.

- **Phase 5 Cleanup**: Removed the temporary `pub use holtburger_session as session;` and `pub use holtburger_world as world;` fallbacks inside `holtburger-core` that were placed during Phase 1. `holtburger-cli` has logically updated its dependencies in `Cargo.toml` to explicitly target `holtburger-world` and `holtburger-session`, formally enforcing the architecture API boundaries.

### Verification Log
- Validated tests across all 5 workspace crates (`Cargo test --workspace`), catching formatting errors.
- Applied `cargo clippy --fix` on workspace crates to collapse `if` nestings and remove extraneous `.clone()` references during transition.

### Open Questions
- *None.*
