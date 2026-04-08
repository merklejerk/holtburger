# CLI/TUI Architecture 🖥️

This crate is the primary interactive interface for Holtburger. It is a Terminal User Interface (TUI) built with [ratatui](https://ratatui.rs/) and follows a pattern inspired by the **Elm Architecture** (Model-Update-View), optimized for a multi-threaded asynchronous environment and Rust's ownership rules.

## 🏗️ Project Structure

- **`src/bin/tui.rs`**: The main executable entry point. Orchestrates the terminal lifecycle, logging, and the core event loop.
- **`src/state.rs`**: Core application state management. Defines `AppState` and `RenderContext`.
- **`src/update/`**: Transition logic.
    - `app_event.rs`: Handles high-level `AppEvent` (Ticks, Keys, Network View Events).
    - `app_action.rs`: Processes semantic `AppAction` intents (e.g., `Log`, `SendCommands`, `Sequence`).
    - `input.rs`: Maps raw terminal input (Key/Mouse) to page-specific logic.
    - `world.rs`: Contains routing logic for incoming network messages.
- **`src/pages/`**: High-level screen abstractions.
    - `mod.rs`: Handles state-based delegation for input and rendering.
    - `render.rs`: Entry point for the UI draw pass.
    - `selection/`: Character selection screen state and rendering.
    - `game/`: The main game interface, split into `data`, `hud`, `panels`, and `layout`.
- **`src/components/`**: Reusable UI widgets like `modal` overlays and `scroll` state logic.
- **`src/theme.rs`**, **`src/types.rs`**, **`src/utils.rs`**: Global definitions for styling, CLI-specific types (`UpdateResult`, `AppAction`), and layout helpers.

## 🧠 State Management: The Model

The application state is meticulously split to enable **disjoint borrowing**. This allows us to pass specific parts of the state to rendering functions while maintaining a mutable reference to others.

### `AppState` ([src/state.rs](src/state.rs))
The root container that tracks session-wide state:
- **`page`**: A `Page` enum representing the current active view (`Selection` or `Game`).
- **`modal`**: Optional `Modal` overlay state.
- **`client_state`**: An enum from `holtburger-core` tracking the backend connection status.
- **`net_stats`**: Real-time throughput and history for the HUD.

### `RenderContext`
A transient struct created during the draw pass in [src/pages/render.rs](src/pages/render.rs). It bundles shared read-only state required by sub-components, preventing "prop drilling" while keeping borrows clean.

## 🔄 The Interaction Loop: Update & View

The TUI operates in `src/bin/tui.rs` using a `loop` with `tokio::mpsc` and `crossterm::event` polling to multiplex events:

### 1. Event Sources
- **Ticks**: Fixed intervals (default 100ms) for UI animations and network stat updates.
- **Terminal Input**: Crossterm events (Key, Mouse).
- **Network Events**: `ClientViewEvent` streams from the `holtburger-core` engine.
- **Logs**: A custom `TuiLogger` captures `log!` macros and pipes them into the UI as `CapturedLog` events.

### 2. The `Update` Phase ([src/update/](src/update/))
Events are processed by `AppState::handle_app_event`.
- **Action Draining**: We use an **Action Drain** pattern. Events/Actions return an `UpdateResult` which may contain a list of new `AppAction`s. `AppState::drain_actions` recursively processes these until the queue is empty.
- **UpdateResult**: A core type in [src/types.rs](src/types.rs) that aggregates:
    - `commands`: `ClientCommand`s to be sent to the core engine.
    - `actions`: Internal UI `AppAction`s to be processed.
    - `needs_redraw`: A boolean flag to trigger a new frame.

### 3. The `View` Phase ([src/pages/render.rs](src/pages/render.rs))
Rendering is strictly separated from logic.
- `render_app` creates a `RenderContext` and delegates to `AppState::page::render`.
- [src/pages/game/layout.rs](src/pages/game/layout.rs) handles complex layout calculations for the multi-pane game interface.

## 🛠️ Key Conventions
- **No Direct Engine Mod**: The TUI never directly modifies the `holtburger-core` state. It communicates via `ClientCommand` and `ClientViewEvent`.
- **State-Specific Logic**: Prefer implementing logic in sub-state structs (like `SelectionState` or `GameState`) and delegating from `AppState`.
- **Borrowing**: If you hit a borrow checker error during rendering, add the field to `RenderContext` instead of passing `&mut AppState`.

## 🎮 Game Page Architecture

The game page uses the same update model as the app shell. It is driven through a small `GameState` entry surface and an internal reducer split under `src/pages/game/update/`.

### `GameState` Integration Surface

These methods are the supported semantic entrypoints for driving the page:

- `handle_input(key)` for raw keyboard input.
- `handle_mouse(mouse)` for raw mouse input.
- `handle_action(action)` for gameplay and workflow intents.
- `handle_ui_action(action)` for durable local UI transitions.
- `handle_view_event(event)` for server-driven state projection.
- `handle_tick(elapsed)` for time-based maintenance and controller coordination.

Each entrypoint returns `UpdateResult`, which carries emitted `ClientCommand`s, follow-up `AppAction`s, and redraw requests.

### Internal Reducer Roles

- `update/action.rs`: routes gameplay and workflow intents to the relevant domain reducers.
- `update/ui_action.rs`: owns durable local UI transitions such as focus changes, confirmation lifecycle, and context-view changes.
- `update/view_event.rs`: owns `ClientViewEvent` projection plus the shared event-seam orchestration that does not belong to a single event family.
- `update/tick.rs`: owns tick-time orchestration over maintenance, controller coordination, and Logopolis presentation updates.
- `update/interaction_policy.rs`: owns shared interaction and frontend-navigation transition rules.
- `update/inventory_projection.rs`: owns inventory and equipment projection, related notification arming, and entity-driven context refresh/cleanup.

Helpers that remain in `state.rs` are reducer internals or page-local support code. They are not part of the external control surface.

### Integration Rules

- Drive gameplay behavior through `AppAction`.
- Drive durable UI-mode changes through `AppUiAction`.
- Project core/client state changes through `ClientViewEvent`.
- Use `handle_tick` for time-based maintenance and coordination, not ad hoc callers into controller helpers.
- Treat raw key or mouse simulation as a fallback for widget-local behavior, not the primary integration path.

For script or other external integration layers, compile external intents into `AppAction` or `AppUiAction`, pass them through the `GameState` entrypoints above, and feed emitted `ClientCommand`s back into the normal app shell flow.

### Boundary Rules

- `GameState` is a page host and reducer entry surface, not a bag of general-purpose mutators.
- Reducer-private policy belongs under `src/pages/game/update/` or in private `state.rs` helpers, depending on ownership and reuse.
- Render and layout support remain presentation concerns; they should not become alternative state-transition pathways.

If a new behavior cannot be described cleanly as input handling, an `AppAction`, an `AppUiAction`, a `ClientViewEvent`, or a tick update, revisit the design before adding another direct mutator path.
