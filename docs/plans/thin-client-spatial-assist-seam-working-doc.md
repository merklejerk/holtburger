# World-Owned Spatial Physics DI Working Doc

## Status

- Drafted: 2026-03-28
- Purpose: reframe the movement-hack seam around world-owned dependency injection

## Problem Statement

The TUI wants movement-adjacent behavior that is useful but dishonest:

1. Pragmatic handling of server-assisted 3D relocation such as ACE `MoveToObject` during sticky melee.
2. Potential future fake-altitude or fake-contact behavior when the thin client lacks real collision.

These are not honest locomotion primitives, but they also are not merely navigation policy. They look more like answers from a spatial or physics layer, just with a dishonest implementation.

That framing gets stronger if the future full client will also want this same seam to participate in gravity, friction, grounding, and collision response.

The future 3D client will eventually need a real spatial or collision seam anyway. So the clean architecture is:

- put the seam in the world-owned spatial/physics subsystem
- ship a conservative baseline implementation
- let the TUI inject a dishonest implementation
- let a future 3D client inject an honest one

The immediate reason to do this is not abstract purity. It is to give the TUI a single explicit place to lie about local z/contact behavior without teaching shared movement execution about TUI-only hacks.

## Converged Design

This is the design the doc should optimize around.

### Authority vs Presentation

The clean split is not "local player in movement, everyone else in projection".

The clean split is:

- `SpatialPhysics` owns authoritative local simulation for any client-simulated bodies.
- `MovementSystem` owns command intake, orchestration, and wire consequences.
- projection owns presentation-time interpolation and dead reckoning for any entity a consumer wants to render smoothly.

That matters because [projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs) already simulates motion-like behavior, but only for visuals. It should not become the place where gameplay-authoritative local body state is decided. Likewise, [movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) should not remain the permanent home for the actual integration math just because the current authoritative client simulation mostly applies to the player.

The first rollout is still player-local because that is the only current client-authoritative simulation path. But the architectural split should be framed as authority versus presentation, not player versus non-player.

That does not mean the call site should live in `MovementSystem`. If the long-term shape is a broader client simulation tick, it is cleaner to promote solve scheduling there immediately and let `MovementSystem` act as one intent source into `ClientSimulationSystem`.

### Ownership

- `SpatialScene` becomes the concrete world-owned spatial subsystem.
- `SpatialScene` owns graph/index/cache state and internal search helpers.
- `SpatialScene` stores `Arc<dyn SpatialPhysics>` as the active solver policy.
- `WorldState` remains the owner of canonical entity state and applies solved results.

### Solver Model

- `SpatialPhysics` is an injected solver policy, not a second copy of the spatial graph.
- `BasicSpatialPhysics` is the conservative shared default.
- `TuiSpatialPhysics` wraps `BasicSpatialPhysics` and layers dishonest z/contact behavior on top.
- a future 3D client can inject a richer honest implementation without changing the shared seam.

### TUI Z Hack Contract

The spec should be explicit about what the first dishonest implementation is for.

- `TuiSpatialPhysics` exists to bias the locally simulated player's solved pose/contact when the TUI lacks honest collision and terrain support.
- it should operate on the solved kinematics returned by `BasicSpatialPhysics`, not replace baseline integration wholesale.
- first-rollout scope is the locally simulated player result, even though the seam itself remains batch-capable and not player-only by design.
- the hack should preserve baseline planar motion and angular integration unless a specific TUI need proves otherwise.
- the hack may adjust solved `pose.z` and `contact` together so the TUI can present a coherent local body state.
- the hack must not perform arbitrary world mutation, packet emission, controller policy, or navigation decisions.

That means the dishonest path should look like:

1. `ClientSimulationSystem` gathers local-player intent from `MovementSystem`.
2. `BasicSpatialPhysics` produces baseline pose, velocity, omega, and contact.
3. `TuiSpatialPhysics` post-processes the solved local-player entry to apply the z/contact lie.
4. `WorldState` applies the solved result through the same world-owned helper used by honest implementations.

This keeps the TUI compromise narrow: same request shape, same solved-result shape, different solver policy.

### Solve Shape

- `solve()` operates on a batch or interaction island, not a single actor-by-design.
- `actors` means "the bodies being advanced together for this solve step", not "the player only".
- the `1` in `SmallVec<[...; 1]>` is inline capacity only, not a hard limit.
- solve results are compact actor-kinematics outputs plus narrowly scoped spatial events.

### What "Pose" Means Here

In this codebase, `pose` should mean the spatial transform represented today by `WorldPosition`:

- landblock or cell identity
- local coordinates within that space
- orientation via `rotation`

It should not mean velocity, omega, contact, locomotion state, or other motion metadata. Those remain separate fields.

That means `pose` is already more than just translation, but it is still not the entire motion state.

One important consequence: a separate `heading` field in the API sketches is redundant if `pose.rotation` is authoritative. If a heading scalar remains in the first implementation for convenience, it should be treated as a derived helper value, not as a second independent source of truth.

### Boundaries

- the solver owns translational and angular integration: pose, velocity, omega, and contact.
- the solver does not own approach/follow/sticky policy, packet serialization, or session transport.
- presentation interpolation stays out of this seam and remains a projection concern.
- `SpatialScene` should not freeze a giant public API for raycasts/sweeps/overlaps on day one. Richer query primitives can remain internal until real callers justify exposing them.

### Clean World Application

- world should apply solved actor kinematics through one helper instead of scattering updates across `set_player_position()`, `set_player_vector()`, and separate grounded-state handling.
- the helper should consume `SolvedActorKinematics`, not a player-only duplicate type.

That helper should live on `WorldState`, not on `ClientSimulationSystem`.

Why:

- `WorldState` already owns the canonical player mirror, the mirrored entity state, and `SpatialScene` membership updates.
- `WorldState` already centralizes the invariants currently hidden behind helpers like `set_player_position()` and `set_player_vector()`.
- `WorldState` is already the source of authoritative `WorldEvent`s emitted when those mirrors change.
- applying solved kinematics is a world-state mutation concern, not a scheduling concern.

If `ClientSimulationSystem` applied solved state directly, it would either duplicate world-mirroring rules that already belong in `WorldState`, or force the scheduler to become a second home for world mutation logic.

So the split should be:

- `ClientSimulationSystem`: decides when to solve and hands solved results to world-owned apply helpers
- `WorldState`: applies solved results while preserving authoritative mirror and scene invariants
- `MovementSystem`: reacts to player-specific consequences of the applied result

### `MovementSystem` Role After The Seam Exists

`MovementSystem` should stay in charge of movement orchestration, not remain the long-term owner of local kinematics integration.

It should continue to own:

- input command queuing and public-motion lifetimes
- snap-facing and other command interpretation
- wire packet emission, deduplication, and sequence diagnostics
- exposing local-player intent to `ClientSimulationSystem`
- deciding when solved local authoritative updates require sync pulses

It should stop owning as primary responsibilities:

- local pose advancement math
- local velocity/omega derivation as the final authority
- TUI-specific z/contact hacks
- future gravity/friction/collision behavior

In other words, `MovementSystem` should become the player-movement orchestrator that gathers intent, feeds it into `ClientSimulationSystem`, and handles the wire consequences of solved player updates. It should not remain the place where `advance_local_motion_prediction()` directly computes the next pose forever.

More precisely: it should become the player-movement orchestrator and wire owner, but not the top-level owner of physics scheduling for the client.

### Solve Call-Site Ownership

The call site for `solve()` should be owned by `ClientSimulationSystem`, not by `MovementSystem`.

That ownership is important enough to state plainly.

`ClientSimulationSystem` should own the call site because it is the natural home for:

- tick-time simulation scheduling
- assembling the active physical solve set for the frame
- issuing one or more solve requests for local bodies or interaction islands
- applying solved kinematics back into authoritative world state
- coordinating multiple sources of client-side simulated motion, not just player input

`MovementSystem` should not own the top-level solve call site because it is fundamentally a player-movement subsystem. Even if it is the only current producer of client-authoritative motion, making it the scheduler bakes player-centric ownership into a seam that is meant to grow to all physical entities.

`MovementSystem` should instead own:

- local movement intent and command lifetimes
- snap-facing and stop-transition rules
- packet emission and deduplication
- the decision of when a local authoritative update should trigger wire-visible follow-up

`SpatialPhysics` should not own its own scheduling or decide when to run. It is a solver policy, not a driver.

`WorldState` should not own the solve call site either. World should provide state, scene access, and result-application helpers, but it should not learn client control policy or top-level simulation scheduling.

`ProjectionSystem` definitely should not own the solve call site, because projection is presentation-only and intentionally downstream of authoritative state.

So the intended control flow is:

1. `ClientSimulationSystem` determines the active solve set for the tick.
2. it gathers local-player intent from `MovementSystem` and any future non-player motion drivers from other systems.
3. it builds `SpatialSolveRequest` for the active bodies or islands.
4. it calls `world.scene.physics.solve(...)`.
5. `WorldState` applies the returned `SolvedActorKinematics` through world-owned helpers.
6. `MovementSystem` handles any resulting player-specific sync pulses, stop transitions, or other wire-side consequences.

That keeps solve invocation in the client-wide simulation layer while keeping integration policy out of movement and out of world.

### Concrete ClientSimulationSystem Shape

This should not stay a vague box in the architecture. The intended first concrete home is `holtburger-core`, alongside the existing client runtime loop.

Working shape:

```rust
pub struct ClientSimulationSystem;

impl ClientSimulationSystem {
    pub fn tick(
        &mut self,
        now: Instant,
        dt: Duration,
        world: &mut WorldState,
        movement: &mut MovementSystem,
    ) -> Vec<WorldEvent> {
        let request = self.build_solve_request(now, dt, world, movement);
        let Some(request) = request else {
            return Vec::new();
        };

        let solved = world.scene.physics.solve(&request, &mut world.scene);
        self.apply_solve_batch(world, movement, solved)
    }
}
```

The important design points are:

- `ClientSimulationSystem` lives at the client-runtime layer, not inside `WorldState`
- it runs on the existing client physics tick
- it depends on `MovementSystem` as an intent source, not as a simulation owner
- it can later grow more intent sources without moving the call site again

The first helper surface should be concrete too:

- `MovementSystem::current_local_intent(...) -> Option<LocalMotionIntent>`
- `ClientSimulationSystem::build_solve_request(...)`
- `WorldState::apply_solved_actor_kinematics(...)`
- `MovementSystem::handle_post_solve(...) -> Vec<WorldEvent>` for player-specific wire follow-up if needed

A reasonable first-cut intent model is:

```rust
pub struct LocalMotionIntent {
    pub actor_id: Guid,
    pub locomotion: MotionState,
    pub snap_heading: Option<f32>,
    pub contact_hint: Option<bool>,
}
```

And a reasonable first-cut scheduler contract is:

```rust
impl ClientSimulationSystem {
    fn build_solve_request(
        &self,
        now: Instant,
        dt: Duration,
        world: &WorldState,
        movement: &MovementSystem,
    ) -> Option<SpatialSolveRequest>;

    fn apply_solve_batch(
        &mut self,
        world: &mut WorldState,
        movement: &mut MovementSystem,
        solved: SpatialSolveBatch,
    ) -> Vec<WorldEvent>;
}
```

The important part is that `MovementSystem` exports player intent and consumes post-solve consequences, while `ClientSimulationSystem` owns request construction and solve execution.

### Intent Handoff And Ownership

The orchestration should be read as a producer/consumer pipeline.

- `MovementSystem` produces `LocalMotionIntent`.
- `ClientSimulationSystem` consumes `LocalMotionIntent`.
- `ClientSimulationSystem` translates that intent plus authoritative world state into `SpatialSolveRequest`.
- `SpatialPhysics` consumes `SpatialSolveRequest` and produces `SpatialSolveBatch`.
- `WorldState` consumes solved actor kinematics and applies them authoritatively.
- `MovementSystem` then consumes the player-specific post-solve outcome to decide wire follow-up.

That means `LocalMotionIntent` is not a shared world object and it is not consumed directly by the solver. It is a client-side handoff object between the player-movement subsystem and `ClientSimulationSystem`.

Concretely, the handoff should look like this:

1. `movement.tick(...)` updates command lifetimes and public motion state.
2. `movement.current_local_intent(...)` returns `Option<LocalMotionIntent>` describing the locally controlled actor's current drive state.
3. `simulation.build_solve_request(...)` consumes that intent and reads authoritative world state to construct one or more `SolveActorInput` values.
4. `simulation` calls `world.scene.physics.solve(...)`.
5. `simulation.apply_solve_batch(...)` applies solved state through world helpers.
6. `movement.handle_post_solve(...)` examines the solved local-player outcome and decides whether to emit sync pulses, stop transitions, or other player-specific wire effects.

The key boundary is:

- pre-solve: `MovementSystem` owns intent
- solve-time: `ClientSimulationSystem` owns request construction and invocation
- post-solve: `WorldState` owns authoritative state application
- wire-after-effects: `MovementSystem` owns player-specific protocol behavior

This keeps `MovementSystem` from being half simulation owner, and keeps `ClientSimulationSystem` from absorbing player-specific packet logic.

`ClientSimulationSystem` should not own packet emission directly. It should own solve scheduling and the solved-state-application flow, while actual world mutation stays delegated to `WorldState`. Player-specific wire consequences stay delegated back to `MovementSystem`.

### Concrete Placement In The Current Client Loop

The existing physics tick in [client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs) already gives us the right insertion point.

Today that tick effectively does:

1. `movement.tick(...)`
2. `world.tick()`
3. `movement.advance_local_motion_prediction(...)`

The intended replacement is:

1. `movement.tick(...)`
2. `world.tick()`
3. `simulation.tick(now, dt, &mut world, &mut movement)`

So the first concrete refactor target is not "add a brand new top-level architecture somewhere abstract." It is:

- add `simulation: ClientSimulationSystem` to `Client`
- initialize it in the builder/test constructors
- replace the direct `advance_local_motion_prediction(...)` call in the client physics loop with `simulation.tick(...)`

That gives the scheduler a real seat in the runtime immediately, without requiring a later ownership migration.

### Long-Term Solve Scheduling

If the retail-shaped client eventually performs physics for all physical entities, then this scheduler is not a future promotion target. It is the right home from the start.

The difference is only scope: initially it may schedule solves for just the local player, but the owner does not need to change when the active solve set grows.

That scheduler would own:

- deciding the tick-wide solve set for the frame
- collecting local-player intent from `MovementSystem`
- collecting any other client-side motion directives or constraints for non-player bodies
- issuing one or more scene solves for the current interaction islands or active body sets
- applying solved kinematics back into world state

In that model:

- `MovementSystem` becomes the producer of local-player intent and the owner of player-specific wire consequences
- `SpatialPhysics` remains the solver policy over scene data
- `ClientSimulationSystem` is the owner of when and for whom solving happens

So the recommendation is:

- short term: use `ClientSimulationSystem` even if the active solve set is only the local player
- long term: grow that same `ClientSimulationSystem` to cover multiple physical entities without rehoming solve ownership

This avoids baking a player-centric call-site owner into the architecture and then migrating it later.

## Converged API

```rust
pub trait SpatialPhysics: Send + Sync + 'static {
    fn solve(
        &self,
        request: &SpatialSolveRequest,
        scene: &mut SpatialScene,
    ) -> SpatialSolveBatch;
}

pub struct SpatialSolveRequest {
    pub dt: Duration,
    pub actors: SmallVec<[SolveActorInput; 1]>,
}

pub struct SolveActorInput {
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vec3,
    pub omega: f32,
    pub locomotion: LocomotionState,
}

pub struct SpatialSolveBatch {
    pub solved: SmallVec<[SolvedActorKinematics; 1]>,
    pub events: SmallVec<[SpatialEvent; 4]>,
}

pub struct SolvedActorKinematics {
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vec3,
    pub omega: f32,
    pub contact: ContactState,
}
```

The important parts of this API are:

- batch-friendly solve shape
- concrete `SpatialScene` ownership of graph/query behavior
- no arbitrary world mutation from the solver
- actor-level solved outputs that world can apply coherently

## Converged Wiring

```rust
pub struct SpatialScene {
    pub landblock_map: HashMap<Guid, HashSet<Guid>>,
    pub physics: Arc<dyn SpatialPhysics>,
}

impl WorldState {
    pub fn new(resources: Arc<ScopedResourceResolver>) -> Result<Self> {
        Self::new_with_spatial_physics(resources, Arc::new(BasicSpatialPhysics))
    }

    pub fn new_with_spatial_physics(
        resources: Arc<ScopedResourceResolver>,
        spatial_physics: Arc<dyn SpatialPhysics>,
    ) -> Result<Self> {
        Ok(Self {
            // ... existing fields ...
            scene: SpatialScene {
                landblock_map: HashMap::new(),
                physics: spatial_physics,
            },
        })
    }
}

impl WorldState {
    pub fn apply_solved_actor_kinematics(
        &mut self,
        solved: &SolvedActorKinematics,
    ) -> Vec<WorldEvent> {
        // update player mirror state coherently in one place
    }
}
```

```rust
#[derive(Clone)]
pub struct ClientBuilder {
    account_name: String,
    // ... existing fields ...
    spatial_physics: Option<Arc<dyn SpatialPhysics>>,
}

impl ClientBuilder {
    pub fn spatial_physics(mut self, physics: Arc<dyn SpatialPhysics>) -> Self {
        self.spatial_physics = Some(physics);
        self
    }
}
```

```rust
pub struct TuiSpatialPhysics {
    base: Arc<dyn SpatialPhysics>,
    config: TuiSpatialHackConfig,
}
```

## Why This Fits Current Code

- [SpatialScene](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs) is already the natural home for "where things are", even though it is currently only a coarse landblock index.
- [WorldState](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs) already owns `scene: SpatialScene`, so storing the solver there fits the existing structure better than adding another top-level field.
- [MovementSystem](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) already contains baseline integration math in helpers like `sync_local_motion_vectors()` and `advance_local_motion_prediction()`, so `BasicSpatialPhysics` should be extracted from that logic rather than rewritten from scratch.
- that same file also owns wire concerns like `send_motion_state_pulse()`, `send_stop_pulse()`, and sequence tracking, which is a good signal that it should remain the orchestrator after integration logic moves behind the solver seam.
- [handle_server_controlled_movement()](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) currently mixes server-driven relocation interpretation with direct pose writes, which further supports splitting "decide what to do on the wire" from "compute the resulting kinematics".
- player physical state is currently mirrored awkwardly across player/entity/world helpers, so a one-shot world apply helper is needed anyway.
- [projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs) already owns presentation interpolation, which cleanly supports keeping interpolation out of this seam.
- [ClientBuilder](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) is already the natural injection point for swapping solver policy.

## Dry-Run Findings Against Current Code

Dry-running the rewritten phases against the actual client/runtime code surfaces a few concrete gaps and constraints that the plan should acknowledge explicitly.

### 1. Runtime Insertion Point Is Real And Straightforward

The current physics tick in [client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs) already has the exact slot where `ClientSimulationSystem` should land:

1. `movement.tick(...)`
2. `world.tick()`
3. `movement.advance_local_motion_prediction(...)`

So Phase 4 is grounded. Replacing step 3 with `simulation.tick(...)` is a concrete refactor, not an abstract aspiration.

### 2. Builder And Test Construction Need To Be First-Class In The Plan

[client/builder.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/builder.rs) constructs `Client` in two different ways:

- production path through `finish(...)`
- test path through `build_test_client(...)`

That means adding `ClientSimulationSystem` is not just a runtime-loop change. The builder and test helper paths must be updated in the same phase, or the architecture will immediately split between production and synthetic clients.

### 3. World-Owned Apply Helpers Are The Right Home, But The Naming Still Needs To Match Scope

[WorldState](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs) and [state/physics.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/physics.rs) already centralize the player mirror invariants behind `set_player_position()` and `set_player_vector()`.

That validates keeping solved-state application in `WorldState`.

The first rollout is player-local, but the helper name should still stay actor-general so the architecture does not need a second rename when non-player bodies arrive.

### 4. There Is Already A Second Movement Path Beyond Local Prediction

[client/messages.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/messages.rs) routes `WorldEvent::SelfServerControlledMotion` into `movement.handle_server_controlled_movement(...)`.

That means the runtime has two distinct movement-related paths today:

- physics-tick local prediction
- event-driven server-controlled relocation/turn handling

The new phased plan is correct to route local prediction first, but it should explicitly call out that this second path will remain a temporary bypass until the later migration phase.

Without that statement, the plan reads more complete than it really is.

### 5. Ordering Between `movement.tick(...)` And `simulation.tick(...)` Is An Actual Design Decision

The current loop runs `movement.tick(...)` before local prediction. That means `movement.tick(...)` today both updates intent state and may emit packets immediately.

When `ClientSimulationSystem` is introduced, the plan should keep this ordering explicit:

- `movement.tick(...)` updates command lifetimes, public motion state, and immediate wire-side transitions
- `simulation.tick(...)` consumes the resulting local intent and advances authoritative local spatial state
- `movement.handle_post_solve(...)` reacts to solved outcomes that require additional wire follow-up

This is not just documentation polish. Without an explicit ordering rule, it is easy to accidentally split stop/sync behavior across both systems in inconsistent ways.

### 6. `ClientSimulationSystem` Probably Should Not Own `dt` Computation Yet

The current runtime loop already computes `dt` in [client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs) before calling `advance_local_motion_prediction(...)`.

An internal `ClientSimulationSystem` timebase is plausible, but it introduces a second timebase owner for no clear gain while the simulation system is still owned directly by `Client`.

Practical implication:

- first cut is probably cleaner if `Client` continues computing `dt` and passes it into `simulation.tick(now, dt, ...)`
- internal scheduler-owned tick timing can be added later only if another use case justifies it

### 7. Event Projection Already Supports The Planned World-Apply Flow

[client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs) already projects `WorldEvent::EntityMoved` and `WorldEvent::EntityVectorUpdated` into `ClientViewEvent`s, which feed projection/render consumers.

That validates the scheduler -> world apply -> world event -> client view flow. We do not need a separate simulation-to-render bypass.

### 8. The Current Plan Should Treat Scene Growth As Independent From Scheduler Introduction

The runtime and ownership changes do not actually require `SpatialScene` to become a rich collision world immediately. The first player-local rollout can work with the current thin scene plus extracted baseline math.

That means scene growth should remain a later expansion phase, not a hidden prerequisite for introducing `ClientSimulationSystem`.

## Expected Split Between Movement And Spatial Physics

The target split should be explicit.

### `MovementSystem` Keeps

- command ingestion and public-motion state
- motion pulse deduplication and stop-pulse rules
- autonomous-position heartbeat and sync emission
- server sequence diagnostics
- exposing local-player intent and player-specific motion commands to the simulation scheduler
- consuming solved local-player outcomes and turning them into wire-visible consequences

### `SpatialPhysics` Owns

- deriving velocity and omega from locomotion intent and current orientation
- advancing local pose and heading for prediction ticks
- producing contact state for the solved result
- any TUI-only z/contact post-processing in the dishonest implementation
- future gravity, friction, collision, or terrain-aware constraints
- no ownership of tick scheduling, command lifetimes, or packet timing

### `ClientSimulationSystem` Keeps

- owning tick-time solve scheduling from the first rollout onward
- assembling the scene-wide or island-wide solve set for the frame
- invoking the solver for all active physical bodies, even if the initial active set is just the local player
- treating `MovementSystem` as one contributor of local-player intent rather than the global simulation owner
- living in `holtburger-core` client runtime code, adjacent to the main tick loop rather than hidden inside movement or world

### First-Cut Exception

Server-driven relocation handling can remain partially in `MovementSystem` for the first rollout if that keeps the initial cut smaller. But even there, the direction should be to move from "movement computes the final destination and writes it directly" toward "movement interprets the packet, the spatial solver resolves the resulting pose".

### Requested Solve Set vs Accessible Scene Scope

Even when the first active solve set is just the local player, that does not mean the scheduler or solver is player-scoped.

- the requested solve set may initially be just the local player
- the accessible scene scope is still the full `SpatialScene`
- long term, the requested solve set should grow into all active physical bodies or interaction islands for the tick

So the asymmetry is intentional:

- narrow initial solve set in the first rollout
- broad scene-aware solver capability from day one
- stable scheduler ownership from day one even as the solve set grows

## Implementation Plan

### Phase 1: Stabilize Shared Contracts

Status: completed on 2026-03-28.

- Add `SpatialPhysics` to `holtburger-world`.
- Add `SpatialSolveRequest`, `SpatialSolveBatch`, `SolveActorInput`, `SolvedActorKinematics`, and `ContactState`.
- Keep the request/result contract narrowly scoped to pose, velocity, omega, contact, and small spatial events.
- Add `WorldState::apply_solved_actor_kinematics(...)` as the canonical world-owned apply helper.
- Keep existing movement behavior unchanged in this phase.

Implemented in Phase 1:

- `SpatialScene` now owns an injected `Arc<dyn SpatialPhysics>` so the seam exists in the world layer immediately.
- the default world constructor currently installs `NoopSpatialPhysics` so the seam stays inert until later phases route real simulation through it.
- `ContactState` landed as `Unknown | Airborne | Grounded` to match current world knowledge without pretending we already have richer collision semantics.
- `WorldState::apply_solved_actor_kinematics(...)` composes existing world-owned position/vector mutation helpers for the local player and performs direct entity/scene updates for non-player actors.
- `ContactState::Unknown` intentionally preserves the existing grounded cache instead of forcing a false ungrounded transition.
- no runtime scheduling, builder injection, or movement-system call-site changes landed in this phase.

Definition of done:

- shared solver types compile cleanly
- world-owned apply helpers exist for solved kinematics
- no production movement path is routed through the seam yet
- no frontend-specific semantics leak into shared contracts

### Phase 2: Introduce Runtime Ownership

Status: completed on 2026-03-28.

- Add `ClientSimulationSystem` to `holtburger-core` as a concrete runtime subsystem owned by `Client`.
- Initialize it in builder and test construction paths.
- Give it explicit responsibilities for tick-time solve scheduling, request construction, solver invocation, and delegating solved-state application to world helpers.
- Add the first intent handoff surface from `MovementSystem`, such as `current_local_intent(...)`.
- Keep `Client` as the owner of `dt` computation initially and pass `dt` into the scheduler tick rather than creating a second timing source immediately.
- Do not replace existing local prediction yet; allow the scheduler to exist without owning production behavior.

Implemented in Phase 2:

- `Client` now owns a concrete `ClientSimulationSystem` in `holtburger-core`.
- builder and synthetic test construction both initialize that subsystem immediately so runtime and tests stay structurally aligned.
- the physics loop now gives `ClientSimulationSystem` a real call site using `now` plus client-computed `dt`, but the call remains behavior-inert because world currently installs `NoopSpatialPhysics` by default.
- `MovementSystem::current_local_intent(...)` now exposes the first client-side handoff object, including actor id, snap-heading intent, and grounded hint.
- snap-only intent is represented temporarily as `MotionState::default()` plus `snap_heading: Some(...)` so the handoff surface can exist before Phase 4 decides how snap-only solves should be encoded in shared solve input.
- request construction currently uses that local intent as the activation gate, then seeds `SpatialSolveRequest` from authoritative world pose and mirrored entity velocity/omega.
- existing production local prediction still runs through `advance_local_motion_prediction(...)`; `ClientSimulationSystem` does not own gameplay-authoritative motion yet.

Definition of done:

- `Client` owns a `ClientSimulationSystem`
- the scheduler has a concrete tick entrypoint in core runtime code
- `MovementSystem` can export local-player intent to the scheduler
- builder and synthetic test construction paths both initialize the scheduler
- no current gameplay behavior changes yet

### Phase 3: Extract Baseline Kinematics

Status: completed on 2026-03-28.

- Extract the current local-player integration math from `MovementSystem` into shared baseline solver helpers.
- Implement `BasicSpatialPhysics` using those helpers.
- Preserve current pose, velocity, omega, and contact semantics as closely as practical.
- Keep `BasicSpatialPhysics` conservative: no TUI lies, no frontend policy, no speculative collision behavior.

Implemented in Phase 3:

- the baseline local integration math now lives in a shared world-side helper, `advance_actor_kinematics(...)`, instead of being duplicated inside `MovementSystem`.
- `BasicSpatialPhysics` now exists in `holtburger-world` and builds `SpatialSolveBatch` by applying that shared helper across the requested actor batch.
- the extracted helper advances pose from authoritative pose plus mirrored velocity/omega, updates heading from `omega.z`, and rotates planar velocity by the integrated turn step so turning movement keeps matching current local prediction behavior.
- `MovementSystem::advance_local_motion_prediction(...)` now delegates to the shared helper by constructing `SolveActorInput` from authoritative player pose plus mirrored entity velocity/omega, then reuses `WorldState::apply_solved_actor_kinematics(...)` for state mutation.
- baseline contact stays deliberately conservative as `ContactState::Unknown`, which preserves the existing grounded cache instead of inventing new contact semantics before collision/terrain work exists.
- `BasicSpatialPhysics` is intentionally implemented but not installed as the world default yet; `NoopSpatialPhysics` remains the default until Phase 4 reroutes authority through the scheduler.

Definition of done:

- `BasicSpatialPhysics` can produce a complete `SpatialSolveBatch`
- extracted math is no longer duplicated between movement execution and solver code
- baseline solver behavior matches current local-player behavior closely enough for routing

### Phase 4: Route Player-Local Simulation Through The Scheduler

Status: completed on 2026-03-28.

- Replace the direct `advance_local_motion_prediction(...)` path in the client physics tick with `ClientSimulationSystem::tick(...)`.
- Have `ClientSimulationSystem` consume `LocalMotionIntent`, build a player-local solve request, invoke `world.scene.physics.solve(...)`, and hand solved results to `WorldState::apply_solved_actor_kinematics(...)`.
- Let `MovementSystem` consume post-solve player outcomes for sync pulses, stop transitions, and other wire-side consequences.
- Keep the initial active solve set limited to the local player.
- Preserve the current runtime ordering where `movement.tick(...)` runs before simulation so the scheduler consumes already-updated local intent.

Implemented in Phase 4:

- the client physics tick no longer calls `movement.advance_local_motion_prediction(...)`; player-local advancement now flows through `ClientSimulationSystem::tick(...)`.
- `SpatialScene::new()` now installs `BasicSpatialPhysics` as the default solver, so the runtime-owned simulation call site introduced in Phase 2 now performs real baseline solving instead of no-op batches.
- `ClientSimulationSystem` now applies solved batches through `WorldState::apply_solved_actor_kinematics(...)` and then hands each solved actor result to `MovementSystem::handle_post_solve(...)`.
- `MovementSystem::handle_post_solve(...)` currently exists as an explicit no-op boundary for the local player because the existing wire-visible movement pulses and stop transitions are still decided during `movement.tick(...)`; the seam is now in place without introducing speculative new packet behavior.
- runtime ordering remains explicit as `movement.tick(...)` -> `world.tick()` -> `simulation.tick(...)`, so the scheduler consumes already-updated local intent and mirrored vectors.
- the initial active solve set remains limited to the local player through `current_local_intent(...)`-gated request construction.

Definition of done:

- the client physics tick no longer advances local pose directly in `MovementSystem`
- player-local authoritative motion flows through `ClientSimulationSystem` and `SpatialPhysics`
- world mutation happens through world-owned apply helpers
- player-specific wire behavior still stays in `MovementSystem`
- `ClientSimulationSystem` uses `dt` supplied by `Client` rather than silently introducing a second timebase

### Phase 5: Add TUI-Specific Dishonest Solving

Status: completed on 2026-03-28.

- Add `TuiSpatialPhysics` as a decorator over `BasicSpatialPhysics`.
- Restrict the first dishonest mutation to the local-player solved entry.
- Keep planar motion and baseline angular integration owned by the baseline solver.
- Treat hacked `pose.z` and `contact` as one coherent output so the TUI does not mix fake altitude with baseline grounded state.
- Install the decorator only from `holtburger-cli` through builder injection.

Implemented in Phase 5:

- `ClientBuilder` now supports builder-time `spatial_physics(...)` injection, and `WorldState` has matching injected-physics constructors for both production and synthetic/test construction.
- `holtburger-cli` now owns `TuiSpatialPhysics` and `TuiSpatialHackConfig`; the dishonest solver does not live in shared crates.
- the TUI bootstrap path now opts into `TuiSpatialPhysics` explicitly through the builder, so solver selection remains a frontend construction decision rather than a shared runtime branch.
- the first dishonest mutation is intentionally bounded: when the active solve request contains exactly one actor, `TuiSpatialPhysics` can force grounded contact and apply a configured local z offset after baseline solving.
- the default TUI config currently forces grounded contact and leaves z unchanged with a `0.0` offset. That establishes the full z/contact decorator seam without introducing speculative altitude drift by default.
- multi-actor solve batches are intentionally left untouched for now because the current scheduler still builds a local-player-only solve request and the solver API does not yet carry an explicit local-player identity.

Definition of done:

- the TUI z/contact hack is entirely behind the spatial seam
- shared crates do not branch on TUI behavior
- TUI can opt in by supplying `TuiSpatialPhysics` at construction time

### Phase 6: Migrate Remaining Player-Specific Movement Paths

Status: completed on 2026-03-28.

- snap-facing remains movement-side orchestration. It is an immediate local heading command plus outbound sync pulse, not a scheduler-owned integration step.
- `LocalMotionIntent` was tightened back down to active locomotion intent only. The unused snap/contact fields were removed because the scheduler was not consuming them and snap-only commands are handled entirely inside `MovementSystem::tick(...)`.
- the last direct local-player pose-advancement helper was removed from `MovementSystem`. The runtime no longer has a second movement-owned local kinematics path, even in tests.
- the `SelfServerControlledMotion` path in [crates/holtburger-core/src/client/messages.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/messages.rs) now routes into `ClientSimulationSystem`, not directly into `MovementSystem`.
- `ClientSimulationSystem` now owns the spatial interpretation of server-controlled relocation/turn packets and converts them into a player-local solved kinematics result that still flows through `WorldState::apply_solved_actor_kinematics(...)` and `MovementSystem::handle_post_solve(...)`.
- this phase intentionally did not widen the `SpatialPhysics` solve contract for server-authored relocation directives. For now, server-controlled relocation is modeled as a scheduler-owned authoritative solved outcome rather than as a physics solve request, which keeps the solver API focused on integration while still removing the movement-side spatial bypass.
- a new regression test now covers server-controlled `MoveToPosition` routing through the migrated message -> simulation -> world-apply path.

- Revisit snap-facing and server-controlled relocation paths and decide which parts should feed solver inputs versus remain movement-side orchestration.
- Remove remaining direct local-player pose-advancement logic from `MovementSystem`.
- Move sticky-melee-adjacent special handling behind the same seam where appropriate.
- Tighten the pre-solve and post-solve interfaces so `MovementSystem` is only intent and wire orchestration.
- Explicitly migrate the `SelfServerControlledMotion` -> `movement.handle_server_controlled_movement(...)` path in [client/messages.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/messages.rs) once the player-local scheduler path is stable.

Definition of done:

- no remaining player-local kinematics authority lives directly in `MovementSystem`
- movement-side special handling no longer bypasses the seam for local-player spatial outcomes
- the player-local runtime story is internally consistent around scheduler -> solver -> world apply -> movement follow-up

### Phase 7: Expand Toward Full Client Physics

Status: completed on 2026-03-28.

- `SpatialScene` now owns a pose index in addition to coarse landblock membership, and its existing `get_entities_in_range(...)` query is now backed by authoritative scene pose snapshots rather than a stubbed placeholder.
- the scene API stayed intentionally narrow. This phase did not expose speculative raycasts/sweeps; it only added the first fine-grained query the scheduler can justify using today.
- `ClientSimulationSystem` now has a generic tracked-actor source and can build a multi-actor solve request instead of being structurally hard-coded to the local player.
- the active solve set stays narrow by default. Tracked non-player actors only join the same solve request when they are within a scene-owned range query around the local simulated actor; if there is no local actor, the tracked actors can still be solved directly.
- runtime tracked-actor registration now exists in production code through observed world events. Non-player entities with live kinematic updates can be registered and unregistered from the scheduler without relying on test-only hooks.
- the same scheduler -> solver -> world-apply path now demonstrably advances more than one actor in a single tick, and `WorldState::apply_solved_actor_kinematics(...)` remains the shared authoritative application path for both player and non-player bodies.
- `ClientSimulationSystem` now consumes `SpatialSolveBatch.events` as well as solved kinematics, so the seam contract no longer drops solver-side spatial events on the floor.
- `BasicSpatialPhysics`, `TuiSpatialPhysics`, and any future honest solver continue to satisfy the same `SpatialPhysics` contract. Phase 7 expanded solve-set selection and scene query capability without reshaping solver ownership boundaries.

- Grow `SpatialScene` beyond coarse landblock indexing into a richer scene-owned graph/query subsystem.
- Expand `ClientSimulationSystem` to gather more motion-intent sources and solve larger active body sets or interaction islands.
- Add honest spatial answers over time: terrain sampling, contact estimation, collision constraints, gravity, friction, and richer blocker classification.
- Keep public scene APIs intentionally narrow until real second callers justify exposing more query primitives.

Definition of done:

- the same scheduler/solver/world-apply architecture can handle more than the local player
- honest client-side physics can grow without reshaping ownership boundaries
- baseline, dishonest, and future honest solvers still satisfy the same contract

## Testing And Validation Plan

- Add unit tests for the shared request/result types and world-owned apply helpers.
- Add unit tests around `BasicSpatialPhysics` solve behavior for pose, velocity, omega, and contact integration.
- Add scheduler tests that verify `ClientSimulationSystem` consumes `LocalMotionIntent`, builds solve requests, and delegates solved-state application correctly.
- Add regression tests for the player-local routing change so replacing `advance_local_motion_prediction(...)` does not change expected motion behavior.
- Add regression tests for `TuiSpatialPhysics`, especially z fudging and contact semantics.
- Add focused tests for `SpatialScene` graph/query behavior as the scene grows richer.
- When practical, add ACE-grounded comparison tests for both baseline and hacked paths so dishonest outputs remain intentionally bounded.

All of those can remain behind the same seam.

## Open Questions

1. Should server-driven relocation interpretation be part of the first seam rollout, or should the first cut focus only on local prediction/integration?
2. Is one `solve()` entrypoint still the right shape once non-player actors or richer collision systems start using it?
3. How aggressive should the first baseline contact fallback be when authoritative grounded state is absent?

## Recommended Answers To Current Open Questions

1. Server-driven relocation should follow after local prediction and integration are successfully routed through the seam.
2. One `solve()` entrypoint is the right starting shape. Split it later only if real usage shows stable fault lines.
3. The first baseline contact fallback should stay conservative and authority-biased rather than trying to infer too much.

## Working Recommendation

If the future 3D client will eventually need movement informed by real spatial or collision answers, then the seam should live in that future home now.

That means:

- world-owned seam
- conservative baseline default
- trait-object DI via builder-time injection
- solver stored on `SpatialScene`
- concrete graph and query behavior owned by `SpatialScene`
- solved actor kinematics applied through one coherent world helper
- authority/presentation split treated as `SpatialPhysics` versus projection, not `movement` versus projection
- `MovementSystem` reduced to movement orchestration and wire responsibilities rather than remaining the owner of local pose advancement
- a client-wide simulation/physics scheduler owning solve scheduling from the start, even if the initial solve set is only the local player
- `MovementSystem` feeding local-player intent into that scheduler rather than becoming the global simulation owner
- TUI dishonest implementation supplied by the frontend
- TUI implementation composing the baseline solver and layering local-player z/contact fudging on top of the solved result
- movement consuming compact spatial solve results with angular state included from day one instead of owning hacks

That is the cleanest way to support the TUI compromise without making the architecture itself patchwork.