# UI Colocation Refactor Plan

**Goal:** Cleanly fold the standalone rendering logic and components from `src/ui/` directly into the `src/pages/` module hierarchy to firmly colocate logical state with TUI presentation.

**Scope:**
- **In Scope:** Moving all files from `apps/holtburger-cli/src/ui`, sending app-wide/generic utilities to `src/` (e.g. `src/theme.rs`, `src/components/`) and sending specific layouts/panels to `src/pages/game/` or `src/pages/selection/`.
- **Out of Scope:** Fundamentally altering the design/visuals of the UI, changing the networking logic, or restructuring the broader event state loops (beyond import fixes).

## 📍 Identifing Ground Truth & References
- Current Architecture Source: `apps/holtburger-cli/src/ui/mod.rs`, `apps/holtburger-cli/src/ui/page.rs`
- Target Colocation Precedent: `apps/holtburger-cli/src/pages/game/panels/` where `dashboard`, `chat`, and `context` already successfully bundle logic and rendering natively.

## 🏗 Phased Implementation

### Phase 1: Core TUI Utilities & Game Layout (Completed)
- **Deliverables:**
  - Move `ui/theme.rs` to `src/theme.rs` (Done)
  - Move `ui/utils.rs` to `src/utils.rs` (Done)
  - Move `ui/layout.rs` into `pages/game/layout.rs` (Done)
  - Explicitly move the `pub fn get_layout(...)` function located directly inside `ui/mod.rs` into `pages/game/layout.rs`. (Done)
  - Export `mod theme;` and `mod utils;` at the root `src/lib.rs`. (Done)
- **Acceptance Criteria:** `cargo check -p holtburger-cli` successfully builds when these files are moved and their localized imports are fixed. (Verified)

### Phase 2: Relocate Generic Components (Completed)
- **Deliverables:**
  - Create a new directory: `src/components/` with a `mod.rs`. (Done)
  - Move `ui/widgets/scroll.rs` -> `src/components/scroll.rs`. (Done)
  - Move `ui/widgets/panels/modal.rs` -> `src/components/modal.rs` (Done)
  - Update all `crate::ui::widgets::scroll` and `crate::ui::widgets::panels::modal` references. (Done)
- **Acceptance Criteria:** Generic TUI utilities are separated from game/selection specific components, residing safely at the app-level `src/`, and all module imports correctly resolve. (Verified)

### Phase 3: Game HUD & Extraneous Panels (Completed)
- **Deliverables:**
  - Create `pages/game/hud/` (with a `mod.rs`) and export it in `pages/game/mod.rs`. (Done)
  - Move `ui/widgets/hud/vitals.rs`, `pulse.rs`, and `status.rs` to `pages/game/hud/`. (Done)
  - Move `ui/widgets/panels/dynamic.rs` into `pages/game/panels/dynamic.rs` and export it in `panels/mod.rs`. (Done)
  - Move `ui/widgets/selection.rs` deeply inside `pages/selection/render_widgets.rs` to colocate with the selection state. (Done)
- **Acceptance Criteria:** The UI module is completely drained of all concrete widget rendering files. (Verified)

### Phase 4: Gut the Root `ui/` Module (Completed)

#### Phase 4.1: Relocate Specific Page State Logic (Completed)
- **Deliverables:**
  - Relocate the `impl GameState` block (specifically the `render` method) from `ui/page.rs` into `pages/game/render.rs`. (Done)
  - Relocate the `impl SelectionState` block from `ui/page.rs` directly into `pages/selection/render.rs`. (Done)
- **Acceptance Criteria:** Page-specific renders are colocated with their states, and `cargo check` passes. (Verified)

#### Phase 4.2: Relocate Generic App Boundaries (Completed)
- **Deliverables:**
  - Move the overarching `impl Page` block (`render`, `handle_input`, `handle_mouse`) from `ui/page.rs` into `pages/mod.rs`. (Done)
  - Move the top level `pub fn ui(...)` from `ui/mod.rs` into `pages/mod.rs` as `pub fn render_app(...)`. (Done)
  - Explicitly update `src/bin/tui.rs` to point to `pages::render_app` instead of `ui::ui`. (Done)
- **Acceptance Criteria:** `src/bin/tui.rs` successfully calls the root render from `pages/mod.rs` rather than `ui/mod.rs`. (Verified)

#### Phase 4.3: Final UI Excision (Completed)
- **Deliverables:**
  - Delete `src/ui/mod.rs` and `src/ui/page.rs`. (Done)
  - Delete the `src/ui` directory entirely. (Done)
  - Remove `pub mod ui;` from `src/lib.rs`. (Done)
- **Acceptance Criteria:** `src/ui/` no longer exists, and the CLI fully functions with zero unresolved imports. (Verified)

## ⚠️ Risks & Mitigations
- **Borrow Checker Complexity in Root App State:** `ui/mod.rs` has the comment `// We break the borrow cycle by borrowing disjoint fields from state.`. Moving the top-level app render might re-trigger overlapping mutable borrows of `AppState` components (Modal vs Page).
  - *Mitigation:* Explicitly preserve the disjoint structural layout. The top level `render_app` can remain functionally identical to `fn ui(f, state)`, just homed in `pages/mod.rs`.
- **Massive Import Noise:** Deleting `crate::ui` will break a massive surface area of UI files.
  - *Mitigation:* Ensure we meticulously run global `sed` passes for `crate::ui::` and rigorously re-run `cargo check` at each phase boundary to clean up dead links iteratively.

## 🏁 Definition of Done (DoD)
- [x] Code compiles completely with zero errors.
- [x] No module references `crate::ui` exist in the entire codebase.
- [x] Running the client correctly renders UI bounds (game, dashboard, chat, HUD) without graphical deviation from `main`.

---
## 📝 The Living Worksheet

### Status: Completed ✅

#### Open Questions
- None.

#### Execution Checklist
- [x] Phase 1 (Utilities & Layout)
- [x] Phase 2 (Components)
- [x] Phase 3 (Panels & HUD)
- [x] Phase 4.1 (Relocate Specific Page State Logic)
- [x] Phase 4.2 (Relocate Generic App Boundaries)
- [x] Phase 4.3 (Final UI Excision)

### Decisions Log
- **2026-03-02**: Decided to move `theme.rs` and `utils.rs` to root `src/` because they are used globally across the app, while moving `layout.rs` and `get_layout` to `pages/game/layout.rs` because they are specific to the game screen layout.
- **2026-03-02**: Phase 1 successfully completed and verified with `cargo check`.
- **2026-03-02**: Established `src/components/` for shared, generic UI widgets like `scroll` and `modal`. This keeps them central but outside the `pages/` hierarchy since they aren't tied to any single page state.
- **2026-03-02**: Phase 2 successfully completed.
- **2026-03-02**: Relocated HUD and dynamic panels into `pages/game/` as they are strictly game-related. Moved selection widget to `pages/selection/render_widgets.rs`.
- **2026-03-02**: Phase 3 successfully completed.
- **2026-03-02**: Moved `GameState::render` and `SelectionState::render` into dedicated `render.rs` files within their respective page modules. This firmly colocates the presentation with the state.
- **2026-03-02**: Phase 4.1 successfully completed.
- **2026-03-02**: Migrated the root `Page` enum implementation and the main `render_app` function into `pages/mod.rs`. Updated binary entry point.
- **2026-03-02**: Phase 4.2 successfully completed.
- **2026-03-02**: Fully excised the `src/ui/` directory and corrected all remaining imports.
- **2026-03-02**: Phase 4.3 successfully completed.

### Verification Log
- **Phase 1**: Verified successfully by running `cargo check -p holtburger-cli --message-format=short`. Build is clean.
- **Phase 2**: Verified successfully by running `cargo check -p holtburger-cli --message-format=short`. Build is clean.
- **Phase 3**: Verified successfully by running `cargo check -p holtburger-cli --message-format=short`. Build is clean.
- **Phase 4.1**: Verified successfully by running `cargo check -p holtburger-cli --message-format=short`. Build is clean.
- **Phase 4.2**: Verified successfully by running `cargo check -p holtburger-cli --message-format=short`. Build is clean.
- **Phase 4.3**: Verified successfully by running `cargo check -p holtburger-cli --message-format=short`. Build is clean.
- **Final Checkout**: Ran `grep -r "crate::ui" apps/holtburger-cli/src/` - 0 results found.
