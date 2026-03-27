# Stateful Movement Input Plan

## Context And Boundaries

### Goal
Refactor `holtburger-core` movement around stateful low-level control inputs that match real client locomotion, while keeping target-aware pulse planning in optional navigation helpers rather than baking world-position semantics into the movement actuator.

### In Scope
- Replace speed-shaped `Drive` semantics as the long-term movement input model with stateful low-level control inputs.
- Remove `DriveVelocity` entirely and move its target-aware steering logic into navigation/controller planning.
- Make movement commands enqueue-only so `MovementSystem` buffers active controls, synthesizes packet edges on tick, and drives matching local self-prediction.
- Keep navigation target-position logic in `NavigationAutomation` and reusable controllers, where it can translate world-space goals into timed pulses.
- Refactor navigation/controller outputs so `Approach`, `Follow`, and sticky-melee pursuit emit timed low-level movement inputs instead of analog-speed-shaped drive requests.
- Add explicit navigation-side pulse planning, hysteresis, and reissue rules that use world-space target coordinates plus movement timing helpers.
- Derive contact and motion-style metadata inside `MovementSystem` from world state so the normal public movement input contract no longer carries packet-construction metadata.
- Add helper APIs so navigation can ask movement for timing and displacement estimates without duplicating locomotion constants.
- Preserve compatibility long enough to migrate existing `Approach`, `Follow`, and sticky-melee flows incrementally.

### Out Of Scope
- Sending target coordinates to the server.
- Full pathfinding or 3D-client input mapping.
- Reworking the TUI UX wholesale.
- Finalizing every possible locomotion command in one pass if ACE behavior is still unverified.
- Replacing navigation with a mandatory core-owned subsystem.

## Ground Truth And Existing Patterns

### Reference Sources
- Current movement executor in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- Current primitive surface in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs)
- Current optional navigation helper in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs)
- Current approach controller in [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs)
- Core architecture boundary in [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md)
- Workspace architectural rules in [AGENTS.md](/home/cluracan/code/holtburger/AGENTS.md)
- ACE client movement handling in [ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs)
- ACE motion interpretation in [ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs)
- ACE observer rebroadcast normalization in [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Motion/MovementData.cs)

### Existing Patterns To Follow
- Optional reusable controllers layered above primitives in [crates/holtburger-core/src/client/controllers/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/mod.rs)
- Frontend-owned orchestration via `NavigationAutomation` in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs)
- Core movement remaining the sole packet executor in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)

## Dry-Run Findings Against The Current Codebase

This section validates the plan against the code as it exists today and calls out the migration seams we should treat explicitly instead of discovering them during implementation.

### What The Current Code Already Supports Cleanly
- `holtburger-core` already has a dedicated movement executor boundary: `ClientCommand::ExecuteMovement(MovementRequest)` enters through [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs) and is executed centrally in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs).
- `NavigationAutomation` already acts as an optional policy layer above movement and emits `ClientCommand`s in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs), which means the architecture already leans toward “target-aware planning above low-level actuation”.
- `Client::run` already owns recurring cadences in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs): a physics tick for local prediction and a separate network heartbeat tick. That gives us a real place to host stateful control expiry if we choose the cadence carefully.
- `MovementSystem` already derives most packet semantics from world state in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs), especially cached server motion style and grounded/contact fallback, so removing public metadata from the normal movement input contract is plausible.

### Gaps And Awkwardness The Plan Must Account For

#### Gap 1: `MovementSystem::tick` Conflicts With The Current Split Between Command-Time Execution And Client Loop Ticks
Today, movement packet emission happens immediately when `ExecuteMovement` is handled in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs), while local self-prediction advances later during the physics tick in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs).

That means the plan's proposed `MovementSystem::tick` API is directionally right but operationally incomplete. We need to decide whether:
- packet edge synthesis moves entirely onto the client loop tick, or
- enqueueing an input still performs an immediate flush step while tick only handles expiry and ongoing state.

Consequence:
- Phase 2 needs explicit client-loop integration work, not just `movement.rs` refactoring.

Decision:
- packet edge synthesis moves entirely onto the shared client-loop tick.

#### Gap 2: The Public Command Surface Only Speaks `MovementRequest`
The only public movement command today is `ClientCommand::ExecuteMovement(MovementRequest)` in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs).

Consequence:
- introducing `MovementInput` or `MovementControl` requires a new enqueue-style `ClientCommand` variant.
- `ExecuteMovement(MovementRequest)` should be treated as a temporary compatibility shim, not the long-term public movement contract.
- The plan must treat command-surface migration as a first-class deliverable, not an implementation detail.

#### Gap 3: Navigation Emits Concrete `ClientCommand`s, Not Pure Plans
`NavigationAutomation` currently returns `NavigationUpdate { commands: Vec<ClientCommand> }` and inserts concrete movement commands directly in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs).

Consequence:
- the migration path is simplest if navigation continues to emit fully translated commands, but those commands should now carry raw `MovementInput`.
- A separate `NavigationLocomotionPlan` would add another translation layer without a proven need today.

#### Gap 4: Navigation Currently Injects `SnapFacing` As A Separate Command Edge
When direct approach starts, navigation may insert an initial `SnapFacing` command ahead of the movement command in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs).

Consequence:
- the new pulse-based navigation plan must say explicitly whether facing remains a separate pre-pulse command, becomes part of a held/pulsed locomotion envelope, or is removed for certain movement modes.
- Otherwise we risk migrating pulse planning while accidentally preserving a stale “snap first, then run” assumption.

Clarification:
- `SnapFacing` is not a holdable or pulsed locomotion control. It is a one-shot movement input.
- The current preferred policy is that navigation does not emit `SnapFacing` for approach/follow. Heading-bearing locomotion plus movement-owned turn/run synthesis should handle reorientation.
- If a future caller still needs explicit immediate reorientation, that should be justified independently rather than preserved as a default navigation pre-edge.

#### Gap 5: Controller Effect Vocabularies Are Still Speed-Shaped Or Two-Step
`ApproachTargetController` currently emits `ApproachTargetEffect::Movement(MovementPrimitive)` and `MaintainRangeController` emits `MaintainRangeEffect::StartApproach { arrival_distance }` in [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) and [crates/holtburger-core/src/client/controllers/maintain_range.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/maintain_range.rs).

Consequence:
- Phase 4 is not just a `navigation.rs` rewrite.
- We must either:
    - change controller effect vocabularies to emit pulse-plan intent directly, or
    - keep the current two-step orchestration and add a navigation-local translation layer.

#### Gap 6: `DriveVelocity` Serves Two Roles Today
`MovementPrimitive::DriveVelocity` currently acts both as a navigation-oriented request shape and as a direct “explicit predicted velocity” path in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs).

Consequence:
- removing `DriveVelocity` is architecturally correct, but we must explicitly replace any remaining direct callers with a low-level control equivalent rather than silently dropping capability.
- Navigation absorbs the target-aware steering logic; movement keeps only low-level control state.

#### Gap 7: Public Metadata On Movement Inputs Is Probably A Compatibility Artifact
Today `MovementPacketMetadata` is attached to each `MovementRequest`, but most call sites pass defaults while movement already derives motion style and grounded/contact fallback from world state.

Consequence:
- the normal public movement input contract should drop metadata entirely.
- if explicit override behavior is still needed later, it should come back as a specialized internal or advanced API rather than as part of every movement input.

#### Gap 8: `SnapFacing` Still Has Non-Navigation Callers
`SnapFacing` is not just a navigation artifact. The TUI uses it for manual left/right rotation in [apps/holtburger-cli/src/pages/game/input.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/input.rs), and combat automation emits it for explicit turn-to behavior in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs).

Consequence:
- removing navigation's pre-approach `SnapFacing` does not mean removing `SnapFacing` entirely.
- the new public movement input surface must preserve a one-shot direct reorientation path for non-navigation callers.
- Phase 2 must account for the TUI currently performing an optimistic local heading update before it sends the command, or we risk ending up with double-applied or ownership-confused heading updates during migration.

Decision:
- the CLI should stop mutating local player heading before sending `SnapFacing`.
- `MovementSystem` owns local optimistic heading application for accepted `SnapFacing` inputs.

### Dry-Run Consequence
The plan remains viable, but it understated three kinds of migration work:
- command-surface changes in `ClientCommand` and `commands.rs`
- client-loop cadence integration in `client/mod.rs`
- controller and navigation effect-vocabulary changes, not just movement-executor changes

It also needs one explicit preservation rule:
- `SnapFacing` survives as a direct one-shot manual/combat input even though navigation stops emitting it for approach/follow.

To stay honest to the current codebase, later phases should call those out explicitly rather than treating them as incidental fallout.

## Proposed API Shape

### Core Principle
Movement inputs should express low-level control state, not target-position semantics and not fake analog throttle. Navigation remains free to be target-aware, but it must translate that intent into low-level control pulses before crossing the boundary into `MovementSystem`.

### Candidate Low-Level Movement API

```rust
pub enum MovementControl {
    Run { heading: f32 },
    Walk { heading: f32 },
    Backstep { heading: f32 },
    StrafeLeft { heading: f32 },
    StrafeRight { heading: f32 },
    TurnLeft,
    TurnRight,
}

pub enum MovementInput {
    Hold { control: MovementControl },
    Pulse { control: MovementControl, duration: Duration },
    SnapFacing { heading: f32 },
    Stop,
    ReleaseLocomotion,
    ReleaseTurning,
}
```

### Candidate MovementSystem Tick API

```rust
impl MovementSystem {
    pub fn enqueue_input(&mut self, input: MovementInput, now: Instant);

    pub async fn tick(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>>;
}
```

### Candidate Helper Surface For Navigation

```rust
pub struct MovementKinematics {
    pub run_speed_mps: f32,
    pub walk_speed_mps: f32,
    pub turn_rate_rad_per_sec: f32,
}

impl MovementSystem {
    pub fn kinematics(&self) -> MovementKinematics;

    pub fn estimate_duration_for_distance(
        &self,
        control: MovementControl,
        distance_m: f32,
    ) -> Duration;

    pub fn estimate_displacement(
        &self,
        control: MovementControl,
        duration: Duration,
    ) -> f32;
}
```

### Candidate Navigation Usage

```rust
let heading = player_position.heading_to(&target_position);
let remaining = (distance_to_target - effective_arrival_distance).max(0.0);
let pulse = movement.estimate_duration_for_distance(
    MovementControl::Run { heading },
    remaining.min(0.75),
);

commands.push(ClientCommand::EnqueueMovementInput(
    MovementInput::Pulse {
        control: MovementControl::Run { heading },
        duration: pulse,
    }
));
```

The important boundary here is that navigation still owns `target_position`, `remaining`, `arrival_distance`, and hysteresis. Movement only receives low-level control intent plus timing.

### Public Command Surface Direction

```rust
pub enum ClientCommand {
    EnqueueMovementInput(MovementInput),
    // temporary compatibility shim during migration:
    ExecuteMovement(MovementRequest),
}
```

The long-term direction is that movement commands enqueue intent only. `MovementSystem` owns packet generation on tick and no longer emits wire movement directly from the command handler.

Navigation should emit raw `MovementInput` directly. If navigation later needs richer private planning state, that state should stay internal to `NavigationAutomation` rather than becoming a second public locomotion-plan abstraction.

## Resolved Design Choices

- Phase 1 supports run locomotion only.
- Turn control is independent from locomotion, and `MovementSystem` merges active turn and run state on tick.
- `SnapFacing` is a one-shot `MovementInput`, not a `MovementControl`.
- Navigation does not emit `SnapFacing` for normal approach/follow pulses.
- `SnapFacing` remains available for direct manual rotation and explicit combat turn-to callers.
- Frontends do not pre-mutate local heading for `SnapFacing`; movement owns that optimistic update path.
- One shared tick cadence is owned by the core client loop.
- Navigation emits raw `MovementInput` directly.
- Enqueued movement inputs wait until the next tick for wire synthesis.
- No specialized explicit metadata-override path is planned today.

## Phased Implementation

### Phase 1: Introduce Stateful Movement Input Model

#### Deliverables
- Add new low-level movement control types in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs)
- Remove `DriveVelocity` from [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs)
- Add buffering state for held and pulsed controls in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- Model `SnapFacing` as a one-shot `MovementInput` in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs) rather than as a holdable control
- Add the necessary enqueue-style public command surface in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs) and [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- Preserve a direct enqueue path for one-shot `SnapFacing` callers outside navigation during the compatibility window
- Remove `MovementPacketMetadata` from the normal public movement input contract and derive contact/motion-style semantics inside movement
- Keep a temporary adapter from existing `MovementPrimitive` requests into the new control model so current callers continue to work during migration

#### Acceptance Criteria
- `MovementSystem` can represent persistent locomotion and timed pulses without requiring target coordinates.
- `DriveVelocity` is gone from the public movement primitive surface.
- `SnapFacing` is represented as a one-shot input rather than as holdable control state.
- Manual rotation and explicit combat turn-to callers still have a valid one-shot `SnapFacing` path.
- Normal movement inputs no longer require public metadata.
- Existing tests still compile behind the adapter layer.
- New unit tests cover pulse expiry, held-state overwrite, and release behavior.

### Phase 2: Move Packet Synthesis And Local Prediction Onto Active Control State

#### Deliverables
- Make `tick` the authoritative place that expires timed inputs, derives the active locomotion state, and decides whether packet edges must be sent.
- Make local self-prediction derive from the exact same active control state used for wire emission.
- Keep stop-pulse obligations and server-controlled motion reconciliation in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- Update the main client loop in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs) so cadence ownership is explicit and compatible with the new movement tick model.
- Change [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs) so movement commands enqueue into `MovementSystem` instead of sending wire movement immediately.
- Remove frontend-owned optimistic heading mutation for manual `SnapFacing` and move that responsibility behind the movement input boundary.

#### Acceptance Criteria
- Local velocity and omega always match the active buffered control state.
- Packet emission is edge-based, tick-driven, and no longer depends on navigation-provided analog speed.
- The movement command handler no longer sends wire motion directly.
- Manual `SnapFacing` does not double-apply because optimistic heading ownership lives in `MovementSystem`, not the frontend.
- Tests prove that held run, pulsed run, and stop transitions stay packet-consistent.

### Phase 3: Add Navigation-Facing Timing Helpers

#### Deliverables
- Add helper APIs for movement timing/kinematics in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) or a nearby helper module.
- Document which values are protocol-shaped approximations versus authoritative server guarantees.
- Add focused tests around helper outputs so navigation and movement share one timing vocabulary.

#### Acceptance Criteria
- Navigation can estimate run pulse duration without hard-coding locomotion constants.
- Helper math stays colocated with the movement actuator semantics.
- Tests cover at least run-speed and turn-rate helper behavior.

### Phase 4: Refactor Navigation Controllers To Emit Pulse Plans

#### Deliverables
- Update [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs) to own pulse scheduling for approach/follow/sticky-melee pursuit using world-space target coordinates.
- Update [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) and any maintained-range helpers so they emit low-level timed inputs rather than speed-shaped `Drive` requests for navigation use cases.
- Keep target-position logic, arrival thresholds, slowdown bands, and hysteresis entirely in navigation/controllers.
- Add or update navigation-local cadence state as needed so pulse planning is stable across ticks instead of recomputing analog speed every frame.
- Keep navigation emitting `ClientCommand`s directly, but change those commands to carry raw `MovementInput` instead of `MovementRequest`.
- Remove the current pre-approach `SnapFacing` injection from navigation and let heading-bearing locomotion plus movement-owned turn/run synthesis handle orientation.
- Retain `MovementPrimitive` compatibility only for call sites that genuinely represent direct locomotion rather than navigation.

#### Acceptance Criteria
- Approach and follow no longer rely on continuous speed as their primary actuator signal.
- Navigation contains the target-aware convergence and pulse-planning logic instead of delegating convergence to the movement actuator.
- Navigation emits raw `MovementInput` directly rather than introducing a second public locomotion-plan abstraction.
- Approach and follow do not prepend explicit `SnapFacing`; orientation is handled by the movement-side execution of heading-bearing locomotion and independent turn state.
- Oscillation-focused tests exist for near-arrival pulse planning.
- Navigation remains optional and movement remains reusable for a future 3D client.

### Phase 5: Remove Legacy Speed-Shaped Navigation Coupling

#### Deliverables
- Delete or narrow legacy `Drive` usages that only existed for navigation throttle shaping.
- Simplify navigation/controller APIs so they no longer expose analog movement speed as the main way to express approach/follow convergence.
- Update docs in [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md) to describe the new stateful movement boundary.
- Add or update a repository memory note capturing the final boundary.

#### Acceptance Criteria
- The core movement API no longer suggests analog speed is the canonical navigation-to-actuator contract.
- Documentation aligns with implementation.
- The migration leaves the codebase in a compilable, testable state without duplicate movement models.

## Risks And Mitigations

### Risk: Overfitting The API To The TUI
If movement inputs start carrying target coordinates or arrival-shell semantics, the low-level client API will drift toward the headless/TUI use case.

Mitigation:
- Keep target-aware logic in navigation and controllers.
- Restrict movement inputs to low-level locomotion and timing only.

### Risk: Timed Pulse Wrappers Become The Only Supported Input Model
If the API only supports `Run { heading, duration }`, future 3D-client manual input will be awkward.

Mitigation:
- Distinguish persistent held controls from timed pulse wrappers.
- Treat duration as scheduling metadata, not locomotion identity.

### Risk: Navigation Reimplements Movement Constants Incorrectly
If navigation hard-codes run distance, turn rate, or pulse heuristics, it will drift from the actuator.

Mitigation:
- Expose helper APIs from movement for timing and displacement estimation.
- Keep tests around those helpers in `holtburger-core`.

### Risk: Navigation Pulse Planning Becomes Hidden Ad Hoc State
If `NavigationAutomation` grows pulse timers and hysteresis without an explicit API shape, we will replace one unclear abstraction with another.

Mitigation:
- Keep navigation outputs as raw `MovementInput`, and make any extra planning state private but well-tested inside `NavigationAutomation`.
- Add navigation-focused tests that prove pulse cadence and stop conditions around the arrival shell.

### Risk: Migration Leaves Two Competing Movement Models In Place Too Long
Adapters are useful, but lingering dual models will make future behavior hard to reason about.

Mitigation:
- Time-box the compatibility layer.
- Remove legacy speed-shaped navigation coupling as an explicit final phase.

### Risk: Dropping Public Metadata Removes Needed Escape Hatches
If a future caller genuinely needs explicit motion-style or contact overrides, deleting metadata entirely could paint us into a corner.

Mitigation:
- Remove metadata from the normal public movement input contract, not necessarily from all possible internals.
- Reintroduce any proven override need as a specialized advanced API only after a concrete caller exists.

## Definition Of Done

- `MovementSystem` accepts stateful low-level control inputs and timed pulses.
- `MovementSystem::tick` is the sole source of truth for active locomotion, packet emission, and matching local self-prediction.
- Movement commands enqueue intent only; the command handler does not send wire movement directly.
- Navigation helpers remain optional and target-aware, but they emit low-level pulse intents or explicit locomotion plans rather than analog speed.
- `NavigationAutomation` and reusable navigation controllers explicitly own approach/follow pulse planning, hysteresis, and target-space convergence policy.
- `DriveVelocity` is removed.
- Public movement inputs no longer carry `MovementPacketMetadata` on the normal path.
- Movement exposes helper timing APIs so navigation does not duplicate locomotion constants.
- `cargo test -p holtburger-core` passes.
- Core architecture docs accurately describe the new boundary.

## Living Worksheet

### Task Checklist
- [x] Phase 1: Add low-level movement control and input types.
- [x] Phase 1: Remove `DriveVelocity` and update its call sites.
- [x] Phase 1: Add buffered held/pulsed control state to `MovementSystem`.
- [x] Phase 1: Add enqueue-style movement commands and compatibility shims.
- [x] Phase 1: Remove public movement metadata from the normal input contract.
- [ ] Phase 2: Make `tick` own locomotion expiry and wire synthesis.
- [ ] Phase 2: Move wire movement generation out of the command handler.
- [ ] Phase 2: Make local self-prediction derive from active control state only.
- [ ] Phase 3: Add timing and displacement helpers for navigation.
- [ ] Phase 4: Update approach/follow/sticky-melee navigation to emit low-level timed pulses.
- [ ] Phase 4: Add navigation-local pulse planning and hysteresis state where needed.
- [ ] Phase 5: Remove legacy speed-shaped navigation coupling.
- [ ] Phase 5: Update architecture docs and notes.

### Decisions Log
- Movement remains a reusable low-level actuator in `holtburger-core`, not a target-position navigation system.
- Navigation stays optional and is responsible for translating target positions into timed pulses.
- Timed pulses are wrappers around low-level control state, not the only movement input model.
- Navigation-system changes are part of the migration, not just a follow-on cleanup after movement changes land.
- `DriveVelocity` is removed; target-aware steering logic moves into navigation.
- Movement commands become enqueue-only; `MovementSystem` sends wire movement on tick.
- `MovementPacketMetadata` drops out of the normal public movement input contract and becomes an internal derivation concern unless a concrete override caller proves otherwise.
- Phase 1 supports run locomotion only.
- Turn control is independent and is merged with locomotion by `MovementSystem` on tick.
- `SnapFacing` is a one-shot `MovementInput`, not a `MovementControl`.
- Navigation does not emit `SnapFacing` for normal approach/follow behavior.
- `SnapFacing` remains a supported direct input for manual rotation and explicit combat turn-to behavior.
- Optimistic local heading updates for `SnapFacing` are movement-owned, not frontend-owned.
- One shared movement tick cadence is owned by the core client loop.
- Navigation emits raw `MovementInput` directly; `NavigationLocomotionPlan` is not part of the current design.
- Enqueued movement inputs wait until the next tick for wire synthesis.
- No specialized explicit metadata-override path is planned today.

### Verification Log
- Phase 1 complete:
- Added `MovementControl` and `MovementInput` alongside a temporary legacy `MovementRequest` shim.
- Removed `DriveVelocity` from the public movement primitive surface and updated controller/test expectations to use heading-bearing `Drive`.
- Added buffered movement ingest state to `MovementSystem` and a new `ClientCommand::EnqueueMovementInput` command surface.
- Moved legacy movement commands onto the buffered ingest path instead of immediate command-handler execution.
- `cargo test -p holtburger-core` still has pending Phase 2 failures to resolve before the suite is green again.

### Open Questions
- When walk, strafe, and backstep are added later, do they fit the same helper surface or need distinct timing APIs?