# CLI/TUI Architecture 🖥️

This crate is the primary interactive interface for Holtburger. It is a Terminal User Interface (TUI) built with [ratatui](https://ratatui.rs/) and follows a pattern inspired by the **Elm Architecture** (Model-Update-View), adapted for a multi-threaded asynchronous environment.

## 🏗️ Project Structure

- **`src/bin/`**: Contains the executable entry point.
    - `tui.rs`: The main TUI application loop, terminal initialization, logging setup, and event orchestration.
- **`src/state/`**: State management.
    - [mod.rs](src/state/mod.rs): Defines `AppState` and aggregate states like `GameState`. Components are decomposed into disjoint containers to avoid borrow checker conflicts.
- **`src/update/`**: Transition logic.
    - Logic that moves the `AppState` from one state to another via `AppAction` and processes inputs.
- **`src/pages/`**: High-level screen abstractions.
    - Handles routing (Selection vs. Game) and major layout definitions.
- **`src/ui/`**: Core UI traits, theming, and layout utilities.
    - [widgets/](src/ui/widgets/): Reusable UI components.
    - [traits.rs](src/ui/traits.rs): Interfaces like `TabController` for polymorphic UI tabs.

## 🧠 State Management: The Model

The application state is decomposed into granular modules within `src/state/` to facilitate **disjoint borrowing**. This is the most crucial architectural detail for developers: by splitting state, we can pass isolated portions like `&mut state.chat` to a function without borrowing all of `state` simultaneously.

### `AppState` ([src/state/mod.rs](src/state/mod.rs))
The root container that aggregates all sub-states directly or via nested pages:
- **`Page`**: High-level routing (Selection vs. Game). Stores page-specific state like `GameState`.
- **`GameState`** ([src/state/mod.rs](src/state/mod.rs) / [src/state/game.rs](src/state/game.rs)): Encapsulates `GameData` (projection of Core), `DashboardState`, and `ViewState` (UI-only transient state).
- **`ChatState`**: Message log, line-wrapping cache, and scroll position.
- **`SelectionState`**: Tracks the currently selected entity and interaction targets.
- **`NetStats`**: Real-time network telemetry.

## 🔄 The Interaction Loop: Update & View

The TUI operates on an asynchronous event loop located in [src/bin/tui.rs](src/bin/tui.rs).

### 1. Action Orchestration
We use `tokio::select!` to multiplex event streams into **`AppAction`**. These include:
- `Tick`: Real-time UI updates (animations, timers).
- `KeyPress / Mouse`: Input from the terminal.
- `ReceivedEvent`: Raw, State, or View events from the Core Engine.

### 2. The `Update` Phase ([src/update/mod.rs](src/update/mod.rs))
The `handle_action` function accepts a `&mut AppState` and an `AppAction`. It returns an `UpdateResult` indicating if a redraw is needed or if an exit was requested.
- **`input.rs`**: Maps crossterm events to intents (e.g., 'i' -> Toggle Inventory Tab).
- **`world.rs`**: Processes engine events to update `GameData`.

### 3. The `View` Phase ([src/pages/mod.rs](src/pages/mod.rs))
The rendering loop uses **disjoint slices**. Instead of passing the whole `AppState` to a widget, we pass only what it needs:
```rust
// Example from src/ui/mod.rs
state.page.render(
    f, area, &mut state.chat, &state.account_name, ...
);
```

### 4. Modal System
Modals (like the "Login Retry" timer) are managed via `Option<Modal>` in `AppState`. When present, they intercept inputs and are rendered as the top-most layer by `src/ui/mod.rs`.

## 📱 Responsive Layout Strategy

The TUI implemented "terminal responsive" design.
- **Wide Mode**: Horizontal layout (Nearby | Chat | Context).
- **Narrow Mode**: Vertical layout (Main stacked between Header/Footer).

Breakpoints are defined in [src/ui/layout.rs](src/ui/layout.rs) and calculate layout constraints dynamically based on `Rect` dimensions.

## 🧩 Modularity & Extensibility

### Dashboard Tabs
The Dashboard panel (bottom right) uses the **`TabController`** trait. 
- **Adding a tab**: Implement the trait in a new module in `src/pages/game/dashboard/tabs/` and add it to the `DashboardTab` enum in `src/types.rs`.

### Interaction Flow

```mermaid
sequenceDiagram
    participant C as Core Engine
    participant T as TUI Loop (tui.rs)
    participant S as AppState (src/state/mod.rs)
    participant P as Page (src/pages/mod.rs)

    C->>T: WorldViewEvent (Guid, VitalUpdate)
    T->>S: handle_action(ReceivedViewEvent)
    S-->>S: Update vitals in GameData
    S->>T: UpdateResult { needs_redraw: true }
    T->>P: render(Frame, AppStateFields...)
    P->>T: next_frame()
```

## 🛠️ Developer Navigation Guide

### Task-Driven Shortcuts
- **Adding a new UI element?** Create a new file in `src/ui/widgets/` or a specialized panel in `src/pages/game/panels/`.
- **Handling a new server message?** 
    1. Ensure `holtburger-core` emits a `WorldViewEvent`.
    2. Add the handler in `src/update/world.rs` to mutate `GameData`.
- **Changing hotkeys?** Look in `src/update/input.rs`.
- **Modifying the theme?** Check `src/ui/theme.rs` for colors and symbols.
- **Adding new UI persistent state?** Add fields to `ViewState` in `src/state/view.rs`.

### Crucial Concepts
- **Line Wrapping**: Chat uses a cache ([src/pages/game/panels/chat.rs](src/pages/game/panels/chat.rs)) to avoid re-wrapping on every frame.
- **Disjoint Borrowing**: If you get a borrow error, check if you're trying to pass the whole `AppState`. Try passing individual fields instead.
- **The TUI is Async**: Heavy computation (like parsing) should happen in Core; the TUI should stay snappy for rendering.

