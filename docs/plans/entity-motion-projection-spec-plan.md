# Entity Motion Projection Spec And Implementation Plan

## Context And Boundaries

### Goal
Add a shared client-side entity motion projection system that interpolates and extrapolates observed movement over time for all entities without mutating authoritative world positions.

### In Scope
- Preserve `holtburger-world` entity positions as authoritative server-owned state.
- Define the shared motion and kinematics inputs needed to project entity motion correctly.
- Add a reusable projection system in `holtburger-core` that consumers can drive on their own frame or UI tick.
- Specify the consumer-facing API for TUI, tools, and future 3D clients.
- Add a phased implementation plan, risks, and acceptance criteria.

### Out Of Scope
- Full skeletal animation, animation blending, or scene graph design.
- Terrain-aware pathfinding or collision-aware local steering.
- Replacing every existing CLI view-state path with projected rendering in one pass.
- Hiding authoritative world state behind a render-oriented abstraction.
- Emitting a 60 Hz `ClientViewEvent` stream from core by default.

## Problem Statement

Today, authoritative entity positions are updated from server position packets and certain motion packets can cause an immediate heading snap. We do not currently simulate observer motion over time from `UpdateMotion`, `VectorUpdate`, or related movement metadata.

That is acceptable for authoritative world bookkeeping, but it is not sufficient for a future graphical client and already limits consumer ergonomics:

- renderers want smooth movement and turning between authoritative updates
- gameplay systems want stable server-owned positions they can trust
- controller loops that react to small target slips, especially maintain-range behavior, want smoother spatial continuity so they do not thrash on packet cadence
- projection code should be shared across clients instead of reimplemented per frontend

The key design constraint is that those needs conflict if we store interpolated motion in `Entity.position`. Authoritative systems should not consume projected state accidentally.

## Design Conclusion

### Keep Authoritative Position Stable
`holtburger-world::Entity.position` should remain the authoritative server-known pose.

Do not rename it to `stable_position`.

Reasons:
- the current field already has the correct authority semantics
- renaming it would introduce ambiguity about which position is the default truth
- many gameplay and bookkeeping systems should continue to use the authoritative pose by default

### Add A Separate Projection Layer
Projected motion should live in a separate client-side projection layer keyed by entity guid.

Recommended ownership:
- `holtburger-world`: authoritative entity pose and motion-related source data
- `holtburger-core`: reusable projection system and projection data model
- frontend or embedder: owns an instance of the projection system and queries projected poses during rendering

This keeps crate boundaries aligned with the repo architecture:
- `world` remains authoritative
- `core` provides reusable client behavior
- frontends keep local presentation state and rendering policy

### Prefer Pull-Based Consumer Access Over Push-Based Frame Events
Do not make the initial design rely on a high-frequency `ClientViewEvent::EntityProjectionUpdated` stream.

Instead:
- consumers feed authoritative view events into a projection system
- consumers call `tick(now)` or `advance(dt)` on their own cadence
- consumers query projected poses when rendering

This avoids flooding the shared event stream with per-frame render state while still giving all clients a common projection implementation.

## Target Architecture

## Layer 1: World-Owned Authoritative Motion Inputs

`holtburger-world` should continue to own the latest authoritative movement-related data for each entity, but only as input data for projection and gameplay queries.

That means world should own compact retained motion and kinematics state such as:
- last authoritative pose
- last known linear velocity
- last known angular velocity
- last observed interpreted motion state relevant to projection
- last observed turn-to-heading or turn-to-object directive when present

World should not own projected or render-time positions.

### Proposed World Data Shape

The current `EntityMotionSnapshot` is too narrow for projection because it drops speeds and motion directives.

Recommended replacement or expansion:

```rust
pub struct EntityMotionState {
    pub current_style: Option<MotionStance>,
    pub forward: Option<AxisMotionState>,
    pub sidestep: Option<AxisMotionState>,
    pub turn: Option<TurnMotionState>,
    pub directive: Option<MotionDirective>,
}

pub struct AxisMotionState {
    pub command: InterpretedMotionCommand,
    pub speed: Option<f32>,
}

pub struct TurnMotionState {
    pub command: InterpretedMotionCommand,
    pub speed: Option<f32>,
}

pub enum MotionDirective {
    TurnToHeading {
        desired_heading: f32,
        speed: f32,
    },
    TurnToObject {
        target: Guid,
        desired_heading: Option<f32>,
        speed: f32,
    },
}
```

Notes:
- this is still authoritative observed state, not a render system
- `MoveToPosition` and `MoveToObject` can be added later if we prove they materially improve observer projection fidelity
- the initial minimum bar is support for continuous turn motion and directional locomotion from `UpdateMotion`, plus velocity/omega from `VectorUpdate`

## Layer 2: Core-Owned Shared Projection System

Add a reusable projection system in `holtburger-core`.

Proposed module:
- `crates/holtburger-core/src/client/projection.rs`

Proposed primary type:

```rust
pub struct EntityProjectionSystem {
    // guid -> projected state
}
```

The system should:
- ingest authoritative client-view events
- retain projected per-entity state
- advance projections over time
- hard-resync on authoritative corrections and despawns
- expose projected and authoritative poses distinctly

### Proposed Projection State Shape

```rust
pub struct ProjectedEntityState {
    pub guid: Guid,
    pub authoritative_pose: WorldPosition,
    pub projected_pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionState>,
    pub projection_mode: ProjectionMode,
    pub last_authoritative_update: Instant,
}

pub struct EntitySpatialSample {
    pub guid: Guid,
    pub authoritative_pose: WorldPosition,
    pub projected_pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionState>,
    pub projection_mode: ProjectionMode,
}

pub enum ProjectionMode {
    AuthoritativeOnly,
    InterpolatingPosition,
    SimulatingMotionState,
    SimulatingVelocity,
    Suspended,
}
```

Notes:
- `authoritative_pose` is the stable truth copied from world/view events
- `projected_pose` is what renderers should usually use
- `projection_mode` exists for debugging and consumer choice, not just internal bookkeeping

## Layer 3: Consumer-Owned Instance Lifecycle

Consumers should own an instance of the projection system.

Recommended pattern:
- a TUI page, 3D renderer, or harness creates `EntityProjectionSystem`
- it feeds incoming `ClientViewEvent`s into that system
- on each frame or UI tick it advances the system using `Instant::now()` or a supplied dt
- rendering code queries `projected_pose`, while gameplay/control code continues to use authoritative world state

This preserves the current repo direction that frontends own local projection state while still centralizing the projection algorithm in reusable shared code.

## First Intended Consumer: Maintain-Range Smoothing

The first controller-level adoption target should be `MaintainRangeController` in [crates/holtburger-core/src/client/controllers/maintain_range.rs](../../crates/holtburger-core/src/client/controllers/maintain_range.rs).

Why this controller first:
- it currently reacts to discrete target-position updates and can reissue or stop on small positional slips near the range boundary
- it benefits from smoother target continuity before a full 3D renderer exists
- it is already a shared controller in `holtburger-core`, so improving its inputs benefits multiple clients instead of just the TUI

Recommended boundary for this first adoption:
- keep target availability, combat legality, and interrupt rules authoritative
- allow the controller to opt into projected target position for distance checks and reissue smoothing
- keep the player's own local motion ownership unchanged unless a later phase proves projected self state is also needed here

That means the first maintain-range integration should use projected motion as a better spatial estimate, not as a replacement for authoritative world semantics.

## Consumer-Facing API Spec

## Recommended Public API

```rust
pub struct EntityProjectionSystem {
    // internal state
}

impl EntityProjectionSystem {
    pub fn new(config: ProjectionConfig) -> Self;

    pub fn handle_view_event(&mut self, event: &ClientViewEvent, now: Instant);

    pub fn tick(&mut self, now: Instant);

    pub fn reset_entity(&mut self, guid: Guid);

    pub fn clear(&mut self);

    pub fn projected_entity(&self, guid: Guid) -> Option<&ProjectedEntityState>;

    pub fn spatial_sample(&self, guid: Guid) -> Option<EntitySpatialSample>;

    pub fn spatial_sample_or_authoritative(&self, entity: &Entity) -> EntitySpatialSample;

    pub fn projected_pose(&self, guid: Guid) -> Option<WorldPosition>;

    pub fn authoritative_pose(&self, guid: Guid) -> Option<WorldPosition>;

    pub fn iter_projected_entities(&self) -> impl Iterator<Item = &ProjectedEntityState>;
}
```

### Why This API

- `handle_view_event` keeps ingestion aligned with existing consumer architecture
- `tick` lets each consumer drive projection on its own frame cadence
- separate `projected_pose` and `authoritative_pose` make authority explicit
- `spatial_sample` gives controller and gameplay-adjacent consumers one explicit, typed handoff instead of a pile of parallel lookups
- `spatial_sample_or_authoritative` removes repetitive fallback glue from consumers that already have an authoritative entity record in hand
- iterator access supports scene-graph and batch render use cases

### Consumer Guidance

- render-focused consumers should usually use `projected_pose` or `iter_projected_entities()`
- gameplay-adjacent consumers that explicitly opt into projection should prefer `spatial_sample()` so authoritative and projected data stay paired in one value
- gameplay consumers that do not opt into projection should continue using `WorldState` or mirrored authoritative view state directly

## Recommended View Event Inputs

The projection system should initially respond to these existing or newly added client-view events:
- `EntitySpawned`
- `EntityReplaced`
- `EntityMoved`
- `EntityMotionUpdated`
- `EntityDespawned`
- `ForcedReposition`
- `TeleportStarted`

The initial implementation should also add a projected view event for entity kinematics because core currently drops world `EntityVectorUpdated` events.

Recommended new event:

```rust
ClientViewEvent::EntityKinematicsUpdated {
    guid: Guid,
    velocity: Vector3,
    omega: Vector3,
}
```

This is preferable to overloading `EntityMoved`, because kinematics are distinct from an authoritative pose change.

## Consumer Examples

## Example 1: TUI Consumer

Goal:
- keep all gameplay logic authoritative
- optionally render or inspect projected positions in debug overlays or future minimap work

```rust
pub struct GameState {
    pub data: GameData,
    pub projection: EntityProjectionSystem,
}

impl GameState {
    pub fn handle_view_event(&mut self, event: ClientViewEvent) {
        let now = Instant::now();
        self.projection.handle_view_event(&event, now);

        // Existing authoritative state handling stays intact.
        self.handle_authoritative_view_event(event);
    }

    pub fn handle_tick(&mut self, elapsed: f64) {
        self.projection.tick(Instant::now());

        // Combat, targeting, and approach logic continue to use
        // self.data.entities[guid].position, not projected poses.
        self.sync_controllers();
    }

    pub fn debug_entity_pose(&self, guid: Guid) -> Option<(WorldPosition, WorldPosition)> {
        let authoritative = self.data.entities.get(&guid)?.position;
        let projected = self.projection.projected_pose(guid)?;
        Some((authoritative, projected))
    }
}
```

Key rule:
- TUI control and gameplay logic should keep using authoritative world state unless a feature explicitly opts into projected render state.

## Example 1B: Maintain-Range Consumer

Goal:
- reduce reissue churn and stop-start jitter near the range threshold
- continue to use authoritative target validity and ownership rules

Recommended controller input evolution:

```rust
pub struct MaintainRangeSpatialInput {
    pub target: EntitySpatialSample,
}

pub enum MaintainRangeInput {
    Tick {
        now: Instant,
        target_guid: Guid,
        player_position: WorldPosition,
        target: Option<MaintainRangeSpatialInput>,
    },
    Suspend {
        clear_latch: bool,
    },
}
```

Recommended first-use policy:
- `target.authoritative_pose` remains the authoritative fallback and validity anchor
- `target.projected_pose` is used for smoothing distance checks when available
- if projection is missing, the consumer can synthesize a sample where authoritative and projected pose are equal

Example usage:

```rust
let target = world.get_entity(target_guid).map(|entity| {
    let sample = projection.spatial_sample_or_authoritative(entity);

    MaintainRangeSpatialInput { target: sample }
});

let update = maintain_range.handle(&MaintainRangeInput::Tick {
    now,
    target_guid,
    player_position: world.player_position(),
    target,
});
```

Suggested controller rule for the first pass:
- use `target.target.projected_pose` when computing range distance
- fall back to `target.target.authoritative_pose` only when the projected sample is synthesized or projection is suspended
- continue using authoritative world data for target existence, targetability, and interruption boundaries

This gives maintain-range the smoothing benefit immediately without teaching the controller to trust projection for gameplay legality.

## Example 2: 3D Client Consumer

Goal:
- render all visible entities from projected poses
- keep gameplay queries and interaction tests authoritative unless intentionally using projected visuals

```rust
pub fn on_view_event(&mut self, event: &ClientViewEvent) {
    self.projection.handle_view_event(event, Instant::now());
    self.world_overlay.handle_view_event(event);
}

pub fn render_frame(&mut self, now: Instant) {
    self.projection.tick(now);

    for projected in self.projection.iter_projected_entities() {
        self.scene.update_node_transform(
            projected.guid,
            projected.projected_pose,
        );
    }
}

pub fn can_attack(&self, guid: Guid) -> bool {
    self.world.combat_target_status(guid).is_available()
}
```

Key rule:
- scene transform uses `projected_pose`
- gameplay legality uses authoritative world queries

## Example 3: Debug Harness Or Tooling Consumer

Goal:
- compare server-authoritative and projected movement for regression analysis

```rust
pub fn sample_entity(&self, guid: Guid) -> Option<EntityProjectionSample> {
    let projected = self.projection.projected_entity(guid)?;

    Some(EntityProjectionSample {
        guid,
        authoritative_pose: projected.authoritative_pose,
        projected_pose: projected.projected_pose,
        velocity: projected.velocity,
        omega: projected.omega,
        projection_mode: projected.projection_mode,
    })
}
```

This makes it easy to validate drift, correction behavior, and turn fidelity.

## Projection Semantics

## Authoritative Resynchronization Rules

The projection system must resynchronize immediately when it sees:
- `EntityMoved` authoritative position updates
- forced reposition
- teleport start or teleport completion flows
- entity despawn
- landblock or world-presence invalidation

When a hard correction arrives:
- update `authoritative_pose`
- clamp or snap `projected_pose` depending on correction severity
- clear incompatible in-flight motion directives

## Simulation Rules

### Position Updates
- `EntityMoved` updates the authoritative pose immediately.
- Projection may interpolate toward that new pose over a short configurable window for remote entities.
- Projection should not delay the authoritative pose itself.

### Vector Updates
- `EntityKinematicsUpdated` updates retained velocity and angular velocity.
- If no stronger motion directive is active, projection may advance `projected_pose` from these values.

### Interpreted Motion Updates
- Interpreted locomotion commands should be treated as sticky until changed or cleared.
- Turn command plus turn speed implies continuous turning over time.
- Forward or sidestep commands may drive projected motion when no fresher authoritative correction supersedes them.

### Turn-To Updates
- `TurnToHeading` and `TurnToObject` should be treated as over-time turn directives, not as immediate heading snaps.
- Projection should rotate toward the target heading at the advertised speed until the target heading is reached or superseded.

## Sequence And Epoch Boundaries

Projection must hard-reset or suspend when it sees server-owned movement epoch changes that invalidate prior client assumptions, including:
- teleport sequence changes
- force-position sequence changes
- world-presence clears and despawns

This mirrors the same boundary the movement docs already establish for self movement.

## Recommended Configuration Surface

Initial projection settings should stay small and explicit.

```rust
pub struct ProjectionConfig {
    pub max_position_interp: Duration,
    pub max_dead_reckon: Duration,
    pub snap_distance_m: f32,
    pub snap_heading_rad: f32,
}
```

Guidance:
- keep defaults conservative
- prefer snapping rather than drifting wildly on missing data
- make debug instrumentation easy so consumers can compare projected and authoritative results

## Implementation Plan

## Ground Truth And Existing Patterns

### Reference Sources
- [docs/autonomous_movement.md](../autonomous_movement.md)
- [docs/messages.md](../messages.md)
- [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](../../ACE/Source/ACE.Server/Network/Motion/MovementData.cs)
- [ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs](../../ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs)
- [ACE/Source/ACE.Server/Network/Motion/TurnToHeading.cs](../../ACE/Source/ACE.Server/Network/Motion/TurnToHeading.cs)
- [ACE/Source/ACE.Server/Network/Motion/TurnToObject.cs](../../ACE/Source/ACE.Server/Network/Motion/TurnToObject.cs)
- [ACE/Source/ACE.Server/Physics/Managers/MoveToManager.cs](../../ACE/Source/ACE.Server/Physics/Managers/MoveToManager.cs)
- [crates/holtburger-world/src/handlers/movement.rs](../../crates/holtburger-world/src/handlers/movement.rs)
- [crates/holtburger-world/src/entity.rs](../../crates/holtburger-world/src/entity.rs)
- [crates/holtburger-core/src/client/mod.rs](../../crates/holtburger-core/src/client/mod.rs)
- [crates/holtburger-core/src/client/types.rs](../../crates/holtburger-core/src/client/types.rs)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [crates/holtburger-core/ARCHITECTURE.md](../../crates/holtburger-core/ARCHITECTURE.md)

### Existing Patterns To Preserve
- authoritative world state lives in `holtburger-world`
- reusable client behavior lives in `holtburger-core`
- frontends consume `ClientViewEvent`s and keep local projection state
- gameplay systems should not silently switch from authoritative state to projected state

## Dry-Run Findings

### Validated Couplings
- `WorldEvent::EntityVectorUpdated` already exists in [crates/holtburger-world/src/events.rs](../../crates/holtburger-world/src/events.rs), but [crates/holtburger-core/src/client/mod.rs](../../crates/holtburger-core/src/client/mod.rs) currently drops it instead of projecting it to a client-view event. That means the planned projection system cannot be driven from `ClientViewEvent` alone until Phase 2 lands.
- [crates/holtburger-world/src/entity.rs](../../crates/holtburger-world/src/entity.rs) already stores authoritative kinematics on `Entity` (`velocity`, `acceleration`, `omega`, `autonomous_movement`) plus a compact `motion_snapshot`, so the plan should treat those as retained world inputs, not projection-owned state.
- [crates/holtburger-world/src/handlers/movement.rs](../../crates/holtburger-world/src/handlers/movement.rs) currently handles `UpdateMotion` in two different ways: it caches a narrow `EntityMotionSnapshot` and it also applies immediate rotation snaps for `TurnToHeading` and `TurnToObject`. The current code therefore does not just lack projection; it also contains a protocol-shortcut that Phase 1 or 3 will need to revisit carefully.
- `MaintainRangeController` is not consumed directly by the CLI. It is wrapped through [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs), where `sync_maintained_target()` currently feeds both follow and sticky-melee behaviors through the same `MaintainRangeInput::Tick { target_position }` shape.
- The CLI currently builds navigation inputs in [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs) via `navigation_sync_input()`, which only provides one `target_position` sourced from authoritative cached entity state. That means the first maintain-range adoption point is actually the `NavigationAutomation` and `ApproachSyncInput` surface, not the controller in isolation.

### Consequences For Implementation
- Phase 2 is mandatory before the projection system can satisfy the current consumer-facing spec. Without a projected kinematics view event, any consumer-owned projection system would need direct world access or duplicated glue, which breaks the intended layering.
- Phase 1 should expand world-retained motion state before removing the current heading-snap shortcut. Otherwise we risk deleting the only consumer-visible turning behavior before projection exists to replace it.
- The first maintain-range adoption should add a spatial-sample concept to `NavigationAutomation`, not just to `MaintainRangeController`. If we only widen the controller input, the shared `ApproachSyncInput` and `sync_maintained_target()` paths will become awkward adapters that still leak raw positional tuples around.
- `ApproachSyncInput` is currently used by direct approach, follow, and sticky-melee plumbing in [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs). Widening it with projection-specific target samples would force direct approach to accept fields it does not yet need and would blur the boundary between "authoritative target location for approach" and "projection-smoothed target sample for maintain-range".
- `spatial_sample_or_authoritative(&Entity)` is convenient for consumers, but it also couples the projection API to the `holtburger-world::Entity` type directly. That is acceptable given current crate dependencies, but it should be treated as a deliberate convenience method, not the only integration path.

### No Major Plan Breakers Found
- The current codebase already has most of the authoritative input fields the projection design expects.
- `MaintainRangeController` remains a strong first consumer because its smoothing benefit is real and its current churn is driven by exactly the kind of discrete target-position updates projection can soften.
- The required refactor surface is bigger around navigation input plumbing than the controller itself, but still well-contained inside `holtburger-core` plus the CLI sync-input builder.

## Phase 1: Expand Authoritative Motion Inputs In World

### Status
Completed.

### Deliverables
- Expand or replace `EntityMotionSnapshot` with a richer `EntityMotionState` in [crates/holtburger-world/src/entity.rs](../../crates/holtburger-world/src/entity.rs).
- Preserve current combat-target semantics while retaining speeds and turn directives needed for projection.
- Update [crates/holtburger-world/src/handlers/movement.rs](../../crates/holtburger-world/src/handlers/movement.rs) to store:
  - interpreted forward, sidestep, and turn speed data
  - turn-to-heading and turn-to-object directives
  - no projected pose data
- Keep `Entity.position` authoritative.

### Acceptance Criteria
- World retains sufficient motion information to support projection without parsing protocol structs in every frontend.
- Existing combat-target and motion tests still pass or are updated intentionally.
- No projected state is stored in world entities.
- The plan for replacing the current `TurnToHeading` and `TurnToObject` rotation snap is explicit, so we do not regress visible turning before projection exists.

### Phase 1 Implementation Notes
- Kept the existing `EntityMotionSnapshot` type name in [crates/holtburger-world/src/entity.rs](../../crates/holtburger-world/src/entity.rs) for this phase to minimize churn while still expanding the retained authoritative motion inputs.
- Added retained interpreted speeds to the snapshot as `forward_speed`, `sidestep_speed`, and `turn_speed` using a small `OrderedMotionSpeed` wrapper so projection inputs can preserve the ordered motion value without depending on raw protocol structs later.
- Added explicit retained turn directives as `EntityMotionDirective::{TurnToHeading, TurnToObject}` so later projection work can reconstruct over-time turn behavior from world-owned state.
- Updated `EntityMotionSnapshot::from_movement_event()` to retain interpreted motion speeds for `MovementTypeData::Invalid` and directive data for `MovementTypeData::TurnToHeading` and `MovementTypeData::TurnToObject`.
- Deliberately did not remove the current immediate heading snap in [crates/holtburger-world/src/handlers/movement.rs](../../crates/holtburger-world/src/handlers/movement.rs) during this phase. That shortcut remains until the shared projection system exists to replace it.
- Left `Entity.position`, `velocity`, `acceleration`, `omega`, and `autonomous_movement` authoritative and world-owned.

### Phase 1 Validation
- Added regression coverage in [crates/holtburger-world/src/player/tests.rs](../../crates/holtburger-world/src/player/tests.rs) for retained interpreted motion speeds.
- Added regression coverage in [crates/holtburger-world/src/player/tests.rs](../../crates/holtburger-world/src/player/tests.rs) for retained `TurnToHeading` directives.
- Updated existing snapshot fixtures in [crates/holtburger-world/src/context.rs](../../crates/holtburger-world/src/context.rs) and [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs) to remain compatible with the expanded snapshot shape.
- `cargo test -p holtburger-world --lib` passed with 104 tests.
- `cargo test -p holtburger-cli --lib` passed with 162 tests.

### Decisions Confirmed By Phase 1
- The minimum world-retained motion surface needed for projection is broader than the preexisting snapshot, but it still fits cleanly in authoritative world state without introducing projected poses.
- Preserving a compact world-owned snapshot is sufficient for now; Phase 1 did not need a full `EntityMotionState` rename to unblock later phases.
- Replacing turn snaps must stay deferred until Phase 3, otherwise remote turning would visibly regress before projection exists.

## Phase 2: Expose Kinematics And Motion Inputs Through Core

### Status
Completed.

### Deliverables
- Stop dropping `WorldEvent::EntityVectorUpdated` in [crates/holtburger-core/src/client/mod.rs](../../crates/holtburger-core/src/client/mod.rs).
- Add `ClientViewEvent::EntityKinematicsUpdated` in [crates/holtburger-core/src/client/types.rs](../../crates/holtburger-core/src/client/types.rs).
- Continue forwarding `EntityMoved`, `EntityMotionUpdated`, spawn, replace, and despawn events.
- Document that these events are authoritative inputs for consumer-owned projection systems.

### Acceptance Criteria
- A consumer can build a projection cache from `ClientViewEvent` alone.
- No consumer needs direct access to world internals to project motion.
- `ClientViewEvent` covers `EntityVectorUpdated` and does not force consumers to scrape `Entity` replacements just to keep kinematics current.

### Phase 2 Implementation Notes
- Added `ClientViewEvent::EntityKinematicsUpdated { guid, velocity, omega }` in [crates/holtburger-core/src/client/types.rs](../../crates/holtburger-core/src/client/types.rs) as the authoritative client-view counterpart to `WorldEvent::EntityVectorUpdated`.
- Updated [crates/holtburger-core/src/client/mod.rs](../../crates/holtburger-core/src/client/mod.rs) so `handle_world_event()` now projects `WorldEvent::EntityVectorUpdated` instead of dropping it.
- Preserved the existing event projection paths for `EntityMoved`, `EntityMotionUpdated`, spawn, replace, and despawn. Phase 2 only closed the missing kinematics gap; it did not change motion semantics.
- Updated [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs) to mirror `EntityKinematicsUpdated` into cached entity `velocity` and `omega` so frontend entity mirrors stay authoritative enough for debug and future projection consumers.

### Phase 2 Validation
- Added a core regression test in [crates/holtburger-core/src/client/mod.rs](../../crates/holtburger-core/src/client/mod.rs) proving `WorldEvent::EntityVectorUpdated` projects to `ClientViewEvent::EntityKinematicsUpdated`.
- Added a CLI regression test in [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs) proving the cached entity mirror ingests kinematics updates and requests redraw.
- `cargo test -p holtburger-core --lib` passed with 101 tests.
- `cargo test -p holtburger-cli --lib` passed with 163 tests.

### Decisions Confirmed By Phase 2
- The client-view stream can now serve as the sole authoritative input surface for later projection work; no direct world scraping is required just to keep kinematics current.
- Consumers that maintain mirrored entity caches, including the current CLI state, should ingest kinematics updates directly instead of waiting for a later full entity replacement. That keeps debug state truthful and avoids creating a second hidden dependency on world internals.

## Phase 3: Implement Shared Projection System In Core

### Status
Completed.

### Deliverables
- Add [crates/holtburger-core/src/client/projection.rs](../../crates/holtburger-core/src/client/projection.rs).
- Implement `EntityProjectionSystem`, `ProjectedEntityState`, and `ProjectionConfig`.
- Add unit tests for:
  - authoritative position interpolation
  - velocity-based dead reckoning
  - continuous turn command application
  - turn-to-heading over-time rotation
  - forced correction snap or clamp
  - despawn and world-presence clear cleanup

### Acceptance Criteria
- The shared projection system can be driven entirely from `ClientViewEvent` plus time.
- Projected and authoritative poses remain distinct in the API.
- Turn-to-heading no longer requires consumers to snap rotation manually.

### Phase 3 Implementation Notes
- Added [crates/holtburger-core/src/client/projection.rs](../../crates/holtburger-core/src/client/projection.rs) with a reusable `EntityProjectionSystem` driven entirely by `ClientViewEvent` and `Instant`.
- Implemented public projection types:
    - `ProjectionMode`
    - `ProjectedEntityState`
    - `EntitySpatialSample`
    - `ProjectionConfig`
    - `EntityProjectionSystem`
- Exposed the projection module from [crates/holtburger-core/src/client/mod.rs](../../crates/holtburger-core/src/client/mod.rs) and re-exported the public projection types from [crates/holtburger-core/src/lib.rs](../../crates/holtburger-core/src/lib.rs) so consumers can adopt the system without reaching through private module seams.
- Implemented conservative authoritative correction handling:
    - small same-landblock corrections interpolate over `max_position_interp`
    - large corrections or landblock changes snap immediately
    - forced reposition snaps to the authoritative pose and clears retained motion simulation state
- Implemented vector-driven dead reckoning from authoritative pose plus retained velocity, bounded by `max_dead_reckon`.
- Implemented over-time heading simulation for:
    - sticky interpreted turn commands with retained turn speed
    - `TurnToHeading` directives
    - `TurnToObject` directives only when they carry an explicit desired heading
- Added convenience sampling APIs so later consumers can fetch projected and authoritative state together without introducing projected state into `holtburger-world`.
- `TeleportStarted` currently suspends all cached projections conservatively by snapping projected pose back to authoritative pose and marking the entry suspended. That is intentionally conservative because the current client-view event does not carry a guid, so Phase 3 cannot target only the local player from this signal alone.
- The implemented `ProjectionConfig` keeps duration knobs as `Duration` and snap thresholds as integer meter and milliradian values so the config stays trivially comparable in tests while still converting cleanly to runtime float thresholds.

### Phase 3 Validation
- Added projection regression coverage in [crates/holtburger-core/src/client/projection.rs](../../crates/holtburger-core/src/client/projection.rs) for:
    - authoritative position interpolation
    - velocity-driven dead reckoning
    - continuous turn command simulation
    - over-time `TurnToHeading` rotation
    - large correction snapping
    - despawn and full-cache clear cleanup
- `cargo test -p holtburger-core --lib` passed with 107 tests.
- `cargo test -p holtburger-cli --lib` passed with 163 tests.

### Decisions Confirmed By Phase 3
- A shared pull-based projection system fits cleanly in `holtburger-core` without forcing a per-frame event stream into the existing client-view channel.
- The projection boundary can stay explicit: `authoritative_pose` remains the stable truth while `projected_pose` is opt-in consumer state.
- Conservative same-landblock interpolation plus bounded dead reckoning is enough to unblock Phase 4 adoption without pretending core already has full pathing or target-relative turn resolution.
- `TurnToObject` without an explicit desired heading cannot be faithfully resolved inside the current projection system from `ClientViewEvent` alone, because the event stream does not provide target pose lookup as part of the directive. That case remains conservative for now instead of guessing.

## Phase 4: Adopt The Projection System In CLI As An Optional Consumer

### Status
Completed.

### Deliverables
- Add a projection-system instance to CLI game state.
- Feed incoming view events into the projection system.
- Use projected poses only in explicitly chosen render, debug, or controller inputs.
- Keep targeting, combat, follow, and movement logic authoritative unless a later spec says otherwise.
- Make `MaintainRangeController` the first intentional controller consumer of projected target pose.
- Introduce a dedicated maintained-target sync type around [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs) so follow and sticky-melee can consume a typed spatial sample without widening `ApproachSyncInput`.

Recommended shape:

```rust
pub struct MaintainedTargetSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target: Option<EntitySpatialSample>,
    pub metadata: MovementPacketMetadata,
}
```

Recommended usage:
- direct approach continues to use `ApproachSyncInput`
- follow and sticky-melee switch to `MaintainedTargetSyncInput`
- `sync_maintained_target()` becomes the seam where maintain-range-specific projection support lives

Concrete `navigation.rs` delta:

Current shapes in [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs):

```rust
pub struct ApproachSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target_position: Option<WorldPosition>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

pub struct StickyMeleeSyncInput {
    pub now: Instant,
    pub combat_mode: CombatMode,
    pub attack_sequence_active: bool,
    pub target_guid: Option<Guid>,
    pub player_position: Option<WorldPosition>,
    pub target_position: Option<WorldPosition>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}
```

Recommended transition:

```rust
pub struct MaintainedTargetSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target_guid: Option<Guid>,
    pub target: Option<EntitySpatialSample>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

pub struct StickyMeleeSyncInput {
    pub now: Instant,
    pub combat_mode: CombatMode,
    pub attack_sequence_active: bool,
    pub target_guid: Option<Guid>,
    pub player_position: Option<WorldPosition>,
    pub target: Option<EntitySpatialSample>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}
```

Recommended function updates:
- keep `start_approach_target(target, arrival_distance, input: ApproachSyncInput)` unchanged
- keep `sync_approach_target(input: ApproachSyncInput)` unchanged
- change `start_follow_target(target, arrival_distance, input: ApproachSyncInput)` to accept `MaintainedTargetSyncInput`
- change `sync_follow_target(target, input: ApproachSyncInput)` to accept `MaintainedTargetSyncInput`
- change `sync_maintained_target(..., input: ApproachSyncInput)` to accept `MaintainedTargetSyncInput`
- change `apply_maintained_target_effect(..., input: ApproachSyncInput, ...)` to accept `MaintainedTargetSyncInput`
- keep `StickyMeleeSyncInput`, but replace its `target_position` field with `target: Option<EntitySpatialSample>` and adapt it into `MaintainedTargetSyncInput` before calling `sync_maintained_target()`

Recommended controller-facing extraction inside `sync_maintained_target()`:

```rust
let target = input.target.and_then(|target| {
    self.automation_target_position(input.player_position, Some(target.authoritative_pose))
        .map(|_| target)
});

let update = controller.handle(&MaintainRangeInput::Tick {
    now: input.now,
    target_guid,
    player_position,
    target: target.map(|target| MaintainRangeSpatialInput { target }),
});
```

That keeps the current automation-distance gate authoritative while still letting maintain-range consume the projected sample once the target has already passed the world-space validity gate.

### Acceptance Criteria
- CLI can display projected-vs-authoritative debug information.
- Maintain-range pursuit reissues less aggressively near the range boundary when projected target motion is available.
- Existing gameplay logic still behaves against authoritative positions.
- No controller or gameplay helper starts depending on projected poses accidentally beyond the explicitly allowed maintain-range distance smoothing path.
- The projection-aware maintain-range adoption does not force unrelated approach-target flows to consume projected samples until they opt in.

### Phase 4 Implementation Notes
- Added an `EntityProjectionSystem` instance to CLI runtime state in [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs).
- The CLI now feeds incoming `ClientViewEvent`s into projection state before applying its local authoritative mirror updates, and advances projection on each game tick.
- Added a projection-aware debug path by threading projection access through [apps/holtburger-cli/src/pages/game/panels/context.rs](../../apps/holtburger-cli/src/pages/game/panels/context.rs) and [apps/holtburger-cli/src/pages/game/panels/dashboard/debug.rs](../../apps/holtburger-cli/src/pages/game/panels/dashboard/debug.rs). Debug output now surfaces projected pose and projection mode alongside authoritative entity information.
- Kept the existing cached context-buffer path for normal TUI views, but switched projected entity debug content to a render-time live path in [apps/holtburger-cli/src/pages/game/render.rs](../../apps/holtburger-cli/src/pages/game/render.rs). That avoids rebuilding the cached context buffer on every projection tick while still showing current projected debug data when the context pane is actually rendered.
- Introduced `MaintainRangeSpatialInput` in [crates/holtburger-core/src/client/controllers/maintain_range.rs](../../crates/holtburger-core/src/client/controllers/maintain_range.rs) so maintain-range can consume a typed `EntitySpatialSample` instead of a bare target position.
- Updated maintain-range distance checks to use `target.projected_pose`, while still requiring an authoritative world-space gate before a sample is admitted into the controller.
- Introduced `MaintainedTargetSyncInput` and `NavigationSyncInput` in [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs). Direct approach remains on `ApproachSyncInput`; follow and sticky-melee now consume the typed maintained-target path.
- `StickyMeleeSyncInput` now carries `target: Option<EntitySpatialSample>` instead of `target_position`.
- Added compatibility conversions from `ApproachSyncInput` into the new maintained-target/navigation wrapper types so existing authoritative-only core tests and call sites can keep expressing intent without fabricating projection state. That preserves Phase 4’s seam without forcing unrelated approach paths to be rewritten immediately.

### Phase 4 Validation
- Added a core regression test in [crates/holtburger-core/src/client/controllers/maintain_range.rs](../../crates/holtburger-core/src/client/controllers/maintain_range.rs) proving projected target pose drives maintain-range smoothing.
- Existing navigation regression coverage in [crates/holtburger-core/src/client/navigation.rs](../../crates/holtburger-core/src/client/navigation.rs) continued to pass after the maintained-target split, validating that direct approach flows stayed compatible while follow and sticky-melee moved to typed target samples.
- Existing CLI state regression coverage in [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs) continued to pass after adding projection ownership and the projected sticky-melee sample path.
- `cargo test -p holtburger-core --lib` passed with 108 tests.
- `cargo test -p holtburger-cli --lib` passed with 163 tests.

### Decisions Confirmed By Phase 4
- The first controller consumer should indeed be maintain-range, not direct approach. That kept gameplay legality and approach ownership authoritative while still harvesting the projection benefit where packet cadence actually causes churn.
- A dedicated maintained-target input seam is worth it. Keeping `ApproachSyncInput` narrow avoided leaking projected sample requirements into direct approach code paths.
- The CLI can safely own projection as local presentation/runtime state while continuing to mirror authoritative entities for gameplay logic.
- Projection-aware debug output is useful, but for the TUI it should be render-time only rather than tick-driven cached-buffer refresh. That keeps debug data current without paying a per-tick context rebuild cost.

## Phase 5: Validate 3D-Client-Oriented Consumer Ergonomics

### Deliverables
- Add examples or harness coverage showing batch scene updates from `iter_projected_entities()`.
- Verify the API is suitable for a future graphical client without requiring a frame-event firehose.
- Refine config knobs only after testing real consumer needs.

### Acceptance Criteria
- A future 3D client can render from projected poses while leaving gameplay and authority queries untouched.
- The projection API remains pull-based and explicit about authority.

## Risks And Mitigations

### Risk: Projection State Leaks Into Authoritative Logic
Mitigation:
- keep `Entity.position` authoritative
- keep projected state in a separate projection store
- name APIs explicitly as `projected_pose` and `authoritative_pose`

### Risk: Consumer APIs Become Event-Spam Heavy
Mitigation:
- do not introduce a default 60 Hz projection event stream
- keep projection pull-based and consumer-driven

### Risk: Current Motion Snapshot Is Too Narrow For Correct Projection
Mitigation:
- expand world-retained motion state before implementing the projection system
- add tests for speeds and turn directives, not just command enums

### Risk: Turn-To Semantics Are Implemented As Snaps Again
Mitigation:
- validate against ACE `MoveToManager` behavior
- add tests that prove turn-to-heading progresses over time and terminates cleanly

### Risk: Consumers Start Using Projected Positions For Gameplay Logic
Mitigation:
- document the boundary in API docs and architecture docs
- keep projected and authoritative accessors separate
- adopt in CLI debug/render paths first, not controller logic

## Definition Of Done

- `Entity.position` remains authoritative and stable.
- Shared projection state exists outside `holtburger-world` entity storage.
- `holtburger-core` exposes a reusable projection system with explicit projected and authoritative pose access.
- Consumers can drive the system from `ClientViewEvent`s and time only.
- Projection supports position interpolation, vector-driven dead reckoning, and turn-over-time semantics.
- CLI or harness adoption proves the API is usable without rewriting gameplay logic around projected state.
- Tests cover interpolation, extrapolation limits, correction handling, turn semantics, and cleanup.

## Living Worksheet

### Task Checklist
- [x] Phase 1: expand authoritative motion inputs in world
- [x] Phase 2: expose kinematics through core view events
- [x] Phase 3: implement `EntityProjectionSystem`
- [x] Phase 4: adopt projection system in CLI debug or render paths
- [ ] Phase 5: validate 3D-client consumer ergonomics

### Decisions Log
- Keep `Entity.position` authoritative; do not rename it to `stable_position`.
- Prefer a separate projection store over a second position field on `world::Entity`.
- Prefer a consumer-owned projection system in `holtburger-core` over a core-owned per-frame event stream.
- Do not widen `ApproachSyncInput` for the first projection-aware controller adoption. Add a narrower `MaintainedTargetSyncInput` for follow and sticky-melee instead.
- Keep authoritative kinematics and motion-adjacent fields on `world::Entity`; projection consumes them but does not own their source of truth.
- For the initial projection pass, treat `VectorUpdate` plus interpreted locomotion and turn directives as sufficient. Defer `MoveToPosition` and `MoveToObject` directive retention until a later fidelity pass proves they materially improve observer projection.
- Keep maintain-range admission authoritative by gating on `authoritative_pose`, then let the controller smooth range checks from `projected_pose` once the target has already passed the world-space validity filter.
- Use projection first in CLI debug surfaces and maintain-range smoothing, not as a wholesale replacement for authoritative UI state.
- Do not add a generic `projected_pose_or_authoritative(guid)` helper. Prefer explicit `projected_pose`, `authoritative_pose`, and typed `spatial_sample` access so consumers must choose the trust boundary deliberately.

### Verification Log
- Pending implementation.

### Deferred Follow-Ups
- After the first projection pass lands, measure whether retaining `MoveToPosition` or `MoveToObject` directives improves remote-entity fidelity enough to justify the added world-state complexity.
- After maintain-range adoption and debug instrumentation land, decide whether any additional CLI surfaces should opt into projected poses or whether projection should remain mostly a graphical-client concern.
- Revisit consumer convenience helpers only after real adoption proves where boilerplate remains. Prefer adding narrowly scoped helpers over a generic API that hides authoritative versus projected choice.