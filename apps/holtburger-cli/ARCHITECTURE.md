# CLI/TUI Architecture 🖥️

This crate is the primary interactive interface for Holtburger. It is a Terminal User Interface (TUI) built with [ratatui](https://ratatui.rs/) and follows a pattern inspired by the **Elm Architecture** (Model-Update-View), adapted for a multi-threaded asynchronous environment.

## 🏗️ Project Structure

- **`src/bin/`**: Contains the executable entry points.
    - `tui.rs`: The main TUI application loop, terminal initialization, logging setup, and event orchestration.
    - `cli.rs`: (Minimal) Non-interactive command-line interface helper.
- **`src/ui/`**: Core UI logic and state.
    - [state/](src/ui/state/): Defines `AppState` and its component parts. Decomposed into disjoint containers to avoid borrow checker conflicts.
    - [update/](src/ui/update/): Transition logic that moves the `AppState` from one state to another via `AppAction`.
    - [page/](src/ui/page/): High-level screen abstractions (Selection vs. Game).
    - [widgets/](src/ui/widgets/): Reusable UI components.
    - [traits.rs](src/ui/traits.rs): Interfaces like `TabController` for polymorphic UI tabs.

## 🧠 State Management: The Model

The application state is decomposed into granular modules within `src/ui/state/` to facilitate **disjoint borrowing**. This is the most crucial architectural detail for developers: by splitting state, we can pass `&mut state.chat` to one function and `&state.game` to another simultaneously.

### `AppState` ([src/ui/state/mod.rs](src/ui/state/mod.rs))
The root container that aggregates all sub-states:
- **`SelectionState`**: Tracks the currently selected entity and interaction targets.
- **`NetStats`**: Real-time network telemetry.
- **`ChatState`**: Message log, line-wrapping cache, and scroll position.
- **`Page`**: High-level routing (Selection vs. Game).
- **`GameState`** ([src/ui/state/game.rs](src/ui/state/game.rs)): contains `GameData` (projection of Core) and `ViewState` (UI-only transient state).

## 🔄 The Interaction Loop: Update & View

The TUI operates on an asynchronous event loop located in [src/bin/tui.rs](src/bin/tui.rs).

### 1. Action Orchestration
We use `tokio::select!` to multiplex event streams into **`AppAction`**. These include:
- `Tick`: Real-time UI updates (animations, timers).
- `KeyPress / Mouse`: Input from the terminal.
- `ReceivedEvent`: Raw, State, or View events from the Core Engine.

### 2. The `Update` Phase ([src/ui/update/mod.rs](src/ui/update/mod.rs))
The `handle_action` function accepts a `&mut AppState` and an `AppAction`. It returns an `UpdateResult` indicating if a redraw is needed or if an exit was requested.
- **`input.rs`**: Maps crossterm events to intents (e.g., 'i' -> Toggle Inventory Tab).
- **`world.rs`**: Processes engine events to update `GameData`.

### 3. The `View` Phase ([src/ui/page/mod.rs](src/ui/page/mod.rs))
The rendering loop uses **disjoint slices**. Instead of passing the whole `AppState` to a widget, we pass only what it needs:
```rust
// Example from src/ui/mod.rs
state.page.render(f, area, &mut state.chat, &state.game, ...);
```

### 4. Modal System
Modals (like the "Login Retry" timer) are managed via `Option<Modal>` in `AppState`. When present, they intercept inputs and are rendered as the top-most layer by `ui/mod.rs`.

## 📱 Responsive Layout Strategy

The TUI implemented "terminal responsive" design.
- **Wide Mode**: Horizontal layout (Nearby | Chat | Context).
- **Narrow Mode**: Vertical layout (Main stacked between Header/Footer).

Breakpoints are defined in [src/ui/mod.rs](src/ui/mod.rs) and calculate layout constraints dynamically based on `Rect` dimensions.

## 🧩 Modularity & Extensibility

### Dashboard Tabs
The Dashboard panel (bottom right) uses the **`TabController`** trait. 
- **Adding a tab**: Implement the trait in a new file in `widgets/dashboard/tabs/` and add it to the `DashboardTab` enum in `ui/types.rs`.

### Interaction Flow

```mermaid
sequenceDiagram
    participant C as Core Engine
    participant T as TUI Loop (tui.rs)
    participant S as AppState (state/mod.rs)
    participant P as Page (page/mod.rs)

    C->>T: WorldViewEvent (Guid, VitalUpdate)
    T->>S: handle_action(ReceivedViewEvent)
    S-->>S: Update vitals in GameData
    S->>T: UpdateResult { needs_redraw: true }
    T->>P: render(Frame, AppStateFields...)
    P->>T: next_frame()
```

## 🛠️ Developer Navigation Guide

### Task-Driven Shortcuts
- **Adding a new UI element?** Create a new file in `widgets/` and call it from `page/game.rs`.
- **Handling a new server message?** 
    1. Ensure `holtburger-core` emits a `WorldViewEvent`.
    2. Add the handler in `update/world.rs` to mutate `GameData`.
- **Changing hotkeys?** Look in `update/input.rs`.
- **Modifying the theme?** Check `ui/theme.rs` for colors and symbols.
- **Adding new UI persistent state?** Add fields to `ViewState`.

### Crucial Concepts
- **Line Wrapping**: Chat uses a cache ([src/ui/state/chat.rs](src/ui/state/chat.rs)) to avoid re-wrapping on every frame.
- **Disjoint Borrowing**: If you get a borrow error, check if you're trying to pass the whole `AppState`. Try passing individual fields instead.
- **The TUI is Async**: Heavy computation (like parsing) should happen in Core; the TUI should stay snappy for rendering.

