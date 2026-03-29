# Spatial Scene Ownership Split Plan

## Goal

Remove the overloaded shared `SpatialScene` ownership model by separating world-owned authoritative spatial state from the app-facing projection cache, while preserving shared runtime sampling semantics in reusable world/core code.

## Scope

### In Scope

- Split the current `SpatialScene` responsibilities into clearer world-owned and app-facing pieces.
- Keep interpolation, dead reckoning, heading projection, and sample derivation in shared code rather than reintroducing frontend-owned math.
- Replace the CLI's full-scene `projection_scene` with a narrower projection cache/read model.
- Retarget the core bridge so it updates a projection cache rather than a world-shaped scene.
- Preserve or explicitly adapt the current `SpatialPhysics::solve(..., &mut SpatialScene)` seam so world solve flows and TUI physics wrappers do not become accidental blockers.
- Trim or rename APIs so the app no longer appears to own world-authoritative spatial machinery.

### Out of Scope

- Changing authoritative world mutation semantics unrelated to spatial ownership.
- Redesigning physics or collision behavior.
- Reworking navigation/controller policy beyond adapting them to the new sample source.
- Introducing a 3D-client-specific rendering architecture in this refactor.

## Ground Truth

### Reference Sources

- [AGENTS.md](/home/cluracan/code/holtburger/AGENTS.md)
- [ARCHITECTURE.md](/home/cluracan/code/holtburger/ARCHITECTURE.md)
- [crates/holtburger-world/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-world/ARCHITECTURE.md)
- [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs)
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs)
- [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs)
- [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)
- [apps/holtburger-cli/src/pages/game/panels/context.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/context.rs)

### Existing Patterns

- `WorldState` already owns authoritative entity/player coherence and spatial indexing integration.
- `SpatialScene` currently mixes authoritative query/index state with runtime body sampling and optional physics hosting.
- `ClientViewSpatialBridge` already acts as the core-side translator from `ClientViewEvent` into app-maintained projection state.
- The CLI currently reads only narrow projected sample data even though it owns a full `SpatialScene` instance.
- `ClientSimulationSystem` currently depends on `world.scene.physics` and `world.scene.get_entities_in_range(...)`, so world query/index and solve-host responsibilities must remain available on the world-owned side.
- The TUI-only physics wrapper in [apps/holtburger-cli/src/spatial.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/spatial.rs) uses `SpatialScene` as a solve context, but that is separate from the game page's `projection_scene` ownership problem.

## Problem Statement

The current `SpatialScene` type conflates two different ownership contexts:

- world-owned authoritative/indexed spatial state used by `WorldState`
- app-owned projection/runtime sampling state used by the CLI

That overload is harmful because the app appears to own machinery it should never reason about directly, including body registration, reset/suspend primitives, ephemeral allocation, spatial indexing, and physics-facing structure. The real app need is much narrower: it needs a projection cache that can answer sample lookups for a `Guid` and optionally provide batch projected samples for rendering/debug.

The refactor should therefore avoid exposing a generic `SpatialBodyScene` directly to the app. Instead, it should:

- keep reusable runtime body-sampling logic in shared code
- keep world-authoritative spatial indexing in world-owned structures
- give the app a narrow projection-cache surface rather than a scene surface

## Proposed Model

### 1. Shared Runtime Sampling Store

Introduce a world-owned reusable store for runtime body sampling semantics. Working name: `BodySamplingStore`.

Responsibilities:

- own runtime body records keyed by `SpatialBodyId`
- own sampling config and interpolation/dead-reckoning/suspend state
- derive `SpatialProjectedEntityState` and `SpatialEntitySample`
- support internal maintenance operations needed by authoritative reconciliation and projection-event application

Non-responsibilities:

- authoritative landblock/entity indexing
- world query APIs like nearby/radius entity searches
- frontend-specific orchestration policy
- direct public exposure of the full mutation surface to app code

### 2. World-Owned Authoritative Spatial State

Retain `SpatialScene` as the world-owned composite that represents the authoritative spatial world. Its responsibilities become explicit:

- landblock/entity pose indexing
- physics host if still required by world-side solve flows
- solve/query context for systems that currently depend on `world.scene.physics` and nearby/radius world queries
- composition over `BodySamplingStore` for runtime body state
- authoritative mutation helpers that keep world state, entity mirrors, and body sampling state coherent

### 3. App-Facing Projection Cache

Add a narrow app-facing projection read model in `holtburger-core`. Working name: `ClientProjectionCache`.

Responsibilities:

- expose only the reads the app actually needs, such as `sample(guid)`, `sample_or_authoritative(entity)`, and possibly `iter_projected_entities()`
- hide body registration/reset/suspend/allocation machinery from the app surface
- internally reuse shared runtime sampling code rather than duplicating math in the frontend

Non-responsibilities:

- authoritative world indexing
- world mutation/reconciliation policy
- generic scene management semantics

### 4. Core Bridge Role

`ClientViewSpatialBridge` remains in `holtburger-core`, but its target changes from a general `SpatialScene` to the new projection cache type. That keeps `ClientViewEvent` knowledge out of `holtburger-world` while eliminating the current lie that the app owns a world-shaped scene.

### 5. Physics Boundary

Keep `SpatialPhysics::solve(..., &mut SpatialScene)` on the world-owned composite for this refactor.

This ownership split is about projection/runtime sampling versus authoritative world state, not about redesigning the world solve context. The TUI spatial-physics wrapper and existing world/core solve call sites already depend on `SpatialScene` as the solve host, so this refactor should not widen scope by introducing a new physics context abstraction unless implementation proves it is unavoidable.

## Phased Implementation

### Phase 1: Extract Shared Sampling Engine

#### Deliverables

- Extract the runtime body-sampling fields and methods from [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs) into a dedicated shared store type.
- Keep sampling semantics unchanged: interpolation, dead reckoning, heading projection, snap logic, suspend/reset, and sample derivation must remain behaviorally identical.
- Update world-owned spatial structures to compose that store rather than owning the fields directly.
- Preserve the current `SpatialPhysics::solve(..., &mut SpatialScene)` signature while extracting the sampling engine, so the world-owned solve host remains stable during this refactor.
- Keep public behavior stable enough that existing world tests can be preserved or mechanically retargeted.

#### Acceptance Criteria

- `SpatialScene` no longer directly owns the extracted runtime sampling fields and mutation logic.
- the world-owned solve path still uses `SpatialScene` as its explicit context object for `SpatialPhysics` implementations and callers
- Sampling tests continue to live with the shared runtime sampling engine rather than migrating into the CLI.
- `cargo test -p holtburger-world` passes.

### Phase 2: Introduce Narrow Projection Cache And Retarget Core Bridge

#### Deliverables

- Introduce `ClientProjectionCache` or equivalent narrow projection-cache type.
- Place `ClientProjectionCache` in `holtburger-core` as a consumer-oriented cache wrapper over shared sampling behavior.
- Update [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs) so `ClientViewSpatialBridge` updates the projection cache rather than a full `SpatialScene`.
- Replace the CLI's `projection_scene: SpatialScene` in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) with the new projection cache type.
- Retarget CLI reads in state/context/debug code to the cache's narrow read surface.
- Keep unrelated CLI spatial-physics code paths using the world-owned solve context until or unless they independently justify cleanup.

#### Acceptance Criteria

- the CLI no longer owns a `SpatialScene`
- the CLI can only perform narrow projection reads through the cache surface
- `ClientViewSpatialBridge` no longer accepts a world-shaped scene type
- `cargo test -p holtburger-core` and `cargo test -p holtburger-cli` pass

### Phase 3: Delete Overloaded App-Facing Scene Surface

#### Deliverables

- Remove or restrict the remaining app-oriented runtime sampling APIs from the world-owned `SpatialScene` surface.
- Rename types if needed so the ownership story is honest again.
- Update architecture docs and any remaining comments/tests that still imply the app owns a general spatial scene.
- Confirm that world owns authoritative spatial/index semantics, shared code owns sampling behavior, and the app owns only a cache.

#### Acceptance Criteria

- `SpatialScene` documents and exposes only world-appropriate responsibilities
- app code no longer depends on world-scene mutation APIs for projection concerns
- tests reflect the final ownership split
- `cargo test -p holtburger-world`, `cargo test -p holtburger-core`, and `cargo test -p holtburger-cli` pass

## Risks & Mitigations

### Risk: The extracted sampling store accidentally becomes another broad public scene type

Mitigation:

- keep the shared store reusable but not the app's primary public abstraction
- expose a narrower cache wrapper to the app rather than the raw store

### Risk: World and projection cache start drifting in behavior after the split

Mitigation:

- keep all interpolation/dead-reckoning/suspend math in one shared sampling engine
- avoid duplicating any of that logic in CLI code

### Risk: The bridge still looks like an important abstraction while only forwarding methods

Mitigation:

- keep the bridge focused on `ClientViewEvent` application only
- prefer direct cache reads over bridge read-forwarders where practical

### Risk: Phase 2 becomes a broad rename-and-cleanup blob

Mitigation:

- complete the shared-engine extraction in Phase 1 before changing app/core surfaces
- keep the cache API intentionally tiny so call-site migration is mechanical

### Risk: The plan accidentally conflates the game page projection cache with the TUI spatial-physics wrapper

Mitigation:

- treat `apps/holtburger-cli/src/pages/game/state.rs` projection ownership as the target of Phase 2
- leave `apps/holtburger-cli/src/spatial.rs` on the world-owned solve context unless a later cleanup is justified separately

### Risk: Public API churn from `holtburger-world` exports makes the refactor noisier than necessary

Mitigation:

- keep stable exported sample/result types where possible
- prefer renaming or narrowing only the app-facing ownership surface first, then revisit broader export cleanup after behavior is stable

## Definition Of Done

- authoritative world spatial ownership is distinct from app projection-cache ownership
- the CLI no longer owns or reasons about a world-shaped spatial scene
- shared runtime sampling behavior exists in one place only
- `ClientViewEvent` to projection-cache application remains a core concern, not a world concern
- world, core, and CLI tests all pass after the final cleanup
- docs reflect the final ownership model clearly enough that maintainers can tell who owns what without reading half the repo

## Living Worksheet

### Task Checklist

- [ ] Phase 1: extract shared runtime sampling store
- [ ] Phase 1: retarget world-owned spatial types to composition
- [ ] Phase 1: preserve or retarget sampling tests
- [ ] Phase 2: introduce narrow projection cache
- [ ] Phase 2: retarget `ClientViewSpatialBridge`
- [ ] Phase 2: migrate CLI call sites to cache reads
- [ ] Phase 3: delete overloaded app-facing scene APIs
- [ ] Phase 3: update docs/comments/tests
- [ ] Final verification across world/core/cli

### Decisions Log

- Resolved: keep `SpatialScene` as the world-owned composite/solve-context type; do not move that name onto the extracted sampling store.
- Resolved: place `ClientProjectionCache` in `holtburger-core` as the app-facing narrow cache surface backed by shared sampling behavior.
- Resolved: keep `SpatialPhysics::solve(..., &mut SpatialScene)` unchanged for this refactor; solving against the world-owned composite remains a separate concern from projection-cache ownership.

### Verification Log

- Pending.

### Open Questions

- None currently blocking execution.