# TUI Navigation Coordinator Plan

## Context & Boundaries

### Goal

Move the TUI-owned navigation control loop out of `apps/holtburger-cli/src/pages/game/state.rs` by turning `apps/holtburger-cli/src/navigation.rs` into a stateful subsystem with its own navigation-specific input, output, and tick flow so `GameState` stops manually orchestrating navigation lifecycle, command emission, and interaction cleanup.

### In Scope

- Extract the TUI-specific navigation orchestration currently embedded in `apps/holtburger-cli/src/pages/game/state.rs`.
- Keep `apps/holtburger-cli/src/navigation.rs` as the owner of dishonest approach, follow, and sticky-melee policy.
- Extend `DishonestNavigation` so it owns navigation lifecycle reconciliation, stop-edge bookkeeping, command emission decisions, and derived sticky-melee behavior.
- Introduce a navigation-specific flow made of immediate inputs, explicit outputs, and periodic tick reconciliation.
- Reduce repeated navigation sync and cleanup calls in `GameState`.
- Preserve current approach, follow, sticky-melee, forced-reposition, and teleport behavior.
- Add or update TUI tests that prove the extended navigation flow preserves current behavior.

### Out Of Scope

- Moving dishonest navigation into `holtburger-core`.
- Introducing a generic controller trait or shared effect vocabulary for TUI navigation.
- Redesigning dishonest movement policy, pursuit math, or arrival heuristics in `apps/holtburger-cli/src/navigation.rs`.
- Reworking unrelated combat automation, inventory handling, or page rendering logic.
- Replacing the TUI's current interaction model.

## Ground Truth

### Reference Sources

- `apps/holtburger-cli/src/pages/game/state.rs`
- `apps/holtburger-cli/src/navigation.rs`
- `crates/holtburger-core/src/client/controllers/combat.rs`
- `docs/plans/navigation-public-mode-enum-plan.md`
- `docs/plans/movement-controller-architecture-plan.md`
- `AGENTS.md`

### Existing Patterns To Preserve

- TUI navigation policy remains frontend-owned.
- `DishonestNavigation` remains the owner of dishonest approach, follow, sticky-melee latch state, and `AutonomousDriveIntent` generation.
- `GameState` remains the owner of page view state, redraw requests, and direct `UpdateResult` mutation.
- No new shared-core abstractions should be introduced just to make the TUI navigation path look like core controllers.
- Forced reposition and teleport remain explicit lifecycle events rather than being inferred indirectly from movement output.
- Sticky melee remains derived behavior driven by combat and targeting state, not an explicit user command.

## Dry-Run Findings Against The Current Codebase

### Finding 1: `state.rs` Is Running A TUI Navigation Control Loop

`GameState` currently owns navigation orchestration through these helpers in `apps/holtburger-cli/src/pages/game/state.rs`:

- `sync_sticky_melee_pursuit`
- `navigation_sync_input`
- `reconcile_navigation`
- `start_approach_target`
- `start_follow_target`
- `sync_approach_target`
- `sync_follow_target`
- `sync_navigation_drive`
- `stop_active_navigation_drive`
- approach and follow interaction cleanup helpers

Consequence:

- This is more than page-local glue. It is a concrete controller loop living in the page state file.

### Finding 2: The Real Navigation Policy Already Lives Elsewhere

`apps/holtburger-cli/src/navigation.rs` already owns:

- active dishonest navigation mode
- approach and follow state
- sticky melee latch and pursuit state
- forced-reposition and teleport reactions at the navigation-policy level
- `AutonomousDriveIntent` generation

Consequence:

- The problem is not missing policy ownership. The problem is that lifecycle coordination around that policy is split between `navigation.rs` and `state.rs`.

### Finding 3: `navigation_drive_active` Is Pure Orchestration State

`GameRuntimeState.navigation_drive_active` exists only to remember whether the TUI needs to emit `ClientCommand::DriveSelf(PlayerDriveIntent::Stop)` when dishonest navigation goes idle.

Consequence:

- This flag does not belong in page runtime state long-term. It belongs with `DishonestNavigation`.

### Finding 4: Interaction Cleanup Is Coupled To Navigation Mode Changes

`GameState` is responsible for keeping `Interaction::Approaching` and `Interaction::Following` synchronized with navigation-mode changes and interruption events.

Consequence:

- Some coordination must remain TUI-local, but it does not need to remain scattered across `GameState`.

### Finding 5: The TUI Does Not Need Shared Bridging Semantics

Unlike `CombatAutomationController` in `crates/holtburger-core/src/client/controllers/combat.rs`, the proposed extraction is TUI-only.

Consequence:

- We should not introduce generic controller traits, shared effect enums, or core-style indirection just for architectural symmetry.
- The extracted unit can stay concrete and TUI-native without inventing reusable controller plumbing.

### Finding 6: The Existing Page API Already Suggests A Narrow Output Surface

`UpdateResult` in `apps/holtburger-cli/src/types.rs` is intentionally small:

- `commands: Vec<ClientCommand>`
- `actions: Vec<AppAction>`
- `needs_redraw: bool`

`Interaction` is also a small page-owned enum, and `navigation_drive_active` is only referenced from `state.rs` tests and helpers.

Consequence:

- The extended navigation type does not need a broad framework.
- A tiny navigation-specific output shape is enough.

### Finding 7: `DishonestNavigationSyncInput` Should Stay A Built Input, Not Stored Navigation State

The current navigation sync input is built from:

- runtime player position
- runtime target sample
- target use radius from entity properties
- player run rate
- current timestamp

Those values belong to `GameData` and current page state, not to long-lived navigation runtime state.

Consequence:

- `DishonestNavigation` should accept a built snapshot each time it is asked to reconcile or tick.
- It should not cache a copy of world-derived sync input internally.

### Finding 8: A Separate Wrapper Adds Very Little

The proposed wrapper would mostly contain:

- `DishonestNavigation`
- `drive_active`
- thin forwarding methods that delegate back into navigation logic

Consequence:

- That seam is probably not pulling its weight.
- Extending `DishonestNavigation` directly is the simpler default unless page-only interaction handling later proves too awkward.

### Finding 9: Giving Navigation No Feed Leaves `GameState` As The God Dispatcher

If `GameState` keeps pattern-matching the entire `AppAction` and `ClientViewEvent` stream and only then calls narrow navigation helpers, the navigation behavior moves only cosmetically.

Consequence:

- `DishonestNavigation` needs its own feed.
- That feed should be navigation-specific, not the raw app-wide enums.

### Finding 10: Sticky Melee Is Derived State, Not A User Verb

Approach and follow are explicit user-initiated modes. Sticky melee is not. It emerges from target selection, combat mode, attack activity, and world distance.

Consequence:

- Sticky melee should not be modeled as an explicit `NavigationInput` variant.
- It should be derived inside `DishonestNavigation` from tick-time world state plus navigation-owned latch state.

### Finding 11: Navigation Cannot Safely Write `view.active_interaction` Directly

`GameState::set_active_interaction(...)` in `apps/holtburger-cli/src/pages/game/state.rs` is not a trivial setter. It also:

- syncs target-health query ownership
- cancels attack state in some interaction transitions
- resumes queued attacks in others

Consequence:

- Navigation should decide approach and follow interaction transitions.
- The actual interaction write should still stay page-owned so those side effects remain centralized.
- Navigation should request that transition through an explicit output, not by calling back into page state.
- Direct `view.active_interaction = ...` writes inside `DishonestNavigation` would be a behavior regression.

### Finding 12: Next-Tick Reconciliation Is An Acceptable Simplification For Ordinary World Churn

The current `handle_view_event(...)` path in `apps/holtburger-cli/src/pages/game/state.rs` repeatedly re-runs navigation sync on:

- combat feedback and combat-mode changes
- entity movement and motion updates
- runtime body upserts, removals, and resets
- remote-target forced reposition
- entity despawn

Consequence:

- Letting these paths reconcile on the next navigation tick is probably acceptable if the tick cadence stays reasonably tight.
- That removes a lot of projected-event plumbing without weakening the real interrupt edges.
- The first extraction should keep immediate events only for hard interrupts like forced reposition and teleport.

## Target Architecture

### Ownership Split

- `apps/holtburger-cli/src/navigation.rs` owns dishonest navigation policy, lifecycle orchestration, stop-edge bookkeeping, and drive intent generation.
- `GameState` projects raw `AppAction` inputs plus a very small set of interrupt signals into navigation, builds world snapshots, and applies returned page-local effects.

### Extended `DishonestNavigation` Responsibilities

The extended `DishonestNavigation` should own:

- navigation-specific input handling for explicit user verbs and hard interrupt edges
- periodic tick reconciliation against the current world snapshot
- stop-edge bookkeeping currently represented by `navigation_drive_active`
- explicit approach and follow mode ownership
- default approach and follow standoff-distance policy
- derived sticky-melee latch and pursuit ownership
- drive-intent emission decisions
- navigation shutdown behavior on forced reposition and teleport

`DishonestNavigation` should not own:

- general page redraw logic unrelated to navigation
- raw `AppAction` and `ClientViewEvent` matching across unrelated domains
- combat automation behavior outside navigation-triggered shutdown and sticky-melee derivation inputs
- rendering or layout concerns

### Feed Design

The navigation subsystem should consume one small immediate input enum plus periodic tick reconciliation.

Immediate inputs:

```rust
pub enum NavigationInput {
  StartApproach { target: Guid },
  StartFollow { target: Guid },
  Cancel,
  ForcedReposition,
  TeleportStarted,
}
```

Periodic reconciliation input:

```rust
pub struct NavigationTick {
  pub now: Instant,
  pub dt: Duration,
  pub snapshot: NavigationSnapshot,
}
```

Sticky melee is intentionally absent from `NavigationInput`. It should be derived internally during tick-time reconciliation from the current snapshot plus navigation's own latch state.

Notes:

- `GameState` is not currently choosing arrival distance intelligently. It mostly forwards fixed approach and follow constants.
- Navigation already owns the real arrival behavior because it combines the base standoff distance with target use radius.
- The cleaner split is for `NavigationInput` to identify the target and requested mode while `DishonestNavigation` owns the default approach and follow distances.

### Output Model

Because this is CLI-only, `DishonestNavigation` can use TUI-native outputs. It does not need reusable shared semantics.

Preferred output model:

- a tiny navigation-specific update object returned from `handle_input(...)` and `tick(...)`
- `GameState` applies that update through its existing `UpdateResult` and `set_active_interaction(...)` paths

Rationale:

- `UpdateResult` is already the page's command and redraw accumulator.
- TUI navigation does not currently need a standalone reusable effect vocabulary.
- Interaction changes are not plain view writes today, so the extraction must preserve the side effects already centralized in `GameState::set_active_interaction(...)`.
- A small explicit output is cleaner than either a callback-shaped apply seam or letting navigation reach back into all of `GameState`.

## Concrete API Shapes

This section records a dry-run-derived candidate API that fits the current code without inventing new shared abstractions.

### Recommended File Placement

Preferred implementation direction:

- extend `apps/holtburger-cli/src/navigation.rs` in place

Reasons:

- `DishonestNavigation` already owns the active mode, interruption semantics, and drive intent generation.
- The remaining missing pieces are the input/output surface, stop-edge bookkeeping, and page-facing update application.
- A wrapper seam would mostly rename existing ownership rather than clarify it.

### Extended State Shape

```rust
pub struct DishonestNavigation {
  active: ActiveDishonestNavigation,
  drive_active: bool,
  default_approach_distance: f32,
  default_follow_distance: f32,
  automation_target_distance_limit_m: f32,
}
```

Notes:

- `drive_active` replaces `GameRuntimeState.navigation_drive_active`.
- `default_approach_distance` and `default_follow_distance` replace page-owned standoff constants that are currently just forwarded into navigation.
- Current combat targeting and attack-activity inputs should be provided on tick through the snapshot rather than retained as extra navigation state.
- `GameRuntimeState` should then hold only `navigation: DishonestNavigation`.
- This keeps ownership where it already mostly lives today.

### Snapshot Input

```rust
pub struct NavigationSnapshot {
  pub player_position: Option<WorldPosition>,
  pub run_rate: f32,
  pub combat_target_guid: Option<Guid>,
  pub combat_mode: CombatMode,
  pub attack_sequence_active: bool,
  pub tracked_target: Option<ResolvedNavigationTarget>,
}
```

Notes:

- This is the built world-facing snapshot used to produce `DishonestNavigationSyncInput`.
- It is assembled by `GameState` from existing data accessors.
- Sticky melee should use this snapshot instead of retained combat and targeting event state.
- It should not duplicate navigation-owned state such as the current explicit approach/follow target or sticky latch.
- `now` belongs on `NavigationTick`, not inside `NavigationSnapshot`.
- `ResolvedNavigationTarget` should be the existing navigation type that already packages `guid`, `SpatialEntitySample`, and `use_radius`, not a second snapshot-specific wrapper.

Recommended build rule in `GameState`:

```rust
fn navigation_snapshot(&self) -> NavigationSnapshot {
  let tracked_target = self.runtime.navigation.tracked_target_guid().and_then(|guid| {
    let sample = self.data.runtime_sample_for_guid(guid)?;
    let use_radius = self
      .data
      .entities
      .get(&guid)
      .and_then(|entity| entity.use_radius())
      .map(|radius| radius as f32);

    Some(ResolvedNavigationTarget {
      guid,
      sample,
      use_radius,
    })
  });

  NavigationSnapshot {
    player_position: self.data.runtime_player_position(),
    run_rate: self.data.player_run_rate().unwrap_or(DEFAULT_APPROACH_RUN_RATE),
    combat_target_guid: self.current_target_guid(),
    combat_mode: self.data.combat_mode,
    attack_sequence_active: self.data.combat_runtime.attack_activity(self.data.combat_mode).is_some(),
    tracked_target,
  }
}
```

### Navigation Output

```rust
pub struct NavigationUpdate {
  pub drive_command: Option<PlayerDriveIntent>,
  pub interaction_change: NavigationInteractionChange,
}

pub enum NavigationInteractionChange {
  Unchanged,
  Set(Option<Interaction>),
}
```

Notes:

- `NavigationUpdate` is intentionally tiny and TUI-specific.
- `GameState` remains the applier of side effects, including `UpdateResult` mutation and the semantic work inside `set_active_interaction(...)`.
- The navigation system stays self-contained because it returns what changed instead of calling back into page state.

### Core Methods

```rust
impl DishonestNavigation {
  pub fn handle_input(
    &mut self,
    input: NavigationInput,
    snapshot: NavigationSnapshot,
  ) -> NavigationUpdate;

  pub fn tick(&mut self, tick: NavigationTick) -> NavigationUpdate;

  pub fn navigation_mode(&self) -> Option<NavigationMode>;

  pub fn sticky_latched_target_guid(&self) -> Option<Guid>;

  pub fn sticky_is_pursuing(&self) -> bool;
}
```

Notes:

- `handle_input` owns explicit user-initiated verbs plus interruption inputs like forced reposition and teleport.
- `handle_input` should always receive a current snapshot even if some inputs do not use every field.
- `tick` owns periodic reconciliation, derived sticky-melee pursuit decisions, `active_navigation_target_guid`, `active_drive_intent`, stop-edge emission, and ordinary world-change reactions.
- This keeps sticky melee internal to navigation without pretending it is an explicit action.
- `NavigationUpdate` is the seam that lets navigation request interaction transitions without duplicating `GameState`'s interaction side effects.
- `GameState` should mark redraw when applying a non-`Unchanged` interaction transition from `NavigationUpdate`, matching the current interaction-sync helpers.

### Recommended Internal Helpers

```rust
impl DishonestNavigation {
  fn to_sync_input(
    &self,
    now: Instant,
    snapshot: NavigationSnapshot,
  ) -> NavigationSyncInput;

  fn approach_distance(&self) -> f32;

  fn follow_distance(&self) -> f32;

  fn tracked_target_guid(&self) -> Option<Guid>;

  fn explicit_navigation_target_guid(&self) -> Option<Guid>;

  fn effective_target_guid(&self) -> Option<Guid>;

  fn should_pursue_sticky_melee(&self, sync_input: NavigationSyncInput) -> bool;

  fn reconcile_explicit_mode(
    &mut self,
    sync_input: NavigationSyncInput,
  ) -> NavigationInteractionChange;

  fn emit_drive_or_stop(
    &mut self,
    sync_input: NavigationSyncInput,
    dt: Duration,
  ) -> Option<PlayerDriveIntent>;

  fn clear_finished_interaction(
    &self,
    mode_before: Option<NavigationMode>,
    mode_after: Option<NavigationMode>,
  ) -> NavigationInteractionChange;
}
```

Notes:

- `to_sync_input` contains the existing target/sample/use-radius/run-rate assembly logic and should resolve the tracked target using navigation-owned mode state plus the supplied snapshot.
- `approach_distance` and `follow_distance` keep default standoff policy inside navigation instead of page state.
- `tracked_target_guid` is the navigation-owned choice of which world target snapshot is currently relevant for approach, follow, or sticky pursuit.
- `explicit_navigation_target_guid` is the extracted form of the current explicit approach/follow target reader.
- `effective_target_guid` is the drive-emission target, including derived sticky-melee pursuit when active.
- `should_pursue_sticky_melee` keeps sticky-melee derivation internal to navigation using current combat and targeting state plus tick-time world state.
- `reconcile_explicit_mode` absorbs the current `sync_approach_target` and `sync_follow_target` behavior.
- `emit_drive_or_stop` is where `drive_active` lives.
- `clear_finished_interaction` keeps the approach/follow UI cleanup logic out of `GameState` while still returning an explicit page-owned interaction change to apply.

### Expected `GameState` Surface After Extraction

`GameState` should still build snapshots because it owns the source data, but the page should stop manually performing navigation lifecycle steps.

Candidate helpers that remain on `GameState`:

```rust
fn navigation_snapshot(
  &self,
) -> NavigationSnapshot;

fn apply_navigation_update(
  &mut self,
  update: NavigationUpdate,
  result: &mut UpdateResult,
);

fn navigation_input_for_app_action(&self, action: &AppAction) -> Option<NavigationInput>;

fn navigation_interrupt_for_view_event(&self, event: &ClientViewEvent) -> Option<NavigationInput>;
```

Recommended projection rule:

- only project hard interrupt inputs such as `ForcedReposition` and `TeleportStarted`
- project page-owned cancellation edges such as `CancelInteraction` or switching from a navigation interaction into a non-navigation interaction as `NavigationInput::Cancel`
- do not mirror raw `ClientViewEvent` variants one-for-one
- let ordinary movement, runtime-body churn, target churn, and sticky-melee derivation settle on the next navigation tick

Everything else in the current navigation cluster should either move or collapse.

### Concrete Deletions The API Would Enable

If the above API lands, these current `GameState` methods should disappear or become one-line wrappers:

- `sync_sticky_melee_pursuit`
- `navigation_sync_input`
- `reconcile_navigation`
- `start_approach_target`
- `start_follow_target`
- `sync_approach_target`
- `sync_follow_target`
- `active_navigation_target_guid`
- `sync_navigation_drive`
- `stop_active_navigation_drive`
- `clear_finished_approach_interaction`
- `clear_finished_follow_interaction`

### Concrete Places That Should Stay In `GameState`

These behaviors still look page-owned after the dry-run:

- building the navigation snapshots from `GameData`
- applying `NavigationUpdate` into `UpdateResult` and `set_active_interaction(...)`
- projecting raw `AppAction` and only interrupt-class `ClientViewEvent` inputs into navigation-specific inputs
- deciding when combat automation should run
- mutating `combat_runtime` on teleport-triggered explicit attack cancellation
- owning the canonical interaction side effects currently centralized in `set_active_interaction(...)`
- handling non-navigation interactions such as targeting, combining, or salvaging

These behaviors no longer need to stay page-owned:

- choosing default approach and follow arrival distances
- determining the active explicit navigation target once navigation already owns its mode state

### Teleport And Forced-Reposition Boundary

The dry-run suggests this split:

- `DishonestNavigation::handle_input(NavigationInput::ForcedReposition, ...)` should own navigation stop-edge and approach/follow interaction cleanup effects.
- `DishonestNavigation::handle_input(NavigationInput::TeleportStarted, ...)` should own navigation stop-edge and approach/follow interaction cleanup effects.
- `GameState::handle_teleport_start()` should continue to own targeting-specific combat cancellation because that logic mutates `combat_runtime` and `combat_automation`, which are not navigation concerns.

Reasoning:

- Teleport shutdown is currently a mixed concern: navigation interactions stop, but targeting-mode combat cancellation also mutates page-owned combat runtime.
- The clean first extraction is to let navigation own navigation shutdown policy while `GameState` keeps the combat-runtime mutation step.

This keeps the extraction tight and avoids pulling combat state mutation into navigation.

## Phased Implementation

### Phase 1: Define The Navigation Feed Boundary

#### Deliverables

- Identify and group all navigation-orchestration methods in `apps/holtburger-cli/src/pages/game/state.rs`.
- Add navigation-specific `NavigationInput`, `NavigationSnapshot`, and `NavigationTick` shapes in `apps/holtburger-cli/src/navigation.rs`.
- Move `navigation_drive_active` ownership into `DishonestNavigation`.
- Move default approach and follow standoff policy into `DishonestNavigation`.

#### Acceptance Criteria

- `GameState` no longer stores raw navigation orchestration state directly.
- `DishonestNavigation` has a clear feed surface for immediate inputs and periodic tick input.

### Phase 2: Move Explicit Action Handling And Stop-Edge Logic

#### Deliverables

- Move explicit approach and follow activation handling into `DishonestNavigation::handle_input(...)`.
- Move `sync_navigation_drive` and `stop_active_navigation_drive` behavior into `DishonestNavigation::tick(...)`.
- Move the `navigation_drive_active` stop-edge bookkeeping into `DishonestNavigation`.
- Stop threading arrival-distance constants through `GameState`.
- Add a page-owned `apply_navigation_update(...)` helper.
- Keep command emission behavior identical, including explicit stop edges.

#### Acceptance Criteria

- `GameState` no longer open-codes `DriveSelf(PlayerDriveIntent::Autonomous(...))` and stop-edge emission for navigation.
- Navigation stop edges are emitted only when the prior behavior would have emitted them.
- Existing approach, follow, and sticky pursuit tests still pass.

### Phase 3: Move Interrupt Handling And Sticky-Melee Derivation

#### Deliverables

- Move approach and follow interaction synchronization into `DishonestNavigation` output generation plus page-owned update application.
- Move sticky-melee derivation fully behind `DishonestNavigation` tick-time reconciliation.
- Consolidate forced-reposition and teleport shutdown behavior into `DishonestNavigation::handle_input(...)`.
- Route page-owned cancellation edges into `NavigationInput::Cancel` instead of open-coding navigation clears in several action branches.
- Preserve current follow-specific pause semantics on forced reposition.

#### Acceptance Criteria

- `GameState` no longer manually mirrors navigation mode changes into `Interaction` through several separate helpers.
- Sticky melee no longer requires `GameState` to orchestrate a bespoke `sync_sticky_melee_pursuit` helper.
- Forced reposition still clears approach and pauses follow exactly as current tests require.
- Teleport still clears the right navigation and targeting state.

### Phase 4: Collapse Call Sites And Harden Tests

#### Deliverables

- Replace repeated navigation helpers in `handle_view_event`, page action handling, and `handle_tick` with projected feed delivery into `DishonestNavigation`.
- Add focused tests for the extended navigation behavior plus any necessary game-page integration tests.

#### Acceptance Criteria

- `handle_view_event` and `handle_tick` have a visibly smaller navigation footprint.
- The page code expresses “project input into navigation and apply result” rather than manually walking navigation modes.
- TUI tests continue to prove current behavior around:
  - approach activation and completion
  - follow pause and resume
  - sticky melee pursuit and latch behavior
  - forced reposition handling
  - teleport handling
  - stop-edge emission

## Risks & Mitigations

### Risk: Interaction Semantics Drift During Extraction

Approach and follow currently update `Interaction` in lockstep with several navigation paths, and subtle drift would show up as incorrect UI state rather than compile errors.

Mitigation:

- Preserve existing page-level tests first.
- Add navigation-focused tests for interaction transitions before deleting old helpers.
- Add at least one test that applying a `NavigationUpdate` interaction change still triggers the same redraw and attack-cancel/resume behavior as the old helpers.

### Risk: Stop-Edge Regressions Become Hard To Notice

If `navigation_drive_active` handling changes subtly, movement may continue indefinitely or fail to emit the final stop edge.

Mitigation:

- Add targeted tests that assert exact `DriveSelf(PlayerDriveIntent::Stop)` behavior for approach completion, forced reposition, teleport, and idle transitions.

### Risk: Over-Abstracting A TUI-Only Problem

Trying to mimic core controllers too closely would add a fake bridge layer with no real consumer outside the CLI.

Mitigation:

- Keep the extracted unit concrete and CLI-native.
- Avoid callback traits or generic controller plumbing unless a second real TUI consumer appears.

### Risk: Event-Driven Resync Stays Scattered

Even after extraction, `GameState` could keep calling several narrow sync entry points from many places, preserving most of the current complexity under new names.

Mitigation:

- Prefer a single navigation tick path for ordinary reconciliation and a tiny interrupt-event path for hard stops.
- Treat repeated multi-call sync patterns as an explicit cleanup target in Phase 4.

### Risk: The Navigation Feed Becomes A Shadow Of Raw App Types

If `NavigationInput` simply mirrors all of `AppAction` and `ClientViewEvent`, the subsystem boundary will be noisy without reducing complexity.

Mitigation:

- Only include navigation-relevant cases in the navigation feed.
- Keep sticky melee derived from tick-time snapshot inputs rather than introducing a fake `StartStickyMelee` input.
- Keep default approach and follow distance policy in navigation unless a real caller-specific override appears.

## Definition Of Done

- `apps/holtburger-cli/src/pages/game/state.rs` no longer owns the detailed TUI navigation control loop.
- TUI dishonest navigation remains frontend-owned and does not move into `holtburger-core`.
- No generic shared-controller abstraction is introduced for this extraction.
- `DishonestNavigation` consumes a small navigation-specific input feed instead of raw app-wide enums.
- Stop-edge bookkeeping no longer lives as ad hoc page runtime state.
- Default approach and follow distance policy no longer lives in page state.
- Interaction updates for approach and follow are preserved.
- Interaction updates for approach and follow still flow through the page-owned side-effect path rather than direct navigation writes or callback-style apply hooks.
- Forced reposition and teleport behavior remain compatible with current tests.
- `cargo test` for the touched TUI modules passes.

## Living Worksheet

### Task Checklist

- [x] Identify the exact extraction boundary for TUI navigation orchestration.
- [x] Add the navigation-specific input/tick feed.
- [x] Extend `DishonestNavigation` with stop-edge and output handling.
- [x] Move navigation runtime ownership fully behind `DishonestNavigation` for default distances and drive-active bookkeeping.
- [x] Move explicit input handling into navigation.
- [x] Move sticky-melee derivation and interruption handling into navigation.
- [x] Collapse repeated navigation call sites into projected feed delivery.
- [x] Add or update tests.

### Decisions Log

- Decision: the extracted navigation unit remains TUI-specific and does not attempt to become a reusable core controller.
- Decision: `DishonestNavigation` should own both dishonest navigation policy and the TUI-local lifecycle orchestration around it.
- Decision: avoid introducing shared bridging semantics solely to mirror `CombatAutomationController` patterns.
- Decision: prefer a tiny explicit `NavigationUpdate` output over callback-style apply hooks or direct page mutation from navigation.
- Decision: `DishonestNavigation` should consume a small navigation-specific input plus tick feed rather than raw `AppAction` and `ClientViewEvent` enums.
- Decision: sticky melee should move behind `DishonestNavigation` as derived behavior driven by tick-time snapshot inputs, not as an explicit action.
- Decision: navigation should not mutate `view.active_interaction` directly; interaction transitions must preserve the existing page-owned side effects.
- Decision: the first extraction should rely on next-tick reconciliation for ordinary world changes and keep immediate events only for hard interrupts.
- Decision: teleport-triggered combat cancellation should remain split at first: navigation owns navigation shutdown, while `GameState` keeps the direct combat-runtime mutation.
- Decision: default approach and follow arrival distances should move into navigation because page state is only forwarding fixed constants today.
- Decision: phase 1 keeps the legacy `reconcile_navigation(...)` and explicit start helpers as compatibility shims while the new feed types and navigation-owned defaults land underneath them.
- Decision: `NavigationSnapshot` is now the page-owned assembly surface for world-derived navigation inputs, even before later phases route `handle_input(...)` and `tick(...)` through it directly.
- Decision: phase 2 uses a tiny `NavigationUpdate` with `drive_command` plus `interaction_change`; that shape is sufficient for current action and tick paths without introducing a broader effect vocabulary.
- Decision: interruption-driven stop cleanup remains temporarily page-owned through `stop_active_navigation_drive(...)` until phase 3 folds forced reposition and teleport onto `NavigationInput`.
- Decision: phase 3 keeps ordinary explicit-mode event resync in `state.rs` for now, but removes sticky-melee event orchestration entirely and lets `DishonestNavigation::tick(...)` derive sticky behavior from the current snapshot.
- Decision: `NavigationInput::Cancel`, `ForcedReposition`, and `TeleportStarted` now return their own stop-edge and interaction cleanup through `NavigationUpdate` rather than depending on page-owned post-processing.
- Decision: `GameState` now chooses the tick snapshot target by preferring `DishonestNavigation::tracked_target_guid()` and only falling back to the current valid combat target when navigation is otherwise idle.
- Decision: phase 4 removes ordinary event-time approach/follow resync from `state.rs`; entity motion, runtime-body churn, despawns, and remote target movement now update page state immediately and let `DishonestNavigation::tick(...)` reconcile on the next tick.
- Decision: page action handling now projects approach, follow, and navigation-cancel edges through `navigation_input_for_app_action(...)`, including switching from a navigation interaction into salvaging or other non-navigation interactions.

### Verification Log

- Implemented phase 1 code changes:
  - added `NavigationInput`, `NavigationSnapshot`, and `NavigationTick` in `apps/holtburger-cli/src/navigation.rs`
  - moved default approach/follow distances into `DishonestNavigation`
  - moved drive-active bookkeeping into `DishonestNavigation`
  - updated `GameState` to build `NavigationSnapshot` and delegate sync-input assembly back to navigation
- Validation:
  - `cargo test -p holtburger-cli --lib` passed after the phase-1 patch.
- Implemented phase 2 code changes:
  - added `NavigationUpdate` and `NavigationInteractionChange` in `apps/holtburger-cli/src/navigation.rs`
  - moved explicit approach and follow startup into `DishonestNavigation::handle_input(...)`
  - moved regular autonomous/stop emission into `DishonestNavigation::tick(...)`
  - added page-owned `apply_navigation_update(...)` in `apps/holtburger-cli/src/pages/game/state.rs`
  - removed the regular `start_*` and `sync_navigation_drive(...)` page control path
  - added focused navigation tests for explicit interaction output and stop-edge emission
- Validation:
  - `cargo test -p holtburger-cli --lib` passed after the phase-2 patch.
- Implemented phase 3 code changes:
  - moved sticky-melee derivation behind `DishonestNavigation::tick(...)`
  - moved forced reposition and teleport shutdown handling behind `DishonestNavigation::handle_input(...)`
  - moved navigation interaction cleanup for completed approach/cancel/interrupt paths behind `NavigationUpdate`
  - routed page-owned navigation cancellation edges through `NavigationInput::Cancel`
  - removed page-owned `sync_sticky_melee_pursuit(...)` and the old approach/follow interaction cleanup helpers
  - added focused navigation tests for forced-reposition cleanup and tick-time approach completion cleanup
- Validation:
  - `cargo test -p holtburger-cli --lib` passed after the phase-3 patch.
- Implemented phase 4 code changes:
  - removed the remaining page-owned `sync_approach_target(...)`, `sync_follow_target(...)`, `reconcile_navigation(...)`, and `navigation_sync_input(...)` helpers from `apps/holtburger-cli/src/pages/game/state.rs`
  - added `navigation_input_for_app_action(...)`, `navigation_interrupt_for_view_event(...)`, and `apply_navigation_input(...)` so page actions and hard interrupts now project into the navigation feed instead of manually resyncing navigation state
  - collapsed ordinary world-churn branches in `handle_view_event(...)` so they only update cached page state and redraw state, leaving navigation reconciliation to `DishonestNavigation::tick(...)`
  - routed `CancelInteraction` and navigation-to-non-navigation `BeginInteraction` transitions through `NavigationInput::Cancel`, including salvaging handoff
  - updated game-page integration tests to assert next-tick reconciliation for ordinary world churn and added focused coverage for the new tick-only contract
- Validation:
  - `cargo test -p holtburger-cli --lib` passed after the phase-4 patch.

### Phase 4 Note

No pivot is required.

The planned extraction is complete: `state.rs` now projects navigation-relevant actions and hard interrupts into `DishonestNavigation`, while ordinary world churn settles on the next tick. If follow-up work happens here, it should be opportunistic cleanup rather than a new phase of this plan.

### Open Questions

- Should `NavigationUpdate` stay as one tiny struct with optional fields, or would a small enum of more explicit update variants be clearer once the implementation is in Rust?