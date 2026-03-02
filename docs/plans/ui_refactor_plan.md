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

### Phase 2: Relocate Generic Components (In Progress)
- **Deliverables:**
  - Create a new directory: `src/components/` with a `mod.rs`.
  - Move `ui/widgets/scroll.rs` -> `src/components/scroll.rs`.
  - Move `ui/widgets/panels/modal.rs` -> `src/components/modal.rs`
- **Acceptance Criteria:** Generic TUI utilities are separated from game/selection specific components, residing safely at the app-level `src/`, and all module imports correctly resolve.

### Phase 3: Game HUD & Extraneous Panels (Complexity: Medium)
- **Deliverables:**
  - Create `pages/game/hud/` (with a `mod.rs`) and export it in `pages/game/mod.rs`.
  - Move `ui/widgets/hud/vitals.rs`, `pulse.rs`, and `status.rs` to `pages/game/hud/`.
  - Move `ui/widgets/panels/dynamic.rs` into `pages/game/panels/dynamic.rs` and export it in `panels/mod.rs`.
  - Move `ui/widgets/selection.rs` deeply inside `pages/selection/render.rs` to colocate with the selection state.
- **Acceptance Criteria:** The UI module is completely drained of all concrete widget rendering files.

### Phase 4: Gut the Root `ui/` Module

Instead of a monolithic refactor, this phase is broken down to safely unwire the root UI logic.

#### Phase 4.1: Relocate Specific Page State Logic (Complexity: Low)
- **Deliverables:**
  - Relocate the `impl GameState` block (specifically the `render` method) from `ui/page.rs` into `pages/game/mod.rs` (or create `pages/game/render.rs`).
  - Relocate the `impl SelectionState` block from `ui/page.rs` directly into `pages/selection/mod.rs` (or `pages/selection/render.rs`).
- **Acceptance Criteria:** Page-specific renders are colocated with their states, and `cargo check` passes.

#### Phase 4.2: Relocate Generic App Boundaries (Complexity: Medium)
- **Deliverables:**
  - Move the overarching `impl Page` block (`render`, `handle_input`, `handle_mouse`) from `ui/page.rs` into `pages/mod.rs`.
  - Move the top level `pub fn ui(...)` from `ui/mod.rs` into `pages/mod.rs` as `pub fn render_app(...)`.
  - Explicitly update `src/bin/tui.rs` to point to `pages::render_app` instead of `ui::ui`.
- **Acceptance Criteria:** `src/bin/tui.rs` successfully calls the root render from `pages/mod.rs` rather than `ui/mod.rs`.

#### Phase 4.3: Final UI Excision (Complexity: Low)
- **Deliverables:**
  - Delete `src/ui/mod.rs` and `src/ui/page.rs`.
  - Delete the `src/ui` directory entirely.
  - Remove `pub mod ui;` from `src/lib.rs`.
- **Acceptance Criteria:** `src/ui/` no longer exists, and the CLI fully functions with zero unresolved imports.

## ⚠️ Risks & Mitigations
- **Borrow Checker Complexity in Root App State:** `ui/mod.rs` has the comment `// We break the borrow cycle by borrowing disjoint fields from state.`. Moving the top-level app render might re-trigger overlapping mutable borrows of `AppState` components (Modal vs Page).
  - *Mitigation:* Explicitly preserve the disjoint structural layout. The top level `render_app` can remain functionally identical to `fn ui(f, state)`, just homed in `pages/mod.rs`.
- **Massive Import Noise:** Deleting `crate::ui` will break a massive surface area of UI files.
  - *Mitigation:* Ensure we meticulously run global `sed` passes for `crate::ui::` and rigorously re-run `cargo check` at each phase boundary to clean up dead links iteratively.

## 🏁 Definition of Done (DoD)
- [ ] Code compiles completely with zero errors.
- [ ] No module references `crate::ui` exist in the entire codebase.
- [ ] Running the client correctly renders UI bounds (game, dashboard, chat, HUD) without graphical deviation from `main`.

---
## 📝 The Living Worksheet

### Status: Not Started

#### Open Questions
- None.

#### Execution Checklist
- [ ] Phase 1 (Utilities & Layout)
- [ ] Phase 2 (Components)
- [ ] Phase 3 (Panels & HUD)
- [ ] Phase 4.1 (Relocate Specific Page State Logic)
- [ ] Phase 4.2 (Relocate Generic App Boundaries)
- [ ] Phase 4.3 (Final UI Excision)
