# World / Player Handler Reorganization Plan

## 1. Context & Boundaries
- **Goal**: Reorganize `holtburger-world` so state models (`PlayerState`, `WorldState`) are separated cleanly from protocol message handlers, with handlers grouped by feature rather than by whichever struct currently owns most of the mutated fields.
- **Scope**:
  - **In Scope**:
    - Refactoring handler code under [crates/holtburger-world/src/player](crates/holtburger-world/src/player) and [crates/holtburger-world/src/state](crates/holtburger-world/src/state).
    - Introducing a dedicated handler module area for world protocol message processing.
    - Converting direct message-parsing logic into narrower mutation methods on `PlayerState` and `WorldState`.
    - Preserving current behavior, message ordering, and the player/entity mirror invariant.
    - Updating and expanding tests to lock in behavior during the refactor.
  - **Out of Scope**:
    - Rewriting protocol decoding in `holtburger-protocol`.
    - Changing event semantics exposed by `StateEvent`.
    - Changing gameplay logic, stat formulas, or ACE-aligned interpretation of packets.
    - Broad crate renames or public API cleanup outside `holtburger-world` unless needed for the refactor.

## 2. Ground Truth & Existing Patterns

### Reference Sources
- Current player model and ownership notes: [crates/holtburger-world/src/player/mod.rs](crates/holtburger-world/src/player/mod.rs#L28-L32)
- Current player-focused handler orchestration: [crates/holtburger-world/src/handlers/player.rs](crates/holtburger-world/src/handlers/player.rs)
- Current world state and mirror invariant notes: [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs#L36-L43)
- Current top-level dispatch flow: [crates/holtburger-world/src/handlers/mod.rs](crates/holtburger-world/src/handlers/mod.rs)
- Current `PlayerDescription` orchestration split: [crates/holtburger-world/src/handlers/player.rs](crates/holtburger-world/src/handlers/player.rs), [crates/holtburger-world/src/handlers/login.rs](crates/holtburger-world/src/handlers/login.rs)
- Current inventory orchestration split: [crates/holtburger-world/src/handlers/player.rs](crates/holtburger-world/src/handlers/player.rs), [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs)
- Current movement/mirror handling: [crates/holtburger-world/src/handlers/movement.rs](crates/holtburger-world/src/handlers/movement.rs), [crates/holtburger-world/src/state/physics.rs](crates/holtburger-world/src/state/physics.rs#L88-L137)
- Current property fan-out across player/entities/vendor: [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs)

### Existing Architectural Precedent
- The code already uses a two-phase dispatch model: player-first, world-second. We should preserve that behavior even if the modules move.
- Tests already protect the player/entity mirror invariant and several handler paths: [crates/holtburger-world/src/state/tests.rs](crates/holtburger-world/src/state/tests.rs), [crates/holtburger-world/src/player/tests.rs](crates/holtburger-world/src/player/tests.rs)
- A prior feature-to-owner event refactor exists as a planning precedent: [docs/plans/event_refactor.md](docs/plans/event_refactor.md)

### Dry-Run Findings Against the Current Codebase
- **Stable public dispatch API exists today**: `holtburger-core` currently calls `WorldState::handle_message()` directly, so the refactor should preserve that API and make it delegate internally rather than removing it early: [crates/holtburger-core/src/client/messages.rs](crates/holtburger-core/src/client/messages.rs#L39-L46)
- **Tests depend directly on the current player router**: `player/tests.rs` calls `PlayerState::handle_message()` directly, but this is not a reason to preserve that API if the architecture is cleaner without it. The tests should be rewritten around the new mutation methods or new handler entry points instead: [crates/holtburger-world/src/player/tests.rs](crates/holtburger-world/src/player/tests.rs#L348-L348), [crates/holtburger-world/src/player/tests.rs](crates/holtburger-world/src/player/tests.rs#L422-L422)
- **Some helpers are private to `state/` today**: `emit_level_info()` and `update_player_inventory_recursive()` are not currently callable from a top-level sibling module, which means a top-level `handlers/` layout either needs `pub(crate)` helper promotion or nested handler modules under `state/` / `player`: [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs#L168-L172), [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs)
- **There are misc/system variants not captured by the initial handler list**: `UseDone`, `WeenieError`, and `WeenieErrorWithString` need an explicit home, and `SetState` plus some property-driven scene side effects need to stay accounted for in the handler map: [crates/holtburger-world/src/handlers/system.rs](crates/holtburger-world/src/handlers/system.rs), [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs)
- **The baseline is green**: `cargo test -p holtburger-world --quiet` passes before the refactor, so we can treat the current test suite as a reliable regression floor.

## 3. Target Architecture

### Desired Shape
- `player/`
  - Owns `PlayerState`, stat/magic helpers, and focused player mutation methods.
  - Does **not** own the protocol routing surface or preserve a legacy message-router API just for test convenience.
- `state/` (or later `world/`)
  - Owns `WorldState`, physics/spatial/vendor/trade state, and world mutation methods.
  - Does **not** own feature handler routing by itself.
- `handlers/`
  - Owns feature-based message handling modules such as `login`, `inventory`, `movement`, `properties`, `trade`, `player`, and optionally `system` / `misc` for protocol events that do not fit the cleaner feature buckets.
  - May call into both `PlayerState` and `WorldState` mutation methods as needed.

### Placement Constraint
The dry-run suggests that the first implementation should preserve `WorldState::handle_message()` as the public entry point and have it delegate inward.
The handler modules can still be organized by feature, but their physical location should be chosen with Rust visibility in mind:
- either a top-level `handlers/` module plus `pub(crate)` helper promotion,
- or feature handlers nested under `state/` and `player/` during the migration, with a later flattening step if it still feels worth it.

### Design Rule
Protocol handlers should mostly **orchestrate**.
State types should mostly **mutate themselves through narrow methods**.
This keeps ownership clear and prevents state structs from becoming giant parser/router objects.

## 4. Phased Implementation

### Phase 1: Establish the New Handler Surface
- **Complexity:** Low
- **Goal:** Introduce a `handlers/` module tree without changing behavior.
- **Files**:
  - New: [crates/holtburger-world/src/handlers](crates/holtburger-world/src/handlers)
  - Update: [crates/holtburger-world/src/lib.rs](crates/holtburger-world/src/lib.rs) or the crate root module file that currently exposes `player`, `state`, and sibling modules
  - Update: [crates/holtburger-world/src/state/messages/mod.rs](crates/holtburger-world/src/state/messages/mod.rs)
- **Deliverables**:
  - Add a new handler module area with placeholder feature files.
  - Preserve `WorldState::handle_message()` as the external API and make it delegate into the new handler surface.
  - Decide early whether the migration starts with top-level `handlers/` or nested feature handlers plus a later flattening step.
  - Keep existing handlers delegating through compatibility shims at first.
- **Acceptance Criteria**:
  - Project compiles.
  - No behavior changes.
  - Existing tests pass.
  - `holtburger-core` continues to compile without call-site changes.

### Phase 2: Extract Pure Mutation Methods from `PlayerState`
- **Complexity:** Medium
- **Goal:** Shrink `PlayerState::handle_message()` into reusable player mutation methods so handlers can call them explicitly.
- **Files**:
  - Update: [crates/holtburger-world/src/player/messages.rs](crates/holtburger-world/src/player/messages.rs)
  - Update: [crates/holtburger-world/src/player/mod.rs](crates/holtburger-world/src/player/mod.rs)
  - Optional new files under [crates/holtburger-world/src/player](crates/holtburger-world/src/player) if the mutation methods should be split by concern (`attributes`, `inventory`, `enchantments`, etc.)
- **Deliverables**:
  - Extract focused methods for:
    - full player hydration from `PlayerDescription`
    - attribute / skill / vital updates
    - enchantment and spell mutations
    - inventory/equipment set maintenance
    - player-local sequence updates
  - Delete or aggressively shrink `handle_message()` once the new handler layer is real; do not preserve it solely for test compatibility.
- **Acceptance Criteria**:
  - `PlayerState` behavior is covered by existing tests plus new extraction-focused tests.
  - No protocol routing logic is duplicated.
  - Tests are rewritten to target mutation methods or the new handler layer rather than the legacy player router.
  - `cargo test -p holtburger-world player::tests` (or equivalent targeted test selection) passes after the test rewrite.

### Phase 3: Extract Pure Mutation Methods from `WorldState`
- **Complexity:** Medium
- **Goal:** Move world graph mutation details behind narrower `WorldState` methods so handler modules do not directly micromanage entity internals.
- **Files**:
  - Update: [crates/holtburger-world/src/state/messages/inventory.rs](crates/holtburger-world/src/state/messages/inventory.rs)
  - Update: [crates/holtburger-world/src/state/messages/login.rs](crates/holtburger-world/src/state/messages/login.rs)
  - Update: [crates/holtburger-world/src/state/messages/movement.rs](crates/holtburger-world/src/state/messages/movement.rs)
  - Update: [crates/holtburger-world/src/state/messages/properties.rs](crates/holtburger-world/src/state/messages/properties.rs)
  - Update: [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs)
  - Update: [crates/holtburger-world/src/state/physics.rs](crates/holtburger-world/src/state/physics.rs)
- **Deliverables**:
  - Introduce focused methods for:
    - syncing player position / velocity mirror state
    - updating entity container/wielder/world placement
    - applying generic property updates to player/entity/vendor targets
    - emitting `PlayerInfo` / level info from already-hydrated state
    - handling misc/system event side effects currently stranded in inventory/properties (`UseDone`, `WeenieError*`, `SetState`, trade-complete cleanup)
  - Reduce direct field manipulation inside message handlers.
- **Acceptance Criteria**:
  - Mirror invariant tests still pass.
  - Inventory, movement, and property tests still pass.
  - Direct mutation of `entities`, `scene`, and `player` from handler files is reduced to well-defined helper calls.

### Phase 4a: Migrate Simple Feature Handlers
- **Complexity:** Low
- **Goal:** Validate the new feature-handler layout by moving the lowest-risk handlers first.
- **Files**:
  - New / Update: [crates/holtburger-world/src/handlers/login.rs](crates/holtburger-world/src/handlers/login.rs)
  - New / Update: [crates/holtburger-world/src/handlers/trade.rs](crates/holtburger-world/src/handlers/trade.rs)
  - New / Update: [crates/holtburger-world/src/handlers/system.rs](crates/holtburger-world/src/handlers/system.rs) or explicit homes for `UseDone`, `WeenieError*`, and related oddball variants
  - Update: [crates/holtburger-world/src/state/messages/mod.rs](crates/holtburger-world/src/state/messages/mod.rs) or the replacement dispatch home
- **Deliverables**:
  - Move `login`, `trade`, and misc/system routing into the new handler surface.
  - Keep message ordering unchanged.
  - Prove the new handler organization works before touching the dual-touch player/world flows.
- **Acceptance Criteria**:
  - Project compiles.
  - Login, trade, and error/use behavior remain unchanged.
  - Full crate test suite passes.

### Phase 4b: Migrate World-Only Handlers
- **Complexity:** Medium
- **Goal:** Move handlers that primarily mutate `WorldState`, entities, scene state, or vendor state.
- **Files**:
  - New / Update: [crates/holtburger-world/src/handlers/movement.rs](crates/holtburger-world/src/handlers/movement.rs)
  - New / Update: [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs)
  - New / Update: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs)
  - Update: [crates/holtburger-world/src/state/messages/mod.rs](crates/holtburger-world/src/state/messages/mod.rs) or the replacement dispatch home
- **Deliverables**:
  - Move world-only movement handling.
  - Move property and inventory object-lifecycle flows that are primarily about entities / scene placement / vendor state.
  - Keep shared player-facing logic on the old path until Phase 4c.
- **Acceptance Criteria**:
  - Movement, property, and object lifecycle tests still pass.
  - The new handler layout is handling the majority of world-only protocol routing.
  - Full crate test suite passes.

### Phase 4c: Migrate Shared Player/World Orchestration
- **Complexity:** High
- **Goal:** Move the genuinely coupled flows that currently make the architecture confusing.
- **Files**:
  - New / Update: [crates/holtburger-world/src/handlers/player.rs](crates/holtburger-world/src/handlers/player.rs)
  - New / Update: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs)
  - New / Update: [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs)
  - New / Update: [crates/holtburger-world/src/handlers/movement.rs](crates/holtburger-world/src/handlers/movement.rs)
  - Update: [crates/holtburger-world/src/state/messages/mod.rs](crates/holtburger-world/src/state/messages/mod.rs) or the replacement dispatch home
  - Update: [crates/holtburger-world/src/player/messages.rs](crates/holtburger-world/src/player/messages.rs)
- **Deliverables**:
  - Create the explicit orchestration home for:
    1. `PlayerDescription`
    2. inventory ownership and equipment transitions
    3. property updates that affect both player-local state and world/entity mirrors
    4. movement flows that update player-local sequences and world mirrors together
  - Preserve current message order semantics:
    1. apply player-local mutations
    2. apply world/entity mutations
    3. emit derived `StateEvent`s / spell name resolution
- **Acceptance Criteria**:
  - The top-level dispatch no longer depends on `PlayerState::handle_message()` as the primary routing abstraction.
  - Inventory and `PlayerDescription` handling are no longer split across surprising locations without an explicit orchestrator.
  - Full crate test suite passes.

### Phase 4d: Remove Legacy Routers and Rewrite Tests
- **Complexity:** Medium
- **Goal:** Delete the old routing seams once the new handler layer is proven.
- **Files**:
  - Update / Delete: [crates/holtburger-world/src/player/messages.rs](crates/holtburger-world/src/player/messages.rs)
  - Update / Delete: [crates/holtburger-world/src/state/messages/mod.rs](crates/holtburger-world/src/state/messages/mod.rs)
  - Update / Delete: [crates/holtburger-world/src/state/messages/login.rs](crates/holtburger-world/src/state/messages/login.rs)
  - Update / Delete: [crates/holtburger-world/src/state/messages/inventory.rs](crates/holtburger-world/src/state/messages/inventory.rs)
  - Update / Delete: [crates/holtburger-world/src/state/messages/movement.rs](crates/holtburger-world/src/state/messages/movement.rs)
  - Update / Delete: [crates/holtburger-world/src/state/messages/properties.rs](crates/holtburger-world/src/state/messages/properties.rs)
  - Update / Delete: [crates/holtburger-world/src/state/messages/trade.rs](crates/holtburger-world/src/state/messages/trade.rs)
  - Update: [crates/holtburger-world/src/player/tests.rs](crates/holtburger-world/src/player/tests.rs)
  - Update: [crates/holtburger-world/src/state/tests.rs](crates/holtburger-world/src/state/tests.rs)
- **Deliverables**:
  - Remove compatibility shims and dead routers.
  - Rewrite tests to target mutation methods and the new handler seam instead of legacy router methods.
  - Collapse any leftover duplicate routing logic.
- **Acceptance Criteria**:
  - No legacy router survives only for compatibility.
  - Tests target the new architecture.
  - Full crate test suite passes.

### Phase 5: Cleanup, Naming, and Documentation Pass
- **Complexity:** Low to Medium
- **Goal:** Make the resulting layout understandable to a new reader.
- **Files**:
  - Update module docs / comments in [crates/holtburger-world/src/player/mod.rs](crates/holtburger-world/src/player/mod.rs) and [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs)
  - Update or add crate-level docs if needed
  - Optional: rename `state/` to `world/` in a follow-up if the team wants the stronger semantic cleanup
- **Deliverables**:
  - Refresh doc comments to describe the post-refactor ownership model.
  - Remove stale compatibility adapters and dead code.
  - Decide whether a `state` → `world` rename is worth the churn after handler extraction is complete.
- **Acceptance Criteria**:
  - No stale routing comments remain.
  - Module names and doc comments match actual responsibilities.
  - `cargo check` and tests are green after cleanup-only changes.

## 5. Risks & Mitigations

### Risk 1: Message Ordering Regressions
Some messages currently update `PlayerState` first and only then sync `WorldState`, or vice versa by intentional accident.
- **Mitigation**:
  - Preserve the current observable order in Phase 4.
  - Add regression tests specifically for `PlayerDescription`, inventory transfers, wield/unequip, position sync, and property updates affecting both player and world mirrors.

### Risk 2: Breaking the Player / Entity Mirror Invariant
The existing code explicitly warns that player position and entity position must stay in sync.
- **Mitigation**:
  - Keep `set_player_position()`, `set_player_velocity()`, and related world mutation methods as the only authority for mirrored movement state.
  - Expand invariant tests before deleting old routing code.

### Risk 3: Borrow Checker Friction in Shared Feature Handlers
Feature-based handlers will often need to mutate both `self.player` and `self.entities` in one flow.
- **Mitigation**:
  - Extract narrow mutation methods first in Phases 2 and 3.
  - Prefer handlers that sequence short `WorldState` method calls instead of holding long mutable borrows across branching logic.

### Risk 4: Refactor Produces “Wrapper Hell” Instead of Simpler Code
A bad extraction could leave lots of pass-through functions without improving clarity.
- **Mitigation**:
  - Only keep mutation methods that meaningfully encode invariants or business meaning.
  - Delete temporary shims aggressively in Phase 5 once the new handler layer is stable.
  - Do not retain legacy entry points only because tests were originally written against them.

### Risk 5: Over-scoping into a Naming Crusade
Renaming `state` to `world` too early could create noisy churn and bury the meaningful architectural changes.
- **Mitigation**:
  - Defer naming cleanup until behavior and ownership are stabilized.
  - Treat directory renames as an optional final pass, not part of the critical path.

## 6. Definition of Done
- [x] Protocol handlers are organized by feature under a dedicated handler area.
- [x] `PlayerState` is primarily a state model plus focused mutation helpers, not the main router.
- [x] `WorldState` remains the authority for world/entity/spatial invariants.
- [x] Shared messages (`PlayerDescription`, inventory transitions, movement, property updates) have one obvious orchestration home.
- [x] Mirror invariant tests pass.
- [x] Existing behavior-facing tests pass and new regression coverage exists for dual-touch messages.
- [x] `cargo check -p holtburger-world` passes.
- [x] `cargo test -p holtburger-world` passes.
- [ ] Module docs/comments explain the new ownership split.

## 7. Living Worksheet

### Task Checklist
- [x] **Phase 1**: Add the `handlers/` module tree and compatibility entry points.
- [x] **Phase 2**: Extract player-local mutation methods from `PlayerState::handle_message()`.
- [x] **Phase 3**: Extract world mutation helpers from `state/messages/*` into narrower `WorldState` methods.
- [x] **Phase 4a**: Migrate simple feature handlers (`login`, `trade`, misc/system).
- [x] **Phase 4b**: Migrate world-only handlers.
- [x] **Phase 4c**: Migrate shared player/world orchestration.
- [x] **Phase 4d**: Remove legacy routers and rewrite tests.
- [ ] **Phase 5**: Clean up docs, stale adapters, and optional naming follow-up.

### Decisions Log
- **Architectural**: Prefer separating **state models** from **protocol handlers** over flattening everything into `state/`.
- **Architectural**: Keep the `PlayerState` / `WorldState` distinction because it encodes real invariants and ownership, even though the current handler layout is confusing.
- **Sequencing**: Treat `state` → `world` renaming as optional and explicitly defer it until after handler extraction.
- **Testing**: Test compatibility does not justify preserving `PlayerState::handle_message()` or other legacy routing APIs. Tests should follow the cleaner architecture.
- **Architectural**: Keep world-side mutation helpers in `state/mutations.rs` for now so the new `handlers/` layer can call a narrow `WorldState` API later without fighting visibility or borrow-checker churn during the migration.
- **Architectural**: Introduce a generic property-target mutation helper on `WorldState` now, but keep message-specific side effects (`CombatModeUpdated`, level info emission, derived stat recalculation) in the existing property handler until Phase 4 moves routing into `handlers/`.
- **Sequencing**: Move simple-feature routing into `handlers/` before deleting the old `state/messages/login.rs` and `state/messages/trade.rs` files. Their file-level cleanup can wait for the legacy-router removal phase once the rest of the dispatch migration is done.
- **Architectural**: Add trade/vendor mutation helpers on `WorldState` so the new handler modules orchestrate state transitions instead of re-embedding trade-state mutation logic.
- **Sequencing**: For Phase 4b, move only clearly world-only inventory flows (`ParentEvent`, `PickupEvent`, `ViewContents`, `CloseGroundContainer`, non-player `WieldObject`, `IdentifyObjectResponse`) into `handlers/inventory.rs`; keep player-owned inventory transitions on the legacy path until Phase 4c.
- **Architectural**: Route non-player movement and non-player/vendor property fan-out through `handlers/` first, but allow the legacy `state/messages/*` files to remain as compatibility fallback until the final router deletion phase.
- **Architectural**: Move shared player/world orchestration into feature handlers instead of treating `PlayerState::handle_message()` as the primary router.
- **Implementation**: A corrupted intermediate edit left [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs) in a bad state, so the active inventory handler was temporarily moved to [crates/holtburger-world/src/handlers/inventory_handler.rs](crates/holtburger-world/src/handlers/inventory_handler.rs) via a module `#[path]` override in [crates/holtburger-world/src/handlers/mod.rs](crates/holtburger-world/src/handlers/mod.rs). Phase 4d should delete the stale file and collapse back to the canonical path.
- **Architectural**: Phase 4d removes the legacy router seam entirely. `WorldState::handle_message()` now delegates straight to [crates/holtburger-world/src/handlers/mod.rs](crates/holtburger-world/src/handlers/mod.rs), and `PlayerState` no longer exposes a message-router module.
- **Implementation**: Phase 4d restored [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs) as the canonical inventory handler path and deleted the temporary `inventory_handler.rs` workaround.

### Verification Log
- **Phase 1 Complete**:
  - Created `handlers/` module with placeholder files.
  - Re-routed `WorldState::handle_message` through `handlers::handle_message`.
  - Fixed initial compile errors related to `StateEvent` imports and `handle_message_legacy` return types.
  - Verified `cargo test -p holtburger-world` passes with all 27 tests green.
- **Phase 2 Complete**:
  - Created `player/mutations.rs` to house focused player state update logic.
  - Extracted `update_attribute`, `update_skill`, `update_vital`, `update_vital_current`, and `update_position_from_server` from the legacy router.
  - Slimmed down `PlayerState::handle_message` in `player/messages.rs` to use these new mutation methods.
  - Verified no regressions in existing world tests.
- **Phase 3 Complete**:
  - Created `state/mutations.rs` to hold world-side mutation helpers and promoted `emit_level_info()` to that shared helper surface.
  - Extracted helpers for player-description follow-up, world/entity movement, inventory/container/wielder placement, generic property target application, instance-id side effects, and trade-complete cleanup.
  - Refactored [crates/holtburger-world/src/state/messages/login.rs](crates/holtburger-world/src/state/messages/login.rs), [crates/holtburger-world/src/state/messages/movement.rs](crates/holtburger-world/src/state/messages/movement.rs), [crates/holtburger-world/src/state/messages/inventory.rs](crates/holtburger-world/src/state/messages/inventory.rs), and [crates/holtburger-world/src/state/messages/properties.rs](crates/holtburger-world/src/state/messages/properties.rs) to use those narrower `WorldState` methods.
  - Verified `cargo check -p holtburger-world` and `cargo test -p holtburger-world --quiet` both pass with all 27 tests green.
- **Phase 4a Complete**:
  - Moved top-level routing for login, trade, vendor, `UseDone`, `WeenieError*`, and `SetState` into [crates/holtburger-world/src/handlers/login.rs](crates/holtburger-world/src/handlers/login.rs), [crates/holtburger-world/src/handlers/trade.rs](crates/holtburger-world/src/handlers/trade.rs), and [crates/holtburger-world/src/handlers/system.rs](crates/holtburger-world/src/handlers/system.rs).
  - Updated [crates/holtburger-world/src/handlers/mod.rs](crates/holtburger-world/src/handlers/mod.rs) to own player-first dispatch plus the new simple-feature handler ordering before falling back to the legacy world handlers.
  - Added `WorldState` trade/vendor mutation helpers in [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs) and removed the migrated routes from the legacy fallback in [crates/holtburger-world/src/state/messages/mod.rs](crates/holtburger-world/src/state/messages/mod.rs), [crates/holtburger-world/src/state/messages/inventory.rs](crates/holtburger-world/src/state/messages/inventory.rs), and [crates/holtburger-world/src/state/messages/properties.rs](crates/holtburger-world/src/state/messages/properties.rs).
  - Verified `cargo check -p holtburger-world` and `cargo test -p holtburger-world --quiet` both pass with all 27 tests green.
- **Phase 4b Complete**:
  - Implemented world-only routing in [crates/holtburger-world/src/handlers/movement.rs](crates/holtburger-world/src/handlers/movement.rs), [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs), and [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs).
  - Updated [crates/holtburger-world/src/handlers/mod.rs](crates/holtburger-world/src/handlers/mod.rs) so non-player movement, non-player/vendor property updates, and world-only inventory events are handled in the new feature layer before falling back to legacy shared flows.
  - Added `WorldState::set_entity_rotation()` in [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs) to keep non-player turn handling behind a narrow world mutation method.
  - Verified `cargo check -p holtburger-world` and `cargo test -p holtburger-world --quiet` both pass with all 27 tests green.
- **Phase 4c Complete**:
  - Added shared player mutation helpers in [crates/holtburger-world/src/player/mutations.rs](crates/holtburger-world/src/player/mutations.rs) for `PlayerDescription` hydration, movement sequence tracking, enchantment/spell updates, and health updates.
  - Implemented [crates/holtburger-world/src/handlers/player.rs](crates/holtburger-world/src/handlers/player.rs) so player-local mutations are orchestrated from the handler layer instead of through `PlayerState::handle_message()`.
  - Expanded [crates/holtburger-world/src/handlers/movement.rs](crates/holtburger-world/src/handlers/movement.rs), [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs), and [crates/holtburger-world/src/handlers/inventory_handler.rs](crates/holtburger-world/src/handlers/inventory_handler.rs) to own the shared movement/property/inventory flows that mutate both player-local and world/entity state.
  - Updated [crates/holtburger-world/src/handlers/mod.rs](crates/holtburger-world/src/handlers/mod.rs) so it now orchestrates player-local updates first, shared world/entity updates second, and spell-name resolution last.
  - Added `WorldState::set_player_vector()` in [crates/holtburger-world/src/state/physics.rs](crates/holtburger-world/src/state/physics.rs) so player vector updates can keep the entity mirror in sync while preserving the packet's `omega` value.
  - Verified `cargo check -p holtburger-world` and `cargo test -p holtburger-world --quiet` both pass with all 27 tests green.
- **Phase 4d Complete**:
  - Deleted the legacy router files under [crates/holtburger-world/src/player](crates/holtburger-world/src/player) and [crates/holtburger-world/src/state/messages](crates/holtburger-world/src/state/messages), leaving the feature-based handler layer as the only routing surface.
  - Simplified [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs) so `WorldState::handle_message()` delegates directly to the handler layer, and removed the legacy router export from [crates/holtburger-world/src/player/mod.rs](crates/holtburger-world/src/player/mod.rs).
  - Restored [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs) as the canonical inventory handler and deleted the temporary workaround module.
  - Rewrote the remaining player-facing routing tests in [crates/holtburger-world/src/player/tests.rs](crates/holtburger-world/src/player/tests.rs) to exercise `WorldState::handle_message()` instead of the deleted `PlayerState` router seam.
  - Verified `cargo check -p holtburger-world --quiet` and `cargo test -p holtburger-world --quiet` both pass with all 27 tests green.

### Open Questions
- No blocking architecture questions remain for the handler split.
- Phase 5 should decide whether to refresh module docs/comments only, or also pay the extra churn cost for an optional `state` → `world` rename.
