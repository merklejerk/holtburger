# Navigation Public Mode Enum Plan

## Context & Boundaries

### Goal

Refactor `NavigationAutomation` so mutually exclusive public navigation modes are encoded structurally as a single active enum variant instead of being inferred from multiple independent controller slots.

### In Scope

- Refactor `crates/holtburger-core/src/client/navigation.rs` to represent public navigation mode with a single internal enum.
- Move controller ownership into mode-local state so direct approach, follow, and sticky melee cannot coexist as peer public modes.
- Preserve current external API shape where practical (`activate_approach`, `activate_follow`, `reconcile_navigation`, `navigation_mode`, `handle_forced_reposition`, `handle_teleport_start`).
- Preserve existing follow and sticky melee semantics around latching, suspend behavior, and teleport handling.
- Add or update unit tests in `crates/holtburger-core/src/client/navigation.rs` to cover mode replacement and variant-local invariants.

### Out of Scope

- Any redesign of `ApproachTargetController` or `MaintainRangeController` behavior beyond what is necessary to relocate ownership.
- CLI UX or command binding changes in `apps/holtburger-cli`.
- Broader navigation policy changes for a future 3D client.
- Unrelated movement/controller cleanup outside `NavigationAutomation`.

## Ground Truth

### Reference Sources

- `crates/holtburger-core/src/client/navigation.rs`
- `apps/holtburger-cli/src/pages/game/state.rs`
- `/memories/repo/navigation-public-mode-exclusivity.md`
- `/memories/repo/navigation-automation-ownership.md`

### Existing Patterns To Preserve

- `NavigationIntent` remains the reconciliation input for per-tick updates.
- `NavigationMode` remains the public read model exposed to frontends.
- `NavigationUpdate` continues to be the command accumulator returned from navigation helpers.
- Sticky melee and follow retain their maintain-range semantics, including preserve-latch-on-forced-reposition and clear-on-teleport behavior.
- CLI callers in `apps/holtburger-cli/src/pages/game/state.rs` continue to poll `navigation_mode()`, `sticky_latched_target_guid()`, and `sticky_is_pursuing()` without needing API changes.

## Semantic Invariants To Preserve

- `Idle` means there is no active public navigation mode.
- `Approach` is an active public mode and is cancelled, not paused, when its controller completes or is interrupted.
- `Follow` remains the active public mode while its target is latched, even when pursuit is currently paused because the player is already within arrival distance.
- `StickyMelee` remains the active public mode while its target is latched, even when pursuit is currently paused because the player is already within arrival distance.
- Paused follow or sticky melee must remain externally observable through `navigation_mode()`.
- Sticky melee must continue exposing retained state through `sticky_latched_target_guid()` and `sticky_is_pursuing()`.
- Forced reposition pauses follow or sticky melee pursuit without clearing their retained latch.
- Teleport start clears sticky melee retained state according to current behavior.
- Explicit public mode activation is a replacement transition: starting approach, follow, or sticky melee replaces the previously active public mode instead of coexisting with it.
- Same-tick sticky reconciliation after an explicit approach or follow action must remain a no-op while that explicit mode is active.
- Follow and sticky melee pursuit reissues must continue to refresh drive intent and heading rather than thrashing public mode state.

## Dry-Run Findings

### Paused Follow And Sticky Are Still Publicly Active Modes

`MaintainRangeController` keeps a latched target while paused in-range, and `navigation_mode()` currently reports `Follow` or `StickyMelee` from that retained latch even when pursuit is not active. The enum refactor must therefore represent paused follow/sticky as retained active variants rather than collapsing them to `Idle`.

### Sticky State Is Observed Outside `navigation_mode()`

CLI tests and gameplay code read `sticky_latched_target_guid()` and `sticky_is_pursuing()` directly. The refactor must preserve retained sticky state across forced reposition and in-range pauses, not just preserve the public mode projection.

### Handle-Action Ordering Matters

`handle_action()` in the CLI always calls `sync_sticky_melee_pursuit()` after explicit approach/follow actions. The current behavior depends on `reconcile_navigation(NavigationIntent::StickyMelee)` becoming a no-op when another public mode is active. The enum refactor must preserve that same ordering-sensitive behavior so explicit approach/follow does not get immediately overwritten on the same tick.

### Follow/Sticky Pursuit Reuse More Than Ownership

The current `start_approach_target_with_owner()` helper is doing more than tagging ownership: it also refreshes same-target pursuit, injects initial `SnapFacing` when drive is issued, and reuses `sync_approach_target()` for follow/sticky reissues. The refactor needs an extracted pursuit-start helper or equivalent mode-local logic so those behaviors do not regress when the global approach slot disappears.

### Cross-Crate Verification Is Required

Core unit tests are not enough. CLI tests in `apps/holtburger-cli/src/pages/game/state.rs` assert sticky latch preservation, pursuit pause/resume, teleport clearing, and follow interaction persistence. The refactor should be verified in both the core navigation tests and the CLI state tests.

## Proposed State Shape

Introduce a single active-mode field on `NavigationAutomation`:

```rust
enum ActiveNavigation {
    Idle,
    Approach(ApproachState),
    Follow(FollowState),
    StickyMelee(StickyMeleeState),
}
```

Supporting internal state:

- `ApproachState { controller: ApproachTargetController }`
- `FollowState { maintain: MaintainRangeController, pursuit: Option<ApproachTargetController> }`
- `StickyMeleeState { maintain: MaintainRangeController, pursuit: Option<ApproachTargetController> }`

This keeps public-mode exclusivity in the type system while still allowing follow and sticky melee to own temporary pursuit state as an implementation detail.

## Phased Implementation

### Phase 1: Introduce The Enum Backbone

#### Deliverables

- Add `ActiveNavigation`, `ApproachState`, `FollowState`, and `StickyMeleeState` in `crates/holtburger-core/src/client/navigation.rs`.
- Replace top-level `approach_target`, `follow_target`, and `sticky_melee` fields on `NavigationAutomation` with a single `active` field.
- Update `Default` implementation to initialize `active` as `Idle`.
- Rework `navigation_mode`, `sticky_latched_target_guid`, and `sticky_is_pursuing` to read from `active`.

#### Acceptance Criteria

- `NavigationAutomation` can compile with the new state shape.
- `navigation_mode()` becomes a direct match on `active` and no longer derives public mode by merging independent `Option`s.
- Public-mode exclusivity no longer relies on a global assert across separate fields.

### Phase 2: Localize Per-Mode Sync And Transition Logic

#### Deliverables

- Split the current cross-cutting sync helpers into mode-local operations:
  - direct approach tick/apply helpers
  - follow tick/apply helpers
  - sticky melee tick/apply helpers
- Replace `ApproachOwner`, `MaintainedIntentOwner`, and `OwnedApproachTarget` with structural ownership inside enum variants.
- Rework `activate_approach`, `activate_follow`, `clear_navigation`, and `reconcile_navigation` so mode replacement is a single `active` assignment instead of partial cleanup across multiple fields.

#### Acceptance Criteria

- Starting approach/follow/sticky melee always replaces the prior public mode in one place.
- Direct approach is no longer represented as a globally shared controller that may also be borrowed by follow or sticky melee.
- `clear_navigation()` becomes a direct transition to `Idle` plus any required stop/cancel side effects.

### Phase 3: Preserve Forced-Reposition And Teleport Semantics

#### Deliverables

- Rework `handle_forced_reposition` and `handle_teleport_start` to dispatch through `active`.
- Encode suspend/clear behavior inside `FollowState` and `StickyMeleeState` without reintroducing peer mode fields.
- Keep suspended or in-range follow/sticky represented as retained active variants with their maintain-range controller intact; use `pursuit: None` to represent paused pursuit while preserving the latched target.

#### Acceptance Criteria

- Forced reposition still pauses sticky melee but preserves the sticky latch.
- Forced reposition still leaves paused sticky melee and follow observable through `navigation_mode()` and sticky helper readers where they are today.
- Teleport start still clears sticky melee latch and pursuit.
- Forced reposition and teleport preserve current direct-approach cancellation semantics.

### Phase 4: Tighten Variant-Local Invariants And Regression Coverage

#### Deliverables

- Remove the old exclusivity debug assert or replace it with variant-local assertions.
- Add regression tests covering public mode replacement:
  - sticky melee active -> activate approach -> only approach remains
  - sticky melee active -> activate follow -> only follow remains
  - follow active -> activate approach -> only approach remains
  - direct approach active -> sticky melee reconcile -> only sticky melee remains
- Add variant-local invariant checks where helpful, for example ensuring a follow/sticky pursuit target matches the maintain-range latched target.
- Add verification coverage in CLI state tests for the paused-mode and explicit-mode-replacement behavior that the core unit tests cannot fully prove.

#### Acceptance Criteria

- Tests prove invalid multi-mode combinations are no longer representable via the public API.
- Variant-local assertions catch inconsistent internal state without rebuilding the old cross-field exclusivity check.
- Existing navigation tests continue to pass after updates for the new representation.

## Risks & Mitigations

### Risk: Semantic Drift During State Relocation

Moving from shared helper fields to variant-local state can accidentally change pause, latch, or reissue behavior.

Mitigation:

- Preserve existing tests first.
- Add replacement-transition tests before deleting old helpers.
- Keep logging messages behaviorally aligned so manual testing remains readable.

### Risk: Over-Generalizing Shared Helpers Again

Trying to force follow and sticky melee through one generic mutation path may recreate the same ambiguity under new names.

Mitigation:

- Share only stateless helper logic.
- Keep state mutation and ownership per variant.

### Risk: Large Diff Becomes Hard To Review

This refactor touches a dense state machine plus its tests.

Mitigation:

- Land it in phased commits if executed incrementally.
- Keep API compatibility where possible.
- Prefer mechanical moves first, semantic tightening second.

## Definition Of Done

- `NavigationAutomation` stores one public mode at a time via a single enum field.
- Illegal combinations such as follow + sticky melee or direct approach + sticky melee are unrepresentable in stored state.
- Public APIs continue to behave compatibly for current CLI callers.
- Existing tests compile and pass after update.
- New regression tests cover explicit mode replacement and sticky/follow suspend semantics.
- No code path requires reconstructing public mode from multiple top-level controller slots.

## Living Worksheet

### Task Checklist

- [ ] Add `ActiveNavigation` and variant state structs.
- [ ] Replace top-level controller slots on `NavigationAutomation`.
- [ ] Rework `navigation_mode` and sticky helper readers.
- [ ] Rework explicit activation APIs to replace `active` directly.
- [ ] Rework reconciliation to tick the current variant or replace it.
- [ ] Rework forced reposition and teleport handling through variant-local state.
- [ ] Delete obsolete ownership enums/helpers.
- [ ] Add transition regression tests.
- [ ] Run targeted core navigation tests.
- [ ] Run targeted CLI game-state tests that cover sticky/follow interaction behavior.

### Decisions Log

- Decided: suspended or in-range follow/sticky should remain as active variants with retained maintain-range state; collapsing them to `Idle` would break current `navigation_mode()` and sticky helper semantics used by the CLI.
- Pending: whether `pursuit: Option<ApproachTargetController>` is sufficient or whether an explicit `PursuitState` enum improves clarity for suspended vs inactive states.

### Verification Log

- Pending implementation.

### Open Questions

- Should direct approach cancellation on missing `player_position` remain a silent clear, or should this refactor tighten that behavior while touching the state machine?
- Should follow and sticky melee continue sharing a small stateless pursuit-start/apply helper, or should those paths be fully split for clarity?