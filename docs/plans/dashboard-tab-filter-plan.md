# Dashboard Tab Filter Plan

## Context & Boundaries

**Goal:** Add a shared `[F]ilter` verb flow for the Nearby, Inventory, and Spells dashboard tabs so each tab can enter a tab-local text input mode, apply a case-insensitive fuzzy filter, preserve the tab's existing ordering and hierarchy rules, and surface active-filter state in the dashboard action bar.

### In Scope
- `apps/holtburger-cli` dashboard tab state, footer/action-bar rendering, and game input routing.
- Nearby, Inventory, and Spells tabs only.
- Reusable text-input support alongside the existing quantity-input flow used by `Split`.
- Filter activation, editing, confirmation, clearing, and filtered-list rendering behavior.
- Tab-specific filtered-content reconstruction that preserves each tab's existing sort order and parent/section context.

### Out of Scope
- Equip and Trade tab filtering in this pass.
- Reworking global interaction state (`Moving`, `Healing`, `Targeting`, `Combining`, `Salvaging`).
- Reordering list content based on match quality. Filtering should only select a subset, not replace the tab's canonical ordering.
- Search against hidden metadata that is not already part of each tab's visible conceptual item identity.

## Ground Truth

### Existing Footer/Input Architecture
- Dashboard footer rendering is centralized in `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs`.
- Tab-local footer input already exists through `TabController::footer_input()` and `TabController::handle_footer_input()` in `apps/holtburger-cli/src/types.rs`.
- Game input already gives footer input precedence over normal tab input in `apps/holtburger-cli/src/pages/game/input.rs`.
- Current footer input rendering is quantity-specific (`render_footer_text_input`) and the input state is quantity-only (`VerbInputKind::Quantity`, `VerbInputState`, `VerbInputEvent`) in `apps/holtburger-cli/src/types.rs`.

### Existing Verb Trigger Pattern
- Inventory `Split` already uses a tab-local `AppUiAction` handoff (`InventoryBeginSplitInput`) in `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`.
- Dashboard-level UI action routing already forwards actions to all tabs in `apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs`.
- This is the right precedent for a filter-entry action because the user explicitly wants filter activation to begin from a `UIAction`.

### Existing List Construction Rules
- Nearby builds a hierarchical entity list with root sorting by distance and child sorting by name in `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs`.
- Inventory builds a hierarchical entity list with root and child sorting by formatted item name in `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`.
- Spells builds a flat list sorted by spell name in `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/render.rs` and selects by sorted spell id list in `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/tab.rs`.

## Product Behavior

### Triggering Filter Edit Mode
- Each in-scope tab exposes an `[F]ilter` verb when no filter is active.
- Triggering `[F]ilter` emits a tab filter `AppUiAction` and enters tab-local footer text-input mode, following the same keyboard-capture pattern as `Split`.
- The input accepts arbitrary printable text, including spaces.
- While editing, the footer replaces the normal action bar with a text input and standard confirmation hints.

### Confirming, Cancelling, and Clearing
- `Enter` confirms the current text buffer.
- If the confirmed buffer trims to empty, the active filter is cleared.
- If the buffer contains text, it becomes the tab's active raw filter pattern.
- `Esc` behavior is asymmetric by design:
  - if no filter was active when edit mode opened, `Esc` cancels editing with no state change;
  - if a filter was already active when edit mode opened, `Esc` clears that active filter.
- Manual clearing is therefore also supported by reopening filter edit, deleting the text, and pressing `Enter`.

### Active Filter Presentation
- When a filter is active and the tab is not currently editing it, the dashboard footer renders a header line like `[F]ilter: {RAW_PATTERN}` above the normal verb list.
- The normal verb list hides the standalone `Filter` verb while a filter is active.
- Pressing `f` while a filter is active still reopens the filter editor, even though the regular verb list omits the standalone `Filter` entry. The header line is the visible affordance.

### Matching Semantics
- Matching is case-insensitive.
- The committed raw pattern is split with `split_whitespace()` into zero or more normalized tokens.
- Multiple tokens are combined by union, not intersection.
- Repeated spaces do not create empty tokens.
- Matching should be fuzzy subsequence matching on each tab's canonical display/search text rather than strict substring matching.
- Match quality must not reorder the list. The filter decides inclusion only; final ordering still comes from the tab's existing sort/hierarchy pipeline.

## Tab-Specific Filter Semantics

### Nearby
- Search unit: the entity's display name as produced by `format_item_name(...)`.
- Base ordering: unchanged from `get_entities(...)`.
- Hierarchy rule: if a matched entity is nested inside a container, wielder, or physics parent chain, include every ancestor needed to preserve the displayed tree path up to the nearest root in the filtered output.
- Descendants of a matched parent are not auto-included unless they also match or are required ancestors of another match.

### Inventory
- Search unit: the entity's display name as produced by `format_item_name(...)`.
- Base ordering: unchanged from `get_entities(...)`.
- Hierarchy rule: if a matched item is inside a pack/container hierarchy, include all ancestor containers up to the visible root so the result never shows detached children at depth zero.
- Status decorations like `(EQUIPPED)`, `(OFFERED)`, `(SALVAGING)`, and container counts remain render-only and should not affect filtering.

### Spells
- Search unit: resolved spell name.
- Base ordering: unchanged from the current alphabetical sort.
- Hierarchy rule: none; this tab is flat.
- Spell power remains visible in the rendered row but should not participate in filtering.

## Proposed Architecture

### 1. Generalize Footer Input From Quantity-Only to Shared Text/Quantity Support
Evolve the existing footer input primitives in `apps/holtburger-cli/src/types.rs` so they can represent:
- quantity input for `Split`, and
- free-text input for tab filters.

Recommended shape:
- `VerbInputKind::{Quantity, Text}`.
- `VerbInputState` supports:
  - prompt/header label,
  - editable buffer,
  - optional numeric bounds for quantity mode,
  - mode-specific key handling.
- `VerbInputEvent` grows a text submission path instead of assuming numeric submission only.

This avoids creating a second, parallel footer-input abstraction just for filters.

### 2. Add Explicit Tab Filter State Per Tab
Each in-scope tab should own lightweight filter state rather than pushing filter data into global `ViewState`.

Recommended per-tab state:
- `active_filter: Option<TabFilterState>` where `TabFilterState` stores:
  - `raw_pattern: String`,
  - `tokens: Vec<String>`.
- `filter_input: Option<FilterEditSession>` or equivalent, seeded from the current active filter when edit mode opens.

Important distinction:
- committed filter state drives list rendering;
- edit-session state drives the footer input widget.

### 3. Standardize the UIAction Entry Point
Add a dedicated filter-entry `AppUiAction` in `apps/holtburger-cli/src/types.rs`.

Recommended shape:
- `BeginTabFilterInput { tab: DashboardTab }`

Why this shape:
- It stays aligned with the existing split trigger pattern.
- It lets verb definitions remain declarative.
- It avoids adding four tab-specific action variants for identical behavior.

### 4. Keep Filtering as a Post-Selection Pass Over Canonical Tab Data
Do not build parallel alternate list constructors.

Instead:
- construct each tab's normal canonical item/line list first;
- determine which canonical rows/entities match;
- expand the included set with any required parent/context rows;
- emit the final list by iterating the canonical list in original order and retaining only included entries.

This is the core rule that preserves existing sort order and hierarchy.

### 5. Extend Footer Rendering to Support Three States
Dashboard footer rendering in `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs` should support:
- normal verb bar;
- editing footer input;
- active-filter footer: header line plus regular verbs-without-filter.

Recommended rendering model:
- when `footer_input()` is present, render the editor;
- otherwise ask the active tab for an optional footer header string;
- render verbs beneath it when present;
- when a filter is active, hide the rendered `Filter` verb without removing the underlying `f` shortcut from dispatch.

This keeps the action bar behavior aligned with the user request without coupling dashboard rendering to tab-specific filter state directly.

## Dry-Run Findings

### Confirmed Good News
- Footer-input key capture already exists in `apps/holtburger-cli/src/pages/game/input.rs`. Once a tab reports `footer_input()`, key events are routed there before normal dashboard/tab input, so no extra modal-routing work is required.
- Dashboard cursor plumbing already exists. `render_dashboard_pane(...)` returns cursor coordinates and `GameState::render(...)` already prefers that cursor over the chat input cursor, so text-mode filters do not need a separate cursor-ownership phase.
- Tab-local `AppUiAction` handling already exists and is routed through `DashboardState::handle_ui_action(...)`, so a filter-entry UI action fits the current architecture cleanly.

### Gaps / Surprises Found in the Real Code
1. Hidden filter verb vs. `f` reopen behavior
  - Current tab input resolves shortcuts by searching `get_verbs(...)`. If `Filter` is removed from that list while active, pressing `f` will stop working.
  - Plan correction: keep the filter shortcut in dispatch while hiding it only in footer rendering, or add an explicit `f` fast-path. Hiding in render is the lower-risk option.

2. Footer line budget is tighter than the spec implied
  - `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs` allocates `Constraint::Length(3)`, which gives one border row and two content rows.
  - That is enough for `header + verbs`, but it leaves no slack for wrapped verbs once a filter header is present. We should treat footer height as part of the implementation, not as free layout space.

3. Active-filter footer headers need a new tab trait hook
  - The plan already assumes the active tab can provide an optional footer header string, but `TabController` currently only exposes `get_verbs(...)`, `footer_input()`, and `handle_footer_input(...)`.
  - Plan correction: add a small generic tab hook such as `footer_header(...) -> Option<String>` rather than coupling dashboard rendering directly to specific tab types.

4. Selection and rendering currently rebuild lists independently
  - Nearby selection uses `get_entities(...)` in the tab file, while rendering independently calls the same helper from the render module.
  - Spells selection and rendering each build and sort their own spell lists separately.
  - Plan correction: each filtered tab needs one shared `visible_*` helper used by both selection/verb logic and rendering, otherwise filters will desync selection from what the user sees.

5. Semantic selection preservation is more expensive than simple clamping
  - Tabs currently persist only `selected_index`, not a stable selected entity/spell identifier.
  - Simple clamping is cheap. Preserving the exact semantic selection across filter transitions requires additional lookup/reselection logic and should be treated as optional polish unless we explicitly choose to pay that cost.

6. Test surface is sparse
  - `apps/holtburger-cli` currently has very little unit-test coverage outside `apps/holtburger-cli/src/pages/game/state.rs`.
  - The safest route is helper-first tests for tokenization, fuzzy matching, and visible-list reconstruction instead of trying to drive everything through a full `GameState` integration path.

## Implementation Phases

The dry run says the work should execute in small slices, but the phase structure itself does not need to mirror every slice. The phases below stay coarse and outcome-oriented; the execution checklist carries the fine-grained sequencing.

## Phase 1: Shared Footer Input Foundation (Complexity: Medium)
**Deliverables**
- Generalize `VerbInputKind`, `VerbInputState`, and `VerbInputEvent` for both quantity and free-text modes.
- Preserve current Split behavior unchanged at the state/event level.
- Update dashboard footer rendering to support both quantity and free-text inputs.
- Keep the existing dashboard cursor path intact.

**Files**
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs`

**Acceptance Criteria**
- The type layer can represent both quantity and free-text footer inputs.
- Existing Split parsing/validation behavior still works.
- Existing Split flow still works.
- Footer input can now accept arbitrary text when requested.
- No changes are required in `apps/holtburger-cli/src/pages/game/render.rs`; the existing dashboard cursor path continues to work.

## Phase 2: Filter Plumbing + Tab Session Wiring (Complexity: Medium)
**Deliverables**
- Add filter-entry `AppUiAction`.
- Add shared helper(s) for normalizing raw filter text into tokens and performing case-insensitive fuzzy matching.
- Add a small shared helper module if needed for token parsing and subsequence scoring.
- Add tab-local committed filter state and filter edit-session state for Nearby, Inventory, and Spells.
- Add the generic tab trait hook needed to supply footer header content.
- Add a clear strategy for keeping `f` active while the rendered `Filter` verb is hidden.

**Files**
- `apps/holtburger-cli/src/types.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/tab.rs`
- optional new helper under `apps/holtburger-cli/src/pages/game/panels/dashboard/` or `apps/holtburger-cli/src/utils.rs`

**Acceptance Criteria**
- All in-scope tabs can declare the same `[F]ilter` verb trigger shape.
- Matching/tokenization logic is not duplicated across tabs.
- Footer-input routing continues to use the existing `GameState::handle_input(...)` precedence model rather than adding a second routing mechanism.
- Each in-scope tab can enter and exit filter edit mode.
- Tabs can expose active-filter footer header content without dashboard type-switching.
- The hidden `Filter` verb still remains dispatchable via `f` when a filter is active.

## Phase 3: Footer/Header Active-Filter Presentation (Complexity: Medium)
**Deliverables**
- Render the active-filter header in the footer.
- Hide the regular `Filter` verb while a filter is active.
- Resolve the footer height/line-budget issue so `header + verbs` renders cleanly.

**Files**
- `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs`

**Acceptance Criteria**
- Active filter state is obvious from the footer.
- `f` still reopens editing when a filter is active.
- Footer content does not silently crop in the active-filter state.

## Phase 4: Nearby Hierarchical Filtering (Complexity: Medium-High)
**Deliverables**
- Add one shared visible-list helper for Nearby so render, selection, and verb resolution operate on the same filtered list.
- Filter the canonical Nearby entity list without changing root/child sort order.
- Include required ancestors for matched descendants.
- Clamp `selected_index` after filter changes; semantic selection preservation is optional follow-up polish.

**Files**
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/render.rs`

**Acceptance Criteria**
- Child matches always render with their ancestor path intact.
- Nearby still sorts roots by distance and children by name.
- Rendered rows and selected/acted-on rows always refer to the same filtered entity list.

## Phase 5: Inventory Hierarchical Filtering (Complexity: Medium-High)
**Deliverables**
- Add one shared visible-list helper for Inventory so render, selection, and verb resolution operate on the same filtered list.
- Filter the canonical Inventory entity list without changing sort order.
- Include required ancestors for matched descendants.
- Clamp `selected_index` after filter changes; semantic selection preservation is optional follow-up polish.

**Files**
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/render.rs`

**Acceptance Criteria**
- Child matches always render with their ancestor path intact.
- Inventory still sorts by formatted item name.
- Rendered rows and selected/acted-on rows always refer to the same filtered entity list.

## Phase 6: Spells Filtering (Complexity: Low-Medium)
**Deliverables**
- Add filter state and edit-session handling to the Spells tab.
- Add a shared visible spell list helper used by both `get_selected_spell_id(...)` and rendering.
- Filter spells from the already-sorted spell list.

**Files**
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/tab.rs`
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/render.rs`

**Acceptance Criteria**
- Spells remain alphabetically sorted after filtering.
- Rendered rows and selected/acted-on rows always refer to the same filtered spell list.

## Phase 7: Regression Coverage (Complexity: Low-Medium)
**Deliverables**
- Add focused tests for tokenization, fuzzy matching, active-filter footer state, and ancestor inclusion.

**Files**
- test locations adjacent to touched modules or in existing CLI test modules

**Acceptance Criteria**
- Core filtering rules are covered by tests instead of being left as manual-only behavior.

## Risks & Mitigations

### Risk: Footer input abstraction regresses Split
- Mitigation: keep quantity mode behavior covered by targeted regression tests and do Phase 1 before any filter-specific tab work.

### Risk: Fuzzy matching introduces surprising reordering
- Mitigation: treat matching as inclusion-only and always emit rows in canonical pre-filter order.

### Risk: Filter editing and active filter display become conflated
- Mitigation: keep committed filter state separate from edit-session state so cancel/clear semantics stay explicit.

### Risk: Selected index points past the end of a filtered list
- Mitigation: after any filter change, preserve the previously selected semantic item when still present; otherwise clamp to the nearest valid row, falling back to zero.

### Risk: Rendered verbs diverge from dispatchable shortcuts
- Mitigation: treat hiding `Filter` as a footer-render concern, not as removal from the actionable shortcut set.

## Complexity Summary

- Overall complexity: Medium-High.
- Main drivers:
  - shared footer-input generalization without regressing `Split`,
  - hierarchical ancestor reconstruction for Nearby and Inventory,
  - keeping render, selection, and verb resolution on the same filtered list,
  - footer layout constraints once an active-filter header is shown.
- Lowest-risk phases: Phase 1 and Phase 2.
- Highest-risk phases: Phase 4 and Phase 5.

## Execution Checklist

### Slice 1: Footer Input Foundation
- [x] Add `Text` support to `VerbInputKind`.
- [x] Extend `VerbInputEvent` so text submission does not require numeric parsing.
- [x] Update `VerbInputState` constructors/handlers for free-text input.
- [x] Verify Inventory Split still compiles and behaves the same.

### Slice 2: Footer Rendering Foundation
- [x] Teach `render_footer_text_input(...)` to render both quantity and text prompts.
- [x] Keep dashboard cursor placement correct for empty and non-empty text input.
- [x] Confirm no changes are needed in `GameState::render(...)`.

### Slice 3: Shared Filter Plumbing
- [x] Add `BeginTabFilterInput { tab: DashboardTab }` to `AppUiAction`.
- [x] Add shared raw-pattern normalization and token parsing helpers.
- [x] Add shared fuzzy subsequence helper.
- [x] Decide and implement the render-only hiding strategy for active `Filter` verbs.

### Slice 4: Tab Session Wiring
- [x] Add a generic footer-header hook to `TabController`.
- [x] Add committed filter state to Nearby, Inventory, and Spells tabs.
- [x] Add filter edit-session state to Nearby, Inventory, and Spells tabs.
- [x] Wire the filter `UIAction` into each in-scope tab.
- [x] Support reopen/edit/clear semantics, including `Esc` on already-active filters.

### Slice 5: Footer Active-Filter UX
- [ ] Render the active-filter header in the footer.
- [ ] Ensure the visible `Filter` verb disappears while active.
- [ ] Ensure `f` still works while active.
- [ ] Resolve the two-line footer budget cleanly.

### Slice 6: Nearby Visible-List Unification
- [ ] Build one filtered visible-list helper for Nearby.
- [ ] Reuse it for selection lookup, verb resolution, and render.
- [ ] Include ancestor chains for matching descendants.
- [ ] Clamp selection safely when the filtered list shrinks.

### Slice 7: Inventory Visible-List Unification
- [ ] Build one filtered visible-list helper for Inventory.
- [ ] Reuse it for selection lookup, verb resolution, and render.
- [ ] Include ancestor chains for matching descendants.
- [ ] Keep existing inventory sort and status rendering intact.

### Slice 8: Spells Visible-List Unification
- [ ] Build one filtered visible spell list helper.
- [ ] Reuse it for `get_selected_spell_id(...)` and render.
- [ ] Preserve alphabetical ordering.

### Slice 9: Regression Coverage
- [ ] Add unit tests for tokenization.
- [ ] Add unit tests for fuzzy subsequence matching.
- [ ] Add unit tests for Nearby/Inventory ancestor inclusion.
- [ ] Add targeted tests for active-filter footer behavior where practical.

## Definition of Done

- `[F]ilter` exists on Nearby, Inventory, and Spells when no filter is active.
- Triggering it opens a tab-local text input in the footer.
- `Enter` confirms a filter; empty confirmation clears it.
- Reopening filter edit and pressing `Esc` clears an existing filter.
- Active filters render a footer header like `[F]ilter: raw pattern`.
- The standalone `Filter` verb is hidden while a filter is active.
- Nearby and Inventory preserve ancestor chains for matching descendants.
- Spells remain alphabetically sorted.
- No tab reorders rows by match score.
- Split still works after the footer input generalization.

## Living Worksheet

### Task Checklist
- [x] Complete Phase 1.
- [x] Complete Phase 2.
- [ ] Complete Phase 3.
- [ ] Complete Phase 4.
- [ ] Complete Phase 5.
- [ ] Complete Phase 6.
- [ ] Complete Phase 7.

### Decisions Log
- Phase 1 uses a single `VerbInputState` for both quantity and text entry, with optional numeric bounds instead of a second parallel footer-input type.
- `VerbInputEvent` now distinguishes quantity and text submission explicitly, which keeps numeric flows type-safe while allowing empty text submission later for filter-clear semantics.
- Phase 2 keeps `Filter` in tab verb dispatch even when a filter is active; Phase 3 will hide it in footer rendering only, so `f` remains live without adding tab-specific shortcut fast paths.
- Phase 2 added tab-local `active_filter` plus `filter_input` session state to Nearby, Inventory, and Spells, and seeded reopened editors from the committed raw pattern.
- `Esc` in filter edit mode now clears the committed filter only when the editor was opened from an already-active filter; otherwise it behaves as a pure cancel.
- Default fuzzy behavior is case-insensitive subsequence matching, not substring-only matching.
- Multiple space-separated tokens combine by union.
- Filtering is inclusion-only and must never reorder a tab's canonical sequence.
- Active filter state is tab-local, not global.

### Verification Log
- 2026-03-10: `cargo check -p holtburger-cli` passed after Phase 1 changes.
- 2026-03-10: VS Code diagnostics reported no errors in `apps/holtburger-cli/src/types.rs`, `apps/holtburger-cli/src/pages/game/panels/dashboard/render.rs`, or `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`.
- 2026-03-10: `cargo check -p holtburger-cli` passed after Phase 2 filter plumbing and tab session wiring changes.
- 2026-03-10: VS Code diagnostics reported no errors in `apps/holtburger-cli/src/types.rs`, `apps/holtburger-cli/src/utils.rs`, `apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs`, `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs`, `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`, or `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/tab.rs`.

### Open Questions
- Do we want filter matching to stay limited to visible names/labels, or should Nearby/Inventory also match secondary metadata such as container status or item class names later?
- Should an active filter survive tab switches for the whole session, or should switching away from a tab clear it? This plan assumes filters persist in each tab until explicitly cleared.
- Do we want a tiny in-house subsequence matcher, or do we want to add a small dependency for scoring later if matching quality feels mid?