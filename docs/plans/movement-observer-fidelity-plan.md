# Movement Observer Fidelity Plan

## Context And Boundaries

### Goal
Fix retail-observed movement artifacts in the current client while reshaping the movement stack so protocol-faithful motion execution lives in core and higher-level steering policy remains optional and frontend-owned.

### In Scope
- Eliminate observer-visible artifacts caused by stale motion commands, incorrect refresh cadence, and protocol-lifecycle mismatches.
- Correct the current planar-only local movement model enough that approach and pursuit are not structurally broken when the target is at a different Z height.
- Reassign responsibilities between controllers, navigation helpers, and `MovementSystem` to fit ACE's movement model and the future 3D-client direction.
- Add tests around motion-command lifecycle, refresh suppression, and prediction boundaries.

### Out Of Scope
- Full pathfinding, navmesh, or collision-aware 3D navigation.
- Replacing the CLI's gameplay UX wholesale.
- Making the geometry-blind approach helper the canonical navigation layer for all clients.
- Perfect retail interpolation fidelity in one pass.

## Ground Truth And Existing Patterns

### Reference Sources
- [docs/autonomous_movement.md](../autonomous_movement.md)
- [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs](../../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs](../../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs](../../ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs)
- [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](../../ACE/Source/ACE.Server/Network/Motion/MovementData.cs)
- [crates/holtburger-core/src/client/movement.rs](../../crates/holtburger-core/src/client/movement.rs)
- [crates/holtburger-core/src/client/locomotion.rs](../../crates/holtburger-core/src/client/locomotion.rs)
- [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs)
- [crates/holtburger-core/src/client/controllers/approach_target.rs](../../crates/holtburger-core/src/client/controllers/approach_target.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs)
- [crates/holtburger-core/ARCHITECTURE.md](../../crates/holtburger-core/ARCHITECTURE.md)

### Existing Patterns To Preserve
- `NavigationAutomation` is optional and geometry-blind, not the universal navigation authority.
- Frontends may own controllers and feed world-derived inputs into them.
- Protocol fidelity for motion-style and movement packet fields belongs in core.

## Architectural Direction

### What Should Stay In Core
- The protocol-faithful movement executor.
- Local motion-session state: what raw commands are currently active, whether a server-visible stop is owed, and whether a fresh `MoveToState` is actually needed.
- Movement heartbeat eligibility and packet emission rules.
- Server-authoritative reconciliation and movement epoch tracking.

### What Should Move Out Of Controllers
- Packet refresh cadence.
- Knowledge of when to send a stop pulse versus a local-only stop.
- Protocol-specific heuristics about sticky command clearing.

### What Should Stay Frontend-Owned Or Optional
- Geometry-blind approach / maintain-range helpers.
- UX policy about when to start, cancel, or suspend approach.
- Any future collision-aware or pathfinding navigation for a 3D client.

### Key Design Conclusion
The current controller model is directionally right, but the primitive surface is still too low-level and leaky. Controllers should emit desired locomotion intent such as “drive toward heading H at speed S” or “stop”, while core owns the ACE-specific session semantics of start, refresh, hold, heartbeat, and explicit clear.

## Dry-Run Findings

### Validated Couplings
- [crates/holtburger-core/src/client/controllers/approach_target.rs](../../crates/holtburger-core/src/client/controllers/approach_target.rs) still owns `MOVE_SYNC_INTERVAL` and emits `LocomotionPrimitive::{Drive, Stop}` values with `refresh_server`, so Phase 2 is an API change, not just an internal refactor.
- [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs) hard-codes different stop semantics across normal cancel, forced reposition, teleport start, and sticky-melee suspend flows. That confirms the stop-lifecycle bug is spread across multiple helpers today.
- [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs) has tests that explicitly expect `Stop { refresh_server: false }` for forced reposition and teleport start. Those tests currently encode the observer artifact and must be updated as part of Phase 1.
- [apps/holtburger-cli/src/pages/game/data.rs](../../apps/holtburger-cli/src/pages/game/data.rs) already derives approach speed from burden and Run skill via `get_run_rate()`, with `DEFAULT_APPROACH_RUN_RATE` as fallback in CLI state. Phase 2 or 3 must preserve that contract instead of accidentally collapsing movement intent back to a fixed speed constant.
- [crates/holtburger-core/src/client/locomotion.rs](../../crates/holtburger-core/src/client/locomotion.rs) and [crates/holtburger-core/src/client/movement.rs](../../crates/holtburger-core/src/client/movement.rs) still contain the planar local-motion assumption, so the Z-height concern is not speculative.

### Consequences For Implementation
- Phase 1 needs test rewrites in both core-adjacent navigation tests and CLI state tests. Treat that as expected fallout, not a regression signal by itself.
- Phase 2 should replace `refresh_server` on the public locomotion primitive surface with a higher-level intent contract in one pass, or the codebase will temporarily carry two competing ownership models.
- Forced reposition and teleport interruption handling should be validated against whether core believes a server-visible motion command is currently active. Blindly sending or suppressing stop pulses in frontend helpers will keep the bug alive.
- Heartbeat eligibility remains part of the same ownership problem. Once core becomes the motion-session authority, it should also decide when autonomous position heartbeats are still owed.

### No Major Plan Breakers Found
- The optional/helper status of `NavigationAutomation` is still consistent with the codebase and with the future 3D-client direction.
- Frontend-owned controller policy remains viable after this refactor as long as ACE session semantics move downward into core.
- The current plan phases are still the right order; the dry run mostly exposed migration cost and test scope, not missing architectural phases.

## Phased Plan

### Phase 1: Fix Motion Lifecycle Bugs

#### Status
Completed on 2026-03-23.

#### Deliverables
- Update [crates/holtburger-core/src/client/movement.rs](../../crates/holtburger-core/src/client/movement.rs) to track whether a server-visible motion command is currently active and whether a stop pulse is required.
- Update [crates/holtburger-core/src/client/commands.rs](../../crates/holtburger-core/src/client/commands.rs) so one-shot `TurnTo` does not leave a sticky turn command active without a matching clear.
- Update [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs) and [crates/holtburger-core/src/client/controllers/approach_target.rs](../../crates/holtburger-core/src/client/controllers/approach_target.rs) so forced reposition / teleport stop paths still clear observer-visible motion when needed.

#### Completed Work
- Routed `TurnTo` through core movement ownership instead of letting `commands.rs` author raw turn packets directly.
- Added core-owned tracking for whether an observer-visible motion session is active, so stop pulses can still be emitted when interruption paths request a local-only stop.
- Added deferred stationary-turn clearing: a stationary turn now emits the turn pulse, then core sends the matching clear on the next physics tick instead of leaving a sticky turn command active.
- Split moving `AutonomousPosition` heartbeats from server-controlled movement acknowledgements. Server-controlled movement now uses an explicit autonomous-position sync path that is not gated on mirrored local velocity.
- Corrected the server-controlled UpdateMotion test fixture to use an initialized world position; the original fixture used a null landblock and could never legally emit `AutonomousPosition`.

#### Acceptance Criteria
- No controller path can leave a stale turn or forward command active on observers.
- Stop semantics are decided in one place, not ad hoc across controllers.
- Tests cover turn-start/turn-stop, drive-start/drive-stop, and forced-reposition/teleport interruption.

#### Validation
- `cargo test -p holtburger-core --lib -- --nocapture` passed.
- Targeted CLI interruption tests passed for forced reposition and teleport cancellation paths.

#### Decisions
- Treat stationary one-shot turns as a short-lived motion session owned by core, with an explicit deferred clear, rather than trying to model them as fire-and-forget raw packets.
- Treat server-controlled movement acknowledgements as a separate packet-emission case from ordinary moving heartbeats. They share packet shape with `AutonomousPosition`, but not the same eligibility rule.

### Phase 2: Move Refresh Policy Into Core

#### Status
Completed on 2026-03-23.

#### Deliverables
- Refine the locomotion primitive contract in [crates/holtburger-core/src/client/locomotion.rs](../../crates/holtburger-core/src/client/locomotion.rs) so controllers express desired locomotion intent, not raw packet-refresh cadence.
- Remove timer-owned `refresh_server` policy from [crates/holtburger-core/src/client/controllers/approach_target.rs](../../crates/holtburger-core/src/client/controllers/approach_target.rs) and related helper flows.
- Teach [crates/holtburger-core/src/client/movement.rs](../../crates/holtburger-core/src/client/movement.rs) to emit `MoveToState` only on meaningful intent edges or changes.

#### Completed Work
- Removed `refresh_server` from `LocomotionPrimitive`, so controller-facing movement is now pure `Drive { heading, speed }` or `Stop` intent.
- Removed the 250 ms resend timer from `ApproachTargetController`; steady-state controller ticks now keep expressing drive intent without encoding ACE packet cadence.
- Updated `NavigationAutomation`, CLI state tests, and the external controller API test to use the simplified locomotion contract.
- Added core-owned server-drive intent tracking so `MovementSystem` now suppresses duplicate drive pulses when heading, derived turn command, speed, and motion-style semantics are unchanged.
- Preserved the Phase 1 interruption fixups while moving the edge/change decision downward into core.

#### Acceptance Criteria
- Straight-line pursuit no longer resends `MoveToState` every controller sync tick.
- Controllers do not need ACE packet-lifecycle knowledge to remain correct.
- Core remains compatible with command-channel frontends and direct embedders.

#### Validation
- `cargo test -p holtburger-core --lib -- --nocapture` passed.
- `cargo test -p holtburger-core --test approach_target_controller_api -- --nocapture` passed.
- Targeted CLI stop/interrupt tests passed after the API change.

#### Decisions
- Core now treats resend suppression as a comparison against the last server-visible drive intent, not as a controller timer concern.
- The meaningful edge for resend is the derived wire-facing drive semantics, especially turn-command change and speed change, rather than raw controller tick frequency.

### Phase 3: Replace Planar-Only Prediction With A Better Shared Contract

#### Status
Completed on 2026-03-23.

#### Deliverables
- Audit and adjust [crates/holtburger-core/src/client/locomotion.rs](../../crates/holtburger-core/src/client/locomotion.rs) and [crates/holtburger-core/src/client/movement.rs](../../crates/holtburger-core/src/client/movement.rs) so local prediction is no longer hard-wired to flat X/Y-only translation as the sole movement model.
- Introduce a clearer boundary between:
  - protocol-faithful motion session state in core
  - optional local prediction for responsiveness
  - frontend-owned spatial steering policy
- Ensure approach logic uses full `WorldPosition` distance/heading semantics and does not structurally assume same-height travel.

#### Completed Work
- Extended `LocomotionPrimitive::Drive` with optional `predicted_velocity`, separating wire-facing heading/speed intent from optional local prediction data.
- Updated `MovementSystem` to use `predicted_velocity` when provided, so local prediction is no longer forced onto planar X/Y-only translation.
- Updated `ApproachTargetController` to compute predicted velocity from full world-space position deltas using `global_coords()`, which allows local approach prediction to advance Z when the target is above or below the player.
- Added tests for vertical predicted-velocity generation and for world-space local prediction application.

#### Acceptance Criteria
- The system no longer assumes that “approach target” means flat-plane interpolation only.
- Local prediction can be improved or replaced without rewriting controller policy.
- The shared core model remains usable by a future 3D client that wants richer steering or terrain-aware motion.

#### Validation
- `cargo test -p holtburger-core --lib -- --nocapture` passed.
- `cargo test -p holtburger-core --test approach_target_controller_api -- --nocapture` passed.
- Targeted CLI approach and sticky-melee tests passed after the prediction-contract change.

#### Decisions
- Keep wire-facing drive intent minimal and ACE-shaped, but allow callers to attach richer prediction hints when they know more about local world-space motion than heading alone can express.
- Do not move collision or pathfinding policy into core as part of this phase; core now provides a better hook for richer local steering without becoming the navigation authority.

### Phase 4: Revalidate Controller Boundary For The 3D-Client Future

#### Status
Completed on 2026-03-23.

#### Deliverables
- Revisit [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs) and [crates/holtburger-core/ARCHITECTURE.md](../../crates/holtburger-core/ARCHITECTURE.md) to ensure the documented boundary matches the implementation after Phases 1-3.
- Keep `NavigationAutomation` as an optional geometry-blind helper, not a hidden movement authority.
- Confirm that a future 3D client can bypass these helpers while still reusing the core movement executor and packet lifecycle.

#### Completed Work
- Revalidated that [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs) still acts as an optional geometry-blind helper that emits `ClientCommand` values rather than owning packet/session semantics.
- Updated [crates/holtburger-core/ARCHITECTURE.md](../../crates/holtburger-core/ARCHITECTURE.md) so the documented movement boundary now matches the implementation: core owns motion-session lifecycle and edge detection, while frontends may supply richer local prediction hints without turning navigation helpers into hidden authorities.
- Confirmed that the current `LocomotionPrimitive` contract still allows a future 3D client to bypass `NavigationAutomation` and drive locomotion directly through core.

#### Acceptance Criteria
- Core owns ACE fidelity and motion-session correctness.
- Controllers own reusable decision logic, not transport semantics.
- Frontends remain free to replace geometry-blind navigation with richer local steering.

#### Validation
- The implemented code paths in core movement, controllers, and navigation now match the intended boundary documented in the architecture and plan.

#### Decisions
- Keep `NavigationAutomation` as a thin optional adapter layer that converts controller effects into command submissions; do not promote it into a hidden engine-owned movement policy layer.
- Treat richer local prediction as caller-supplied hint data, not as proof that core should absorb frontend steering or collision responsibilities.

## Risks And Mitigations

### Risk: Fixing observer lifecycle bugs by pushing more policy into core
Mitigation: Move only ACE packet/session semantics into core. Keep target selection, arrival policy, and navigation strategy outside.

### Risk: Over-correcting prediction and making the TUI feel laggy
Mitigation: Treat prediction as an optional layer. Preserve snappy local updates, but decouple them from packet cadence and observer-state correctness.

### Risk: Trying to solve 3D navigation now
Mitigation: Stop at a cleaner shared contract. Do not smuggle pathfinding or collision policy into this refactor.

## Definition Of Done

- Retail observers no longer see persistent wrong-direction running or endless spinning from normal approach/turn usage.
- Controller interruption paths do not suppress required server-visible stop semantics.
- `MoveToState` emission is edge-based or change-based, not timer-driven.
- The movement executor in core owns protocol-faithful motion lifecycle.
- Optional controllers remain optional and do not become the canonical navigation layer for all clients.
- Tests cover the corrected lifecycle and prediction boundaries.