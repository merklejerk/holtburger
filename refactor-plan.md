# Refactor Plan: `holtburger-core/src/client/mod.rs`

> **Author:** DeluluDev
> **Date:** 2026-02-12
> **Status:** Draft — Ready for Review
> **Supersedes:** `refactor-plan-opus4.6.md`, `refactor-plan-gemini3.md`

---

## 1. Motivation

`client/mod.rs` is currently **1,321 lines** and functions as a god-module — it owns the
entire client lifecycle, from network handshake to physics-tick movement to chat forwarding.
Distinct domains are tangled together:

| Domain | Approx Lines | Concern |
|---|---|---|
| Construction / DAT loading | ~80 | `new()`, `new_replay()`, `create_with_session()` |
| Command dispatch | ~250 | `handle_command()` — a giant match arm |
| Message dispatch | ~200 | `handle_message()` — another giant match arm |
| Handshake / auth flow | ~80 | `send_login_request()`, `handle_handshake_*()`, `send_login_complete()` |
| Character selection | ~50 | `handle_character_list()`, `select_character()`, `send_character_enter_world()` |
| Server-controlled movement | ~130 | `handle_server_controlled_movement()` |
| Client-side approach (MoveTo) | ~80 | `handle_approach_task()` |
| Run loop (`run()`) | ~70 | Event loop with `tokio::select!` |
| Miscellaneous helpers | ~30 | `disconnect()`, `send_talk()`, etc. |
| Error/boot handlers | ~30 | `handle_character_error()`, `handle_boot_account()` |

**Pain points:**

1. **Untestable.** Every method is `&mut self` on a `Client` that owns a live `Session`
   (UDP socket). There is no way to unit-test `handle_message` or `handle_command` without
   standing up a real network session or building an elaborate mock.
2. **Unclear ownership.** Movement logic lives alongside chat forwarding alongside auth —
   a change in one area risks breaking another.
3. **Massive match arms.** `handle_command()` and `handle_message()` are each 200+ line
   match blocks that grow with every new feature. Adding a new `ClientCommand` variant
   means editing a single 250-line function.
4. **No separation of "what to do" from "how to send it."** Every command handler manually
   constructs a `GameMessage`, boxes it, and ships it through `self.session.send_message()`.
   This boilerplate is repeated 20+ times.
5. **Approach/movement logic is game-engine code** living inside what should be a network
   client.

---

## 2. Goals

- **Single Responsibility:** Each file handles one domain — auth, commands, messages,
  movement, etc.
- **Testability:** Core logic (message handling, command dispatch, movement math) should be
  testable without a live `Session`. Pure functions where possible, thin async wrappers where
  not.
- **Discoverability:** A new contributor should be able to `ls client/` and immediately
  understand the module's structure.
- **Gradual Migration:** Each phase compiles and passes tests before the next begins. No big
  bang. Existing public API (`Client`, `ClientEvent`, `ClientCommand`, etc.) stays stable
  throughout — downstream consumers (the CLI/TUI bins) should not need changes until we
  explicitly choose to refactor them.
- **ECS-like Decomposition:** After file-splitting, organically extract disjoint state into
  dedicated system structs (`MovementSystem`, `AuthState`) that are unit-testable in
  isolation — without fighting the borrow checker.

---

## 3. Target File Layout

### After Phase 6 (file-splitting complete):

```
client/
├── mod.rs          # Client struct, field defs, the run-loop, re-exports  (~120 lines)
├── types.rs        # ClientState, ClientEvent, ClientCommand, RetryState  (existing, unchanged)
├── builder.rs      # new(), new_replay(), create_with_session()
├── auth.rs         # Handshake, login, character selection, enter-world flow
├── commands.rs     # handle_command() dispatch + per-command sending helpers
├── messages.rs     # handle_message() dispatch + per-message handling helpers
└── movement.rs     # handle_approach_task(), handle_server_controlled_movement(), heading math
```

### After Phase 8 (ECS-like struct extraction):

```
client/
├── mod.rs          # Client struct (owns sub-systems), run-loop, re-exports  (~120 lines)
├── types.rs        # ClientState, ClientEvent, ClientCommand, RetryState
├── builder.rs      # new(), new_replay(), create_with_session()
├── auth.rs         # AuthState struct + impl (owns auth-specific fields)
├── commands.rs     # handle_command() dispatch + per-command sending helpers
├── messages.rs     # handle_message() dispatch + per-message handling helpers
└── movement.rs     # MovementSystem struct + impl (owns movement-specific fields) + pure helpers
```

The key difference: in Phase 8, `Client`'s fields are reorganized:

```rust
// Before (Phase 6):
pub struct Client {
    pub session: Session,
    pub world: WorldState,
    account_name: String,
    characters: Vec<CharacterEntry>,
    character_id: Option<Guid>,
    character_preference: Option<String>,
    state: ClientState,
    event_tx: Option<mpsc::UnboundedSender<ClientEvent>>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    connection_cookie: u64,
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    move_target: Option<Guid>,
    last_move_sync: Instant,
    last_move_pos: WorldPosition,
    last_move_pos_time: Instant,
    last_sent_pos_seq: Option<u16>,
}

// After (Phase 8):
pub struct Client {
    pub session: Session,          // shared — passed by &mut to systems
    pub world: WorldState,         // shared — passed by &mut to systems
    state: ClientState,            // shared — passed by &mut to systems
    event_tx: Option<...>,         // shared — passed by & to systems
    command_rx: Option<...>,       // owned by Client (run-loop only)
    auth: AuthState,               // owns: account_name, characters, character_id, etc.
    movement: MovementSystem,      // owns: move_target, last_move_sync, etc.
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
}
```

---

## 4. Borrow Checker Strategy

The ECS-like approach works in Rust because of **field-level borrow splitting**.
Sub-systems never own `Session` or `WorldState` — they receive them as parameters:

```rust
// ✅ Compiles — disjoint field borrows via destructuring
let Client { movement, world, session, event_tx, .. } = self;
movement.tick(dt, world, session, event_tx).await?;
```

This avoids the classic problem:

```rust
// ❌ Does NOT compile — `self` borrowed twice
self.movement.tick(&mut self.world, &mut self.session).await?;
```

**Async safety:** Since the `run()` loop uses `tokio::select!` (one branch at a time,
sequential execution), holding borrows across `.await` points is safe — we never have two
systems borrowing shared state concurrently.

### Field Ownership Map

| System | Owned State (moves into sub-struct) | Shared State (passed as `&mut`) |
|---|---|---|
| `MovementSystem` | `move_target`, `last_move_sync`, `last_move_pos`, `last_move_pos_time`, `last_sent_pos_seq` | `world`, `session`, `event_tx` |
| `AuthState` | `account_name`, `characters`, `character_id`, `character_preference`, `connection_cookie` | `session`, `state`, `event_tx` |

---

## 5. Phased Plan

### Phase 0 — Prep & Safety Net
> Establish a testing baseline so we know nothing regresses.

- [x] **0.1** Ensure `cargo build` and `cargo test` pass cleanly on the current `main` branch.
- [x] **0.2** Identify and catalogue every public symbol exported from `client/mod.rs` and
  `client/types.rs`. Confirm `lib.rs` re-exports match downstream usage in `holtburger-cli`.
- [x] **0.3** Tag a git commit (`pre-client-refactor`) as the safe rollback point.

**Notes:**
- **Completed 2026-02-12:** Verified world and player tests. Catalogued `Client`, `ClientState`, `ClientEvent`, `ClientCommand`. Tagged `pre-client-refactor`.

---

### Phase 1 — Extract `builder.rs` (Construction)
> Move `Client::new()`, `Client::new_replay()`, and `Client::create_with_session()` into
> `client/builder.rs`.

- [x] **1.1** Create `client/builder.rs` containing the three constructor functions as an
  `impl Client` block (Rust allows `impl` blocks across files in the same module).
- [x] **1.2** Remove the constructor bodies from `mod.rs`, add `mod builder;`.
- [x] **1.3** `cargo build && cargo test` — green.
- [x] **1.4** Commit: `refactor(client): extract builder.rs`.

**Notes:**
- **Completed 2026-02-12:** Successfully moved constructors. Cleaned up imports in `mod.rs`.

---

### Phase 2 — Extract `auth.rs` (Authentication & Character Flow)
> Move the handshake / login / character-selection lifecycle into `client/auth.rs`.

Functions to move:
- `send_login_request()`
- `handle_handshake_request()`
- `handle_handshake_response()`
- `handle_character_list()`
- `select_character()`
- `send_character_enter_world()`
- `send_login_complete()`
- `handle_character_error()`
- `handle_boot_account()`

- [x] **2.1** Create `client/auth.rs` with an `impl Client` block containing all auth methods.
- [x] **2.2** Move the function bodies, keeping signatures identical. Everything stays as
  `&mut self` methods for now.
- [x] **2.3** Remove the moved functions from `mod.rs`, add `mod auth;`.
- [x] **2.4** `cargo build && cargo test` — green.
- [x] **2.5** Commit: `refactor(client): extract auth.rs`.

**Notes:**
- **Completed 2026-02-12:** Moved handshake and character flow logic. Removed `Isaac` and `CharacterError` imports from `mod.rs`.
  `self.connection_cookie`, and `self.character_id`. They don't touch movement state at all,
  so the cut is clean.
- Future improvement (Phase 7): model the auth flow as an `AuthState` struct with explicit
  transitions.

---

### Phase 3 — Extract `movement.rs` (Movement & Approach)
> Move game-level movement logic into `client/movement.rs`.

Functions to move:
- `handle_approach_task()`
- `handle_server_controlled_movement()`

- [x] **3.1** Create `client/movement.rs` with an `impl Client` block.
- [x] **3.2** Move both functions. They access `self.world`, `self.session`, `self.event_tx`,
  and approach-tracking fields (`move_target`, `last_move_sync`, `last_move_pos`,
  `last_sent_pos_seq`).
- [x] **3.3** Remove from `mod.rs`, add `mod movement;`.
- [x] **3.4** `cargo build && cargo test` — green.
- [x] **3.5** Commit: `refactor(client): extract movement.rs`.

**Notes:**
- **Completed 2026-02-12:** Moved `handle_approach_task` and `handle_server_controlled_movement`. Const `AUTO_MOVE_DISTANCE_LIMIT` is now `pub(super)` in `mod.rs` for shared access until we extract the struct.

---

### Phase 4 — Extract `commands.rs` (Command Dispatch)
> Move `handle_command()` and its per-command helpers into `client/commands.rs`.

- [x] **4.1** Create `client/commands.rs` with an `impl Client` block containing
  `handle_command()`.
- [x] **4.2** Move `send_talk()` and `disconnect()` alongside it (they are command-specific
  helpers).
- [x] **4.3** Remove from `mod.rs`, add `mod commands;`.
- [x] **4.4** `cargo build && cargo test` — green.
- [x] **4.5** Commit: `refactor(client): extract commands.rs`.

**Notes:**
- **Completed 2026-02-13:** Extracted the massive `handle_command` match arm and its helpers. Cleaned up more imports in `mod.rs`.

---

### Phase 5 — Extract `messages.rs` (Inbound Message Dispatch)
> Move `handle_message()` and its sub-handlers into `client/messages.rs`.

- [x] **5.1** Create `client/messages.rs` with an `impl Client` block containing
  `handle_message()`.
- [x] **5.2** Move `handle_game_action()` alongside it.
- [x] **5.3** The `GameMessage::UpdateMotion` / `AutonomousPosition` arms that touch
  movement state call into `movement.rs` functions — verify cross-file method resolution
  works.
- [x] **5.4** Remove from `mod.rs`, add `mod messages;`.
- [x] **5.5** `cargo build && cargo test` — green.
- [x] **5.6** Commit: `refactor(client): extract messages.rs`.

**Notes:**
- **Completed 2026-02-13:** Extracted to `messages.rs`. Cleaned up `ProtocolUnpack` import in `mod.rs`.
- `handle_message()` is the second-largest function. After extraction, consider grouping
  related match arms into sub-functions: `handle_chat_message()`, `handle_property_update()`,
  etc.
- The message dump logic (writing to `message_dump_dir`) could become a utility method
  `fn dump_message(&mut self, data: &[u8])` at the top of `messages.rs`.

---

### Phase 6 — Slim Down `mod.rs`
> After phases 1–5, `mod.rs` should contain only:
> - `mod` declarations and re-exports
> - The `Client` struct definition
> - The `run()` event loop
> - `set_event_tx()` / `set_command_rx()` / `send_status_event()` (tiny helpers)

- [ ] **6.1** Audit `mod.rs` — confirm it is ≤ ~150 lines.
- [ ] **6.2** Move constants (`AUTO_MOVE_DISTANCE_LIMIT`, `PHYSICS_TICK_MS`) to the files
  that use them: `PHYSICS_TICK_MS` stays in `mod.rs` (run-loop), `AUTO_MOVE_DISTANCE_LIMIT`
  moves to `movement.rs`.
- [ ] **6.3** Ensure all `mod` declarations are present and ordered: `types`, `builder`,
  `auth`, `commands`, `messages`, `movement`.
- [ ] **6.4** Verify the public API surface hasn't changed: `Client`, `ClientState`,
  `ClientEvent`, `ClientCommand`, `RetryState` all accessible via `holtburger_core::*`.
- [ ] **6.5** `cargo build && cargo test` — green.
- [ ] **6.6** `cargo clippy` — no new warnings.
- [ ] **6.7** Commit: `refactor(client): finalize mod.rs slim-down`.

---

### Phase 7 — ECS-like Struct Extraction
> With the code cleanly split into files, extract disjoint fields into dedicated system
> structs. This is the organic transition from the file-split (Opus) approach to the
> systems-based (Gemini) approach.

**7a — `MovementSystem` struct:**

- [ ] **7a.1** Define `MovementSystem` in `movement.rs`:
  ```rust
  pub(super) struct MovementSystem {
      pub(super) move_target: Option<Guid>,
      last_move_sync: Instant,
      last_move_pos: WorldPosition,
      last_move_pos_time: Instant,
      last_sent_pos_seq: Option<u16>,
  }
  ```
- [ ] **7a.2** Convert the `impl Client` methods in `movement.rs` to `impl MovementSystem`
  methods that receive shared state as parameters:
  ```rust
  impl MovementSystem {
      pub(super) async fn handle_approach_task(
          &mut self, target_guid: Guid, dt: f32,
          world: &mut WorldState, session: &mut Session,
          event_tx: &Option<mpsc::UnboundedSender<ClientEvent>>,
      ) -> Result<()> { ... }
  }
  ```
- [ ] **7a.3** Update `Client` struct: remove the 5 movement fields, add
  `movement: MovementSystem`.
- [ ] **7a.4** Update `run()` to use destructuring for disjoint borrows:
  ```rust
  let Client { movement, world, session, event_tx, .. } = self;
  movement.handle_approach_task(target_guid, dt, world, session, event_tx).await?;
  ```
- [ ] **7a.5** Update `builder.rs` to initialize `movement: MovementSystem::new()`.
- [ ] **7a.6** `cargo build && cargo test` — green.
- [ ] **7a.7** Commit: `refactor(client): extract MovementSystem struct`.

**7b — `AuthState` struct:**

- [ ] **7b.1** Define `AuthState` in `auth.rs`:
  ```rust
  pub(super) struct AuthState {
      pub(super) account_name: String,
      pub(super) characters: Vec<CharacterEntry>,
      pub(super) character_id: Option<Guid>,
      pub(super) character_preference: Option<String>,
      pub(super) connection_cookie: u64,
  }
  ```
- [ ] **7b.2** Convert `impl Client` methods in `auth.rs` to `impl AuthState` methods that
  receive shared state as parameters.
- [ ] **7b.3** Update `Client` struct: remove the 5 auth fields, add `auth: AuthState`.
- [ ] **7b.4** Update callsites in `messages.rs`, `commands.rs`, and `run()` to go through
  `self.auth.*` or use destructuring.
- [ ] **7b.5** `cargo build && cargo test` — green.
- [ ] **7b.6** Commit: `refactor(client): extract AuthState struct`.

---

### Phase 8 — Pure Function Extraction & Unit Tests
> With systems isolated, extract pure functions that are trivially testable and eliminate
> duplicated inline math.

- [ ] **8.1** Extract `heading_to_target(from: Vector3, to: Vector3) -> f32` in
  `movement.rs` — currently duplicated 3 times inline as the atan2 → heading conversion.
- [ ] **8.2** Extract `detect_stuck(old_pos: Vector3, new_pos: Vector3, elapsed: Duration) -> bool`
  — the stuck-detection heuristic from `handle_approach_task`.
- [ ] **8.3** Extract `compute_arrival_position(player: &WorldPosition, target: &WorldPosition, arrival_dist: f32) -> WorldPosition`
  — the MoveToObject arrival calculation.
- [ ] **8.4** Add unit tests for all three pure functions. These require zero async, zero
  network, zero DAT files.
- [ ] **8.5** Add unit tests for `MovementSystem::new()` default state.
- [ ] **8.6** `cargo build && cargo test` — green.
- [ ] **8.7** `cargo clippy` — no new warnings.
- [ ] **8.8** Commit: `test(client): add unit tests for movement pure functions`.

---

## 6. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Accidental public API breakage | Low | Phase 0 catalogues the API; Phase 6 verifies it. |
| Split `impl` blocks cause borrow issues | Low | Rust allows multiple `impl` blocks in the same crate. Fields are accessed through `&mut self` as before. |
| Movement logic has hidden coupling to message handling | Medium | Phase 5 explicitly verifies the cross-file calls. If circular dependencies emerge, introduce a thin internal trait or restructure. |
| `async` + borrow splitting issues in Phase 7 | Low | `run()` is sequential (`tokio::select!` picks one branch). No concurrent mutable borrows across await points. |
| Merge conflicts with concurrent work | Medium | Commit each phase directly. Keep commits small and focused. |

---

## 7. Out of Scope

- Refactoring `Session` or `WorldState` internals.
- Changing the `ClientCommand`/`ClientEvent` enum shapes.
- Refactoring the TUI/CLI consumers.
- Introducing a full ECS framework (e.g. `bevy_ecs`).
- Async trait extraction or DI for `Session` (good idea, but needs its own plan).

---

## 8. Success Criteria

1. `client/mod.rs` is ≤ 150 lines.
2. No file in `client/` exceeds ~300 lines.
3. `cargo build && cargo test` pass at every phase boundary.
4. `cargo clippy` has no new warnings.
5. Downstream bins (`holtburger-cli`) compile without changes.
6. `MovementSystem` and `AuthState` are independently constructible without a live `Session`.
7. At least 3 new unit tests exist for previously-untestable pure functions (Phase 8).
