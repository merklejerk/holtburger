# Plan: TUI Component-Based Refactor

## 1. Context & Boundaries

- **Goal**: Refactor the TUI dashboard to use a component-based architecture where each tab (Inventory, Equipment, etc.) manages its own rendering, input handling, and verb generation.
- **Scope**:
    -   **In Scope**:
        -   Refactoring `apps/holtburger-cli/src/ui/widgets/dashboard.rs` and splitting it into submodules.
        -   Defining a new `TabController` (or similar) trait.
        -   Updating `apps/holtburger-cli/src/ui/update/input.rs` to delegate input handling.
        -   Moving verb generation logic from the global `verbs.rs` into specific tab implementations where appropriate (or context-aware implementations).
    -   **Out of Scope**:
        -   Refactoring other UI panes (Chat, Map, etc.) unless strictly necessary to support the dashboard refactor.
        -   Changing core protocol logic (already done in previous steps).

## 2. Identifying Ground Truth

- **Reference Sources**:
    -   `apps/holtburger-cli/src/ui/model.rs`: Defines `AppState` and `DashboardTab`.
    -   `apps/holtburger-cli/src/ui/widgets/dashboard.rs`: Current monolithic dashboard implementation.
    -   `apps/holtburger-cli/src/ui/update/input.rs`: Current centralized input handling.
    -   `apps/holtburger-cli/src/entities/verbs.rs`: Current centralized verb logic.

- **Existing Patterns**:
    -   The `Ratatui` widget pattern (render method).
    -   The `Action`/`Update` pattern in `ui/action.rs` and `ui/update`.

## 3. Phased Implementation

### Phase 1: Define the `TabController` Trait
Create the abstraction that allows tabs to be self-contained.

- **Deliverables**:
    -   `apps/holtburger-cli/src/ui/traits.rs`: New file with `TabController` trait.
    -   Trait signature:
        -   `render(&self, f: &mut Frame, state: &mut AppState, area: Rect)` (Matches `render_dashboard_pane` usage)
        -   `get_verbs(&self, state: &AppState, index: usize) -> Vec<EntityVerb>`
        -   `get_target_at_index(&self, state: &AppState, index: usize) -> CommandTarget`

### Phase 2: Refactor `EquipTab` Component
Migrate the most complex tab (Equipment) to the new pattern first.

- **Deliverables**:
    -   `apps/holtburger-cli/src/ui/widgets/dashboard/mod.rs`: Module definition.
    -   `apps/holtburger-cli/src/ui/widgets/dashboard/equip.rs`: Implements `TabController`.
    -   Move `get_equip_tab_lines` logic into `equip.rs`.
    -   Implement `get_verbs` to correctly return `TargetSlot::MainHand`/`OffHand` specific verbs, utilizing the `EquipTabLine` context.

### Phase 3: Refactor Other Tabs & Dashboard Host
Migrate the simple tabs (Entities, Inventory, Character, Spells) and update the main dashboard.

- **Deliverables**:
    -   `apps/holtburger-cli/src/ui/widgets/dashboard/inventory.rs`
    -   `apps/holtburger-cli/src/ui/widgets/dashboard/character.rs`
    -   `apps/holtburger-cli/src/ui/widgets/dashboard/spells.rs`
    -   Update `apps/holtburger-cli/src/ui/widgets/dashboard.rs` to dispatch dynamically based on `DashboardTab`.

### Phase 4: Integration with Input Loop
Wire up the new system to the main input loop.

- **Deliverables**:
    -   Update `apps/holtburger-cli/src/ui/update/input.rs` to use `TabController::get_verbs` instead of global logic.

## 4. Risks & Mitigations

- **Risk**: Circular dependencies between `AppState` and `TabController`.
    -   *Mitigation*: Tabs should receive `AppState` by reference for rendering/verbs.
- **Risk**: Performance of `get_verbs` on every input tick.
    -   *Mitigation*: Only calculate verbs on demand when input occurs (like Enter or Verb Menu).

## 5. Definition of Done

- [ ] `TabController` trait is defined.
- [ ] Dashboard is split into submodules.
- [ ] Equipment tab correctly generates specific `MainHand`/`OffHand` verbs.
- [ ] Input loop is simplified.
- [ ] Project compiles and valid `cargo check`.

## 6. Living Worksheet

### Task Checklist
- [ ] Phase 1: Define Trait
- [ ] Phase 2: Equip Tab
- [ ] Phase 3: Other Tabs
- [ ] Phase 4: Integration
