# Game State Event Reducer Refactor Plan

## 1. Context & Boundaries

### Goal

Refactor the game-page state layer so [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs) becomes a thin composition root over explicit action, ui-action, view-event, and tick reducers, while extending the action-first architecture where appropriate so meaningful imperative branches become `AppAction` or `AppUiAction` flows that are easier to script, test, and reason about.

### Why This Matters

The current `GameState` owns too many concerns at once:

- `ClientViewEvent` projection into local caches and view state.
- `AppAction` handling for gameplay, inventory, trade, combat, and interaction flows.
- `AppUiAction` handling for UI-local state.
- controller orchestration for navigation, combat automation, weapon swap, and tick-time behavior.
- context buffering and other presentation-adjacent refresh logic.

That all works, but it makes the file a giant imperative switchboard. A Deno scripting layer will want to emit stable intents, observe stable events, and rely on predictable reducers. It should not need intimate knowledge of `GameState` mutators or hidden sequencing rules.

### In Scope

- Split [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs) into focused reducer/orchestrator modules.
- Preserve and extend the external action loop centered on `AppAction`, `AppUiAction`, `UpdateResult`, and `ClientViewEvent`.
- Convert the game page toward an explicit reducer model where handlers are grouped by input type and domain responsibility.
- Make follow-up work visible through `UpdateResult` instead of hidden imperative chaining wherever practical.
- Promote meaningful imperative local branches into `AppAction` or `AppUiAction` flows when doing so improves semantic visibility, scriptability, or composability.
- Add tests that lock in the new seams and protect behavior during the extraction.

### Out Of Scope

- Adding the Deno runtime itself.
- Rewriting the terminal runtime loop in [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs).
- Moving TUI-owned logic into `holtburger-core` just to make the file smaller.
- Front-loading a full redesign of all existing `AppAction` and `AppUiAction` variants before the reducer seams are in place.
- Large UI rendering refactors unrelated to state/update flow.


### Optional Adjacent Scope

A focused cleanup of the global update pipeline may be worth doing if it directly improves reducer clarity, but it should stay narrowly scoped to [apps/holtburger-cli/src/update/app_event.rs](apps/holtburger-cli/src/update/app_event.rs), [apps/holtburger-cli/src/update/app_action.rs](apps/holtburger-cli/src/update/app_action.rs), and the action/result model in [apps/holtburger-cli/src/types.rs](apps/holtburger-cli/src/types.rs).

That means improving event normalization, effect draining, redraw policy ownership, or the action vocabulary when those changes let us surface intent more explicitly. It does not mean redesigning the async terminal loop, transport wiring, or draw throttling machinery in [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs).


## 2. Ground Truth & Existing Patterns

### Reference Sources

- [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs)
- [apps/holtburger-cli/src/types.rs](apps/holtburger-cli/src/types.rs)
- [apps/holtburger-cli/src/update/app_action.rs](apps/holtburger-cli/src/update/app_action.rs)
- [apps/holtburger-cli/ARCHITECTURE.md](apps/holtburger-cli/ARCHITECTURE.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [AGENTS.md](AGENTS.md)

### Existing Patterns To Reuse

- Page-level action delegation already exists in [apps/holtburger-cli/src/types.rs](apps/holtburger-cli/src/types.rs).
- Action draining already exists in [apps/holtburger-cli/src/update/app_action.rs](apps/holtburger-cli/src/update/app_action.rs).
- Smaller page-local action handlers exist in [apps/holtburger-cli/src/pages/selection/state.rs](apps/holtburger-cli/src/pages/selection/state.rs).
- Dashboard-local UI action delegation already exists in [apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs](apps/holtburger-cli/src/pages/game/panels/dashboard/state.rs).
- Slash-command parsing in [apps/holtburger-cli/src/pages/game/input/commands.rs](apps/holtburger-cli/src/pages/game/input/commands.rs) already demonstrates a partial action-first style, even though it still mixes in direct view/chat mutations.

### Global Loop Observations

- The high-level event loop in [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs) is mostly orchestration and batching. That part is not the main obstacle.
- The more meaningful seam is the split between `handle_app_event` in [apps/holtburger-cli/src/update/app_event.rs](apps/holtburger-cli/src/update/app_event.rs) and `handle_app_action` in [apps/holtburger-cli/src/update/app_action.rs](apps/holtburger-cli/src/update/app_action.rs).
- `UpdateResult` currently mixes commands, follow-up actions, and redraw requests, which is workable but keeps intent reduction and side-effect execution coupled.
- Input redraw policy is partially global and partially local today. That is fine operationally, but it muddies ownership when trying to reason about reducers.

### Naming Collision Watchlist

We need to be deliberate with new names, because several attractive words are already heavily loaded elsewhere in the workspace.

High-risk collision terms:

- `context`
  - already overloaded between [apps/holtburger-cli/src/pages/game/panels/context.rs](apps/holtburger-cli/src/pages/game/panels/context.rs) and `WorldContext` in [crates/holtburger-world/src/context.rs](crates/holtburger-world/src/context.rs)
- `controller` and `controllers`
  - already a first-class term in `holtburger-core` for reusable higher-level behaviors; a TUI subsystem called just `controllers` may be confused with the shared controller kernel described in [crates/holtburger-core/ARCHITECTURE.md](crates/holtburger-core/ARCHITECTURE.md)
- `projection`
  - already used across world/runtime-body motion sampling and broader frontend view projection language, so a TUI-local `projection` subsystem must not sound like it owns authoritative spatial projection
- `interaction`
  - already the name of the app-facing enum in [apps/holtburger-cli/src/types.rs](apps/holtburger-cli/src/types.rs), so a subsystem using the same bare name may blur type versus policy ownership
- `update`
  - already used at the app shell level in [apps/holtburger-cli/src/lib.rs](apps/holtburger-cli/src/lib.rs); a nested `pages/game/update/` is acceptable, but references must stay explicit to avoid confusion with the top-level app update pipeline

Medium-risk collision terms:

- `runtime`
  - easily confused with core runtime ownership versus TUI-local runtime helpers
- `view`
  - easily confused with `ClientViewEvent`, `ViewState`, and rendering concerns
- `state`
  - already extremely overloaded; avoid new modules whose names add no extra semantic signal beyond `state`

### Naming Rules

- Prefer names that state the ownership and role together, not just the domain noun.
- Prefer `*_policy`, `*_reducer`, `*_projection`, `*_coordination`, or `*_notifications` over bare generic nouns when the bare noun already exists elsewhere.
- Use `tui_` or `game_` prefixes only when they genuinely reduce ambiguity; do not spam prefixes everywhere.
- Avoid naming a TUI-local subsystem after a term that already implies shared cross-client meaning in `holtburger-core` or `holtburger-world`.
- When a subsystem mainly adapts existing core controllers, name it as coordination or orchestration rather than another controller layer.

### Preferred Naming Direction

These names are less collision-prone than the current shorthand in this plan:

- use `interaction_policy` or `interaction_reducer` instead of bare `interaction` when referring to the subsystem layer
- use `view_projection` or `event_projection` instead of bare `projection` when referring to TUI-local cache/view updates
- use `controller_coordination` or `frontend_control` instead of bare `controllers` when referring to the TUI-owned orchestration layer
- use `context_view` or `context_buffering` instead of bare `context` when referring to TUI panel/view logic
- use `inventory_notifications` instead of bare `notifications` when the scope is specifically item ownership and chat logging

### Naming Decision Requirement

Before landing any new subsystem or module, sanity-check:

- Could a reviewer confuse this with an existing `holtburger-core` controller concept?
- Could a reviewer confuse this with `WorldContext`, runtime-body projection, or an existing panel module?
- Does the name tell us whether the module owns policy, data projection, rendering support, or orchestration?
- If the name appeared alone in a PR title, would it be clear which layer of the stack it belongs to?

### Action-First Expansion Heuristics

Good candidates to promote into `AppAction` or `AppUiAction` flows:

- transitions that scripts may want to trigger directly
- branches that currently emit multiple commands or mutate several local state fields in a coordinated way
- policy decisions that already have preconditions, logging, redraw behavior, or follow-up actions
- behavior that benefits from composition via `Sequence` or future effect draining

Poor candidates to promote into new actions:

- trivial one-field local bookkeeping with no meaningful semantic boundary
- purely internal helper steps that are easier to understand as reducer-private functions
- action variants that would only ever have one call site and no scripting or testing value

### Test Retention Policy

This refactor should preserve useful behavioral coverage without letting tests punch holes through the architecture.

- Keep an existing test where it is unless ownership actually moved.
- Move a test only when the behavior it verifies now clearly belongs to a different reducer, subsystem, or module boundary.
- Do not copy a test into a new module just to make the new module feel “covered.” Either move it, rewrite it around the new owner, or delete it if it no longer tests a meaningful contract.
- Prefer testing a module through its real public or reducer-facing surface rather than exposing new internals or adding broader visibility just to satisfy old assertions.
- If a test can only be preserved by reaching across subsystem boundaries or inspecting unrelated internal state, treat that as a sign the test should be rewritten or dropped.
- Favor contract-level assertions over incidental implementation details such as helper ordering, temporary intermediate fields, or exact internal branching.
- Avoid over-specifying `UpdateResult` contents when only part of the result is semantically important. Assert only the commands, actions, redraws, or state transitions that define the contract under test.
- Prefer a small number of well-named scenario tests per reducer seam over large volumes of near-duplicate branch tests.
- When extracting a subsystem, add new tests only for behavior that became newly isolated or newly legible. Do not duplicate old end-to-end-ish tests and subsystem-level tests for the same contract without a clear reason.
- Treat test-only visibility expansion as a design smell. If a test requires `pub(crate)` creep or cross-module peeking, revisit the test boundary before changing production visibility.

### Responsibility Clusters Identified In `state.rs`

- View-event reducers: chat events, player projections, entity projections, vendor/trade/fellowship updates, navigation interrupts.
- Action reducers: interaction actions, combat actions, inventory/equipment actions, trade/vendor actions, context/detail actions.
- UI-local reducers: confirmation modals, dashboard tab changes, context-view changes.
- Tick orchestrators: enchantment aging, combat automation refresh, weapon-swap synchronization, navigation ticking, logopolis ticking.
- Shared helpers: interaction transitions, inventory ownership/equipment tracking, context refresh triggers.

### Architecture Direction Clarification

“Preserve the action loop” should not mean freezing today’s action surface in place. The stronger direction is:

- keep the app-level action pipeline as the organizing mechanism
- extend `AppAction` and `AppUiAction` where that lets us replace imperative local branching with explicit intent transitions
- avoid inventing actions for trivial one-line bookkeeping that gains nothing from scripting, testing, or composition

The target is not maximum action count. The target is better semantic visibility for meaningful transitions.

### Dry-Run Findings

Running the plan against the codebase surfaced several important adjustments:

- The plan cannot stop at [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs). [apps/holtburger-cli/src/pages/game/input.rs](apps/holtburger-cli/src/pages/game/input.rs) and [apps/holtburger-cli/src/pages/game/input/commands.rs](apps/holtburger-cli/src/pages/game/input/commands.rs) still perform a large amount of direct `ViewState`, `ChatState`, and `ChatInputState` mutation.
- The game page already has two update styles living side by side: some paths emit `AppAction` or `AppUiAction`, while others mutate `self.view`, `self.chat_input`, or `self.chat` directly. Any refactor that only cleans up `state.rs` will leave that split-brain model in place.
- [apps/holtburger-cli/src/pages/game/render.rs](apps/holtburger-cli/src/pages/game/render.rs) contains render-adjacent state mutation in `update_layout`, including layout-cache updates and context-scroll clamping. That means the final architecture will still have at least one legitimate mutation path outside reducer modules unless we explicitly re-home layout-state maintenance.
- The proposed `controller_coordination` seam should own orchestration only. It should not absorb existing controller implementations such as [apps/holtburger-cli/src/navigation.rs](apps/holtburger-cli/src/navigation.rs) or [apps/holtburger-cli/src/pages/game/weapon_swap.rs](apps/holtburger-cli/src/pages/game/weapon_swap.rs) into a new giant local framework.
- `context_buffering` looks weaker after the dry run than it did in the abstract. Much of the relevant behavior is either reducer-triggered invalidation or render-time display preparation, which suggests it may remain a helper module or fold into `event_projection` plus render support rather than survive as a subsystem.
- A separate transient UI-state seam is more real than the plan currently acknowledges. Focus changes, scroll offsets, confirmation overlays, chat-input history, and command-submission cleanup are currently spread across input and state handlers.

### Dry-Run Consequences

- The refactor scope should explicitly include game-page input/update files, not just `state.rs`.
- The reducer split should be paired with a narrower pass over transient UI-state transitions in [apps/holtburger-cli/src/pages/game/input.rs](apps/holtburger-cli/src/pages/game/input.rs).
- We should keep `UpdateResult` unified for this refactor. Splitting reducer output versus effects right now would create more churn across input, page, and app-shell layers than the current dry run justifies.
- The future script API should likely target a script-facing intent layer that compiles into `AppAction` and `AppUiAction`, rather than exposing the raw enums as the long-term public contract.

### Reassessment Rule

This plan should stay intentionally fluid, but only at explicit reassessment points rather than through constant scope drift.

- Treat each phase boundary as a decision gate, not an automatic march to the next section.
- After each phase, re-evaluate whether the newly exposed seams still justify the next planned extraction.
- Prefer changing later phases over forcing the code to match an outdated earlier guess.
- Do not reopen already-stable decisions unless implementation uncovers a concrete contradiction, hidden coupling, or materially better seam.
- Capture reassessment outcomes in the Decisions Log so the plan evolves visibly instead of informally.

## 3. Target Shape

The desired end state is not “many helper methods.” It is an explicit reducer surface.

We should also be willing to introduce a small number of domain-scoped subsystems when they represent stable policy owners rather than just file organization. If a subsystem meaningfully owns a domain contract, lifecycle, and tests, that is cleaner than forcing all policy through one giant reducer layer.

Illustrative expanded module shape under `apps/holtburger-cli/src/pages/game/` after the first reducer extraction:

- `state.rs`
  - owns `GameState`, `ViewState`, `GameRuntimeState`, `GameRenderState`
  - delegates by input kind only
- `update/mod.rs`
  - shared reducer exports
- `update/action.rs`
  - `reduce_action(state, action) -> Option<UpdateResult>`
- `update/ui_action.rs`
  - `reduce_ui_action(state, action) -> UpdateResult`
- `update/view_event.rs`
  - `reduce_view_event(state, event) -> UpdateResult`
- `update/tick.rs`
  - `reduce_tick(state, elapsed) -> UpdateResult`
- `update/interaction_policy.rs`
  - shared interaction transition rules, cancel/resume attack semantics, target-health query syncing
- `update/event_projection.rs`
  - `ClientViewEvent` projection into local mirrors, inventory/equipment ownership, and context invalidation
- `update/inventory_notifications.rs`
  - inventory-notification arming, quiet-period policy, and user-facing inventory change logging
- `update/controller_coordination.rs`
  - combat automation, navigation, weapon-swap orchestration

If borrow pressure makes this awkward, prefer reducer structs or free functions that take `&mut GameState` plus small helper inputs. Do not create a second shadow state type just to appease the borrow checker.

These filenames are still illustrative rather than mandatory. The important point is that later domain modules should follow the collision-avoidance rules above instead of falling back to overloaded names like `controllers` or bare `interaction`.

### Recommended Initial Module Layout

Phase 1 should start with the narrowest layout that gives us an explicit reducer seam without forcing premature domain foldering.

- Start with only these new files under `pages/game/update/`:
  - `mod.rs`
  - `action.rs`
  - `ui_action.rs`
  - `view_event.rs`
  - `tick.rs`
- Keep `input.rs`, `input/commands.rs`, and `render.rs` where they are during the first extraction pass.
- Keep domain-specific helper moves conservative in Phase 1. If a helper is still shared by multiple reducers, leave it in `state.rs` temporarily or move it into `update/mod.rs` as a clearly temporary shared helper.
- Defer domain submodules such as `interaction_policy`, `event_projection`, `controller_coordination`, and `inventory_notifications` until after the basic reducer split compiles cleanly and the real ownership seams are visible.
- Treat `context_buffering` as opt-in only after extraction proves it owns more than invalidation glue.

### Preferred Subsystem Roles

These are good candidates if the extraction exposes clear domain ownership. The names below are conceptual roles, not final module names.

- `interaction_policy`
  - owns interaction transition policy, target acquisition/release rules, target-health query synchronization, and interaction-driven combat cancellation/resume behavior
- `event_projection`
  - owns `ClientViewEvent` projection into local TUI caches such as player state, entity mirrors, inventory/equipment ownership, vendor/trade/fellowship projections, and context invalidation triggers
- `controller_coordination`
  - owns frontend-only controller orchestration for navigation, combat automation, weapon swap, and tick-time coordination
- `context_buffering`
  - owns context-panel state transitions, refresh invalidation, and any derived context buffering rules that are currently scattered through event/action handlers
- `inventory_notifications`
  - owns inventory-notification arming, quiet-period policy, and user-facing inventory change logging

These should stay inside the TUI crate unless we can prove the behavior is actually reusable by both the TUI and the future 3D client.

### Likely Keepers vs Likely Fold Candidates

Based on the current module layout, not every extracted area should survive as a standalone subsystem.

Likely durable subsystem candidates:

- `interaction_policy`
  - real cross-cutting policy owner spanning action handling, navigation cancellation, targeting transitions, and combat resume/cancel semantics
- `event_projection`
  - real owner for `ClientViewEvent` to local-cache/view projection logic
- `controller_coordination`
  - likely durable because navigation, combat automation, and weapon swap already behave like orchestrated frontend controllers rather than incidental helpers
- `inventory_notifications`
  - potentially durable if inventory notification arming/logging remains a coherent user-facing policy surface

Likely thin or vestigial candidates after the refactor:

- `context_buffering`
  - may end up too small if it only owns buffer refresh and context-view invalidation; if so, fold it into a `view_state` or `event_projection` domain instead of preserving a tiny subsystem
- standalone `salvaging`
  - the current salvage helpers in [apps/holtburger-cli/src/pages/game/salvaging.rs](apps/holtburger-cli/src/pages/game/salvaging.rs) are currently narrow `GameData` queries; after extraction they may fit better inside inventory logic or `interaction_policy` rather than surviving as their own subsystem
- standalone `combat` state holder
  - [apps/holtburger-cli/src/pages/game/combat.rs](apps/holtburger-cli/src/pages/game/combat.rs) contains useful runtime state, but a future split may leave only a tiny state machine plus a presentation label helper; if that happens, keep the state machine and fold the label or thin wrappers elsewhere
- reducer-only “subsystems” that are just namespaced free functions
  - if a proposed subsystem has no owned policy, no local invariants, and no separate tests, it is probably just a folder and should be folded back into a reducer module

Current module-specific read on pruning risk:

- [apps/holtburger-cli/src/pages/game/weapon_swap.rs](apps/holtburger-cli/src/pages/game/weapon_swap.rs)
  - low pruning risk; it already looks like a legitimate controller with lifecycle, local state, and tests
- [apps/holtburger-cli/src/pages/game/combat.rs](apps/holtburger-cli/src/pages/game/combat.rs)
  - medium pruning risk; the runtime attack-state machine is real, but adjacent helpers may be better colocated with presentation or controller code
- [apps/holtburger-cli/src/pages/game/salvaging.rs](apps/holtburger-cli/src/pages/game/salvaging.rs)
  - high pruning risk as a standalone module; likely better folded into inventory or interaction policy unless salvage behavior grows materially

### Subsystem Rules

- Introduce a subsystem only when it has clear policy ownership, not just many lines of code.
- Prefer one subsystem per domain boundary, not one subsystem per enum variant family.
- A subsystem may own its own internal state if that state already exists conceptually, but it should not become a parallel source of truth for data already owned by `GameData`, `ViewState`, or world-derived mirrors.
- Subsystems should communicate through explicit reducer inputs and emitted `UpdateResult` effects, not ad hoc backreferences or hidden cross-calls.
- If two subsystems need to coordinate frequently, define their seam in one place rather than letting them reach into each other opportunistically.
- Every subsystem proposal should include an explicit answer to: if this ends up owning less than one coherent policy surface, where will it be folded instead?

## 4. Phased Implementation

### Phase 1: Establish The Reducer Boundary

#### Deliverables

- Add a `pages/game/update/` module tree.
- Move the bodies of `handle_action`, `handle_ui_action`, `handle_view_event`, and `handle_tick` behind reducer functions while keeping the public `GameState` methods intact.
- Keep behavior unchanged; this phase is mostly structural.

#### Files

- [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs)
- new files under `apps/holtburger-cli/src/pages/game/update/`
- possibly [apps/holtburger-cli/src/pages/game/mod.rs](apps/holtburger-cli/src/pages/game/mod.rs) if module exports need adjustment

#### Acceptance Criteria

- `GameState::{handle_action, handle_ui_action, handle_view_event, handle_tick}` become thin delegators.
- No behavior change in existing tests.
- The new module boundaries are obvious from filenames and symbols.

#### Reassessment Checkpoint

Before moving past Phase 1, confirm:

- the reducer seam is actually buying clarity rather than just file movement
- any helpers left in [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs) are there for real temporary reasons rather than avoidance
- the next split should still start with `AppAction` and not jump prematurely into input or render cleanup

#### Recommended Extraction Order

1. Add `pages/game/update/mod.rs` plus the four top-level reducer files: `action.rs`, `ui_action.rs`, `view_event.rs`, and `tick.rs`.
2. Move the bodies of `GameState::{handle_action, handle_ui_action, handle_view_event, handle_tick}` into those files with minimal internal reshaping and keep any still-shared helpers close to the reducer that currently needs them.
3. Convert the original methods in [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs) into thin delegators only after the moved reducer bodies compile.
4. Keep public signatures and `UpdateResult` behavior unchanged while the extraction is still structural.
5. Only after the top-level reducer seam is stable, start splitting `action.rs` and `view_event.rs` into domain-oriented helper modules.
6. Leave [apps/holtburger-cli/src/pages/game/input.rs](apps/holtburger-cli/src/pages/game/input.rs), [apps/holtburger-cli/src/pages/game/input/commands.rs](apps/holtburger-cli/src/pages/game/input/commands.rs), and [apps/holtburger-cli/src/pages/game/render.rs](apps/holtburger-cli/src/pages/game/render.rs) in place during Phase 1 except for import or delegation fallout; they become first-class targets in later phases rather than hidden collateral churn.

### Optional Phase 1.5: Tighten The Global Update Pipeline

#### When To Do This

Do this only if Phase 1 exposes friction that comes from the app-level pipeline rather than from `GameState` itself.

#### Deliverables

- Clarify the responsibility split between raw event routing and action draining.
- Decide whether `UpdateResult` should remain one bag of outputs or evolve toward a clearer distinction between:
  - emitted intents/actions
  - client commands
  - redraw requests
- Remove any avoidable special-casing that forces page reducers to know too much about app-global redraw or drain behavior.
- Determine whether any currently imperative app-shell behaviors should also be surfaced through explicit actions rather than hidden control flow.

#### Recommended Constraints

- Keep `AppEvent -> UpdateResult` and `AppAction -> UpdateResult` as the public app-level contract unless there is a compelling reason to widen it.
- Avoid changing the async polling loop in [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs) during this refactor.
- Prefer changes that make script integration cleaner, such as a more explicit action/effect boundary, over changes that merely reshuffle control flow.

#### Acceptance Criteria

- Page reducers have a clearer contract with the app shell.
- The app shell does less semantic interpretation of page-local behavior.
- Any pipeline change reduces coupling instead of introducing another abstraction layer.

#### Reassessment Checkpoint

Before keeping any Phase 1.5 changes, confirm they reduced a concrete reducer-boundary problem exposed by implementation. If they mainly reshuffled app-shell control flow without simplifying page reducers, cut or defer them.

### Phase 2: Extract Domain Reducers From The Action Switch

#### Deliverables

- Split `AppAction` handling by domain instead of one monolithic `match`.
- Identify imperative local branches that should become explicit `AppAction` or `AppUiAction` flows rather than staying hidden inside reducer internals.
- Likely subreducers:
  - `interaction_actions`
  - `inventory_actions`
  - `combat_actions`
  - `trade_actions`
  - `detail_actions`
- Centralize the action-to-navigation translation so action handlers do not each need to know when to cancel or preserve frontend-owned navigation.

#### Notes

This phase is where the Deno-prep value starts showing up. Each reducer becomes an explicit intent surface the script adapter can eventually target.

#### Acceptance Criteria

- `handle_action` no longer contains the big gameplay switch.
- Each action domain has focused tests or preserves existing tests with clearer ownership.
- `Sequence` handling remains consistent with the existing app-level action-drain pattern.
- Newly promoted actions correspond to real semantic transitions, not mechanical over-modeling.

#### Test Retention Guidance

- Keep broad behavior tests near the current [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs) seam until a narrower owner is genuinely stable.
- When extracting an action domain, move only the tests that now read more naturally against that domain reducer than against `GameState`.
- Do not duplicate existing `GameState` tests and new domain-reducer tests for the same contract unless the two tests protect different layers.

#### Reassessment Checkpoint

Before promoting domains into subsystems, confirm which extracted action areas still feel like coherent policy owners versus plain reducer slices. If a domain is readable and stable as a reducer file, do not promote it just to satisfy the plan outline.

### Phase 2.5: Promote Stable Domains Into Subsystems

#### When To Do This

Do this for domains that still feel awkward after reducer extraction, especially where a domain has both event-driven and action-driven policy plus local runtime coordination.

#### Deliverables

- Promote the highest-value extracted domains into dedicated TUI subsystems.
- Likely first candidates:
  - `interaction_policy`
  - `event_projection`
  - `controller_coordination`
  - `inventory_notifications`
- Treat `context_buffering` as provisional; keep it only if it retains real policy after extraction.
- Give each subsystem a small, explicit surface instead of letting it sprawl as miscellaneous helpers.

#### Acceptance Criteria

- Subsystems correspond to real domain ownership, not arbitrary foldering.
- Cross-domain coupling is reduced relative to the original `GameState`.
- Tests can target subsystem behavior without booting the entire game page for every case.

#### Reassessment Checkpoint

Before Phase 2.6, explicitly review whether each proposed subsystem still deserves to exist. This is the point where planned subsystem candidates are most likely to prove unnecessary.

### Phase 2.6: Prune Or Fold Thin Subsystems

#### Deliverables

- Review each newly introduced subsystem after the first extraction pass.
- Identify domains that ended up too thin, purely delegating, or lacking independent policy.
- Fold those domains back into a better owner rather than preserving them for symmetry.

#### Review Questions

- Does this subsystem own real policy or only forward calls?
- Does it have state, invariants, or tests that justify its existence?
- Would another subsystem become clearer if this one were folded into it?
- Is this module only surviving because it existed during the refactor transition?

#### Acceptance Criteria

- Thin wrappers are removed or folded.
- The final architecture reflects stable ownership, not temporary migration scaffolding.
- The module tree is smaller and clearer than the naive “one folder per concern” outcome.

#### Test Retention Guidance

- When a thin subsystem is folded away, fold or delete its tests too; do not leave orphan tests asserting a boundary that no longer exists.
- If the best remaining test for a behavior is again a higher-level reducer or `GameState` scenario, prefer that over keeping an artificial subsystem test alive.

### Phase 3: Extract View-Event Projection Reducers

#### Deliverables

- Split `ClientViewEvent` handling into focused projection reducers.
- Separate pure projection from controller follow-up where possible.
- Make event-caused follow-up work explicit, for example:
  - entity projection update
  - inventory/equipment projection refresh
  - context invalidation
  - controller resynchronization
  - UI action emission

#### Recommended Slices

- `player_events`
- `entity_events`
- `social_events`
- `trade_vendor_events`
- `runtime_body_events`
- `navigation_interrupts`

#### Acceptance Criteria

- `handle_view_event` is primarily dispatch and post-processing.
- Event-driven state changes can be reasoned about without scanning unrelated combat or UI code.
- Existing event behavior remains locked by tests, especially around trade/vendor tab changes, targeting cleanup, and inventory notifications.

#### Reassessment Checkpoint

Before continuing into broader UI-state cleanup, confirm whether event projection exposed any stronger ownership for `context_buffering`, layout invalidation, or inventory-notification policy. Adjust later module plans based on what the event split actually revealed.

### Phase 3.5: Normalize Transient UI-State Mutation

This phase depends on the basic `ui_action` reducer seam from Phase 1, but it does not need to wait for every view-event extraction task in Phase 3 to finish. If useful, it can begin once the UI reducer boundary is stable.

#### Deliverables

- Audit [apps/holtburger-cli/src/pages/game/input.rs](apps/holtburger-cli/src/pages/game/input.rs) and [apps/holtburger-cli/src/pages/game/input/commands.rs](apps/holtburger-cli/src/pages/game/input/commands.rs) for direct mutation of focus state, scroll offsets, confirmation overlays, and chat-input session state.
- Promote durable UI transitions into explicit `AppUiAction` flows, especially when scripts may want to trigger them or when they coordinate multiple local state changes.
- Keep high-frequency, low-semantic UI bookkeeping such as character-by-character editing, cursor movement, and trivial scroll nudges as reducer-private UI-state helpers.
- Consolidate repeated command-submission cleanup behavior such as restoring focus and maintaining chat-input history.

#### Current Candidate Split

Likely `AppUiAction` candidates based on the current input path:

- input-mode entry and exit transitions, including saving/restoring `previous_focused_pane`
- pane-focus cycling and other durable focus-mode changes currently driven by `Tab`, `BackTab`, `Esc`, and input submission paths
- local confirmation lifecycle transitions, especially opening, accepting, and dismissing overlays that already represent named UI modes
- command-submission finalization currently centralized in `finish_input_command_submission`, because it coordinates input history, history cursor reset, and focus restoration
- context-view mode changes such as entering or leaving Logopolis, which already read as stable UI intents rather than raw widget bookkeeping

Likely reducer-private UI helpers that should remain local for responsiveness:

- character-by-character input editing via `chat_input.input.apply_key(...)`
- chat-input history traversal with `Up` and `Down`
- fine-grained chat scroll and context scroll updates from arrow keys, page keys, mouse wheel, `Home`, and `End`
- chat view toggles on `1` and `2` while the chat pane is focused, unless future scripting gives us a real reason to expose them as stable intents
- dashboard tab footer keystroke handling and other widget-local editing flows that already behave like direct control manipulation

Borderline cases that should stay explicit during implementation review:

- active-character confirmation response handling in [apps/holtburger-cli/src/pages/game/input.rs](apps/holtburger-cli/src/pages/game/input.rs), because it mixes overlay dismissal with command emission
- `Esc` behavior that may either leave input mode, clear Logopolis context view, or cancel an active interaction depending on state
- slash commands that both emit gameplay effects and mutate local UI session state, since they may want a split between gameplay intent and shared submission cleanup

#### Acceptance Criteria

- The game page no longer has two equally important update styles competing with each other.
- Transient UI-state transitions have a clear ownership model.
- Input handling remains responsive without forcing every tiny keystroke into the global action pipeline.

#### Reassessment Checkpoint

Before widening `AppUiAction` further, confirm that newly promoted UI transitions improved semantic clarity or reuse. If a transition still feels like glorified widget bookkeeping after extraction, keep it local.

### Phase 4: Extract Tick-Time Controllers And Runtime Coordination

#### Deliverables

- Move tick-time logic into a dedicated coordinator module.
- Separate three categories clearly:
  - deterministic local projection maintenance
  - controller ticks that emit commands
  - presentation-side ticking such as logopolis
- Encapsulate combat automation, weapon-swap sync, and navigation tick sequencing in one place.

#### Acceptance Criteria

- `handle_tick` becomes a short orchestration wrapper.
- Controller ordering is documented and tested.
- The refactor does not regress sticky melee, navigation cancellation, or weapon-swap reentry behavior.

#### Reassessment Checkpoint

Before treating `controller_coordination` as a durable subsystem, confirm it is coordinating existing controllers rather than accreting unrelated tick helpers into a new god module.

### Phase 5: Introduce Script-Friendly Intent Rules And Cleanup

#### Deliverables

- Audit `GameState` helper methods and classify them as either:
  - reducer internals
  - domain utilities
  - script-safe intent entrypoints
- Reduce direct state mutation from scattered helper methods when the mutation is really an action or event transition.
- Document which state transitions are only reachable via `AppAction`, `AppUiAction`, `ClientViewEvent`, or tick reducers.
- Add a short architecture note explaining how future script bindings should inject actions and consume emitted results.

#### Notes

The dry run suggests the script surface should compile into `AppAction` and `AppUiAction` rather than expose every raw enum variant directly. That gives us room to stabilize the scripting contract without freezing every app-internal action as public API.

#### Acceptance Criteria

- There is a clear answer to “how does external code interact with the game page safely?”
- New contributors do not need to call arbitrary mutators to drive gameplay behavior.
- The remaining imperative helpers are implementation details, not the public mental model.

#### Reassessment Checkpoint

At the end of the refactor, re-check the whole plan against the resulting codebase and delete any plan artifacts that no longer describe reality. The final architecture note should document the system we actually built, not the intermediate plan vocabulary.

## 5. Risks & Mitigations

### Risk: The refactor becomes file shuffling without improving semantics

Mitigation:

- Require each extraction to map to a reducer category or domain boundary.
- Reject helper modules that are just “misc.rs” in disguise.

### Risk: New subsystems become mini-god-objects

Mitigation:

- Keep subsystem surfaces small and domain-specific.
- Do not let a subsystem own unrelated concerns just because they happen to be called together today.
- Prefer composition of reducers and helpers inside a subsystem over another giant public manager type.

### Risk: Temporary extraction scaffolding calcifies into permanent vestigial layers

Mitigation:

- Add an explicit prune/fold review pass before calling the refactor done.
- Prefer deleting a subsystem over preserving a symmetry that no longer buys clarity.
- Track likely fold candidates early so we do not rationalize them into permanence later.

### Risk: We preserve too much imperative branching and miss the scripting payoff

Mitigation:

- During extraction, explicitly review whether each multi-step branch is better expressed as an action flow.
- Prefer promoting meaningful semantic transitions into `AppAction` or `AppUiAction` when that improves observability and composition.
- Do not stop at “same behavior, smaller files” if a clearer action boundary is obvious.

### Risk: Borrow-checker friction causes a bad abstraction layer

Mitigation:

- Prefer reducers that operate on `&mut GameState` directly.
- Only introduce smaller context structs when they encode a real semantic boundary.
- Do not duplicate `GameData`, `ViewState`, or runtime ownership into parallel temporary models.

### Risk: The refactor cleans up `state.rs` but leaves imperative input/update seams untouched

Mitigation:

- Explicitly include [apps/holtburger-cli/src/pages/game/input.rs](apps/holtburger-cli/src/pages/game/input.rs) and [apps/holtburger-cli/src/pages/game/input/commands.rs](apps/holtburger-cli/src/pages/game/input/commands.rs) in the migration plan.
- Treat transient UI-state mutation as a first-class seam, not a footnote.
- Do not call the refactor complete while focus, confirmation, scroll, and input-session rules still live in ad hoc imperative branches.

### Risk: Hidden behavior regressions during extraction

Mitigation:

- Preserve and expand the existing tests already concentrated in [apps/holtburger-cli/src/pages/game/state.rs](apps/holtburger-cli/src/pages/game/state.rs).
- When moving tests, keep them colocated with the reducer module they verify.
- Treat the combat/navigation inventory tests as the non-negotiable safety net.

### Risk: Test migration leaks abstractions and forces bad visibility

Mitigation:

- Apply the test retention policy above: move tests only when ownership moved, never by copy-paste default.
- Prefer rewriting tests around stable reducer contracts instead of preserving brittle internal assertions.
- Reject production visibility changes whose only justification is keeping an old test shape alive.

### Risk: We accumulate over-specified or low-value tests during the refactor

Mitigation:

- Review new tests for contract relevance before keeping them.
- Delete tests that only restate implementation details, helper wiring, or temporary extraction scaffolding.
- Prefer fewer scenario tests with clear semantic intent over exhaustive but low-signal assertion lists.

### Risk: Global-loop cleanup balloons into framework churn

Mitigation:

- Treat app-level pipeline work as optional and subordinate to the `GameState` reducer split.
- Only change the global pipeline if it removes a concrete reducer boundary problem.
- Avoid touching [apps/holtburger-cli/src/bin/tui.rs](apps/holtburger-cli/src/bin/tui.rs) unless a defect or duplicated policy makes it necessary.

### Risk: The scripting goal pressures us into moving TUI-specific logic into shared crates

Mitigation:

- Keep frontend control policy in the TUI.
- Only move logic out of the TUI if it is genuinely reusable by both the TUI and a future 3D client.
- Re-check changes against [AGENTS.md](AGENTS.md) crate-boundary guidance before moving code across crates.

### Risk: `AppAction` becomes an untyped dumping ground

Mitigation:

- Group reducers by domain and document the intended producer/consumer paths.
- Prefer explicit variants over generic payload blobs.
- Defer any “script command” umbrella action until concrete scripting needs exist.

## 6. Definition Of Done

- `GameState` is a thin composition root, not the primary location of domain behavior.
- The main game-page update logic is split by input kind and domain responsibility.
- The dominant mental model is event/action reduction plus emitted `UpdateResult`, not direct mutator choreography.
- Existing behavior remains intact for combat, navigation, trade/vendor, interaction, and inventory-notification flows.
- Existing behavior remains intact for combat, navigation, trade/vendor, interaction, and inventory notification flows.
- Tests cover the reducer seams well enough that future scripting work can add new action producers without fear.
- A short documentation note exists describing the action-first integration model for future script bindings.

## 7. Living Worksheet

### Reassessment Note Template

When a phase checkpoint triggers a reassessment, record it in a compact form:

- Phase:
- What changed in our understanding:
- Decision kept, changed, or dropped:
- Impact on later phases:
- Follow-up validation needed:

Keep these notes short and decision-oriented. The goal is to make plan drift auditable, not to maintain a second narrative document.

### Task Checklist

- [ ] Create `pages/game/update/` and move top-level reducers behind it.
- [ ] Extract `AppAction` handling into domain reducers.
- [ ] Extract `AppUiAction` handling into a dedicated reducer.
- [ ] Audit imperative branches for promotion into `AppAction` or `AppUiAction` flows.
- [ ] Extract `ClientViewEvent` projection into domain reducers.
- [ ] Normalize transient UI-state mutation in `input.rs` and `input/commands.rs`.
- [ ] Extract tick/controller orchestration into a dedicated reducer.
- [ ] Consolidate shared interaction transition helpers.
- [ ] Consolidate inventory/equipment projection helpers.
- [ ] Review extracted domains for vestigial subsystem risk.
- [ ] Fold or delete thin subsystems that do not retain real policy ownership.
- [ ] Re-home or expand tests to follow the new reducer boundaries.
- [ ] Add a short script-integration architecture note.

### Decisions Log

- Pending: whether reducer modules should be free functions or small reducer structs.
- Rule: revisit the plan only at explicit reassessment checkpoints or when implementation exposes a concrete contradiction.
- Preferred direction: keep major behavior tests in `state.rs` through the early extraction phases, then move targeted tests only once stable subsystem seams are real.
- Preferred direction: test migration follows ownership, not file creation; do not copy tests across layers or widen visibility just to preserve old assertions.
- Preferred direction: prefer contract-level assertions and delete low-value or over-specified tests rather than carrying them forward mechanically.
- Preferred direction: keep the initial reducer split under `pages/game/update/`, then revisit whether later domain helpers should stay there or move into sibling modules only after real ownership seams stabilize.
- Preferred direction: allow domain-scoped subsystems when they encode real policy ownership, especially for `interaction_policy`, `event_projection`, `controller_coordination`, and `inventory_notifications`.
- Initial pruning bias: `weapon_swap` likely stays, `combat` may partially fold, and `salvaging` should justify itself or get absorbed into a stronger owner.
- Preferred direction: keep `UpdateResult` unified for this refactor rather than splitting reducer outputs and effects immediately.
- Preferred direction: future scripting should likely target a script-facing intent layer that compiles into `AppAction` and `AppUiAction`.
- Preferred direction: `context_buffering` is provisional and should justify itself after extraction or fold into `event_projection` plus render support.
- Preferred direction: promote durable UI transitions into `AppUiAction`, especially pane/focus mode changes, confirmation lifecycle transitions, and command-submission cleanup that coordinates multiple fields.
- Preferred direction: keep high-frequency ephemeral editing behavior local to UI reducers, including character editing, cursor movement, and fine-grained scroll nudges.
- Preferred direction: leave layout-cache maintenance and context-scroll clamping render-adjacent in [apps/holtburger-cli/src/pages/game/render.rs](apps/holtburger-cli/src/pages/game/render.rs) for this refactor unless that seam starts blocking reducer clarity or scriptability.

### Verification Log

- Pending implementation.

### Reassessment Log

- Pending implementation.

### Open Questions

- Within [apps/holtburger-cli/src/pages/game/input.rs](apps/holtburger-cli/src/pages/game/input.rs), exactly which transitions fall on the durable side of the line beyond the current likely set: pane/focus mode changes, confirmation enter/exit, and command-submission cleanup?
- If render-adjacent layout maintenance in [apps/holtburger-cli/src/pages/game/render.rs](apps/holtburger-cli/src/pages/game/render.rs) becomes a problem later, should it move into a narrow layout-state helper under the game page, or into a broader UI-state seam alongside transient input state?