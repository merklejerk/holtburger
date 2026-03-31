# Self-Player Direct-Drive Plan

## Context And Boundaries

### Goal
Replace the current self-player movement path with a first-class direct-drive loop in core so manual input and frontend-owned autonomous pursuit flow through the same control channel, the active spatial backend realizes the self-player body, and the TUI post-solve rewrite hack can be removed.

### In Scope
- Introduce a shared self-player drive intent model in `holtburger-core`.
- Let frontend navigation send autonomous drive into core through the command surface.
- Keep `MovementSystem` as the owner of self-player intent arbitration and outbound movement packet cadence.
- Extend simulation and the spatial solve contract so the active drive intent is passed into the solver as self-player control input.
- Teach the shared solver path to realize self-player direct drive according to local control state.
- Keep `holtburger-world` as the canonical owner of runtime bodies.
- Migrate the TUI from `TuiSpatialPhysics` post-solve rewrites to the shared direct-drive path.
- Add or update tests around command arbitration, wire emission, solve integration, and autonomous heartbeat behavior.

### Out Of Scope
- Pathfinding, navmesh work, or click-to-move routing.
- Reintroducing core-owned target-aware navigation policy.
- Reworking unrelated remote-entity interpolation behavior.
- Designing the final collision model for a future 3D client beyond the seam this plan must enable.

## Ground Truth

### Reference Sources
- Self-player movement bridge in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- Local simulation request building in [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs)
- Current movement contract in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs)
- Core command surface in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs)
- World-owned spatial runtime and solve contract in [crates/holtburger-world/src/spatial/scene.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial/scene.rs)
- TUI autonomous navigation in [apps/holtburger-cli/src/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/navigation.rs)
- TUI spatial hack layer in [apps/holtburger-cli/src/spatial.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/spatial.rs)
- Project architecture rules in [AGENTS.md](/home/cluracan/code/holtburger/AGENTS.md)
- Workspace architecture overview in [ARCHITECTURE.md](/home/cluracan/code/holtburger/ARCHITECTURE.md)
- ACE motion references in [ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs), [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Motion/MovementData.cs), and [ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs)

### Existing Patterns To Preserve
- `MovementSystem` remains the only owner of self-player wire protocol emission.
- `holtburger-world` remains the only owner of runtime body state.
- Frontend code owns navigation policy such as target selection, follow or approach behavior, and arrival heuristics.
- Shared code owns movement orchestration and solve integration.
- Phases should leave the workspace compiling and testable after each milestone.

## Dry-Run Findings Against The Current Codebase

This section records the concrete seams the rewritten plan will hit in the current code, so implementation is not surprised by hidden motion-state assumptions or TUI-only lifecycle behavior.

### Finding 1: Core Has No Autonomous Drive Command Surface Yet
Today the only movement-facing command entry in core is `ClientCommand::DriveMovement(MovementCommand)` in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs), and `MovementCommand` only models motion-state input, snap-facing, and stop.

Consequence:
- Phase 1 needs a new autonomous-drive command path in core rather than just a new internal type.
- [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs) and [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) both need command-routing changes.

### Finding 2: `MovementSystem` Internals Are Still Motion-State-Shaped
`MovementSystem` currently stores `queued_commands`, `active_public_motion`, `local_motion`, and `pending_snap_facing` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs). Its current tick consumes queued `MovementCommand`s, resolves them into `MotionState`, and still treats `local_motion` as the source of local runtime drive.

Consequence:
- Phase 2 is a real internal refactor, not just a command rename.
- The plan must replace or reshape `active_public_motion`, `local_motion`, and `current_local_intent`, not merely layer autonomous drive beside them.

### Finding 3: Core Still Realizes Manual Motion By Mutating Runtime Vectors Directly
`apply_motion_state`, `apply_motion_state_stop`, and `sync_local_motion_vectors` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) still call `world.set_local_player_runtime_vectors(...)` directly.

Consequence:
- The temporary compatibility bridge in Phase 2 is not optional in practice.
- Phase 3 must explicitly remove this path as the steady-state realization mechanism.

### Finding 4: Simulation And World Spatial Types Are Still Motion-State-Only
`ClientSimulationSystem` still builds `LocalMotionIntent` and `SpatialSolveRequest { dt, actors }` in [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs), while [crates/holtburger-world/src/spatial/scene.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial/scene.rs) defines no `local_drive` field yet.

Consequence:
- Phase 1 touches both `holtburger-core` and `holtburger-world` immediately.
- Every `SpatialPhysics` implementation, including `BasicSpatialPhysics`, `NoopSpatialPhysics`, and `TuiSpatialPhysics`, must be updated when `local_drive` lands.

### Finding 5: World Sampling Still Has No Self-Player-Specific Projection Hook
The runtime sampling path in [crates/holtburger-world/src/spatial/scene.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial/scene.rs) still derives runtime pose through generic `SpatialSampleMode` handling such as `SimulatingVelocity`, `SimulatingMotionState`, and `InterpolatingPosition`.

Consequence:
- Phase 3 needs a real insertion point for `SelfPlayerDriveProjectionState`; it cannot just be a naming exercise.
- The plan should expect changes both to solve-time realization and to post-solve sampling or runtime projection behavior.

### Finding 6: The TUI Still Publishes Pose-Shaped Dishonest Navigation
`DishonestNavigationDirective` in [apps/holtburger-cli/src/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/navigation.rs) still publishes `target_pose` plus `world_speed_mps`, and [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) forwards that through `TuiSpatialHackHandle::set_navigation_directive(...)`.

Consequence:
- Phase 4 is not just “send a core command instead.”
- The TUI must translate from its current pose-shaped dishonest navigation output into the new autonomous drive command shape.

### Finding 7: The TUI Already Owns Forced-Reposition And Teleport Reactions
The TUI game state currently calls `handle_forced_reposition` and `handle_teleport_start` on its navigation runtime in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs).

Consequence:
- Phase 4 must decide what remains frontend-owned navigation lifecycle policy versus what becomes core-owned drive cancellation or suppression semantics.
- The plan should not assume those reactions disappear automatically when the output shape changes.

### Finding 8: The Current Heartbeat Depends On Solved Velocity And Omega
`build_autonomous_position_heartbeat` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) only emits when solved velocity or omega are non-trivial.

Consequence:
- Phase 3 must preserve meaningful solved kinematics for grounded direct-drive, even if drive intent is no longer represented as additive velocity or omega.
- Otherwise heartbeat cadence will silently disappear.

### Finding 9: `handle_post_solve` Is Still Empty
`MovementSystem::handle_post_solve` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) is still a no-op.

Consequence:
- The plan cannot rely on an already-existing post-solve movement lifecycle seam.
- If post-solve bookkeeping is needed, Phase 3 will have to create that behavior explicitly.

### Finding 10: There Are Existing Core Controllers That This Plan Is Intentionally Not Using
Core already contains frontend-usable controllers like [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs), but the current plan keeps target-aware navigation policy in the TUI rather than reviving core-owned approach or follow orchestration.

Consequence:
- The implementation should treat those controllers as reference material or future options, not as part of this migration unless the plan is explicitly revised.

### Dry-Run Conclusion
The rewritten control-loop design still holds, but the codebase adds five practical constraints:

1. Phase 1 must introduce a new autonomous-drive command surface in core, not just an internal intent type.
2. Phase 2 must refactor `MovementSystem` internal state, not merely consume a new command.
3. Phase 3 must replace direct runtime-vector writes and add a real self-player projection hook in world spatial code.
4. Phase 4 must translate TUI pose-shaped dishonest navigation into the new command shape and preserve the frontend's forced-reposition and teleport policy behavior.
5. Heartbeat behavior depends on solved kinematics and must be validated during the migration.

## Target Architecture

### Control Loop
The intended self-player loop is:

1. Manual input or frontend navigation computes a self-player drive command.
2. The command is sent into core, where `MovementSystem` stores it as pending drive state.
3. On its tick, `MovementSystem` consumes pending drive state into the active intent for the current tick, emits any required `MoveToState` or stop message immediately, and exposes the coalesced intent to simulation.
4. On the simulation tick, the active spatial backend advances all bodies and treats the self-player specially according to the current local-control mode.
5. On later movement ticks, `MovementSystem` observes the solved self-player body and uses that solved state for autonomous heartbeat cadence and other outbound decisions.

This is a one-way control loop with one observation path back from solved state. It is not a design where movement and the solver both own the local body.

### Ownership Rules
- Navigation decides whether autonomous drive should continue, stop, or change mode.
- `MovementSystem` owns pending input, arbitration, wire emission, and movement lifecycle bookkeeping.
- Simulation passes the coalesced drive intent to the solver.
- The spatial backend owns realization of the self-player runtime body for the current tick.
- `MovementSystem` records authoritative server-control, teleport, and forced-reposition epochs immediately in event handlers, then only observes solved runtime state after solve for outbound cadence and related decisions. It does not reclaim runtime-body ownership.

### Core Design Rules
- Direct drive is a locomotion control channel, not additive body velocity or omega.
- Manual input stays expressed as the existing ACE-shaped `MotionState` contract.
- Autonomous drive stays non-key-shaped, but should stay ACE-shaped in speed semantics by choosing `Gait` rather than free-form speed values.
- Arrival thresholds remain navigation policy. They do not belong in `MovementSystem`.
- The shared solver path, not the TUI, must ultimately own the geometry-blind direct-drive behavior needed by the current client.
- [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) should be treated as a rewrite target, not as legacy structure to preserve. Keep packet semantics and proven helpers where they still fit, but do not let the old `active_public_motion` or `local_motion` architecture dictate the new design.

## Candidate Data Shapes

### Self-Player Drive Intent

```rust
pub enum PlayerDriveIntent {
    ManualHeld(MotionState),
    Autonomous(AutonomousDriveIntent),
    SnapFacing { heading: f32 },
    Stop,
}

pub struct AutonomousDriveIntent {
    pub desired_world_delta: Vector3,
    pub desired_heading: Option<f32>,
    pub gait: Gait,
    pub force_grounded: bool,
}
```

Notes:
- `ManualHeld(MotionState)` preserves the existing public held-input contract and wire semantics.
- `AutonomousDriveIntent` is the core-side representation of the wonky geometry-blind local drive request the TUI needs today: move roughly this far in world space this tick, maybe face this heading, use this gait, and optionally force grounded treatment.
- It is deliberately not pretending to be pathfinding, click-to-move, or a rich locomotion planner. It is the minimal current-tick control packet needed to pull off the hacked TUI 3D movement through the shared movement and solver seam.
- Frontend navigation may use a similar directive shape internally, but its richer local policy state should stay in the frontend rather than leaking into core.

### Simulation Bridge

```rust
pub struct LocalDriveControl {
    pub body_id: SpatialBodyId,
    pub intent: PlayerDriveIntent,
}

pub struct SpatialSolveRequest {
    pub dt: Duration,
    pub actors: SmallVec<[SolveActorInput; 1]>,
    pub local_drive: Option<LocalDriveControl>,
}
```

The key architectural change is that the solver receives self-player drive as explicit control input instead of inferring it only from precomputed body velocity and omega.

### Self-Player Solver Modes

```rust
pub enum SelfPlayerDriveProjectionState {
    LocalGroundedDirectDrive,
    LocalAirborne,
    ServerControlled,
    AuthorityFrozen,
}
```

These are projection or ownership modes, not replacements for generic `SpatialSampleMode` output.

`AuthorityFrozen` means the client has recently received a server-authoritative correction such as a teleport, forced reposition, or similar resync event, and local direct-drive should be temporarily suspended while the runtime body accepts that authority cleanly. It is a short-lived correction state, not a general movement mode.

Initial derivation rule:

1. If a recent server-authoritative correction is still being settled, use `AuthorityFrozen`.
2. Else if server-controlled movement is active, use `ServerControlled`.
3. Else if local drive is active and the solved body is grounded, use `LocalGroundedDirectDrive`.
4. Else use `LocalAirborne`.

## Execution Model By Subsystem

### Navigation
- Computes desired autonomous motion from frontend policy.
- Decides arrival, sticky-melee behavior, follow versus approach behavior, and when to stop.
- Sends `PlayerDriveIntent::Autonomous` into core through `ClientCommand` or an equivalent command entry point.
- For the current TUI, this is the frontend saying: "do the dishonest local 3D movement for this tick in this approximate world-space direction," not asking core to solve a richer navigation problem.

### MovementSystem
- Accepts manual, autonomous, snap-facing, and stop commands.
- Stores pending drive state.
- Consumes pending drive state into the active intent for the current tick.
- Emits `MoveToState`, stop, and snap-facing messages immediately from the active intent.
- Exposes the active coalesced self-player drive intent to simulation.
- Records authoritative server-control, teleport, and forced-reposition epochs in event handlers.
- Observes solved self-player state after solve for heartbeat cadence and other outbound decisions.

### Simulation
- Builds `SpatialSolveRequest` including `local_drive` for the self-player.
- Passes all actors plus the self-player control intent into the active spatial backend.
- Applies solved self-player results back into world runtime state without frontend post-solve rewrites.

### Spatial Backend
- Advances and constrains all bodies.
- Treats the self-player specially based on `SelfPlayerDriveProjectionState`.
- In `LocalGroundedDirectDrive`, realizes current-tick drive directly instead of relying on generic velocity-to-position dead reckoning.
- Still emits solved velocity, omega, and contact as observational outputs for wire cadence and downstream logic.

For the current TUI-oriented backend behavior, this realization is intentionally a geometry-blind cheat. The point of the seam is not to make that cheat disappear today. The point is to move it out of frontend post-solve rewrites and into the shared movement-plus-solver control flow where a future backend can replace it with something less fake.

## Phased Implementation

### Phase 1: Add The Shared Drive Intent Seam

#### Deliverables
- Add shared self-player drive intent types in core.
- Extend the core command surface so autonomous drive can reach `MovementSystem` through a real `ClientCommand` path rather than only through `MovementCommand`.
- Introduce the initial movement-side pending autonomous drive storage and routing hooks.
- Extend the spatial solve contract with `local_drive`.
- Thread the new solve field through simulation without yet changing final realization behavior.
- Update all `SpatialPhysics` implementations and related tests that currently assume `SpatialSolveRequest { dt, actors }`.

#### Files And Symbols
- [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs)
- [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs)
- [crates/holtburger-world/src/spatial/scene.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial/scene.rs)
- Any affected `SpatialPhysics` implementations such as [apps/holtburger-cli/src/spatial.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/spatial.rs)

#### Acceptance Criteria
- Core can represent `PlayerDriveIntent::Autonomous` without frontend-owned solver types.
- Core has a dedicated autonomous-drive command surface instead of forcing the TUI through `MovementCommand`.
- `MovementSystem` can store pending autonomous drive state.
- `SpatialSolveRequest` can carry self-player drive intent.
- All existing spatial backends still compile against the extended solve contract.
- The workspace builds and updated type-level tests pass.

### Phase 2: Move MovementSystem To Active-Intent Arbitration

#### Deliverables
- Rewrite the internal control-flow of [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) from first principles around the new drive loop.
- Rebuild `MovementSystem` state so manual held motion, autonomous drive, snap-facing, and stop can be consumed into one active intent per tick.
- Replace the current `active_public_motion`, `local_motion`, and `current_local_intent` flow rather than layering autonomous drive beside it.
- Make pending drive commands get consumed into active control state rather than replayed indefinitely on later ticks.
- Emit `MoveToState` or stop messages directly from that active intent during the movement tick.
- Keep existing wire semantics for held manual movement.
- Add a temporary compatibility realization path so the control loop is correct before the shared solver fully owns realization.

Implementation bias for this phase:
- Prefer deleting or replacing legacy state holders and tick paths over threading new concepts through them.
- Only carry forward helpers from the current file when they are still locally coherent in the rewritten design, for example packet encoding helpers and sequence bookkeeping.
- Do not preserve the old structure just to minimize diff size; coherence matters more than edit count here.

#### Files And Symbols
- [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs)
- [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)

#### Acceptance Criteria
- Manual and autonomous drive are mutually exclusive according to explicit arbitration rules.
- The rewritten `MovementSystem` no longer reads like a motion-state-only legacy path with autonomous drive bolted onto the side.
- Pending drive commands are consumed into active state and are not blindly re-sent forever just because they were once queued.
- `MovementSystem` sends `MoveToState`-style messages from the active intent during its normal tick.
- `MovementSystem` exposes the coalesced intent to simulation.
- Existing manual movement behavior remains functional.

### Phase 3: Teach The Shared Solver To Realize Self-Player Drive

#### Deliverables
- Implement shared-solver realization of `local_drive` for the self-player.
- Introduce the derived self-player projection or ownership state.
- Add a real self-player-specific projection hook in world spatial code rather than only naming `SelfPlayerDriveProjectionState` in the plan.
- Remove reliance on direct runtime vector writes as the long-term realization path.
- Preserve solved velocity, omega, and contact outputs for heartbeat and downstream logic.
- Create any required post-solve movement bookkeeping explicitly rather than assuming `handle_post_solve` already does useful work.

#### Files And Symbols
- [crates/holtburger-world/src/spatial/scene.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial/scene.rs)
- [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs)
- [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)

#### Acceptance Criteria
- The active spatial backend can realize self-player drive from `local_drive`.
- `LocalGroundedDirectDrive` bypasses generic local dead reckoning for grounded self-player movement.
- The solver remains the owner of the self-player runtime body.
- The temporary compatibility path from Phase 2 is no longer required for the steady-state manual path.
- Heartbeat behavior is validated so grounded direct-drive still produces the solved kinematics needed by outbound autonomous position cadence.
- Any new post-solve movement bookkeeping is implemented explicitly rather than being left as an implied future seam.

### Phase 4: Migrate TUI Autonomous Pursuit To The Shared Drive Channel

#### Deliverables
- Update TUI navigation to translate its current pose-shaped dishonest navigation output into autonomous drive commands for core.
- Keep arrival and pursuit heuristics in the TUI navigation layer.
- Preserve the TUI's existing forced-reposition and teleport-start navigation reactions, while deciding explicitly which parts remain frontend policy versus shared drive lifecycle behavior.
- Remove dependence on `TuiSpatialPhysics` post-solve self-player rewrites.
- Route approach, follow, and sticky-melee through the shared direct-drive channel.

#### Files And Symbols
- [apps/holtburger-cli/src/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/navigation.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)
- [apps/holtburger-cli/src/spatial.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/spatial.rs)
- [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)

#### Acceptance Criteria
- TUI navigation sends autonomous drive through core instead of a TUI-only spatial directive.
- The TUI's current pose-shaped dishonest navigation output has a concrete translation path into the new autonomous drive command shape.
- TUI autonomous movement no longer depends on a post-solve local body rewrite.
- Frontend arrival heuristics stay outside `MovementSystem`.
- Forced-reposition and teleport-start reactions still behave correctly after the migration.
- Approach, follow, and sticky-melee remain functional.

### Phase 5: Cleanup And Hardening

#### Deliverables
- Remove temporary compatibility paths and dead code.
- Tighten docs around the final control loop and ownership model.
- Add regression coverage for arbitration, heartbeat cadence, stop edges, forced reposition, teleport-start interruption, and autonomous interruption.
- Define the backend extension point a future collision-aware client will implement.

#### Files And Symbols
- [docs/plans/self-player-direct-drive-plan.md](/home/cluracan/code/holtburger/docs/plans/self-player-direct-drive-plan.md)
- Relevant tests in `holtburger-core`, `holtburger-world`, and `holtburger-cli`

#### Acceptance Criteria
- There is one self-player drive loop shared by manual and autonomous movement.
- `MovementSystem` owns intent and wire cadence, not runtime-body realization.
- The active spatial backend owns self-player realization.
- `TuiSpatialPhysics` is gone or reduced to zero long-term architectural responsibility.
- Regression coverage proves the migrated path preserves heartbeat cadence and the TUI's forced-reposition or teleport lifecycle behavior.
- Relevant build and test suites pass.

## Risks And Mitigations

### Risk: Movement And Solver Drift Back Into Shared Ownership
Mitigation:
- Keep `local_drive` one-way from movement into simulation and the solver.
- Keep event-handler bookkeeping limited to authoritative epoch tracking rather than runtime-body mutation.
- Only let movement observe solved body state after solve.
- Do not allow frontend or movement code to keep post-solve self-player rewrite hooks.

### Risk: Autonomous Drive Starts Smuggling Navigation Policy Into Core
Mitigation:
- Keep arrival thresholds, target choice, and pursuit-mode heuristics in frontend navigation.
- Limit `AutonomousDriveIntent` to the current-tick fields the solver actually needs.

### Risk: Shared Solver Realization Regresses Current TUI Feel
Mitigation:
- Add regression tests for the geometry-blind modes the TUI depends on.
- Land the shared-solver direct-drive path before removing the TUI shim.

### Risk: `AutonomousDriveIntent` Sounds More General Than It Really Is
Mitigation:
- Document plainly that the current use case is dishonest geometry-blind TUI movement, not a general navigation or pathfinding contract.
- Keep the intent minimal and current-tick-shaped so it reflects the actual hacked movement being requested today.
- Only generalize the contract later if a second real backend proves that extra abstraction is necessary.

### Risk: Wire Semantics Regress While Refactoring Local Control
Mitigation:
- Preserve `MotionState` as the manual input contract.
- Keep `MovementSystem` as the only place that emits `MoveToState` and heartbeat messages.
- Add focused tests for motion-state pulses, stop edges, and autonomous position cadence.

## Definition Of Done

- Manual input and autonomous pursuit both flow through `PlayerDriveIntent`.
- `MovementSystem` stores pending drive state, consumes it into the active intent, and emits `MoveToState`-style wire messages from that intent.
- `MovementSystem` records authoritative server-control, teleport, and forced-reposition epochs in event handlers rather than deferring that bookkeeping to the movement tick.
- Simulation passes the active self-player drive intent into the solver through `SpatialSolveRequest`.
- The active spatial backend realizes the self-player body according to the current projection or ownership mode.
- `MovementSystem` uses solved self-player state for heartbeat cadence and other outbound decisions instead of owning runtime-body advancement.
- The TUI no longer depends on a post-solve self-player rewrite hack.
- `holtburger-world` remains the only owner of runtime bodies.
- Relevant build and test suites pass.

## Living Worksheet

### Task Checklist
- [ ] Phase 1: Add the shared drive intent seam.
- [ ] Phase 2: Move `MovementSystem` to active-intent arbitration.
- [ ] Phase 3: Teach the shared solver to realize self-player drive.
- [ ] Phase 4: Migrate TUI autonomous pursuit to the shared drive channel.
- [ ] Phase 5: Remove temporary compatibility paths and harden tests and docs.

### Decisions Log
- Decision: the plan follows a one-way control loop where movement owns intent and wire cadence, while the active spatial backend owns runtime-body realization.
- Decision: manual input stays `MotionState`-shaped.
- Decision: [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) should be rewritten from first principles around the new drive loop rather than incrementally accreting new behavior onto its current motion-state-shaped internals.
- Decision: autonomous drive uses `Gait`, not arbitrary speed fields.
- Decision: arrival heuristics remain frontend navigation policy.
- Decision: the shared solver path eventually owns the TUI's geometry-blind direct-drive behavior.

### Verification Log
- Pending implementation.

### Open Questions
- None at plan level right now. Resolve naming and API details during implementation as long as they preserve the control loop and ownership rules above.