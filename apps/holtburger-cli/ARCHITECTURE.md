# CLI/TUI Architecture 🖥️

This crate is the primary interactive interface for Holtburger. It is a Terminal User Interface (TUI) built with [ratatui](https://ratatui.rs/) and follows a pattern inspired by the **Elm Architecture** (Model-Update-View), adapted for a multi-threaded asynchronous environment.

## 🏗️ Project Structure

- **`src/bin/`**: Contains the executable entry point.
    - `tui.rs`: The main TUI application loop, terminal initialization, logging setup, and event orchestration.
- **`src/state.rs`**: Core application state management. Defines `AppState`.
- **`src/update/`**: Transition logic.
    - Logic that moves the `AppState` from one state to another via `AppAction` and processes inputs.
- **`src/pages/`**: High-level screen abstractions.
    - Handles routing (Selection vs. Game) and major layout definitions.
- **`src/components/`**: Reusable UI widgets and elements.
    - [modal.rs](src/components/modal.rs): Shared modal component.
    - [scroll.rs](src/components/scroll.rs): Scrolled state logic.
- **`src/theme.rs`**, **`src/types.rs`**, **`src/utils.rs`**: Core types, traits, theming, and layout utilities.

## 🧠 State Management: The Model

The application state is decomposed into granular modules to facilitate **disjoint borrowing**. This is the most crucial architectural detail for developers: by splitting state, we can pass isolated portions like `&mut state.chat` to a function without borrowing all of `state` simultaneously.

### `AppState` ([src/state.rs](src/state.rs))
The root container that aggregates all sub-states directly or via nested pages:
- **`Page`**: High-level routing (Selection vs. Game). Stores page-specific state like `GameState` vs `SelectionState`.
- **`GameState`** ([src/pages/game/state.rs](src/pages/game/state.rs)): Encapsulates `GameData` (projection of Core logic), and UI transient state for the game interface.
- **`SelectionState`** ([src/pages/selection/state.rs](src/pages/selection/state.rs)): Tracks the currently selected character from the selection screen.

## 🔄 The Interaction Loop: Update & View

The TUI operates on an asynchronous event loop located in [src/bin/tui.rs](src/bin/tui.rs).

### 1. Event Orchestration
We use `tokio::select!` to multiplex event streams into **`AppEvent`**. These include:
- `Tick`: Real-time UI updates (animations, timers).
- `KeyPress / Mouse`: Input from the terminal via crossterm.
- `ReceivedViewEvent`: View events mapped from the Core Engine (`ClientViewEvent`).

### 2. The `Update` Phase ([src/update/mod.rs](src/update/mod.rs))
The `handle_app_event` function accepts a `&mut AppState` and an `AppEvent`. It logic processes engine events mapped into UI data, or input intents (like 'i' -> Toggle Inventory Tab), and returns an `UpdateResult` indicating if a redraw is needed or if an exit was requested.
Furthermore, input mapping translates generic keystrokes into `AppAction` intents which describe high-level client choices (e.g. `AppAction::Equip(Guid)`).
