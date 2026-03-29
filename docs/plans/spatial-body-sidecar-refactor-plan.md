# SpatialBody Sidecar Refactor Plan

## Goal

Make `SpatialBody` sidecars the live local runtime state for movement, tracking, navigation, and prediction, while preserving `Entity` and player world state as server-confirmed authoritative snapshots only.

## Scope

### In Scope

- Introduce a scene-owned sidecar model for tracked spatial bodies and derived spatial samples.
- Define a stable body identity model that can represent hydrated entities and non-entity client-side bodies.
- Move consumer-facing predictive sampling off the current standalone projection state model and onto world/spatial-owned sidecar data.
- Re-route local solve and controller-driven spatial updates so they mutate sidecar bodies rather than authoritative entity/player pose fields.
- Rework navigation and related spatial consumers to read from the shared sidecar model.
- Narrow or retire the current `EntityProjectionSystem` where its responsibilities become redundant.

### Out of Scope

- Full collision/pathfinding implementation.
- Replacing current controller policy in `navigation.rs` with a retail-grade 3D navigation stack.
- Immediate support for every possible ephemeral body type; the first rollout only needs a shape that can grow there cleanly.
- Changing wire protocol semantics or session transport behavior.

## Ground Truth

### Reference Sources

- [ARCHITECTURE.md](/home/cluracan/code/holtburger/ARCHITECTURE.md)
- [crates/holtburger-world/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-world/ARCHITECTURE.md)
- [docs/plans/thin-client-spatial-assist-seam-working-doc.md](/home/cluracan/code/holtburger/docs/plans/thin-client-spatial-assist-seam-working-doc.md)
- [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs)
- [crates/holtburger-world/src/entity.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/entity.rs)
- [crates/holtburger-world/src/state/liveness.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/liveness.rs)
- [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs)
- [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs)
- [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs)
- [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs)

### Existing Patterns

- `SpatialScene` already owns spatial indexing and solver policy in [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs).
- `WorldState` already owns authoritative apply semantics in [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs).
- `ClientSimulationSystem` already owns solve scheduling in [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs).
- `EntityProjectionSystem` already defines the current predictive sample surface in [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs).
- Navigation already treats projected samples as operational inputs in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs).

## Problem Statement

The current architecture says authoritative spatial state lives in world/simulation while predictive spatial sampling lives in a separate core-side projection system. That split is weaker than the code now implies:

- projection samples are already consumed by navigation and target tracking, not only by renderers
- projection can therefore influence behavior, not merely presentation
- projection is geometry-blind today, so operational consumers can act on samples that drift through blockers

At the same time, mutating authoritative player/entity pose from local solve confuses server-confirmed world truth with local runtime simulation, and putting predicted fields directly on `Entity` would blur the meaning of the hydrated world object and block future tracking of client-side spatial bodies that are not authoritative entities or do not have a real `Guid`.

The cleaner direction is a world-owned `SpatialBody` sidecar model:

- `Entity` remains authoritative hydrated state
- `SpatialScene` owns tracked bodies and derived samples
- local solve, navigation, tracking, and render all operate on sidecar body state rather than authoritative entity/player pose fields
- server packets reconcile authoritative world state and seed or correct corresponding sidecar bodies
- navigation, tracking, and rendering query the shared sidecar model instead of maintaining a wholly separate predictive store

## Proposed Model

### Core Types

Introduce a scene-owned identity and sample model in `holtburger-world`.

Working shape:

```rust
pub enum SpatialBodyId {
    Entity(Guid),
    LocalPlayer(Guid),
    Ephemeral(u64),
}

pub struct SpatialBody {
    pub id: SpatialBodyId,
    pub authoritative_pose: Option<WorldPosition>,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub contact: ContactState,
    pub mode: SpatialSampleMode,
}
```

The important properties are:

- body identity is not hard-coded to `Guid`
- the local player keeps an explicit tagged runtime identity without losing its authoritative `Guid`
- server-confirmed authoritative pose is retained separately from live runtime body pose
- non-entity client-side bodies can exist without polluting `Entity`
- consumers can read one world-owned runtime spatial sample surface

### Ownership

- `SpatialScene` owns the sidecar storage and query/indexing over tracked bodies.
- `WorldState` remains the owner of canonical server-confirmed entity/player mutation.
- `ClientSimulationSystem` remains the owner of solve scheduling.
- controllers, navigation, and rendering should stop owning separate pose caches once the sidecar is available.

### Runtime Sampling Home

The current `EntityProjectionSystem` owns more than a simple pose cache. It currently owns:

- interpolation state and timers
- snap thresholds and dead-reckon windows
- teleport suspension and forced-reposition resets
- the current public sample type consumed by navigation and rendering

This refactor must give those semantics an explicit new home instead of merely saying they move "into the scene".

Working direction:

- `SpatialScene` should own canonical `SpatialBody` runtime state plus any required sidecar sampling state for interpolation, dead-reckoning, and suspension.
- a narrowed `EntityProjectionSystem` may remain temporarily as a read-only facade over scene-owned sampling state during migration, but it should stop being a second source of truth.
- configuration currently embodied by `ProjectionConfig` must either move into scene-owned sampling config or be surfaced as an explicit adapter layer that reads from scene-owned state.

### Player Mirror Contract

The local player is still mirrored today across `PlayerState` and the player-backed `Entity`.

Under this refactor:

- `PlayerState` plus the player-backed `Entity` remain the server-confirmed authoritative mirror
- `SpatialBodyId::LocalPlayer(Guid)` owns the live local runtime body state
- server packets update the authoritative mirror first, then reconcile or reseed the local-player body
- routine local solve must not be allowed to mutate the authoritative player mirror just because that mirror still exists

That distinction must remain explicit during Phases 2 and 3.

### Contract Direction

This plan does not require folding prediction into `SpatialPhysics::solve(...)` immediately.

The stronger direction for this refactor is:

- authoritative server state remains the job of packet-driven world mutation
- `SpatialPhysics` advances scene-owned `SpatialBody` runtime state rather than mutating authoritative entity/player pose fields
- movement, navigation, tracking, and rendering consume sidecar body state
- server packets reconcile body state back toward confirmed truth by updating authoritative snapshots and corresponding body corrections
- collision-aware or constraint-aware body advancement can later move closer to solver helpers without first exploding the `SpatialPhysics` trait surface

That keeps the solver focused on body advancement while making the truth split explicit: authoritative world snapshots are server-confirmed, live spatial bodies are client runtime state.

## Phased Implementation

### Phase 1: Define `SpatialBody` Sidecar Contracts

#### Deliverables

- Add `SpatialBodyId`, `SpatialBody`, and any supporting mode/sample enums in [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs).
- Add sidecar storage to `SpatialScene`.
- Add scene helpers for registering, updating, querying, and removing tracked spatial bodies.
- Introduce body-centric solver contract types or an explicit compatibility bridge so later phases are not blocked on raw `Guid`-centric solve identities.
- Define the scene-owned home for runtime sampling state that is currently owned by [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs), including interpolation, dead-reckoning, snap, and suspend state.
- Define the registration API for ephemeral bodies, including whether IDs are supplied or allocated by `SpatialScene`.
- Keep existing `Entity` behavior unchanged in this phase.

#### Acceptance Criteria

- world compiles with a scene-owned body sidecar model
- `Entity` remains authoritative-only
- sidecar identity can represent at least entity-backed and ephemeral bodies
- the plan has a defined path from raw `Guid`-centric solve/event types to `SpatialBodyId`-aware solve/event types
- the plan has an explicit home for interpolation/dead-reckoning/suspension state after projection-store collapse
- the plan has an explicit ephemeral registration/allocation contract
- unit tests cover body registration, update, and removal semantics

### Phase 2: Seed And Reconcile Bodies From Authoritative World State

#### Deliverables

- Update world mutation flows in [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs) and [crates/holtburger-world/src/state/liveness.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/liveness.rs) so server-driven entity/player updates seed, correct, and retire corresponding `SpatialBody` sidecar records.
- Ensure entity spawn/replace/despawn and server movement/vector updates keep body-sidecar state coherent.
- Make the player mirror contract explicit: server-driven updates seed `PlayerState` and the player-backed `Entity`, then reconcile `SpatialBodyId::LocalPlayer(Guid)`.
- Add teleport and forced-reposition sidecar suspension/reset rules so runtime bodies do not continue advancing through authoritative teleport boundaries.

#### Acceptance Criteria

- authoritative world updates automatically seed and reconcile scene body sidecar state
- despawning or pruning an entity removes its corresponding body sidecar entry
- teleport and forced-reposition flows reset or suspend relevant bodies deterministically
- world tests cover entity/body coherence under create, server move, vector update, correction, and despawn

### Phase 3: Route Local Solve And Controllers Through Sidecar Bodies

#### Deliverables

- Update [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs) so solve inputs are built from `SpatialBody` state and solve outputs mutate `SpatialBody` state rather than calling authoritative world pose/vector apply helpers.
- Migrate `SolveActorInput`, `SolvedActorKinematics`, and `SpatialEvent` handling in [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs) and related scheduler code so runtime solve/apply paths operate on `SpatialBodyId`-aware identities instead of assuming entity-backed `Guid`s.
- Reduce [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) to intent, sequence, pulse, and wire orchestration; local spatial advancement and local vector writes should no longer target authoritative player/entity state.
- Rework any controller-driven pose updates to target sidecar bodies only.
- Re-route movement packet construction and heartbeat/sync reads so they source local pose/vector data from the local-player body rather than `world.player.position` and related authoritative fields.
- Decide whether `SpatialEvent` becomes `SpatialBodyId`-based directly or whether a compatibility event layer is introduced temporarily; document the chosen migration path.

#### Acceptance Criteria

- local solve no longer mutates authoritative entity/player pose fields
- runtime solve/apply paths no longer depend on raw entity `Guid`s as the only solvable identity
- movement/controller code no longer uses authoritative local pose/vector writes for routine local runtime advancement
- movement packet construction for local runtime motion reads body state rather than authoritative world pose/vector fields
- scheduler, movement, and controller tests demonstrate sidecar-owned live body updates

### Phase 4: Collapse Projection-Owned Sampling Into Scene-Owned Bodies

#### Deliverables

- Introduce a world-owned runtime sampling/update path for scene bodies, initially preserving current interpolation/dead-reckoning semantics closely where still needed.
- Refactor [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs) into either:
  - a thin facade over scene-owned samples, or
  - a smaller consumer helper that no longer owns the canonical predictive store
- Preserve existing runtime sampling concepts where they still matter: interpolation windows, snap thresholds, teleport suspension, forced reposition resets.
- Ensure there is no ambiguous dual-write period where sidecar bodies and `EntityProjectionSystem` independently advance runtime state without a defined sync rule.

#### Acceptance Criteria

- there is one canonical runtime spatial body/sample store under world/spatial ownership
- core no longer owns a separate full authoritative-plus-prediction cache for entities
- any temporary projection facade is read-only over scene-owned state rather than a second updating store
- existing projection tests are either migrated or replaced with equivalent scene-owned sample tests

### Phase 5: Migrate Navigation And Tracking Consumers

#### Deliverables

- Update [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs) to consume scene-owned body samples instead of the old projection-owned sample path.
- Audit any other target tracking or controller inputs that currently rely on `EntitySpatialSample` and rehome them onto the shared sidecar model.
- Preserve the distinction between server-confirmed and live runtime target pose in consumer inputs where that distinction still matters.
- Define the replacement sample contract for consumers that currently expect both authoritative and projected pose in one object.

#### Acceptance Criteria

- navigation consumes the new shared spatial sample surface
- no controller depends on the old projection store as the source of truth for predictive samples
- migrated consumers have a defined replacement for `EntitySpatialSample` that still exposes any required authoritative-versus-runtime distinction
- regression tests confirm approach/follow/sticky behavior still works with migrated sample sources

### Phase 6: Support Non-Entity Bodies And Constraint-Aware Growth

#### Deliverables

- Add the first path for registering an ephemeral/non-entity `SpatialBody` without a backing `Entity`.
- Define lifecycle rules for ephemeral bodies in `SpatialScene`.
- Document how future collision-aware body advancement or runtime sampling can constrain `pose` against scene-owned spatial answers.
- Implement the Phase 1 ephemeral registration/allocation contract rather than inventing a second path here.

#### Acceptance Criteria

- the sidecar model can represent at least one non-entity tracked body cleanly
- scene/body APIs no longer assume every tracked body has a `Guid`
- the architecture leaves room for physically constrained predictive samples without redesigning ownership again

## Risks & Mitigations

### Risk: `Entity` Meaning Gets Accidentally Weakened Anyway

If call sites keep reaching through `Entity` for prediction-like data, the sidecar model will exist on paper but not in practice.

Mitigation:

- keep prediction fields out of `Entity`
- make consumer APIs explicitly request `SpatialBody` or `SpatialSample`
- remove or shrink APIs that still expose live runtime state through entity-owned fields

### Risk: Authoritative And Runtime Body State Get Confused

If local solve still writes to authoritative world pose/vector fields in parallel with sidecar body updates, the rollout will preserve the ambiguity it is supposed to remove.

Mitigation:

- treat local-solve writes into authoritative world pose/vector as explicit collapse targets
- reserve authoritative world spatial mutation for server-driven updates and reconciliation only
- make tests assert that routine local advancement changes body state without mutating server-confirmed snapshots

### Risk: The Rollout Creates Two Competing Runtime Stores

If `EntityProjectionSystem` and the new sidecar both remain live sources of runtime body state for too long, the codebase will get patchwork fast.

Mitigation:

- treat Phase 4 as the point where scene-owned samples become canonical
- keep any temporary projection wrapper read-only over the new sidecar model

### Risk: Player Packet Construction Keeps Reading Authoritative Snapshots

If movement pulse/sync packet builders keep reading `world.player.position` and related authoritative fields after body-sidecar rollout, local runtime motion and packet emission will diverge.

Mitigation:

- treat local packet-building reads as part of the Phase 3 migration scope
- add regression tests that compare emitted local motion packets against body state rather than authoritative mirror state

### Risk: Teleport And Forced-Reposition Suspension Semantics Get Lost

The current projection store owns teleport suspension and forced-reposition resets. If those semantics are not explicitly rehomed, runtime bodies can continue advancing across authoritative discontinuities.

Mitigation:

- define teleport/reset behavior in Phase 2 before projection-store collapse
- add tests covering suspension and resume of local-player and remote bodies

### Risk: Identity Model Becomes Over-Engineered

It is easy to invent a huge identity abstraction before real ephemeral bodies exist.

Mitigation:

- keep `SpatialBodyId` minimal in the first cut
- support only the known immediate cases: entity-backed and ephemeral/local
- extend only when a real caller appears

### Risk: Constraint-Aware Prediction Pressures `SpatialPhysics` Too Early

There will be temptation to bolt predictive sampling directly onto `solve()` before the sidecar architecture is stable.

Mitigation:

- keep authoritative solve and sidecar prediction loosely coupled at first
- only widen `SpatialPhysics` once a stable constrained-sampling requirement is proven

## Definition of Done

- `SpatialScene` owns a canonical sidecar model for tracked spatial bodies and runtime samples.
- `Entity` remains an authoritative hydrated object and does not carry sidecar prediction fields.
- navigation, tracking, and other controller consumers use the shared sidecar model instead of separate projection-owned or controller-owned stores.
- local solve and controller-driven runtime updates do not mutate server-confirmed world spatial state.
- core no longer owns a second full entity prediction cache.
- the architecture can represent non-entity tracked bodies without fake GUID hacks.
- world/core tests pass and cover both entity-backed and sidecar lifecycle invariants.

## Code Paths To Collapse Or Prune

The current codebase already shows which paths become redundant under this direction.

### Collapse Targets

- Local-solve writes into authoritative world state through [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs): `apply_solved_actor_kinematics(...)` for routine local runtime advancement.
- Scheduler application path in [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs): the current `world.apply_solved_actor_kinematics(...)` flow should become body-sidecar mutation for local/runtime bodies.
- Local vector/pose writes from [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs): direct calls into `world.set_player_position(...)` and `world.set_player_vector(...)` for routine local motion should collapse into sidecar updates or disappear entirely.
- Separate projection-owned sample cache in [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs): `EntityProjectionSystem`, `ProjectedEntityState`, and `EntitySpatialSample` should be narrowed into scene-body facades or retired.
- Navigation/controller dependency on projection-owned types in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs) and [crates/holtburger-core/src/client/controllers/maintain_range.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/maintain_range.rs).

### Keep As Authoritative World Mutation Paths

- Server-driven position/vector/application flows in [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs) and message handlers under `holtburger-world/src/handlers/**`.
- Reconciliation and correction paths where authoritative server updates seed or snap corresponding bodies.
- World visibility/lifecycle ownership in [crates/holtburger-world/src/state/liveness.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/liveness.rs).

## Living Worksheet

### Task Checklist

- [ ] Phase 1: add `SpatialBody` sidecar types and storage
- [ ] Phase 1: add sidecar registration/query tests
- [ ] Phase 1: define body-centric solver identity migration path
- [ ] Phase 1: define scene-owned home for interpolation/dead-reckoning/suspend state
- [ ] Phase 1: define ephemeral body registration/allocation contract
- [ ] Phase 2: seed and reconcile authoritative entity/player state into sidecar bodies
- [ ] Phase 2: add coherence tests for spawn/server-move/vector/despawn
- [ ] Phase 2: define and test teleport/forced-reposition body reset behavior
- [ ] Phase 3: route local solve and controller updates through sidecar bodies
- [ ] Phase 3: migrate solve/apply contracts off raw `Guid`-only identity
- [ ] Phase 3: remove routine local writes into authoritative world pose/vector fields
- [ ] Phase 3: migrate movement packet-building reads onto body state
- [ ] Phase 4: make scene-owned samples canonical
- [ ] Phase 4: shrink or remove the standalone projection-owned store
- [ ] Phase 5: migrate navigation/tracking consumers
- [ ] Phase 5: add regression tests for migrated controller inputs
- [ ] Phase 6: add first non-entity body path
- [ ] Phase 6: document constrained-prediction growth path

### Decisions Log

- Initial direction: prefer scene-owned sidecar samples over adding prediction fields directly to `Entity`.
- Initial naming: use `SpatialBody` / `SpatialBodyId` terminology.
- Initial ownership: keep `ClientSimulationSystem` as scheduler owner; do not move scheduling into the projection layer.
- Refined direction: live local runtime state belongs to `SpatialBody` sidecars; authoritative entity/player spatial state should be mutated only by server-driven world updates and reconciliation.
- Open question resolution: keep `SpatialBodyId::LocalPlayer(Guid)` so the local player remains a tagged runtime identity while still carrying the underlying authoritative entity mapping.
- Open question resolution: preserve server-faithful interpolation/runtime sampling behavior during migration rather than intentionally narrowing it in the first cut.
- Open question resolution: navigation and controller migration should assume all authoritative spatial field reads and writes move to sidecar bodies unless a concrete counterexample appears during implementation.

### Verification Log

- 2026-03-28: planning-only phase; no code changes executed under this plan yet.

### Resolved Assumptions

- `SpatialBodyId::LocalPlayer(Guid)` should remain distinct as a tagged runtime identity while directly retaining the local player's authoritative `Guid` mapping.
- The first scene-owned runtime body mode should preserve existing server-faithful interpolation and dead-reckoning behavior as closely as practical.
- Phase 3 migration should treat all navigation/controller authoritative spatial field reads and writes as sidecar migration targets unless implementation proves a narrower carveout is necessary.