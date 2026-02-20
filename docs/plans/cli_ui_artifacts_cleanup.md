# Plan: Clean Up UI Architecture Artifacts

## 1. Context & Boundaries
- **Goal**: Eliminate the remaining architectural artifacts and "code smells" left over from the monolithic UI refactor, ensuring strict domain boundaries and idiomatic Rust patterns.
- **In Scope**: 
  - Relocating leaked UI state (`wrapped_chat_cache`, `last_chat_width`) from `AppState` to `ViewState`.
  - Extracting `log_chat` and its associated state (`chat_log`, `messages`) into a dedicated `ChatState` manager.
  - Breaking up `src/ui/state/mod.rs` into smaller, focused files (`page.rs`, `selection.rs`, `net.rs`).
  - Removing "reach-through" wrapper methods on `AppState` by improving delegation.
  - Refactoring the `std::mem::replace` borrow-checker workaround in the update loop.
- **Out of Scope**: 
  - Adding new UI features or widgets.
  - Changing the underlying `ratatui` rendering logic.
  - Modifying the `holtburger-core` engine or protocol crates.

## 2. Identifying Ground Truth
- **Reference Sources**: 
  - Current `apps/holtburger-cli/src/ui/state/mod.rs` (The primary source of leaked state and wrapper methods).
  - Current `apps/holtburger-cli/src/ui/update/input.rs` and `src/ui/mod.rs` (The sources of the `std::mem::replace` borrow-checker dance).
- **Existing Patterns**: 
  - The `UIEffect` and `UpdateResult` pattern in `src/ui/update/effect.rs` is the gold standard for how we want to handle state mutations without fighting the borrow checker.

## 3. Phased Implementation

### Phase 1: State & Type Relocation (The Easy Wins)
- **Deliverables**:
  - Move `wrapped_chat_cache` and `last_chat_width` from `AppState` to `ViewState`.
  - Extract `NetStats` into `src/ui/state/net.rs`.
  - Extract `SelectionState` into `src/ui/state/selection.rs`.
  - Extract `Page` into `src/ui/state/page.rs`.
  - Update `src/ui/state/mod.rs` to simply re-export these new modules.
- **Acceptance Criteria**: The codebase compiles with the new state structures and dispersed types. No UI state remains in the top-level `AppState`.

### Phase 2: The Chat Manager (Single Responsibility)
- **Deliverables**:
  - Create a new `ChatState` struct in `src/ui/state/chat.rs` to hold `messages`, `chat_log`, `wrapped_chat_cache`, and `last_chat_width`.
  - Move the `log_chat` method from `AppState` to `ChatState`.
  - Update all callers of `log_chat` to use `app.chat.log(...)`.
- **Acceptance Criteria**: `AppState` no longer directly manages chat history or file I/O. The codebase compiles and chat functions normally.

### Phase 3: Delegation & The Borrow Checker Dance
- **Deliverables**:
  - Remove "reach-through" methods on `AppState` (e.g., `dashboard_item_count`, `refresh_context_buffer`, `maintain_scroll`) by moving this logic directly into the `Page::Game` handlers or having widgets accept `&GameState` instead of `&AppState`.
  - Refactor the `std::mem::replace` pattern in `ui/mod.rs` (rendering) and `ui/update/input.rs` (input handling). This may involve passing specific sub-states (like `&mut ChatState`, `&mut NetStats`) to the `Page` handlers instead of the entire `&mut AppState`, or relying entirely on `UIEffect` to defer mutations.
- **Acceptance Criteria**: `std::mem::replace` is no longer used to swap out `self.page`. Wrapper methods are eliminated. The codebase compiles and runs without regressions.

## 4. Risks & Mitigations
- **Risk**: Moving `wrapped_chat_cache` to `ViewState` or `ChatState` might cause borrow checker issues during rendering if the render function needs mutable access to the cache while immutably borrowing the rest of the state.
  - **Mitigation**: We will carefully design `ChatState` to encapsulate its own mutability (e.g., using interior mutability `RefCell` for the cache if absolutely necessary, though standard `&mut` passing is preferred).
- **Risk**: Removing `std::mem::replace` might prove difficult if `Page` handlers genuinely need access to global `AppState` fields (like `net_stats` or `chat`).
  - **Mitigation**: We will pass the required global fields explicitly as arguments to the `Page` handlers (e.g., `page.handle_input(key, &mut app.chat, &mut app.net_stats)`), completely avoiding the overlapping borrow of `self.page` and `self`.

## 5. Definition of Done (DoD)
- [ ] `src/ui/state/mod.rs` is strictly a module index/re-export file.
- [ ] `AppState` contains only high-level domain structs (`ChatState`, `NetStats`, `Page`, etc.) and global config (`account_name`, `verbosity`).
- [ ] `log_chat` is encapsulated in `ChatState`.
- [ ] `std::mem::replace` is removed from `ui/mod.rs` and `ui/update/input.rs`.
- [ ] `cargo check -p holtburger-cli` passes with no warnings.
- [ ] `cargo fmt -p holtburger-cli` has been run.

## 6. The Living Worksheet

### Task Checklist
- [ ] **Phase 1: State & Type Relocation**
  - [ ] Move `wrapped_chat_cache` and `last_chat_width` to `ViewState` (or wait for Phase 2).
  - [ ] Extract `NetStats` to `state/net.rs`.
  - [ ] Extract `SelectionState` to `state/selection.rs`.
  - [ ] Extract `Page` to `state/page.rs`.
  - [ ] Fix imports and compile.
- [ ] **Phase 2: The Chat Manager**
  - [ ] Create `ChatState` in `state/chat.rs`.
  - [ ] Move `log_chat` logic.
  - [ ] Update callers.
  - [ ] Fix imports and compile.
- [ ] **Phase 3: Delegation & The Borrow Checker Dance**
  - [ ] Remove reach-through methods on `AppState`.
  - [ ] Refactor `std::mem::replace` in `ui/mod.rs`.
  - [ ] Refactor `std::mem::replace` in `ui/update/input.rs`.
  - [ ] Fix imports and compile.

### Decisions Log
- *None yet.*

### Verification Log
- *None yet.*

### Open Questions
- *None yet.*
