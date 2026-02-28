# CLI Architecture Reorganization Plan

## 1. Context & Boundaries
**Goal**: Reorganize the `holtburger-cli` architecture into a Component-Centric (View Hierarchy-Based) model, eliminating global disjoint borrows and removing convoluted event bubbling layers.

**Background Intent**: The current architecture separates concerns by technical layers (State vs Update vs View), similar to a strict Elm architecture. While this provides strong separation of concerns, it makes it difficult to locate all logic for a single visual component. Jump-scares between `state/chat.rs`, `update/chat.rs`, and `widgets/panels/chat.rs` create high cognitive overhead. Our intent is to colocate related code so the file tree mirrors the UI you see on screen, resolving deeply intrusive Rust borrow-checker conflicts along the way.

**Scope**:
- **In Scope**: 
  - Restructuring the source tree into domain-driven component folders (e.g., `chat/mod.rs` holding State, Update, and View).
  - Replacing deep event bubbling (`AppAction`, `UIEffect`, `Action`) with a simplified `UiMessage` channel bus and direct explicit `ClientCommand` returns.
  - Removing Ratatui `ScrollbarState` and the `maintain_scroll()` hacks.
  - Dismantling the `ViewState` God Object so UI components isolate their state (like `ChatState`).
  - Preserving line/paragraph caching using Ratatui's `StatefulWidget` model.
- **Out of Scope**: 
  - Changing network protocol logic or game mechanics.
  - Modifying `holtburger-core` or pure engine behavior unless required to expose data.
  - Changing visual styling or themes significantly.

## 2. The Target Architecture (Component-Centric)

This approach organizes the codebase exactly how the user flows through the app. Every page or widget is a self-contained module containing its own State, Update logic, and Rendering logic.

### Proposed File Structure
```text
src/
├── bin/                 # Entrypoints (cli.rs, tui.rs)
├── app.rs               # Main AppState, global event routing
├── messages.rs          # UiMessage definitions (Replaces UIEffect/Action)
├── ui/
│   ├── theme.rs         # Global styling, colors, symbols
│   ├── layout.rs        # Common layout utilities and breakpoints
│   └── shared/          # Dumb, highly reusable generic widgets (Button, List)
├── pages/               # Top-level routing states
│   ├── mod.rs           # Page enum and routing logic
│   ├── selection/       # The Character/Server selection flow
│   │   ├── mod.rs       # State, Update, Render for this page
│   │   └── widgets.rs   # Selection-specific widgets
│   └── game/            # The main Game flow
│       ├── mod.rs       # Game page layout, state, and event delegation
│       ├── hud/         # HUD component (vitals, compass, status)
│       ├── panels/      # Left/Right persistent panels (chat, logs)
│       └── dashboard/   # The bottom interactive area (inventory, spells, trade)
└── core_state/          # Shared global state (e.g., GameData) passed read-only.
```

## 3. Resolving Core Architectural Friction

### The Problem: `&mut GameState` Dependency Cascades
Currently, drawing tabs like `NearbyTab` requires borrowing `&mut GameState` globally just to update generic Ratatui UI state (`list_state`, `scroll_offset`). Because `&mut GameState` contains the core `GameData`, *nothing else can borrow the game data* while a widget is awkwardly trying to update a scroll integer.
**The Fix**: Components will own their UI state locally. The global layout passes `&GameData` deeply as strictly **read-only**, while layout changes (like scrolling) modify `&mut self` internally on the Component.

### The Scrollbar Question & Ratatui Friction
Visual scrolling relying on Ratatui's `Scrollbar` is stateful and clashes with immediate-mode resizing. Our manual `maintain_scroll()` function attempts to update `scroll_offset` mid-render if the terminal height changes, breaking disjoint borrowing paradigms.
**The Fix**: Strip `ratatui::widgets::Scrollbar` from all List and Text panels. Stop the awkward `maintain_scroll()` loop entirely. Scroll positions will simply be integers updated by keyboard input and bounds-checked iteratively during the view phase without mutating cache state. Instead of a drawn sidebar, we can simply render a single discreet span in the pane's title block: e.g. `[15/154]`.

### Stateful Caching & Performance
A crucial requirement for performance is the ability to cache expensive UI calculations (like text-wrapping paragraphs in the chat panel based on dynamic terminal width). Under the new component-centric architecture, this is natively supported via Ratatui's `StatefulWidget` pattern. Because `ChatPanel` owns its `ChatState` (containing `wrapped_chat_cache`), its `render()` method has isolated mutable access to its own cache. When the terminal resizes, it re-wraps safely *without* requesting a mutable borrow of the global `GameData`.

### Event Hierarchy Re-Alignment
Currently, developers must trace `AppAction` -> `Action` -> `UIEffect` -> `ClientCommand`. This causes extreme cognitive load to translate a raw keystroke into four halfway proxy enums. 
**The Fix**: We are deleting `Action`, `CommandTarget`, and `UIEffect` entirely, standardizing on a 3-layer system:
1. `TuiEvent`: Raw input from the OS/Hardware (Tick, KeyPress, WindowResize).
2. `UiMessage`: Internal TUI mutations via an async message bus (FocusPane, StartInteraction).
3. `ClientCommand`: Output to the game server. Components will map `TuiEvent` inputs straight into a `ClientCommand` whenever possible, totally bypassing intermediate UI objects.

### Cross-Component Interactions (Moving, Healing, Splitting)
When a user highlights an item in the `InventoryTab` and hits "Use", but wants to apply it to a target in the `NearbyTab`, state sharing becomes complex.
**The Fix**: Read-only contexts. The `InventoryTab` emits `UiMessage::BeginInteraction(Healing)`. This sets a global state in the parent router. Because `&Option<Interaction>` is passed down read-only to all tabs during rendering, the `NearbyTab` simply reads it and dynamically changes its hint text to "Press Enter to Heal". When pressed, the tab just emits `UiMessage::ConfirmInteractionTarget(item)`. The global parent matches its own `Interaction` state with the `target_guid` and synthesizes the final `ClientCommand`.
**Handling Multi-Step & Complex Targets**: The current codebase abstracts targets using a convoluted `CommandTarget` enum (handling Entities, Input strings, etc.). In the new model, this is replaced by specific strongly-typed `UiMessage` variants: `UiMessage::ConfirmInteractionTarget(Guid)`, `UiMessage::ConfirmInteractionSplit(Guid, u32)`, and `UiMessage::ConfirmInteractionText(String)`. The top-level router pairs the active `Interaction` context with these specific payload types natively natively without needing generic target wrappers.

## 4. Risks & Mitigations
- **Global State Passing**: Since we are dismantling `ViewState`, passing unified contexts down the component tree can get verbose.
  - *Mitigation*: Unify shared data (like `GameData` or target selection) into a single struct passed by reference globally.
- **Inter-components Communication**: If the inventory needs to tell the chat to log a message, they no longer share a mutual `ViewState`.
  - *Mitigation*: The `UiMessage` channel bus handles fire-and-forget internal event routing.
- **Ghost/Orphaned Logic**: The "Big Move" might leave dead code in `update.rs` or `effect.rs`.
  - *Mitigation*: Purge features aggressively in phases. Phase 4 guarantees `UIEffect` and `Action` are completely deleted, acting as a forcing function to re-wire remaining interactions.
- **Git History Destruction**: Moving 3 files into 1 file per component breaks file history.
  - *Mitigation*: Strictly execute `git mv` operations where possible. 

## 5. Phased Implementation

### Phase 1: Message Bus & Event Simplification Foundation
- **Deliverables**:
  - Introduce `UiMessage` (internal message bus).
  - Set up `tokio::sync::mpsc::unbounded_channel` for routing `UiMessage`.
  - Adjust `Interaction` to pass as `&Option<Interaction>` (read-only context) to widgets.
- **Verification**: The new `UiMessage` plumbing routes successfully alongside legacy code.

### Phase 2: Removing Visual Scrollbars & `ViewState` Preparations
- **Deliverables**:
  - Strip `Scrollbar` logic from lists/text panels.
  - Remove the `maintain_scroll()` loop in `view.rs`.
  - Refactor components to use localized `scroll_offset` integers.
- **Verification**: `maintain_scroll()` is gone; manual keyboard scrolling behaves correctly.

### Phase 3: The Component-Centric Restructure (File Moves)
- **Deliverables**:
  - Scaffold the `src/pages/` folder tree.
  - Relocate features (e.g., move `chat` state, view, and update into `pages/game/chat/mod.rs`).
  - Extract `GameData` so `render(...)` signatures require only read-only models.
- **Verification**: `src/ui/state`, `src/ui/update`, and `src/ui/widgets` are vastly minimized. Code compiles successfully.

### Phase 4: Eradication of `Action` and `UIEffect`
- **Deliverables**:
  - Hard-delete `UIEffect`, `Action`, and `CommandTarget` enums.
  - Handle complex flows (moving, healing, splitting, typing) directly in the router via strongly-typed messages (`UiMessage::ConfirmInteractionTarget(Guid)`, `ConfirmInteractionText(String)`, etc.).
  - Semantic components return raw `ClientCommand` events.
- **Verification**: Cross-component actions behave identically without `effect.rs`.

### Phase 5: Cleanup & Polish
- **Deliverables**:
  - Remove ghost files, standardize formatting.
  - Validate performance caches (like `wrapped_chat_cache`).
- **Verification**: Cargo clippy has 0 warnings. Code mirrors original TUI functionality perfectly.

## 6. Definition of Done (DoD)
- [ ] Ratatui `Scrollbar` components and `maintain_scroll()` are removed.
- [ ] The `src/pages/` structure is live. `ViewState` and `AppState` have been decomposed.
- [ ] Render functions use `&self` or local `&mut self`, taking strict read-only `&GameData`. 
- [ ] `Action` and `UIEffect` are purged entirely from the project.
- [ ] Stateful caching runs cleanly via `StatefulWidget` with no global borrow leaks.
- [ ] `cargo check -p holtburger-cli` compiles with 0 errors/warnings.

## 7. The Living Worksheet

### Task Checklist
- [x] **Phase 1: Event & Message Bus Foundation**
  - [x] Create `messages.rs` with `UiMessage` enum.
  - [x] Set up the internal message bus channel in `app.rs`.
  - [x] Change `Interaction` to pass as read-only.
- [ ] **Phase 2: Remove Visual Scrollbars**
  - [ ] Remove `Scrollbar` logic from lists and text panels.
  - [ ] Strip `maintain_scroll()` mechanics.
- [ ] **Phase 3: Component-Centric Restructure**
  - [ ] Scaffold `pages/` directory.
  - [ ] Refactor `chat` feature (State, View, Update).
  - [ ] Refactor `dashboard` tabs.
  - [ ] Dismantle `ViewState` God Object.
- [ ] **Phase 4: Eradicate `Action` and `UIEffect`**
  - [ ] Purge `UIEffect` handling block and struct.
  - [ ] Handle interactions natively returning `ClientCommand`s.
- [ ] **Phase 5: Cleanup & Polish**
  - [ ] Execute `cargo clippy`.
  - [ ] Validate cross-component edge cases (Trade/Targetting/Movement).

### Decisions Log
- *Decision*: Component-Centric "Plan A" selected as standard. 
- *Decision*: Visual scrollbars removed entirely rather than fighting stateful widget layout cycles.
- *Decision*: Stateful Caching (`wrapped_chat_cache`) will use Ratatui `StatefulWidget` trait for isolated mutable caching.

### Verification Log
- **Phase 1**: Initialized `mpsc::unbounded_channel` in `tui.rs`. Updated `TabController::get_verbs` signature across all 6 tabs to accept `&Option<Interaction>` to rely on read-only passing instead of grabbing `game.view.active_interaction`. Verified `cargo check` runs clean.
- *(Empty - to be filled during execution)*

### Open Questions
- *(None at the moment)*
