# Split Verb + Tab-Scoped Text Input Plan

## Context & Boundaries

**Goal:** Implement a reusable, tab-scoped verb-to-text-input flow so `Split` enters a local "splitting mode", replaces the dashboard verb bar with a numeric input, captures keyboard focus like a modal, and submits a fully formed `AppAction::SplitItem` with parsed quantity.

### In Scope
- `apps/holtburger-cli` UI state + input + dashboard footer rendering.
- Split flow in Inventory tab first, built on reusable abstractions for other tabs/verbs.
- `AppAction::SplitItem` shape update to carry quantity explicitly.
- Numeric-only text input behavior (digit entry + backspace + enter/esc).

### Out of Scope
- Reworking all global interactions (`Moving`, `Combining`, `Healing`, `Targeting`) in this pass.
- New visual themes/components outside existing ratatui primitives/theme usage.
- Protocol wire changes (already supported by `ClientCommand::Split { amount }`).

---

## Ground Truth (Current State)

### Action + Command Pipeline
- `AppAction::SplitItem` now carries explicit fields: `SplitItem { item, container, amount }` in `apps/holtburger-cli/src/types.rs`.
- `GameState::handle_action` now forwards split amount directly into `ClientCommand::Split` in `apps/holtburger-cli/src/pages/game/state.rs`.
- Transport already supports quantity at command level (`ClientCommand::Split { item, container, amount: u32 }`) in `crates/holtburger-core/src/client/types.rs`.

### How Split Is Triggered Today
- Inventory split is tab-local via `InventoryTab` (`SplitSession` + `VerbInputState`) in `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`.
- Pressing the split shortcut enters footer input mode; `Enter/Esc/Backspace/digits` are handled via `handle_footer_input` and `VerbInputState::handle_key`.
- Dynamic pane only displays interaction title/details (`Splitting`) in `apps/holtburger-cli/src/pages/game/panels/dynamic.rs`.

### Footer / Verb Bar Rendering
- Dashboard always renders tab content + shared verb bar footer in `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs`.
- Footer helper rendering is colocated in `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs` (`render_verb_bar` / `render_footer_text_input`).

### State Architecture Constraints
- Global interaction state lives in `ViewState.active_interaction` (`apps/holtburger-cli/src/pages/game/state.rs`).
- Tabs already own local state structs (`InventoryTab`, `TradeTab`, etc.) and are routed through `TabController` (`apps/holtburger-cli/src/types.rs`, `apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs`).
- This makes tab-local split mode a good fit without extending global interaction semantics.

---

## Proposed Architecture

### 1) Standardized Tab-Scoped Verb Input Pattern
Introduce a reusable tab-local “verb input session” abstraction that any tab can opt into.

Candidate shape (exact naming can be adjusted during implementation):
- `VerbInputKind` (start with `Quantity` variant).
- `VerbInputState` containing:
  - prompt label (e.g., `"Split amount"`),
  - text buffer,
  - validation constraints (min/max),
  - completion action factory (returns `AppAction` after parse).

This lives in `apps/holtburger-cli/src/types.rs` (or a nearby UI state module) and is consumed by tabs.

### 2) TabController Extension for Footer Override + Modal-Like Input Capture
Extend `TabController` so active tab can:
- expose optional footer override (`verbs` vs `text input`),
- consume key events for active verb-input mode before normal tab navigation/verb shortcuts.

Dashboard/game input routing should treat active tab input mode as keyboard-capturing (modal-like), even though state remains tab-local.

**Dry-run correction:** today tab input is only called when `FocusedPane::Dashboard` (`apps/holtburger-cli/src/update/input.rs`). To get modal-like capture, we must add an early routing path that checks active tab verb-input mode regardless of focused pane.

### 3) Split Flow Migration to Tab-Local Mode
Inventory split verb should:
- enter local split input mode on keypress (`p`),
- stop using `Interaction::Splitting` for this path,
- on `Enter`: parse quantity, validate range, emit `AppAction::SplitItem` with item/container/amount,
- on `Esc`: cancel local mode and restore verb bar.

**Dry-run correction:** dynamic pane currently labels `Interaction::Splitting` (`apps/holtburger-cli/src/pages/game/panels/dynamic.rs`). Once split becomes tab-local, this label will disappear by design; we should preserve dynamic-pane behavior for all remaining global interactions only.

---

## Dry-Run Findings (Grounding Pass)

### Verified Feasible Paths
- `AppAction::SplitItem` has exactly two call sites (`apps/holtburger-cli/src/types.rs`, `apps/holtburger-cli/src/pages/game/state.rs`), so adding `amount` is low-risk and tightly scoped.
- All tabs already share one `TabController` entrypoint (`render`, `get_verbs`, `handle_input`), making a standardized footer/input abstraction practical without creating tab-specific hacks.
- Footer rendering is centralized in one place (`apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs` + `apps/holtburger-cli/src/utils.rs`), so replacing verb bar with input can be done once.

### Gaps in Current Plan (Now Addressed)
1. **Keyboard capture gap**
  - Existing flow only gives tabs input when dashboard is focused.
  - **Resolution:** introduce a pre-routing step in `GameState::handle_input` that delegates to active-tab verb-input handler first, before pane-gated behavior.

2. **Cursor ownership gap**
  - Only chat input sets a cursor today (`apps/holtburger-cli/src/pages/game/render.rs`).
  - **Resolution:** define one authoritative cursor source in render path; dashboard footer input must return optional cursor coordinates to `GameState::render`.

3. **Abstraction leakage risk in trait growth**
  - Naively adding split-specific methods to `TabController` would leak feature details.
  - **Resolution:** add generic footer/input contracts (e.g., footer model + generic key handling), not `split_*` methods on trait.

4. **Interaction coexistence ambiguity**
  - Global `active_interaction` affects verbs across tabs; split becoming tab-local can conflict conceptually.
  - **Resolution:** split input mode takes precedence only for active tab and does not mutate `active_interaction`.

### Recommended Defaults (to avoid open-ended design churn)
- Split destination container: use player main pack (`data.player_guid`) to match existing `/split` semantics in `apps/holtburger-cli/src/update/input.rs`.
- Invalid quantity UX: keep input open, log validation error, preserve typed value for correction.
- While tab-local input mode is active: block dashboard tab switch keys (`1..6`) and verb shortcuts; allow only mode-edit keys + `Esc`.

---

## Phased Implementation

## Phase 1: Action/Data Contract Cleanup (Complexity: Low)
**Deliverables**
- Update `AppAction::SplitItem` to include quantity explicitly (e.g., struct/tuple form with `amount`).
- Update all split action handling in `GameState::handle_action`.
- Remove hardcoded `amount: 1` TODO.

**Files**
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/pages/game/state.rs`

**Acceptance Criteria**
- Split action can carry arbitrary positive quantity from UI.
- No remaining split default amount constants in app action path.

**Dry-run notes**
- Confirmed only two compile touchpoints for this variant, so this phase is mechanically straightforward.

## Phase 2: Reusable Verb-Input Session Primitive (Complexity: Medium)
**Deliverables**
- Add standardized tab-scoped verb-input state type(s).
- Add helper functions for numeric key handling: digit-only append, backspace, parse/validate.
- Add common footer rendering helper for input-mode UI (reusing existing border/theme patterns).

**Files**
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/utils.rs`
- (Optional helper module) `apps/holtburger-cli/src/components/...`

**Acceptance Criteria**
- Primitive is generic enough for future verbs (buy/sell/give quantities).
- Numeric-only input behavior is centralized, not reimplemented ad hoc in each tab.

**Dry-run notes**
- Keep this primitive UI-agnostic (state + parser + validator) to avoid bloating `utils.rs` with behavior.
- Prefer a focused module for this pattern instead of split-specific fields on `InventoryTab` only.

## Phase 3A: Input Precedence + Router Integration (Complexity: Medium-High)
**Deliverables**
- Update game input routing to let active tab consume keys first when tab-local input mode is active, regardless of normal verb shortcut flow.

**Files**
- `apps/holtburger-cli/src/update/input.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs`
- `apps/holtburger-cli/src/types.rs`

**Acceptance Criteria**
- While active, digit/backspace/enter/esc drive the verb-input session (modal-like capture).
- Normal dashboard shortcuts and pane handlers still work when no tab-local input mode is active.

**Dry-run notes**
- This is the routing-risk phase; isolate behavior changes before any rendering/cursor changes.
- Implement explicit input precedence to avoid regressions:
  1) app modal, 2) tab-local verb input, 3) tab shortcuts/global dashboard handling, 4) existing pane handlers.

## Phase 3B: Footer Rendering Swap (Complexity: Medium)
**Deliverables**
- Update dashboard render path to switch footer from verb bar to input control when active tab reports verb-input mode.
- Keep the rendering contract generic (footer model/state) so it is reusable across tabs/verbs.

**Files**
- `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs`
- `apps/holtburger-cli/src/utils.rs`
- `apps/holtburger-cli/src/types.rs`

**Acceptance Criteria**
- Entering tab-local input mode visually replaces footer verbs with text input.
- Exiting tab-local input mode restores the existing verb bar.

**Dry-run notes**
- Footer rendering is centralized, so this can be implemented without touching per-tab render functions.

## Phase 3C: Cursor Ownership Unification (Complexity: Medium)
**Deliverables**
- Ensure cursor is shown in the footer input while active (and not conflicting with chat input cursor).
- Centralize cursor selection in game render path with one authoritative source.

**Files**
- `apps/holtburger-cli/src/pages/game/render.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs`
- `apps/holtburger-cli/src/types.rs`

**Acceptance Criteria**
- Exactly one cursor is active at a time.
- Chat input cursor behavior remains unchanged when tab-local input mode is inactive.

**Dry-run notes**
- Current cursor is set only for chat input; this phase safely introduces footer-input cursor without creating dual-cursor bugs.

## Phase 4: Inventory Split Implementation on New Primitive (Complexity: Medium)
**Deliverables**
- Inventory `Split` verb enters local split mode (tab state).
- Validate quantity in range `1..=max_amount` from selected stack.
- Build and emit fully formed split action with:
  - selected item guid,
  - resolved container guid,
  - parsed amount.
- Cancel and clear mode on successful submit or escape.

**Files**
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/render.rs` (if any tab-specific footer or prompt text needed)
- `apps/holtburger-cli/src/types.rs`

**Acceptance Criteria**
- Pressing split shortcut enters split input mode.
- Only numeric entry is accepted.
- `Enter` submits split quantity > 0 and <= stack size.
- Invalid quantity does not emit command and provides user feedback (chat/system log).

**Dry-run notes**
- Existing `InventoryTab` already owns `selected_index` and entity lookup, so binding `max_amount` to current selection is straightforward.
- Must define behavior if selected item changes while input mode is active (recommendation: lock the target item at mode entry).

## Phase 4.5: Verb Trigger Routing Refactor (Complexity: Medium)
**Deliverables**
- Remove split-specific key special-casing from `InventoryTab::handle_input`.
- Introduce uniform verb dispatch so shortcut definitions live in `get_verbs` and are dispatched through one path.
- Convert split trigger to typed UI action dispatch instead of a key-special-case branch.
- Preserve existing split behavior while preparing for app-level UI orchestration.

**Files**
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/character/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/equip/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/trade/tab.rs`

**Acceptance Criteria**
- `InventoryTab::handle_input` no longer contains hardcoded split shortcut branching.
- Split shortcut is declared once through normal verb definitions and resolved via uniform dispatch.
- No message-bus overreach: scope remains tab/UI routing only (no global architecture rewrite).

**Dry-run notes**
- This phase addresses the current code smell (shortcut duplication + deviation in `handle_input`) without introducing a heavy component bus.
- This phase is now fully subsumed by Phase 4.75's `AppAction::UiAction(AppUiAction)` model.

## Phase 4.75: App-Level UI Orchestration Lane (Complexity: Medium-High)
**Deliverables**
- Introduce `AppAction::UiAction(AppUiAction)` so verbs emit `AppAction` only.
- Add explicit handling path in app/page update loop so UI actions bubble to root and are reduced, then routed down via `handle_ui_action(...)` on owned components.
- Add `handle_ui_action(...)` propagation through component ownership layers (app/page → dashboard/view/chat → tab).
- Deprecate and remove local `TabUiAction` once equivalent `AppUiAction` targets are in place.
- Migrate at least one concrete cross-component path from direct component mutation to this lane (recommended candidates: trade/vendor-driven tab switch behavior or context/focus coordination).

**Files**
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/update/app_action.rs`
- `apps/holtburger-cli/src/pages/game/state.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/*/tab.rs`
- `apps/holtburger-cli/src/update/input.rs` (if dispatch path needs extension)

**Acceptance Criteria**
- Verbs produce `AppAction` only (no separate verb-local action type in `Verb`).
- App-level UI orchestration paths no longer require direct reach-through mutations when crossing component boundaries.
- `AppAction::UiAction(AppUiAction)` supports both local-targeted and cross-component UI transitions via typed variants.
- `handle_ui_action(...)` exists at component boundaries and dispatches only owned concerns.
- No global message-bus overreach: explicit, typed actions only.

**Dry-run notes**
- This phase targets the abstraction-leak concern around root-level coordination and prepares a scalable pattern for future cross-component UX flows.
- Prefer incremental adoption (one migrated orchestration path first) to keep risk bounded.
- Keep strict ownership boundaries to avoid turning root reducers into god handlers.

## Phase 5: Cleanup + Guardrails (Complexity: Low-Medium)
**Deliverables**
- Remove obsolete `Interaction::Splitting` references from global interaction flows (if no remaining consumers).
- Ensure dynamic pane interaction label behavior remains correct for other interaction types.
- Add/adjust focused tests around tab input behavior (or at least compile-level + manual scenario checklist if no existing test harness covers TUI input routing).

**Files**
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/pages/game/panels/dynamic.rs`
- Any affected tab files

**Acceptance Criteria**
- No dead split-interaction branches remain.
- Existing non-split interactions continue to function.

**Dry-run notes**
- `Interaction::Splitting` has four direct references (`types`, `inventory tab`, `dynamic pane` title/target mapping), so cleanup surface is known and bounded.

---

## Abstraction Guardrails (Non-Negotiable)

- Do not put split-specific fields on `ViewState`; split mode must remain tab-local.
- Do not add split-specific methods to `TabController`; add generic footer/input interfaces only.
- Keep action construction at tab level and command translation in `GameState::handle_action` (preserves current architecture boundary).
- Avoid adding cross-tab shared mutable state in `DashboardState`; keep per-tab ownership and explicit dispatch.
- Keep rendering concerns separated: dashboard chooses footer widget, tab supplies footer model/state.

---

## Risks & Mitigations

- **Risk:** Cursor ownership conflict between chat input and dashboard footer input.
  - **Mitigation:** Centralize cursor decision in `GameState::render` using a single authoritative `Option<(x,y)>` from active mode.

- **Risk:** Key routing regressions (tab switches/verbs ignored unexpectedly).
  - **Mitigation:** Route keys in strict precedence: modal -> tab-local verb input -> existing dashboard shortcuts -> existing pane-level handlers.

- **Risk:** Container selection ambiguity for split destination.
  - **Mitigation:** Preserve current semantic default used by `/split` (player/main inventory container) unless item-specific container is explicitly required; document decision.

- **Risk:** Over-coupling new primitive to inventory-only assumptions.
  - **Mitigation:** Keep primitive generic (`prompt`, constraints, parser, action factory) and tab-owned.

---

## Definition of Done

- `Split` is fully functional from verb selection through quantity entry to emitted command amount.
- Split input mode is tab-local and does not rely on global `active_interaction`.
- Footer replacement + keyboard capture behaves modal-like while preserving existing app modal precedence.
- `cargo check -p holtburger-cli` passes.
- Manual verification checklist completed:
  - Enter split mode from inventory stack item.
  - Type digits/backspace; non-digits ignored.
  - Enter valid quantity submits split command with expected amount.
  - Enter invalid quantity shows feedback and stays/cancels per chosen UX.
  - Esc cancels and restores normal verb bar.

---

## Living Worksheet

### Task Checklist
- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3A complete
- [x] Phase 3B complete
- [x] Phase 3C complete
- [x] Phase 4 complete
- [x] Phase 4.5 complete
- [x] Phase 4.75 complete
- [x] Phase 5 complete

### Decisions Log
- [x] Decide `AppAction::SplitItem` final shape: Named fields `SplitItem { item: Guid, container: Guid, amount: u32 }` for clarity and consistency with `ClientCommand::Split`.
- [x] Standardize tab-scoped verb input primitive in `types.rs`: `VerbInputState`, `VerbInputKind`, `VerbInputEvent`, and `VerbInputError`.
- [x] Centralize numeric-only input behavior in `VerbInputState::handle_key` (digits/backspace/enter/esc) with range validation in `parse_value`.
- [x] Add reusable footer input renderer colocated with dashboard footer call sites in `pages/game/panels/dashboard/render.rs`.
- [x] Route precedence implemented in `GameState::handle_input`: tab-local footer input captures keys before focused-pane dashboard/global handlers.
- [x] Footer rendering contract implemented generically via `TabController::footer_input` and `TabController::handle_footer_input` defaults (no split-specific trait leakage).
- [x] Cursor ownership unified: dashboard footer cursor takes precedence when active; chat input cursor remains fallback.
- [x] Decide split destination container resolution strategy: use player main pack (`data.player_guid`) to match existing `/split` semantics.
- [x] Decide invalid-input UX: keep split input mode open, log validation error, and preserve typed value for correction.
- [x] Implement inventory split flow using tab-local `SplitSession` (`InventoryTab`), with item GUID and max split amount locked at mode entry.
- [x] Add lightweight UI action lane (`TabUiAction`/`VerbAction`) to remove shortcut special-casing, then supersede it in Phase 4.75.
- [x] Add generic `TabController::handle_ui_action(...)` dispatch hook for uniform tab UI handling.
- [x] Refactor split trigger to typed UI action dispatch, removing hardcoded split shortcut special-casing from `InventoryTab::handle_input`.
- [x] Replace local UI-action lane with `AppAction::UiAction(AppUiAction)` so verbs emit `AppAction` only.
- [x] Codify ownership map: `GameState::handle_ui_action` forwards app UI actions; `DashboardState::handle_ui_action` applies dashboard-owned variants and broadcasts to tabs.
- [x] Add component-level `handle_ui_action(...)` propagation (`GameState` → `DashboardState` → `InventoryTab`).
- [x] Migrate first cross-component orchestration path: vendor/trade-driven tab switching now dispatches `AppAction::UiAction(AppUiAction::SetDashboardActiveTab(...))` instead of direct dashboard mutation.
- [x] Flatten UI action shape to a single `AppUiAction` enum and broadcast routed UI actions to dashboard tabs.
- [x] Remove obsolete global split interaction branch: deleted `Interaction::Splitting` and dynamic-pane split title/target handling.

### Verification Log
- ✅ `cargo check -p holtburger-cli` passed after Phase 2 changes.
- ✅ `cargo check -p holtburger-cli` passed after Phase 3A/3B/3C integration.
- ✅ `cargo check -p holtburger-cli` passed after Phase 4 inventory split integration.
- ✅ `cargo check -p holtburger-cli` passed after Phase 4.5 verb trigger routing refactor.
- ✅ `cargo check -p holtburger-cli` passed after Phase 4.75 `AppAction::UiAction(AppUiAction)` migration.
- ✅ `cargo check -p holtburger-cli` passed after Phase 5 cleanup (`Interaction::Splitting` removal).

### Open Questions
1. Should tab-local verb-input mode block dashboard tab-switch keys (`1..6`) while input mode is active? (Current implementation: yes, keys are captured by footer input handler.)
2. Should we expand the flattened `AppUiAction` surface beyond dashboard/inventory variants now (for example `View` or `Chat` transitions) or wait for the next concrete cross-component use case?
