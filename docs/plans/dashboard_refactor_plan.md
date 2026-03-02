# Dashboard Architectural Refactor Plan

**Goal:** Avoid leaky abstractions by making EACH TAB stateful and adding stateful render and input handlers into `TabController`. `DashboardState` should route to the active `TabController` rather than leaking state.

## Phase 1: Stateful Abstraction Definitions (Completed)
- Redesign `TabController` trait to use split borrows (`data: &GameData`, `view: &ViewState`) instead of a single `&mut GameState` to satisfy the Rust borrow checker during active renders.
- Transform UI tabs (Inventory, Nearby, Character, Spells, Equip, Trade) into stateful structs holding their own Ratatui widget states (e.g., `ListState`, `selected_index`).

## Phase 2: Gut Global State Leaks (Completed)
- Remove leaked tab-specific properties from the global `ViewState` root.
- Relocate UI-specific data such as `trade_focus` and `trade_no_session_msg_cache` strictly into their associated local tab state (`TradeTab`).

## Phase 3: The Dashboard Router (Completed)
- Upgrade `DashboardState` from a hollow enum tracker into a router that physically owns instances of the UI tabs.
- Implement an `.active_tab_mut()` dispatcher that returns `&mut dyn TabController` to locally isolate and route input/rendering logic without leaking structure.

## Phase 4: True Encapsulation & Re-wiring (In Progress)
Instead of a monolithic rewrite, this phase is broken down to methodically box-in all abstraction leaks left over from the original structure.

### Phase 4.1: Eradicate Trait Pollution (Completed)
- Radically simplify `TabController`. The dashboard should only know `render`, `handle_input`, `get_verbs`, and context routing.
- **REMOVE** leaky list-specific concepts like `get_selected_index`, `next`, `previous`, `get_item_count`, and `get_target_at_index` from the trait entirely. The dashboard has zero business knowing the internal structure (like "lists" or "indexes") of the active tab.
- **RETAIN** `get_verbs` for drawing action bars, but **REMOVE** the `index` parameter. The dashboard just asks "what actions are available right now?" without enforcing that the tab must track an "index".

### Phase 4.2: Fix Standalone Render & Tab Logic (We are here)
- Use `apps/holtburger-cli/src/pages/game/panels/dashboard/input.rs` as a **reference** to ensure no verbs or navigation shortcuts are lost.
- Manually build out `handle_input(&mut self, key, data, view)` definitions into every tab.
- Implement `get_verbs(&self, data, view, interaction)` for tabs that actually return verb actions.
- The current files (`equip`, `spells`, `trade`, `character`, etc.) incorrectly rely on global `game` structs instead of cleanly mapped `data` & `view` inputs. Fix all of these files to use proper params.
- **DELETE `input.rs` ONLY AFTER every single tab completely replicates its behavior successfully.** Let tabs mutate their own `self.selected_index` directly based on key presses.

### Phase 4.3: Fix Inventory & Nearby Return Lifetimes
- Fix missing lifetime bounds resulting from dropping full-state borrows. Correct functions like `get_entities<'a>(...) -> Vec<(&'a Entity, ...)>` to match cleanly.

### Phase 4.4: Bridge the App Loop
- Make the main update event loops totally agnostic of internal dashboard state. No more `game.dashboard.selected_index()` hacking in the top-level inputs—route the `key` straight to `active_tab_mut().handle_input()` and let the tab map verbs to actions.
