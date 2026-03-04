# Event Handler Refactor Plan

## 1. Context & Boundaries
- **Goal**: Architecturally align `holtburger-cli`'s event flow by pushing state-modification logic out of the global `AppState` and down to the specific `Page` (e.g., `GameState`) that owns that state.
- **Scope**:
  - **In Scope**: Refactoring `update/world.rs`, `update/app_event.rs`, `update/app_action.rs`, and `update/input.rs`. Expanding the existing `Page` enum's `impl` block to explicitly delegate events using enum dispatch.
  - **Out of Scope**: Changing component rendering, rewriting `holtburger-core`, changing the `TabController` trait signatures, or converting the `Page` enum into a dynamic `Trait`.

## 2. Ground Truth & Identifying The "Leaks"

By inspecting the codebase, we've identified the exact reasons *why* events and actions leak into the God-object, and what needs fixing:

### Leak 1: The AppAction State Cycle
- **The Ground Truth**: In `src/types.rs`, `TabController::handle_input` takes `&GameData` and `&ViewState` immutably. Because UI panels cannot mutate the page's data directly, they emit `AppAction`s (like `ChangeContextView` or `BeginInteraction`).
- **The Leak**: Instead of `GameState` catching these actions and mutating its own state, it blindly bubbles them up to `AppState::handle_app_action` (`src/update/app_action.rs`). `AppState` then pattern matches and reaches *back down* into `game.view.context_view` to apply the change. 
- **The Fix**: `GameState` must process its own layout/data updates locally. We will add an `impl Page` block that matches variants to pass actions down. `AppState` should only process things it exclusively owns (like `Log` or `DisplayClientInfo`).

### Leak 2: The ViewEvent Dump
- **The Ground Truth**: `ClientViewEvent` comes from the `holtburger-core` network thread. It contains both global state (`StatusUpdate`, `CharacterList`) and highly localized game state (`EntitySpawned`, `PlayerStatsSkillsUpdated`, `TradeStateUpdated`).
- **The Leak**: `src/update/world.rs` is a massive router in `AppState`. It explicitly matches `if let Page::Game(ref mut game) = self.page` dozens of times to manipulate `game.data.entities` and `game.data.skills`. All the private helper methods to manage this live on `AppState`.
- **The Fix**: `AppState` should only read the global connection events. It should delegate structural world events entirely to a new `page.handle_view_event(event)` method using enum dispatch. The helper methods will be moved to `GameState`.

### Leak 3: The Tick Processing
- **The Ground Truth**: `AppEvent::Tick` drives frame progression and timeouts.
- **The Leak**: In `src/update/app_event.rs` (lines ~133), `AppState::update_tick` reaches directly into `game.data.player_enchantments` to purge expired enchantments and decrement durations.
- **The Fix**: Delegate `Tick` to the `Page` so `GameState` can apply its own temporal logic.

## 3. Delegation Target Map (Exact Enum Variants)

*Every single enum variant must be accounted for to prevent silent drops during the refactor.*

### `AppAction` Execution Map
**Handled by `AppState` (Global Concerns):**
- `Log`, `DisplayClientInfo`, `SendCommands`, `Sequence`

**Handled by `Page::Game(GameState)` (World & UI Context):**
- *State Mutations*: `ChangeContextView`, `RequestDebugContext`, `BeginInteraction`, `CancelInteraction`, `ViewDetails`, `ClearVendor`
- *Actions returning ClientCommands*: `Identify`, `Assess`, `Use`, `UseOn`, `Approach`, `PickUp`, `Pickup`, `Drop`, `Equip`, `Unequip`, `TalkTo`, `Open`, `Close`, `OpenTrade`, `AddToTrade`, `MoveItem`, `StackItems`, `SplitItem`, `UseWith`, `QueryDebugInfo`, `CastSpell`, `SetCombatMode`, `Give`, `BuyFromVendor`, `SellToVendor`, `AcceptTrade`, `DeclineTrade`, `ResetTrade`, `ExitTrade`

### `ClientViewEvent` Execution Map
**Handled by `AppState` (Lifecycle & Global):**
- `StatusUpdate`, `CharacterList`, `PlayerEntered`, `ErrorRaised`, `NetPulse` (bubbles down), `Disconnected` (bubbles down), `WorldNameUpdated`

**Handled by `Page::Game(GameState)`:**
- *Entities & World*: `EntitySpawned`, `EntityDespawned`, `EntityMoved`, `EntityPropertiesUpdated`, `EntityIdentified`, `EntityDebugInfoSnapshot`, `NoClipUpdated`
- *Player Stats & Magic*: `PlayerStatsSkillsUpdated`, `PlayerVitalsUpdated`, `PlayerSpellsUpdated`, `PlayerEnchantmentsUpdated`, `CombatModeUpdated`
- *Interactables & Trade*: `ContainerOpened`, `ContainerClosed`, `VendorStateUpdated`, `TradeStateUpdated`
- *Chat Box Routing (`game.chat`)*: `LogMessage`, `ServerMessage`, `Chat`, `Emote`, `PingResponse`, `BootAccount`, `WeenieError`, `NetPulse`, `Disconnected`
- *Time*: `ServerTimeUpdated`

## 4. Phased Implementation

### Phase 1: Establish Page Delegation Contracts ✅ via Enum Dispatch
- **Complexity:** Low
- **Goal**: Expand the `impl Page` block with methods to catch bubbling events and route them to their variant's underlying structs.
- **Files**: `src/types.rs`, `src/pages/game/state.rs`, `src/pages/selection/mod.rs`.
- **Deliverables**:
  - Add `pub fn handle_view_event(&mut self, event: &ClientViewEvent) -> UpdateResult` to `impl Page`.
  - Add `pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult>` to `impl Page`.
  - Add `pub fn handle_tick(&mut self, elapsed: f64) -> UpdateResult` to `impl Page`.
  - Implement these matching functions on `GameState` and `SelectionState` directly (can be empty stubs initially).
- **Acceptance Criteria**: Methods exist, successfully pattern match to the variants, and stub out fallback behavior. Project compiles.

### Phase 2: Action Relocation - Internal UI State ✅
- **Complexity:** Medium
- **Goal**: Migrate the first half of `AppAction` (the ones that mutate UI state rather than generating commands) and setup the fallback routing.
- **Files**: `src/state.rs`, `src/update/app_action.rs`, `src/pages/game/state.rs`.
- **Deliverables**:
  - Move `AppState::refresh_context_buffer` to `GameState::refresh_context_buffer`. Update the top-level loop so that `GameState` triggers its own buffer refreshes.
  - In `AppState::handle_app_action`, invoke `self.page.handle_action(action.clone())` before falling back to its own match statement.
  - Move state-altering actions (`ChangeContextView`, `RequestDebugContext`, `BeginInteraction`, `CancelInteraction`, `ClearVendor`, `ViewDetails`) into `GameState::handle_action`.
- **Acceptance Criteria**: `refresh_context_buffer` no longer over-renders at the global loop. UI interactions like viewing details or interactions work the exact same. Project compiles.

### Phase 3: Action Relocation - Gameplay Commands 🏗️
- **Complexity:** Medium
- **Goal**: Complete `AppAction` migration by migrating the 25+ gameplay variants.
- **Files**: `src/update/app_action.rs`, `src/pages/game/state.rs`.
- **Deliverables**:
  - Move ALL remaining mapped `AppAction` variants (`Identify`, `Assess`, `Drop`, `CastSpell`, etc.) into `GameState::handle_action`.
- **Acceptance Criteria**: `update/app_action.rs` shrinks significantly and only processes `Log`, `DisplayClientInfo`, `SendCommands`, and `Sequence`. Using items/spells still sends the appropriate `ClientCommand`.

### Phase 4: Event Relocation - Helper Methods
- **Complexity:** Medium
- **Goal**: Relocate all the private methods on `AppState` that modify `game.data` internally (preparing for Phase 5 to avoid circular borrow/dependency issues).
- **Files**: `src/update/world.rs`, `src/pages/game/state.rs`.
- **Deliverables**:
  - Move `update_inventory_and_equipment`, `handle_entity_identified`, `handle_entity_removed`, `handle_navigation_event`, `handle_player_event`, and `update_inventory_recursive` from `AppState` to `GameState`.
- **Acceptance Criteria**: Project compiles. The global `match` block in `world.rs` now correctly calls `game.update_inventory_and_equipment(...)` instead of `self.update_inventory_and_equipment(...)`.

### Phase 5: Event Relocation - The Match Router (`ClientViewEvent`)
- **Complexity:** High
- **Goal**: Evict `GameData` manipulations from `update/world.rs` entirely.
- **Files**: `src/update/world.rs`, `src/pages/game/state.rs`.
- **Deliverables**:
  - Migrate all the world/game state events (`EntitySpawned`, `PlayerStatsSkillsUpdated`, etc.) from `world.rs` into `GameState::handle_view_event`.
  - Keep Lifecycle events in `AppState::handle_client_view_event`. Pass down bubbling events (`NetPulse`, `Disconnected`).
- **Acceptance Criteria**: `AppState` no longer manually unpacks `if let Page::Game(ref mut game)` purely to mutate entities.

### Phase 6: Tick Delegation
- **Complexity:** Low
- **Goal**: Move local time-based updates to the respective page structurally.
- **Files**: `src/update/app_event.rs`, `src/pages/game/state.rs`.
- **Deliverables**:
  - Move the `player_enchantments` tick logic into `GameState::handle_tick`.
- **Acceptance Criteria**: Enchantment timers still expire correctly in the UI.

## 5. Risks & Mitigations
- **Risk**: Event Processing Order. If an action like `DisplayClientInfo` checks `Page` state, and the Page handles an action before it, it might read data unexpectedly.
- **Mitigation**: Using `UpdateResult::merge` properly ensures that command queues are executed sequentially and state is mutated linearly. Draining `AppAction`s strictly in the order they're emitted guarantees soundness.

## 6. The Living Worksheet
### Task Checklist
- [x] **Phase 1 (Low)**: Define `impl Page` routing methods (`handle_view_event`, `handle_action`, `handle_tick`).
- [x] **Phase 2 (Medium)**: Delegate fallback routing in `app_action.rs` and migrate local UI-state actions & `refresh_context_buffer`.
- [ ] **Phase 3 (Medium)**: Migrate the 25+ gameplay-command `AppAction`s to `GameState::handle_action`.
- [ ] **Phase 4 (Medium)**: Migrate physical helper methods (`update_inventory_...`) from `AppState` to `GameState`.
- [ ] **Phase 5 (High)**: Migrate the massive `ClientViewEvent` router block out of `world.rs`.
- [ ] **Phase 6 (Low)**: Move `AppEvent::Tick` game loop logic to `GameState`.

### Decisions Log
- **Architectural**: Opted for expanding the `impl Page` block via matching (Enum Dispatch / Option A) rather than creating a `PageController` Trait. This avoids the cost/complexity of Dynamic Dispatch on a highly constrained and known enum.
- **Phase 1 Decision**: Stored the trait-like methods directly on the `SelectionState` and `GameState` structs to keep the `impl Page` matchers simple and readable. Verified with `cargo check`.

### Open Questions
- None. Everything has been rigorously sourced against the codebase.
