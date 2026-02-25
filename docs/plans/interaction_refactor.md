# Interaction System Refactor Plan

## 1. Context & Boundaries
- **Goal**: Centralize the TUI entity interaction logic (Moving, Healing, Targeting) into a cohesive, enum-based state machine to eliminate boilerplate and make adding new interactions trivial.
- **In Scope**: 
  - Replacing `InteractionMode` and `ActiveInteraction` with a new `Interaction` enum.
  - Moving action handling for interactions out of `common.rs` and into the `Interaction` impl.
  - Updating `GameState` and `UIEffect` to use the new system.
  - Updating the dynamic panel to render status text from the `Interaction` enum.
- **Out of Scope**: 
  - Adding new interaction types (e.g., Crafting) during this refactor.
  - Changing how `CommandTarget` works.
  - Moving verb generation out of tab controllers (tabs will still own their verb logic).

## 2. Identifying Ground Truth
- **Existing Patterns**: 
  - The current scattered logic in `apps/holtburger-cli/src/ui/widgets/dashboard/tabs/common.rs` (`handle_base_action`).
  - Tab-specific verb overrides in `apps/holtburger-cli/src/ui/widgets/dashboard/tabs/*/tab.rs`.
  - Effect resolution in `apps/holtburger-cli/src/ui/update/effect.rs`.
  - Dynamic panel rendering in `apps/holtburger-cli/src/ui/widgets/panels/dynamic.rs`.

## 3. Phased Implementation

### Phase 1: Define the Core Abstraction
- **Deliverables**:
  - Create `apps/holtburger-cli/src/ui/interaction.rs`.
  - Define the `Interaction` enum with variants for `Moving`, `Healing`, and `Targeting`.
  - Implement `handle_action(&self, action: &Action, target: &CommandTarget, game: &GameState) -> Option<UIEffect>`.
  - Implement `status_text(&self) -> &'static str`.
- **Acceptance Criteria**: The new module compiles and encapsulates the action handling logic currently found in `common.rs` and `dynamic.rs`.

### Phase 2: State & Effect Migration
- **Deliverables**:
  - Update `apps/holtburger-cli/src/ui/types.rs` to remove `InteractionMode` and `ActiveInteraction`.
  - Update `GameStateView` in `apps/holtburger-cli/src/ui/state/mod.rs` to use `pub active_interaction: Option<Interaction>`.
  - Update `UIEffect` variants in `apps/holtburger-cli/src/ui/update/effect.rs` to construct the new `Interaction` enum variants instead of the old structs.
- **Acceptance Criteria**: The core state and effect resolution compile with the new types.

### Phase 3: UI & Tab Integration
- **Deliverables**:
  - Update `apps/holtburger-cli/src/ui/widgets/panels/dynamic.rs` to call `interaction.status_text()`.
  - Update all tab controllers (`inventory`, `equip`, `character`, `spells`, `nearby`, `trade`) to match on the new `Interaction` enum variants when generating verbs.
  - Strip out the interaction-specific `handle_base_action` overrides from `common.rs` and delegate them to `Interaction::handle_action`.
- **Acceptance Criteria**: The TUI compiles, runs, and all existing interactions (moving items, healing, targeting spells) function exactly as they did before, but with centralized action handling.

## 4. Risks & Mitigations
- **Risk**: Breaking existing interaction flows (e.g., moving an item into a container vs giving it to an NPC).
  - **Mitigation**: Carefully port the exact match arms from `common.rs` into the new `Interaction::handle_action` method. Test each interaction type manually after Phase 3.
- **Risk**: Circular dependencies between `Interaction`, `GameState`, and `UIEffect`.
  - **Mitigation**: Keep `Interaction` in its own module (`ui/interaction.rs`) and pass `GameState` by reference only when necessary (e.g., for `handle_action` context).

## 5. Definition of Done (DoD)
- [x] `InteractionMode` and `ActiveInteraction` are completely removed from the codebase.
- [x] All tabs rely on the centralized `Interaction` enum for interaction-state verbs and actions.
- [x] The project compiles without warnings (`cargo clippy --fix --allow-dirty && cargo fmt --all`).
- [ ] Manual testing confirms Moving, Healing, and Targeting work correctly in the TUI.

## 6. The Living Worksheet

### Task Checklist
- [x] **Phase 1**
  - [x] Create `ui/interaction.rs`.
  - [x] Define `Interaction` enum.
  - [x] Implement `handle_action`.
  - [x] Implement `status_text`.
- [x] **Phase 2**
  - [x] Remove old types from `ui/types.rs`.
  - [x] Update `GameStateView`.
  - [x] Update `UIEffect` resolution.
- [x] **Phase 3**
  - [x] Update dynamic panel rendering.
  - [x] Update tab controllers to match on new enum.
  - [x] Clean up `handle_base_action` in `common.rs`.

### Open Questions
- Should `Interaction::handle_action` return `UIEffect` or `ClientCommand` directly? (Currently leaning towards `UIEffect` to match existing patterns, but returning `ClientCommand` might skip a step).