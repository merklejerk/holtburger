# Plan: Refactor `holtburger-cli` UI Organization

## 1. Context & Boundaries
- **Goal**: Reorganize the `holtburger-cli` crate's UI module to eliminate "God Objects" (`model.rs`, `types.rs`) and group related components by domain and function, improving maintainability and developer navigation.
- **In Scope**: 
  - Splitting `AppState` and `GameState` into domain-specific state modules.
  - Dispersing `types.rs` into appropriate domain modules.
  - Reorganizing the `widgets/` directory by layout function (e.g., `hud/`, `panels/`).
  - Refactoring `update/` to handle events by domain rather than source.
  - Updating all imports and visibility modifiers to ensure the crate compiles.
- **Out of Scope**: 
  - Adding new features or UI components.
  - Changing the underlying `ratatui` rendering logic or layout breakpoints.
  - Modifying the `holtburger-core` engine or protocol crates.

## 2. Identifying Ground Truth
- **Reference Sources**: 
  - Current `apps/holtburger-cli/src/ui/model.rs` (The "God Object" to be dismantled).
  - Current `apps/holtburger-cli/src/ui/types.rs` (The "Junk Drawer" to be sorted).
  - Current `apps/holtburger-cli/src/ui/update/mod.rs` (The monolithic update loop).
- **Existing Patterns**: 
  - The `widgets/dashboard/` module is a good example of nested, domain-specific organization that we want to replicate across the rest of the UI.

## 3. Phased Implementation

### Phase 1: State & Types Dispersal
- **Deliverables**:
  - Create `src/ui/state/mod.rs`, `src/ui/state/game.rs`, and `src/ui/state/view.rs`.
  - Move `GameState` fields related to authoritative game data (entities, stats, inventory) to `state/game.rs`.
  - Move `GameState` fields related to UI state (scroll offsets, focus, tabs) to `state/view.rs`.
  - Move layout constants from `types.rs` to a new `src/ui/layout.rs`.
  - Move `ChatMessage` types to `src/ui/widgets/chat.rs` (or a new chat state module).
  - Move `UIEffect` and `UpdateResult` to `src/ui/update/mod.rs`.
- **Acceptance Criteria**: The codebase compiles with the new state structures and dispersed types.

### Phase 2: Widget Reorganization
- **Deliverables**:
  - Create `src/ui/widgets/hud/` and move `vitals.rs`, `status.rs`, and `pulse.rs` into it.
  - Create `src/ui/widgets/panels/` and move `chat.rs`, `dynamic.rs`, and `context.rs` (if applicable) into it.
  - Update `src/ui/page/game.rs` and `src/ui/mod.rs` to use the new widget paths.
- **Acceptance Criteria**: The TUI renders exactly as it did before, with no visual regressions.

### Phase 3: Update Loop Domain Split
- **Deliverables**:
  - Refactor `src/ui/update/world.rs` into domain-specific handlers (e.g., `chat.rs`, `inventory.rs`, `combat.rs`, `navigation.rs`) within the `update/` module.
  - Update `AppState::handle_action` to route events to these new domain handlers.
- **Acceptance Criteria**: All user interactions and server events are processed correctly, and the codebase compiles.

## 4. Risks & Mitigations
- **Risk**: Massive import breakage across the crate due to moving types and state fields.
  - **Mitigation**: Rely heavily on `cargo check` and `rust-analyzer` after each file move. Do not proceed to the next phase until the current phase compiles.
- **Risk**: Introducing subtle bugs in the update loop by splitting `world.rs`.
  - **Mitigation**: Carefully trace the logic for each event type before moving it. Ensure the new domain handlers have access to the necessary parts of the split `AppState`.
- **Risk**: Borrow checker conflicts when splitting `GameState` into `game.rs` and `view.rs`.
  - **Mitigation**: The `update/` handlers currently take `&mut AppState`. If a handler needs to mutate both `game` and `view` state simultaneously, we must ensure the methods are defined on `AppState` itself (which can destructure its fields) rather than passing `&mut AppState` down into methods that only need partial access. We will use `std::mem::replace` (as already seen in `input.rs`) or field destructuring (`let AppState { game, view, .. } = self;`) to satisfy the borrow checker when delegating to sub-modules.

## 5. Definition of Done (DoD)
- [x] `model.rs` and `types.rs` are significantly reduced in size or eliminated entirely.
- [x] `widgets/` is organized into logical subdirectories (`hud/`, `panels/`, `dashboard/`).
- [x] `update/` logic is split by domain. (Extracted `chat.rs`, `inventory.rs`, `combat.rs`, `navigation.rs`, `client.rs`)
- [x] `cargo check -p holtburger-cli` passes with no warnings. (Warnings fixed by `cargo fix`)
- [x] `cargo fmt -p holtburger-cli` has been run.
- [ ] The TUI launches and functions correctly (verified manually or via existing tests).

## 6. The Living Worksheet

### Task Checklist
- [x] **Phase 1: State & Types Dispersal**
  - [x] Create `state/` module structure.
  - [x] Migrate game data to `state/game.rs`.
  - [x] Migrate UI data to `state/view.rs`.
  - [x] Extract layout constants to `layout.rs`.
  - [x] Disperse remaining types from `types.rs`.
  - [x] Fix imports and compile.
- [x] **Phase 2: Widget Reorganization**
  - [x] Create `hud/` and `panels/` directories.
  - [x] Move widget files.
  - [x] Fix imports and compile.
- [x] **Phase 3: Update Loop Domain Split**
  - [x] Create domain-specific update modules. (Extracted `effect.rs`, `chat.rs`, `inventory.rs`, `combat.rs`, `navigation.rs`, `client.rs`)
  - [x] Migrate logic from `world.rs`.
  - [x] Update `handle_action` routing.
  - [x] Fix imports and compile.

### Decisions Log
- **2026-02-20**: Chose absolute paths (`crate::ui::...`) for core UI types over relative ones (`super::super`) to prevent re-breakage if items are moved again.
- **2026-02-20**: Extracted `UpdateResult` and `UIEffect` to `src/ui/update/effect.rs` to allow them to be used by all UI modules without circular dependencies.
- **2026-02-20**: Unified layout constants (including former `pulse.rs` constants) in [layout.rs](apps/holtburger-cli/src/ui/layout.rs).
- **2026-02-20**: Split `world.rs` into specialized domain handlers (`chat`, `inventory`, `combat`, `navigation`, `client`) for better logic locality.

### Verification Log
- **2026-02-20**: Ran `cargo check -p holtburger-cli` iteratively throughout refactor.
- **2026-02-20**: Used `cargo fix` to prune 20+ unused imports after widget migration.
- **2026-02-20**: Verified full build success after Phase 3 split.

### Open Questions
- *None yet.*
