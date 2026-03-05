# CLI Code Reorganization Proposal

The current architecture of `holtburger-cli` separates concerns by technical layers (State, Update, View/Widgets), similar to a strict Elm architecture or Redux pattern. While this provides strong separation of concerns, it can make it difficult to locate all the logic for a single feature or visual component, leading to cognitive overhead as you have to jump between `state/chat.rs`, `update/chat.rs`, and `widgets/panels/chat.rs` just to change how the chat works.

To make the code organization reflect the actual program flow, pages, UI components, and dependencies, here are three proposed reorganization plans.

---

## Plan A: Component-Centric (View Hierarchy-Based)

This approach organizes the codebase exactly how the UI is structured on the screen and how the user flows through the app. Every page or complex widget is a self-contained module containing its own State, Update logic, and Rendering logic.

### Proposed Structure
```text
src/
├── bin/                 # Entrypoints (cli.rs, tui.rs)
├── app.rs               # Main AppState, global event routing
├── events.rs            # Global AppActions and Event definitions
├── ui/
│   ├── theme.rs         # Global styling, colors, symbols
│   ├── layout.rs        # Common layout utilities and breakpoints
│   └── shared/          # Dumb, highly reusable generic widgets (Scrollbar, Button, List)
├── pages/               # Top-level routing states
│   ├── mod.rs           # Page enum and routing logic
│   ├── selection/       # The Character/Server selection flow
│   │   ├── mod.rs       # State, Update, Render for this page
│   │   └── widgets.rs   # Selection-specific widgets
│   └── game/            # The main Game flow
│       ├── mod.rs       # Game page layout, state, and event delegation
│       ├── hud/         # HUD component (vitals, compass, status)
│       │   ├── mod.rs   # HUD state, update, render
│       │   └── vitals.rs
│       ├── panels/      # Left/Right persistent panels
│       │   ├── chat.rs  # Chat state, message processing, rendering
│       │   └── logs.rs
│       └── dashboard/   # The bottom interactive area
│           ├── mod.rs   # Tab controller and state
│           ├── inventory.rs
│           ├── spells.rs
│           └── trade.rs
└── core_state/          # Shared global state (e.g., networking stats, target selection) that multiple components need access to.
```

### ✅ Pros
- **Highly Intuitive:** The file tree mirrors the UI you see on screen. If you see a bug in the chat panel, you go straight to `pages/game/panels/chat.rs`.
- **Encapsulation:** A component's state, business logic, and rendering sit side-by-side. 
- **Reflects Flow:** Readily visible distinction between the `selection` page and `game` page flows.

### ❌ Cons & Mitigations
- **Global State Passing:** Since Rust requires strict borrowing, passing a unified context or specific references down the component tree can sometimes get verbose.
  - *Mitigation:* Extract shared data (like `GameData` or target selection) into a unified `core_state` object that can be passed by reference globally, while keeping UI-specific state strictly isolated to the component. Use disjoint borrows at the top-level page router.
- **Inter-component communication:** If the `dashboard/inventory` needs to send a message to `panels/chat`, they must communicate via global `AppEvents` routed through the main `app.rs` update loop instead of direct method calls.
  - *Mitigation:* Embrace a formalized **Message Passing** architecture (like Redux or Elm actions). Components should return an `AppAction` enum from their `update` methods, letting the global loop route the consequence without tightly coupling the components to one another.

---

## Plan B: Vertical Slicing (Feature-Based)

This approach organizes the codebase by **Domain Features** rather than UI layout. If a feature spans multiple UI areas (like "Combat", which affects the chat log, the 3D view, and the vitals HUD), all its logic lives together.

### Proposed Structure
```text
src/
├── bin/
├── app.rs               # Main event loop
├── ui/                  # Pure rendering and layout (Dumb components)
│   ├── pages/           # High level layout shells
│   └── widgets/         # Reusable structural widgets
└── features/            # Business logic, state, and feature-specific rendering
    ├── chat/
    │   ├── mod.rs       # ChatState, handle_chat_event()
    │   └── view.rs      # render_chat_panel()
    ├── combat/
    │   ├── mod.rs       # CombatState (targets, stances)
    │   └── view.rs      # render_target_hud()
    ├── inventory/
    │   ├── mod.rs       # InventoryState
    │   └── view.rs      # render_inventory_tab()
    ├── navigation/      # Movement, compass, maps
    └── network/         # NetStats, connection state
```

### ✅ Pros
- **Feature Isolation:** Adding or removing a feature (e.g., "Trade") means adding/removing a single folder.
- **Logic Cohesion:** Domain logic isn't split across UI components.
- **Great for large teams:** Developers can own entire features end-to-end without merge conflicts in UI layout files.

### ❌ Cons & Mitigations
- **UI is fragmented:** To understand what the screen looks like as a whole, you have to mentally assemble pieces from different feature folders.
  - *Mitigation:* Explicitly declare UI layout files (`ui/layout.rs` or `ui/pages/game.rs`) that do nothing but serve as physical slots. Each feature component simply registers what piece of the slot it occupies. 
- **Routing is complex:** The main page layout has to manually compose rendering calls from all the different features.
  - *Mitigation:* Create a generic standard interface (e.g. `Trait FeatureRenderable`) so that the top-level loop can just iterate over `Vec<Box<dyn FeatureRenderable>>` without needing hardcoded knowledge of every feature's internal rendering bounds.

---

## Plan C: Hybrid Module Flow (The "Flow & Dependency" Model)

This addresses the user flow directly by grouping code by its specific lifecycle stage and dependency graph. It separates "Engine/Client Interface" from "UI/Display".

### Proposed Structure
```text
src/
├── bin/
├── client/              # Bridges the TUI to `holtburger-core`
│   ├── receiver.rs      # Handles inbound core events
│   ├── sender.rs        # Sends outbound core commands
│   └── state.rs         # The "Source of Truth" replica of the game world (GameData)
├── interaction/         # Translates human input -> Client commands
│   ├── shortcuts.rs     # Keybindings and macros
│   └── mouse.rs         
└── views/               # Strict visual representation, organized by User Flow
    ├── common/          # Modals, generic lists, inputs
    ├── flows/
    │   ├── selection_flow/ # Everything needed to pick a character and connect
    │   └── game_flow/      # The actual gameplay UI
    │       ├── layout.rs   # Handles wide vs narrow terminal breakpoints
    │       ├── chat.rs
    │       ├── dashboard.rs
    │       └── hud.rs
```

### ✅ Pros
- **Clear Dependencies:** The `views` depend on `client` for data, and `interaction` depends on `client` to act. Clear separation of View (drawing) vs Interaction (input).
- **Core Decoupling:** Makes it extremely clear how the UI talks to the background game engine.

### ❌ Cons & Mitigations
- **Input and Render are split:** When you click a button in the inventory, the render logic is in `views/flows/game_flow/dashboard.rs`, but the click handling is over in `interaction/mouse.rs`. This separation can be annoying for highly interactive widgets.
  - *Mitigation:* Decouple *meaning* from *binding*. The rendering file (`dashboard.rs`) should explicitly expose what possible actions a user can take as an Enum (like `InventoryAction::ClickItem`). The interaction file only specifies *how* an `Interaction::Click` maps onto that specific semantic action, avoiding duplication of state knowledge.

---

## 🏆 Recommendation: Plan A (Component-Centric)

For a Terminal UI application built with Ratatui, **Plan A** is generally the most ergonomic and intuitive. 

1. **Locality of Behavior:** When you are working on the Chat panel, you want to see how it stores data, how it processes a new line, and how it draws it on the screen all in one place.
2. **Page-Driven:** It naturally surfaces the concept of "Pages" at the top file level (`pages/selection` vs `pages/game`), perfectly reflecting the program flow.
3. **Refactoring Path:** Moving from the current Elm-like structure to Plan A mostly involves taking `state/X.rs`, `update/X.rs`, and `widgets/X.rs` and moving them together into `pages/game/X/mod.rs`.

### Typical refactoring steps for Plan A:
1. Create `src/pages/` and `src/pages/game/`, `src/pages/selection/`.
2. Move `/ui/page/mod.rs` concepts into the new `pages/` directory.
3. Create `src/pages/game/chat/mod.rs`. Move chat state from `ui/state/chat.rs`, update logic from `ui/update/chat.rs`, and render logic from `ui/widgets/panels/chat.rs` into this single module.
4. Repeat for Dashboard, HUD, Modals, etc.
5. Extract global traits and reusable dumb widgets into `src/ui/shared/`.

---

## 🔬 Feasibility Assessment & Ground-Truth Dry Run

To ensure the **Plan A + Message Bus + Scrollbar Removal** plan survives contact with the actual `holtburger-cli` codebase, a dry-run analysis was performed across the current routing, state management, and rendering loops.

### The Problem: `&mut GameState` Dependency Cascades
Currently, `render_nearby_tab(f: &mut Frame, game: &mut GameState, area: Rect)` asks for a **fully mutable** `GameState`. It does this purely because it calls:
- `game.view.dashboard_list_state().select(Some(index))` (Ratatui ListState mutation)
- `game.view.last_dashboard_height = height` (Caching for scrolling math)
- Stateful widget rendering like `ScrollbarState`.

Because `render_nearby_tab` borrows `&mut GameState`, we hit **massive disjoint borrowing friction**. The parent `render_dashboard_pane` must use `&mut GameState`, which means the root `game.render()` must use `&mut GameState`. 

Because `&mut GameState` contains the core `GameData` (all entities, vitals, inventory), *nothing else can borrow the game data* while a widget is awkwardly trying to update a scroll integer. 

### Dry-Run of Plan A Execution:
Under Plan A, we completely shatter this dependency tree.

**1. Slicing the State:**
`GameData` (Entities, Player level, Vitals) belongs to the parent router (`GamePage`), or even to a global shared struct. 
`ViewState` (the UI-specific data) is dismantled. The `NearbyTab` struct *owns* its own `list_index` and `scroll_offset`. 

**2. The New Renderer Signature:**
When Ratatui needs mutable access to stateful widgets, it mutates the *Tab's* state, not the global state!
```rust
// Inside src/pages/game/dashboard/tabs/nearby/mod.rs
impl NearbyTab {
    // Notice how GameData & Interaction are perfectly safe, read-only references!
    // The Tab handles its own scrolling (&mut self).
    pub fn render(&mut self, f: &mut Frame, area: Rect, data: &GameData, interaction: &Option<Interaction>) {
        let items = self.get_filtered_items(data);
        let list_state = &mut self.ratatui_list_state;
        
        let list = List::new(items);
        f.render_stateful_widget(list, area, list_state);
        // We no longer manually calculate scrollbars here. We render text like "[2/15]" 
    }
}
```

**3. State Extraction is Highly Feasible:**
In `src/ui/state/view.rs`, `dashboard_list_states` is currently a hashmap storing states for every tab. In Plan A, this hashmap gets deleted. The `list_state` simply becomes a direct struct field on `InventoryTab`, `NearbyTab`, etc.

In `src/ui/widgets/panels/chat.rs`, the `wrapped_chat_cache` and `last_chat_width` are currently injected into `ChatState` which sits on `AppState`. Under Plan A, `ChatPanel` owns those. The network router just sends `UiMessage::AddLog(msg)`. 

### Stateful Caching & Performance
A crucial requirement for performance is the ability to cache expensive UI calculations (like text-wrapping paragraphs in the chat panel based on dynamic terminal width). Under the new component-centric architecture, this is naturally supported via Ratatui's `StatefulWidget` pattern. 

Because a component (like `ChatPanel`) fully owns its `ChatState` (which contains `wrapped_chat_cache` and `last_chat_width`), its `render` method has localized, mutable access to its own cache. When the terminal resizes or new messages arrive, the component can safely mutate and re-wrap its text arrays on-the-fly *without* requesting a mutable borrow of the global `GameData`. Caching becomes a clean, internal implementation detail of the component rather than bubbling up into a global "God Object".

### The Verdict
The refactor is **extremely feasible and mechanically sound**. By removing `ScrollbarState` and distributing UI layout state (like `list_state` or `scroll_offset`) directly to their respective UI component structs, we completely eliminate the need to pass `&mut GameState` around. 

This unlocks the ability to pass `&GameData` across the entire application as a simple read-only context, guaranteeing 0 borrow-checker panics. The `UiMessage` bus will cleanly route user intents back up to the router to modify the world.

---

## � Cross-Component Entity Interactions (Moving, Healing, Stacking)

Some of the most complex flows in the game span across multiple UI components. For instance:
1. User highlights an item in the **Inventory Tab** and presses `M` (Move).
2. The UI enters a state of `Interaction::Moving { item_guid }`.
3. The user switches to the **Nearby Tab**, highlights a Chest, and presses `Enter`.
4. The system must synthesize the `item_guid` from step 1 with the `target_guid` of step 3 to issue a single `ClientCommand::MoveItem(item_guid, target_guid)`.

Currently, this is handled via a massive `Interaction::handle_action()` match block.

Under our new **Plan A** architecture + **UiMessage bus**, the flow becomes explicitly routed through the shared global router without bleeding into specific components:

**Step 1:** The `InventoryTab` intercepts the raw keystroke `M` on an item:
```rust
// In inventory::update()
return UiMessage::BeginInteraction(Interaction::Moving { item_guid });
```

**Step 2:** The global loop (the owner of `GamePage` state) catches this message and saves it to its own `ViewState::active_interaction`.

**Step 3:** The user highlights the Chest in the `NearbyTab` and presses `Enter`. The `NearbyTab` does **not** need to know about the active interaction! It simply reports what the user clicked:
```rust
// In nearby::update()
return UiMessage::TargetSelected(chest_guid);
```

**Step 4:** The parent `GamePage` router receives `TargetSelected`. It checks its *own* `active_interaction` state. It sees we are `Moving`. It synthesizes the command itself on behalf of the child components:
```rust
// In game/mod.rs (the main router)
if let Some(interaction) = self.view_state.active_interaction.take() {
    match interaction {
        Interaction::Moving { item_guid } => {
            core_tx.send(ClientCommand::MoveItem(item_guid, target_guid));
        }
    }
}
```

**Why this is better:**
- `InventoryTab` ONLY cares about inventory items.
- `NearbyTab` ONLY cares about nearby entities.
- Neither tab has to know what `Interaction` state the global game is in! They just blindly emit intents (`BeginInteraction` or `TargetSelected`) and let the top-level parent stitch the two halves together. This is standard decoupled routing.

During this reorganization, there is a massive opportunity to simplify the tangled web of event and action types. Currently, developers have to keep track of:
- `AppAction`: High-level TUI loop triggers (Tick, KeyPress, ViewEvent).
- `UIEffect`: State mutations generated by user interactions which might spit out a network `ClientCommand`.
- `Action`: Semantic, gameplay-oriented intents (e.g., Assess, Buy, Drop) primarily originating from UI interaction.
- `CommandTarget`: What an Action is being applied to.

This causes extreme cognitive load as developers must route `AppAction` -> `Action` -> `UIEffect` -> `ClientCommand`.

### Proposed Event Hierarchy Re-Alignment
We should standardize on three clear layers of vocabulary:

#### 1. `TuiEvent` (formerly `AppAction`)
This represents **Input into the TUI process**. It belongs exclusively to the top-level `tui.rs` loop.
```rust
enum TuiEvent {
    Tick(f64),
    Input(crossterm::event::Event), // Unifies Key/Mouse/Layout 
    Engine(ClientViewEvent), // Data arriving from the holtburger-core
}
```

#### 2. `UiMessage` (The Internal Message Bus)
This replaces `UIEffect` and handles strictly **TUI-internal** mutations and syncs that don't need to touch the game engine. Components send these up via the new message bus.
```rust
enum UiMessage {
    SetContextView(ContextView), // Replaces UIEffect::Assess, UIEffect::ActivateDebug...
    SetInteraction(Option<Interaction>), // Replaces UIEffect::Move, UIEffect::Heal...
    AddLog(ChatMessageKind, String), // Replaces UIEffect::Log
    FocusPane(FocusedPane),
}
```

#### 3. Semantic Component Returns (Replaces `Action` + `CommandTarget` + partial `UIEffect`)
Currently, `Action` is a massive global enum. Under **Plan A**, semantic actions should be owned by the components generating them. Instead of translating a raw keystroke into a global `Action::Use` and mapping a `CommandTarget`, a component receives `TuiEvent::Input`, figures out what that means internally, and uses the exact context it already has to emit the underlying consequence.

For example, when handling an interaction on an Inventory Item, the `inventory::update()` method doesn't need to return an `Action::Use` wrapped around a `CommandTarget::Entity`. It can just directly return what the network needs:
```rust
// User pressed "Enter" while highlighting an item
return Some(ClientCommand::Use(highlighted_guid));
```

By killing `Action`, `CommandTarget`, and `UIEffect` entirely (which are just convoluted halfway proxies), and reshaping around `TuiEvent` / `UiMessage`, we remove three literal layers of enum-translation boilerplate. 


## 📜 The Scrollbar Question & Ratatui Friction

During the `holtburger-cli` architecture evolution, scrolling has been a major source of friction. Specifically, Ratatui's `ScrollbarState` and the manual tracking of `scroll_offset`, `total_lines`, and `maintain_scroll()` are deeply invasive to the state model.

### The Core Conflict
Ratatui is an immediate-mode renderer, but the `Scrollbar` widget is stateful. It requires you to pass `&mut ScrollbarState` on every frame. Furthermore, because text wrapping can alter the maximum scroll height dynamically based on terminal width, we frequently have caching issues.

Currently, we rely on a manual `maintain_scroll()` function that attempts to update `scroll_offset` mid-render if the terminal height changes or new lines arrive. This breaks disjoint borrowing paradigms by requiring `&mut GameState` in the middle of a render pipeline.

### Should we remove visual Scrollbars?
**Yes.** In modern robust TUIs, visual scrollbars for simple text logs or lists are often rated as "nice-to-have but not worth the architectural cost." Removing them significantly improves code quality:

1. **Self-Healing Scroll State:** If we remove the visual `ScrollbarState` UI element, we only have to track a single integer per pane: `scroll_offset`. 
2. **Move offset math to Input:** If a user presses `PageUp`, we increment the `scroll_offset`. The bounds checking (`scroll_offset.min(max_lines)`) can happen strictly during the *View* phase without ever writing the bounded result back into mutable state. If a resize happens, an out-of-bounds `scroll_offset` simply pins to the maximum during the slice slice operation `all_lines[height..offset]`.
3. **No more `maintain_scroll()`**: We can entirely eliminate the hacky `maintain_scroll()` polling update, clearing up the `&mut` View rendering requirements.

**Alternatives to Visual Scrollbars in TUIs:**
Instead of a drawn sidebar, we can simply render a single discreet span in the pane's title block or bottom border: e.g. `[15/154]` or `(More ↑)`. This is completely stateless relative to the View layer, requiring no mutable widget caching.

### Recommendation
During the Plan A refactor, **we will strip `ratatui::widgets::Scrollbar` from all generic panels (Chat, Context, Dashboard lists)**. Scrolling will still work via keyboard/mouse wheel by mutating a localized `scroll_offset`, but we will drop the visual bar rendering and the brittle `maintain_scroll` cache tracking. This will dramatically simplify component `render()` signatures from `&mut self` downward to `&self`, ensuring purely declarative views.

Some of the most complex flows in the game span across multiple UI components. For instance:
1. User highlights an item in the **Inventory Tab** and presses `M` (Move).
2. The UI enters a state of `Interaction::Moving { item_guid }`.
3. The user switches to the **Nearby Tab**, highlights a Chest, and presses `Enter`.
4. The system must synthesize the `item_guid` from step 1 with the `target_guid` of step 3 to issue a single `ClientCommand::MoveItem(item_guid, target_guid)`.

### The Edge Case: Contextual Verbs
A complication exists because Tabs (like `NearbyTab` or `InventoryTab`) aren't *just* rendering lists of entities. They dynamically render the contextual **Verbs** (e.g., "Press `Enter` to Use", or "Press `Enter` to Heal Target") at the bottom of the screen. Those verbs entirely depend on knowing if an `Interaction` is active! If we hide `active_interaction` deeply inside the router, the tabs can't render the correct instructions to the user.

### The Refactored Flow
To preserve disjoint ownership while allowing tabs to display correct contextual prompts, `&Option<Interaction>` simply becomes part of the read-only data context passed down from the top-level router during the `render` and `update` phases (just like `&GameData`).

**Step 1:** The `InventoryTab` intercepts the raw keystroke `M` on an item:
```rust
// In inventory::update(..., data: &GameData, interaction: &Option<Interaction>)
return UiMessage::BeginInteraction(Interaction::Moving { item_guid });
```

**Step 2:** The global loop (the owner of `GamePage` state) catches this message and saves it to its own `ViewState::active_interaction`.

**Step 3:** During the next render cycle, the `NearbyTab` receives the read-only `interaction: &Option<Interaction>` reference. It sees `Moving`, so instead of rendering "Press [U] to Use", it dynamically renders "Press [Enter] to Move to container". 

**Step 4:** The user highlights the Chest in the `NearbyTab` and presses `Enter`. Because the tab knows the interaction is active, it doesn't emit a standard `Drop` or `Use` intent. It emits the generic confirmation intent:
```rust
// In nearby::update(..., interaction: &Option<Interaction>)
if interaction.is_some() {
    return UiMessage::ConfirmInteractionTarget(chest_guid);
}
```

**Step 5:** The parent `GamePage` router receives `ConfirmInteractionTarget`. It alone holds the mutable `ViewState` and the power to synthesize the network command across components:
```rust
// In game/mod.rs (the main router)
if let Some(interaction) = self.view_state.active_interaction.take() {
    match interaction {
        Interaction::Moving { item_guid } => {
            core_tx.send(ClientCommand::MoveItem(item_guid, target_guid));
        }
    }
}
```

**Why this preserves Plan A's benefits:**
- Tabs still do not mutate the interaction state or define the final business logic for *how* moving/healing works.
- Tabs only map keypresses to generic `UiMessage::ConfirmInteractionTarget`.
- The top-level router remains the sole location where complex, multi-entity network synthesis happens, preventing spaghetti dependencies.


## 🧩 Cross-Component Entity Interactions (Moving, Healing, Stacking)

Some of the most complex flows in the game span across multiple UI components. For instance:
1. User highlights an item in the **Inventory Tab** and presses `M` (Move).
2. The UI enters a state of `Interaction::Moving { item_guid }`.
3. The user switches to the **Nearby Tab**, highlights a Chest, and presses `Enter`.
4. The system must synthesize the `item_guid` from step 1 with the `target_guid` of step 3 to issue a single `ClientCommand::MoveItem(item_guid, target_guid)`.

### The Edge Case: Contextual Verbs
A complication exists because Tabs (like `NearbyTab` or `InventoryTab`) aren't *just* rendering lists of entities. They dynamically render the contextual **Verbs** (e.g., "Press `Enter` to Use", or "Press `Enter` to Heal Target") at the bottom of the screen. Those verbs entirely depend on knowing if an `Interaction` is active! If we hide `active_interaction` deeply inside the router, the tabs can't render the correct instructions to the user.

### The Refactored Flow
To preserve disjoint ownership while allowing tabs to display correct contextual prompts, `&Option<Interaction>` simply becomes part of the read-only data context passed down from the top-level router during the `render` and `update` phases (just like `&GameData`).

**Step 1:** The `InventoryTab` intercepts the raw keystroke `M` on an item:
```rust
// In inventory::update(..., data: &GameData, interaction: &Option<Interaction>)
return UiMessage::BeginInteraction(Interaction::Moving { item_guid });
```

**Step 2:** The global loop (the owner of `GamePage` state) catches this message and saves it to its own `ViewState::active_interaction`.

**Step 3:** During the next render cycle, the `NearbyTab` receives the read-only `interaction: &Option<Interaction>` reference. It sees `Moving`, so instead of rendering "Press [U] to Use", it dynamically renders "Press [Enter] to Move to container". 

**Step 4:** The user highlights the Chest in the `NearbyTab` and presses `Enter`. Because the tab knows the interaction is active, it doesn't emit a standard `Drop` or `Use` intent. It emits the generic confirmation intent:
```rust
// In nearby::update(..., interaction: &Option<Interaction>)
if interaction.is_some() {
    return UiMessage::ConfirmInteractionTarget(chest_guid);
}
```

**Step 5:** The parent `GamePage` router receives `ConfirmInteractionTarget`. It alone holds the mutable `ViewState` and the power to synthesize the network command across components:
```rust
// In game/mod.rs (the main router)
if let Some(interaction) = self.view_state.active_interaction.take() {
    match interaction {
        Interaction::Moving { item_guid } => {
            core_tx.send(ClientCommand::MoveItem(item_guid, target_guid));
        }
    }
}
```

**Why this preserves Plan A's benefits:**
- Tabs still do not mutate the interaction state or define the final business logic for *how* moving/healing works.
- Tabs only map keypresses to generic `UiMessage::ConfirmInteractionTarget`.
- The top-level router remains the sole location where complex, multi-entity network synthesis happens, preventing spaghetti dependencies.


## 📜 The Scrollbar Question & Ratatui Friction

During the `holtburger-cli` architecture evolution, scrolling has been a major source of friction. Specifically, Ratatui's `ScrollbarState` and the manual tracking of `scroll_offset`, `total_lines`, and `maintain_scroll()` are deeply invasive to the state model.

### The Core Conflict
Ratatui is an immediate-mode renderer, but the `Scrollbar` widget is stateful. It requires you to pass `&mut ScrollbarState` on every frame. Furthermore, because text wrapping can alter the maximum scroll height dynamically based on terminal width, we frequently have caching issues.

Currently, we rely on a manual `maintain_scroll()` function that attempts to update `scroll_offset` mid-render if the terminal height changes or new lines arrive. This breaks disjoint borrowing paradigms by requiring `&mut GameState` in the middle of a render pipeline.

### Should we remove visual Scrollbars?
**Yes.** In modern robust TUIs, visual scrollbars for simple text logs or lists are often rated as "nice-to-have but not worth the architectural cost." Removing them significantly improves code quality:

1. **Self-Healing Scroll State:** If we remove the visual `ScrollbarState` UI element, we only have to track a single integer per pane: `scroll_offset`. 
2. **Move offset math to Input:** If a user presses `PageUp`, we increment the `scroll_offset`. The bounds checking (`scroll_offset.min(max_lines)`) can happen strictly during the *View* phase without ever writing the bounded result back into mutable state. If a resize happens, an out-of-bounds `scroll_offset` simply pins to the maximum during the slice slice operation `all_lines[height..offset]`.
3. **No more `maintain_scroll()`**: We can entirely eliminate the hacky `maintain_scroll()` polling update, clearing up the `&mut` View rendering requirements.

**Alternatives to Visual Scrollbars in TUIs:**
Instead of a drawn sidebar, we can simply render a single discreet span in the pane's title block or bottom border: e.g. `[15/154]` or `(More ↑)`. This is completely stateless relative to the View layer, requiring no mutable widget caching.

### Recommendation
During the Plan A refactor, **we will strip `ratatui::widgets::Scrollbar` from all generic panels (Chat, Context, Dashboard lists)**. Scrolling will still work via keyboard/mouse wheel by mutating a localized `scroll_offset`, but we will drop the visual bar rendering and the brittle `maintain_scroll` cache tracking. This will dramatically simplify component `render()` signatures from `&mut self` downward to `&self`, ensuring purely declarative views.

