# Stateful Movement Input Plan

## Context And Boundaries

### Goal
Refactor `holtburger-core` movement around stateful low-level control inputs that match real client locomotion, while keeping target-aware pulse planning in optional navigation helpers rather than baking world-position semantics into the movement actuator.

### In Scope
- Replace speed-shaped `Drive` semantics as the long-term movement input model with stateful low-level control inputs.
- Keep `MovementSystem` responsible for buffering active controls, synthesizing packet edges on tick, and driving matching local self-prediction.
- Keep navigation target-position logic in `NavigationAutomation` and reusable controllers, where it can translate world-space goals into timed pulses.
- Refactor navigation/controller outputs so `Approach`, `Follow`, and sticky-melee pursuit emit timed low-level movement inputs instead of analog-speed-shaped drive requests.
- Add explicit navigation-side pulse planning, hysteresis, and reissue rules that use world-space target coordinates plus movement timing helpers.
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

## Proposed API Shape

### Core Principle
Movement inputs should express low-level control state, not target-position semantics and not fake analog throttle. Navigation remains free to be target-aware, but it must translate that intent into low-level control pulses before crossing the boundary into `MovementSystem`.

### Candidate Low-Level Movement API

```rust
pub enum MovementControl {
    Stop,
    Run { heading: f32 },
    Walk { heading: f32 },
    Backstep { heading: f32 },
    StrafeLeft { heading: f32 },
    StrafeRight { heading: f32 },
    TurnLeft,
    TurnRight,
    SnapFacing { heading: f32 },
}

pub enum MovementInput {
    Hold { control: MovementControl },
    Pulse { control: MovementControl, duration: Duration },
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

commands.push(ClientCommand::ExecuteMovementInput {
    input: MovementInput::Pulse {
        control: MovementControl::Run { heading },
        duration: pulse,
    },
});
```

The important boundary here is that navigation still owns `target_position`, `remaining`, `arrival_distance`, and hysteresis. Movement only receives low-level control intent plus timing.

### Candidate Navigation Output Model

```rust
pub enum NavigationLocomotionPlan {
    Idle,
    PulseRun {
        heading: f32,
        duration: Duration,
    },
    HoldRun {
        heading: f32,
    },
    Stop,
    SnapFacing {
        heading: f32,
    },
}
```

```rust
impl NavigationAutomation {
    fn plan_approach_pulse(
        &self,
        player_position: WorldPosition,
        target_position: WorldPosition,
        arrival_distance: f32,
        movement: &MovementSystem,
    ) -> NavigationLocomotionPlan;
}
```

This keeps navigation responsible for target-aware convergence while movement remains responsible for executing the resulting low-level control plan.

## Phased Implementation

### Phase 1: Introduce Stateful Movement Input Model

#### Deliverables
- Add new low-level movement control types in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs)
- Add buffering state for held and pulsed controls in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- Keep a temporary adapter from existing `MovementPrimitive` requests into the new control model so current callers continue to work during migration

#### Acceptance Criteria
- `MovementSystem` can represent persistent locomotion and timed pulses without requiring target coordinates.
- Existing tests still compile behind the adapter layer.
- New unit tests cover pulse expiry, held-state overwrite, and release behavior.

### Phase 2: Move Packet Synthesis And Local Prediction Onto Active Control State

#### Deliverables
- Make `tick` the authoritative place that expires timed inputs, derives the active locomotion state, and decides whether packet edges must be sent.
- Make local self-prediction derive from the exact same active control state used for wire emission.
- Keep stop-pulse obligations and server-controlled motion reconciliation in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)

#### Acceptance Criteria
- Local velocity and omega always match the active buffered control state.
- Packet emission is edge-based and no longer depends on navigation-provided analog speed.
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
- Update [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) and any maintained-range helpers so they emit navigation plans or low-level timed inputs rather than speed-shaped `Drive`/`DriveVelocity` requests for navigation use cases.
- Keep target-position logic, arrival thresholds, slowdown bands, and hysteresis entirely in navigation/controllers.
- Add or update navigation-local cadence state as needed so pulse planning is stable across ticks instead of recomputing analog speed every frame.
- Retain `MovementPrimitive` compatibility only for call sites that genuinely represent direct locomotion rather than navigation.

#### Acceptance Criteria
- Approach and follow no longer rely on continuous speed as their primary actuator signal.
- Navigation contains the target-aware convergence and pulse-planning logic instead of delegating convergence to the movement actuator.
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
- Make navigation outputs explicit, either as low-level timed inputs or a small `NavigationLocomotionPlan` enum.
- Add navigation-focused tests that prove pulse cadence and stop conditions around the arrival shell.

### Risk: Migration Leaves Two Competing Movement Models In Place Too Long
Adapters are useful, but lingering dual models will make future behavior hard to reason about.

Mitigation:
- Time-box the compatibility layer.
- Remove legacy speed-shaped navigation coupling as an explicit final phase.

## Definition Of Done

- `MovementSystem` accepts stateful low-level control inputs and timed pulses.
- `MovementSystem::tick` is the sole source of truth for active locomotion, packet emission, and matching local self-prediction.
- Navigation helpers remain optional and target-aware, but they emit low-level pulse intents or explicit locomotion plans rather than analog speed.
- `NavigationAutomation` and reusable navigation controllers explicitly own approach/follow pulse planning, hysteresis, and target-space convergence policy.
- Movement exposes helper timing APIs so navigation does not duplicate locomotion constants.
- `cargo test -p holtburger-core` passes.
- Core architecture docs accurately describe the new boundary.

## Living Worksheet

### Task Checklist
- [ ] Phase 1: Add low-level movement control and input types.
- [ ] Phase 1: Add buffered held/pulsed control state to `MovementSystem`.
- [ ] Phase 2: Make `tick` own locomotion expiry and wire synthesis.
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

### Verification Log
- Pending implementation.

### Open Questions
- Which locomotion controls must be first-class in phase 1: run only, or run plus walk/strafe/backstep?
- Should turn state be represented as its own independent held control or always piggyback on heading-bearing locomotion?
- Do we want one shared `tick` cadence for movement inputs, or should frontends explicitly advance the movement system at their own cadence?
- Should navigation emit raw `MovementInput` values directly, or should it emit a narrower `NavigationLocomotionPlan` that the client translates into movement inputs?