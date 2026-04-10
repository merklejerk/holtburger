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

### Threading and Ownership

The frontend shell and the core runtime are separate async tasks. `holtburger-core` owns authoritative world mutation and emits `ClientViewEvent`s, while the TUI task owns the local projection, controller state, and render state that are derived from those events.

This matters for scripting and other frontend-side integrations: anything that needs on-demand reads should query the frontend-owned projection state, not `WorldState` directly. That keeps the core as the single authority and lets frontend-only runtimes such as `deno-core` live beside `AppState` without requiring shared mutable access to engine internals.

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

The game page uses the same update model as the app shell. It is driven through a small `GameState` entry surface and an internal reducer split under `src/pages/game/domains/`.

### `GameState` Integration Surface

These methods are the supported semantic entrypoints for driving the page:

- `handle_input(key)` for raw keyboard input.
- `handle_mouse(mouse)` for raw mouse input.
- `handle_action(action)` for gameplay and workflow intents.
- `handle_view_event(event)` for server-driven state projection.
- `handle_tick(elapsed)` for time-based maintenance and controller coordination.

Each entrypoint returns `UpdateResult`, which carries emitted `ClientCommand`s, follow-up `AppAction`s, and redraw requests. Durable local UI transitions are still modeled as `AppUiAction`, but they now flow through the normal action drain as `AppAction::UiAction` instead of a separate `GameState` entrypoint.

### Internal Reducer Roles

- `domains/mod.rs`: thin action, view-event, and tick routers that dispatch by owning subsystem rather than by trigger type.
- `domains/chat.rs`: chat/event projection.
- `domains/combat.rs`: combat actions, combat feedback projection, combat automation, and stale attack refresh on tick.
- `domains/context.rs`: assess/read/debug/context-view actions.
- `domains/entity.rs`: world-entity projection, motion/position updates, and container tracking.
- `domains/inventory.rs`: inventory actions, salvage state, weapon-swap coordination, inventory/equipment projection, and inventory notification arming.
- `domains/lifecycle.rs`: busy/confirmation/status and other client lifecycle view events.
- `domains/navigation.rs`: interaction/navigation actions, runtime-body projection, frontend navigation policy, navigation interrupts, and navigation tick coordination.
- `domains/party.rs`: fellowship projection plus party/allegiance actions.
- `domains/player.rs`: player projection and player-timed maintenance such as enchantment decay.
- `domains/progression.rs`: stat and skill training actions.
- `domains/trade_vendor.rs`: trade/shop actions and vendor/trade projection.
- `domains/ui.rs`: durable local UI transitions, context-buffer maintenance, and Logopolis tick-time behavior.

Helpers that remain in `state.rs` are reducer internals or page-local support code. They are not part of the external control surface.

### Integration Rules

- Drive gameplay behavior through `AppAction`.
- Drive durable UI-mode changes through `AppUiAction`, wrapped into the normal action pipeline as `AppAction::UiAction`.
- Project core/client state changes through `ClientViewEvent`.
- Use `handle_tick` for time-based maintenance and coordination, not ad hoc callers into controller helpers.
- Treat raw key or mouse simulation as a fallback for widget-local behavior, not the primary integration path.

For script or other external integration layers, compile external intents into `AppAction` values. UI intents should be wrapped as `AppAction::UiAction`. Feed emitted `ClientCommand`s back into the normal app shell flow.

### Boundary Rules

- `GameState` is a page host and reducer entry surface, not a bag of general-purpose mutators.
- Reducer-private policy belongs under `src/pages/game/domains/`, organized by owning subsystem rather than by trigger shape.
- Render and layout support remain presentation concerns; they should not become alternative state-transition pathways.

If a new behavior cannot be described cleanly as input handling, an `AppAction`, an `AppUiAction`, a `ClientViewEvent`, or a tick update, revisit the design before adding another direct mutator path.
