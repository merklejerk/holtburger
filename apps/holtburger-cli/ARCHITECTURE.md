# CLI/TUI Architecture 🖥️

This crate is the primary interactive interface for Holtburger. It is a Terminal User Interface (TUI) built with [ratatui](https://ratatui.rs/) and follows a pattern inspired by the **Elm Architecture** (Model-Update-View), optimized for a multi-threaded asynchronous environment and Rust's ownership rules.

## 🏗️ Project Structure

- **`src/bin/tui.rs`**: The main executable entry point. Orchestrates terminal lifecycle, logging, and the core event loop.
- **`src/lib.rs`**: The crate surface. Re-exports the top-level modules used by the binary and by tests: `components`, `navigation`, `pages`, `scripting`, `state`, `theme`, `types`, `update`, `utils`, and `version`.
- **`src/state.rs`**: Core application state management. Defines `AppState`, `RenderContext`, and the top-level shell/event plumbing.
- **`src/navigation.rs`**: Frontend navigation policy and helper logic shared across page reducers.
- **`src/scripting.rs`**: The CLI scripting bridge. Owns `DeferredScriptSource`, builds `TuiScriptClientView`, and wires the frontend projection into `holtburger-scripting::ScriptHost`.
- **`src/update/`**: App-shell transition logic.
    - `app_event.rs`: Handles high-level `AppEvent` values such as ticks, keys, and network view events.
    - `app_action.rs`: Processes semantic `AppAction` intents such as `Log`, `SendCommands`, and `Sequence`.
    - `input.rs`: Maps raw terminal input to page-specific logic.
    - `world.rs`: Routes incoming network messages into frontend state updates.
- **`src/pages/`**: High-level screen abstractions and page-specific reducers.
    - `selection/`: Character selection and creation screen state, input, and rendering.
    - `game/`: The main game interface, split into `state.rs`, `render.rs`, `data.rs`, `layout.rs`, `combat.rs`, `input.rs`, `input/commands.rs`, `hud/`, `panels/`, `domains/`, `weapon_swap.rs`, and `salvaging.rs`.
- **`src/components/`**: Reusable UI widgets such as modal overlays and scroll state logic.
- **`src/theme.rs`**, **`src/types.rs`**, **`src/utils.rs`**, **`src/version.rs`**: Global definitions for styling, CLI-specific types (`UpdateResult`, `AppAction`), layout helpers, and build/version metadata.

## 🧠 State Management: The Model

The application state is meticulously split to enable **disjoint borrowing**. This allows us to pass specific parts of the state to rendering functions while maintaining a mutable reference to others.

### `AppState` ([src/state.rs](src/state.rs))
The root container that tracks session-wide state:
- **`page`**: A `Page` enum representing the current active view (`Selection` or `Game`).
- **`modal`**: Optional `Modal` overlay state.
- **`client_state`**: An enum from `holtburger-core` tracking the backend connection status.
- **`net_stats`**: Real-time throughput and history for the HUD.

### `GameState` ([src/pages/game/state.rs](src/pages/game/state.rs))
The game-page host that owns the page-local reducer state:
- **`data`**: The frontend projection of character, world, inventory, and runtime data.
- **`dashboard`**: Dashboard tab state and selection.
- **`view`**: Page-local view state such as confirmations and busy indicators.
- **`script`**: Deferred script source, script host, and tick accumulation.
- **`runtime`**: Local navigation and combat controller state.
- **`render_state`**: Ephemeral rendering state used during draw passes.
- **`chat`** and **`chat_input`**: Chat history and the active input buffer.

### `RenderContext`
A transient struct created during the draw pass in [src/pages/render.rs](src/pages/render.rs). It bundles shared read-only state required by sub-components, preventing "prop drilling" while keeping borrows clean.

## 🔄 The Interaction Loop: Update & View

The TUI operates in `src/bin/tui.rs` using a `loop` with `tokio::mpsc` and `crossterm::event` polling to multiplex events:

### Threading and Ownership

The frontend shell and the core runtime are separate async tasks. `holtburger-core` owns authoritative world mutation and emits `ClientViewEvent`s, while the TUI task owns the local projection, controller state, render state, and script host that are derived from those events.

This matters for scripting and other frontend-side integrations: anything that needs on-demand reads should query the frontend-owned projection state, not `WorldState` directly. That keeps the core as the single authority and lets the frontend scripting bridge in `src/scripting.rs` live beside `GameState` without requiring shared mutable access to engine internals.

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

- `domains/reduce.rs`: the dispatcher that fans out actions, view events, and ticks to the owning subsystem.
- `domains/chat.rs`: chat projection and chat-oriented actions.
- `domains/combat.rs`: combat actions, combat feedback projection, automation, and stale attack refresh on tick.
- `domains/entity.rs`: world-entity projection, motion and position updates, and container tracking.
- `domains/interaction.rs`: interaction-driven actions that do not belong to the broader navigation flow.
- `domains/inventory.rs`: inventory actions, salvage state, weapon-swap coordination, inventory/equipment projection, and inventory notification arming.
- `domains/lifecycle.rs`: busy, confirmation, status, and other client lifecycle view events.
- `domains/logopolis.rs`: captured-log state and log-driven UI behavior.
- `domains/navigation.rs`: interaction/navigation actions, runtime-body projection, frontend navigation policy, navigation interrupts, and navigation tick coordination.
- `domains/object_interaction.rs`: context buffer maintenance plus inspect/read/debug style object interactions.
- `domains/party.rs`: fellowship projection and party/allegiance actions.
- `domains/player.rs`: player projection and player-timed maintenance such as enchantment decay.
- `domains/progression.rs`: stat and skill training actions.
- `domains/script.rs`: script host coordination and script-related action handling.
- `domains/trade_vendor.rs`: trade/shop actions and vendor/trade projection.
- `domains/ui.rs`: durable local UI transitions, context-buffer maintenance, and other page-local UI behavior.

Helpers that remain in `state.rs` are reducer internals or page-local support code. They are not part of the external control surface.

### Integration Rules

- Drive gameplay behavior through `AppAction`.
- Drive durable UI-mode changes through `AppUiAction`, wrapped into the normal action pipeline as `AppAction::UiAction`.
- Project core/client state changes through `ClientViewEvent`.
- Use `src/scripting.rs` and `domains/script.rs` for the frontend scripting bridge; compile script intents into `AppAction` values instead of reaching into `GameState` directly.
- Use `handle_tick` for time-based maintenance and coordination, not ad hoc callers into controller helpers.
- Treat raw key or mouse simulation as a fallback for widget-local behavior, not the primary integration path.

For script or other external integration layers, compile external intents into `AppAction` values. UI intents should be wrapped as `AppAction::UiAction`. Feed emitted `ClientCommand`s back into the normal app shell flow.

### Boundary Rules

- `GameState` is a page host and reducer entry surface, not a bag of general-purpose mutators.
- Reducer-private policy belongs under `src/pages/game/domains/`, organized by owning subsystem rather than by trigger shape.
- The scripting runtime is frontend-owned and should remain behind the `AppAction`/`ScriptHost` boundary.
- Render and layout support remain presentation concerns; they should not become alternative state-transition pathways.

If a new behavior cannot be described cleanly as input handling, an `AppAction`, an `AppUiAction`, a `ClientViewEvent`, or a tick update, revisit the design before adding another direct mutator path.
