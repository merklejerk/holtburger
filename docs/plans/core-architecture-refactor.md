# Core Architecture Refactor Plan

## 1. Context & Boundaries
- **Goal**: Refactor `holtburger-core` into modular crates (`session`, `world`, `core`) and transition the client-engine relationship to a "Semantic Notifications + Shared State" architecture to eliminate state duplication.
- **The Problem**: Currently, `holtburger-core` is a monolith that handles networking, game state, and client orchestration. Furthermore, it uses a "Producer-Only Event Stream" model where it broadcasts heavy state payloads (like full `Box<Entity>` clones) via `ClientViewEvent`. This forces consumers (like `holtburger-cli`) to maintain their own parallel, duplicated `HashMap`s of the world state (`GameData`). This is inefficient, prone to state drift, and will cause massive duplication of effort when we build a 3D client.
- **The Solution**: 
  1. Break the monolith into focused crates.
  2. Make `holtburger-world` the single source of truth, storing entities as `Arc<Entity>` for cheap, thread-safe sharing.
  3. Change `ClientViewEvent` to emit lightweight, semantic notifications (e.g., "Entity 123 moved", "Item 456 equipped") rather than full state dumps.
  4. Consumers will listen to these semantic events to know *when* and *how* things changed (to trigger animations/UI updates), and then query the shared `WorldState` via `Arc` references to get the actual data for rendering.
- **In Scope**: 
  - Splitting `holtburger-core` into `holtburger-session`, `holtburger-world`, and `holtburger-core`.
  - Refactoring `WorldState` to use `Arc<Entity>` for cheap, thread-safe sharing.
  - Redesigning `ClientViewEvent` into lightweight, semantic notifications (e.g., `EntityDamaged`, `ItemEquipped`).
  - Refactoring `holtburger-cli` to remove its duplicated `GameData` state and adopt a pull-based rendering model.
- **Out of Scope**: 
  - Adding new gameplay features or handling new network opcodes.
  - Changing the underlying UDP transport or cryptography logic.
  - Building the actual 3D client (this is purely preparatory architecture work).

## 2. Identifying Ground Truth
- **Reference Sources**: 
  - `crates/holtburger-core/ARCHITECTURE.md` (Current architecture and data flow).
  - `apps/holtburger-cli/src/ui/state/game.rs` (The current duplicated state that needs to be eliminated).
- **Existing Patterns**: 
  - `holtburger-protocol` and `holtburger-common` demonstrate our standard for pure, isolated library crates.

## 3. Phased Implementation

### Phase 1: Crate Extraction (The Great Split)
- **Motivation**: Isolate pure networking (`session`) and pure state management (`world`) from the client orchestrator. This enforces strict boundaries and makes the domains independently testable.
- **Deliverables**: [COMPLETED]
  - Create `crates/holtburger-session` and move `src/session/*` into it.
  - Create `crates/holtburger-world` and move `src/world/*` into it.
  - Update `Cargo.toml` dependencies across the workspace.
  - Re-export necessary types in `holtburger-core` to minimize immediate downstream breakage.
- **Acceptance Criteria**: [VERIFIED] The workspace compiles successfully (`cargo check --workspace`). All existing tests pass (`cargo test --workspace`). No logic changes have been introduced.

### Phase 2: The `Arc` Glow-Up (Shared State Foundation)
- **Motivation**: Make `WorldState` cheap to clone and share so clients can hold references to entities without deep copying massive structs. This is the foundation for eliminating UI state duplication. By using `Arc<Entity>`, the UI can hold a pointer to the exact same data the core engine is using.
- **Deliverables**: [COMPLETED]
  - Refactor `EntityManager` and `WorldState` in `holtburger-world` to store `Arc<Entity>` instead of `Entity`.
  - Update mutation methods in `WorldState` to handle `Arc`. When an entity needs to be mutated by a network packet, the core engine should use `Arc::make_mut` (which clones the data *only* if there are other references, ensuring thread safety) or replace the `Arc` entirely.
  - Expose read-only query methods on `WorldState` (e.g., `get_entity(Guid) -> Option<Arc<Entity>>`, `get_inventory(Guid) -> Vec<Arc<Entity>>`). These methods will be used by the UI to pull data for rendering.
- **Acceptance Criteria**: [VERIFIED] `holtburger-world` and `holtburger-core` compile. Core tests pass. [DEVIATION: Resolved major async lock-scoping issues during integration].

### Phase 3: Semantic Event Stream Refactor
- **Motivation**: Stop broadcasting heavy state payloads. Tell the client *what* happened (the semantic action), not the resulting state. This allows the UI to trigger transient effects (animations, sounds) and know exactly what parts of its view are dirty, without having to diff large structs.
- **Deliverables**: [COMPLETED]
  - Redesign `ClientViewEvent` in `holtburger-core` (or a new `holtburger-api` crate). [DONE]
  - Replace heavy events like `EntityUpserted { entity: Box<Entity> }` with lightweight events like `EntitySpawned { guid: Guid }`, `EntityMoved { guid: Guid }`, `EntityDamaged { guid: Guid, amount: u32 }`, `ItemAddedToInventory { item_guid: Guid, container_guid: Guid }`. [DONE]
  - Update the `Client` event translation layer to emit these new semantic events instead of the old state dumps. [DONE]
- **Acceptance Criteria**: [VERIFIED] `holtburger-core` compiles with the new event definitions. Internal tests pass.

### Phase 4: Semantic Event Wiring
- **Motivation**: Connect the CLI to the new semantic event stream and provide it with the shared `WorldState` reference.
- **Deliverables**: [COMPLETED]
  - Provide the CLI with a thread-safe reference to `WorldState` (e.g., `Arc<RwLock<WorldState>>`). [COMPLETED]
  - Update `handle_client_view_event` in the CLI to react to semantic events. [COMPLETED]
  - *Note: This phase temporarily retained the local `GameData` cache to keep the UI compiling while the event pipeline was rewired.*

### Phase 5: True Pull-Based Rendering & State Eradication
- **Motivation**: The ultimate goal of the refactor. Eliminate all duplicated game state from the CLI and force it to render directly from the shared `WorldState`.
- **Deliverables**: [COMPLETED]
  - Refactor the `WorldContext` trait in `holtburger-world` to return `Arc<Entity>` instead of `&Entity` to solve lock lifetime issues.
  - Gut `GameData` in `holtburger-cli`: remove `entities`, `inventory`, `equipment`, `attributes`, `vitals`, `skills`, `vendor`, `trade`, etc.
  - Update all CLI rendering logic to lock the `WorldState` and pull data on-the-fly during the render frame.
- **Acceptance Criteria**: [VERIFIED] `GameData` contains zero duplicated game state. `holtburger-cli` compiles and renders correctly.

## 4. Risks & Mitigations
- **Risk**: Lock contention between the network thread (updating `WorldState`) and the UI thread (reading `WorldState` for rendering).
  - **Mitigation**: The UI should only hold the `RwLock` on `WorldState` long enough to clone the `Arc<Entity>` pointers it needs for the current frame. It should *never* hold the lock during the actual rendering process.
- **Risk**: `Arc::make_mut` overhead if entities mutate constantly.
  - **Mitigation**: Profile the performance. If `Arc` cloning becomes a bottleneck during heavy mutation (e.g., physics ticks), we can explore interior mutability for highly volatile fields (like position), though `Arc` replacement is usually fast enough for our tick rate.
- **Risk**: Massive refactor breaks existing CLI functionality.
  - **Mitigation**: Strictly adhere to the phased approach. Do not start Phase 4 until Phases 1-3 are fully complete and tested. [NOTE: Phase 4 groundwork was required for core building].

## 5. Testing Philosophy
- **No Regressions**: This is a structural refactor, not a feature addition. The primary goal is to ensure the game behaves exactly as it did before.
- **Phase-by-Phase Verification**: Every phase must end with a green CI pipeline (`cargo check`, `cargo test`). Do not proceed to the next phase if tests are failing.
- **Automated Verification**: Rely on the existing test suite to ensure state mutations and protocol parsing remain intact. If necessary, add new unit tests to cover the new `Arc` based query methods.

## 6. Definition of Done (DoD)
- [x] `holtburger-core` is successfully split into `holtburger-session`, `holtburger-world`, and `holtburger-core`.
- [x] `WorldState` uses `Arc<Entity>` for entity storage.
- [x] `ClientViewEvent` uses lightweight, semantic notifications.
- [x] `holtburger-cli` no longer maintains its own `HashMap<Guid, Entity>` or duplicated state (True Pull-Based Rendering).
- [x] The workspace compiles without warnings.
- [x] All unit and integration tests pass.

## 7. The Living Worksheet

### Task Checklist
**Phase 1**
- [x] Create `crates/holtburger-session` and move files.
- [x] Create `crates/holtburger-world` and move files.
- [x] Update workspace `Cargo.toml` and crate dependencies.
- [x] Fix imports and re-exports in `holtburger-core`.

**Phase 2**
- [x] Change `EntityManager` to use `HashMap<Guid, Arc<Entity>>`.
- [x] Update `WorldState` mutation methods to handle `Arc` replacement.
- [x] Add query methods to `WorldState` (`get_entity`, `get_inventory`, etc.).

**Phase 3**
- [x] Redesign `ClientViewEvent` enum in `types.rs`.
- [x] Update `Client::emit_world_view_projection` to map `StateEvent` to lightweight notifications.
- [x] Remove cloning of `Arc<Entity>` from the common event path.
- [x] Cleaned up unused imports and fixed compilation errors in `holtburger-core`.

**Phase 4: Semantic Event Wiring**
- [x] Pass `Arc<RwLock<WorldState>>` to the CLI state.
- [x] Update CLI event handlers to use semantic events.

**Phase 5: True Pull-Based Rendering**
- [x] Refactor `WorldContext` trait to return `Arc<Entity>`.
- [x] Remove duplicated state fields from `GameData`.
- [x] Update CLI rendering logic to pull directly from `WorldState`.

### Decisions Log
- **Decision**: Splitting Phase 4 into Phase 4 (Wiring) and Phase 5 (State Eradication).
  - *Rationale*: Attempting to remove the local `GameData` cache revealed that the `WorldContext` trait's reliance on returning `&Entity` references conflicts with the `RwLockReadGuard` lifetimes when pulling from the shared `WorldState`. A dedicated phase is needed to refactor `WorldContext` to use `Arc<Entity>` and completely gut the CLI's duplicated state.
- **Decision**: Keep `ClientViewEvent` in `holtburger-core` for now.
  - *Rationale*: Creating a `holtburger-api` crate right now might be premature optimization. `holtburger-core` is already acting as the orchestrator/API boundary for the client. We can extract it later if we find that consumers need the event definitions without pulling in the engine logic.
- **Decision**: Small, non-entity state (like `ServerTimeSync`, `CombatMode`, `NoClip`) will be copied, not wrapped in `Arc`.
  - *Rationale*: `Arc` is great for large, complex structs like `Entity` to avoid deep copies. However, for small, primitive-heavy structs or enums, the overhead of atomic reference counting and pointer indirection is actually *worse* than just copying the bytes. The UI can just clone these small values when it queries the `WorldState`.
- **Decision**: Stripping `async` from Movement and Message handlers.
  - *Rationale*: Encountered `tokio::spawn` errors because `RwLockWriteGuard` is `!Send`. Any function holding a write lock on the world cannot contain an `.await` point unless the lock is dropped first. To solve this sustainably, movement logic and message handlers were made synchronous where possible, returning `Option<GameMessage>` payloads that the caller sends after dropping the lock.
- **Decision**: "Ghost" CLI Refactor in Phase 2.
  - *Rationale*: Because the CLI depends on `holtburger-core` types, changing the `WorldState` to use `Arc<Entity>` broke the CLI's own internal cache. I updated the CLI to use `Arc<Entity>` pointers immediately to keep it compiling, which is effectively Phase 4.1. The complete removal of the local cache is still scheduled for Phase 4 proper.

### Verification Log
- 2026-02-26: Phase 1 & 2 verified via `cargo check --workspace` and `cargo test -p holtburger-world`. CLI builds and runs with `Arc<Entity>` pointers.
- 2026-02-27: Phase 3, 4 & 5 verified. `GameData` is fully gutted of duplicated state. CLI uses `with_world` to pull data directly from `WorldState` for rendering. All tests pass and workspace compiles without warnings.

### Open Questions
- *None at this time.*
