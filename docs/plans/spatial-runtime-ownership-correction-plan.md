# Spatial Runtime Ownership Correction Plan

## Goal

Make world-owned `SpatialBody` sidecars the single canonical client runtime body model, and reduce core projection code to a read-oriented facade over world-owned runtime state.

## Scope

### In Scope

- Eliminate the current dual-runtime-advancement hybrid between world-side sidecars and core-side projection cache state.
- Establish one explicit ownership model for canonical runtime body advancement, future constraint resolution, and derived spatial samples.
- Rehome operational sampling semantics so interpolation, dead reckoning, suspension, forced reposition resets, and projected pose derivation are driven from canonical world-owned runtime bodies.
- Retarget navigation, controllers, and render/debug consumers to read from the canonical shared sample surface.
- Define the temporary compatibility seams allowed during migration and the point at which they must be deleted.

### Out of Scope

- Implementing full collision, pathfinding, or retail-grade 3D navigation.
- Reworking unrelated wire protocol or transport behavior.
- Inventing a second long-lived app-owned runtime body model.
- General cleanup unrelated to runtime body ownership or projection/sample correctness.

## Ground Truth

### Reference Sources

- [AGENTS.md](/home/cluracan/code/holtburger/AGENTS.md)
- [ARCHITECTURE.md](/home/cluracan/code/holtburger/ARCHITECTURE.md)
- [docs/plans/spatial-body-sidecar-refactor-plan.md](/home/cluracan/code/holtburger/docs/plans/spatial-body-sidecar-refactor-plan.md)
- [docs/plans/spatial-scene-ownership-split-plan.md](/home/cluracan/code/holtburger/docs/plans/spatial-scene-ownership-split-plan.md)
- [crates/holtburger-world/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-world/ARCHITECTURE.md)
- [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md)
- [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs)
- [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs)
- [crates/holtburger-world/src/state/liveness.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/liveness.rs)
- [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs)
- [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs)
- [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs)
- [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs)
- [crates/holtburger-core/src/client/controllers/maintain_range.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/maintain_range.rs)
- [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)

### Existing Patterns

- `SpatialBodyId`, `SpatialBody`, `SpatialSamplingState`, and `BodySamplingStore` already exist in [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs).
- `ClientProjectionCache` currently owns a private `BodySamplingStore` and advances it from `ClientViewEvent`s in [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs).
- `ClientSimulationSystem` already builds solve inputs from runtime body state via `world.runtime_kinematics_for_guid(...)` and applies solved body outputs through world APIs in [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs).
- Navigation and maintain-range logic already treat projected samples as operational inputs, not presentation-only data, in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs) and [crates/holtburger-core/src/client/controllers/maintain_range.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/maintain_range.rs).

## Problem Statement

The current codebase has crossed into an incoherent hybrid state:

- world owns `SpatialBody` sidecar types and runtime solve/application seams
- core still owns an independently advancing `ClientProjectionCache`
- both paths rely on runtime sampling/advancement semantics from `BodySamplingStore`
- operational consumers already read projected pose for navigation, tracking, and control decisions

That means projected pose is not merely a renderer convenience. It is live runtime state that can affect behavior.

This becomes a correctness bug as soon as canonical runtime advancement becomes geometry-aware or constraint-aware. If world-side bodies are constrained by collisions or other future runtime rules while core-side cache state keeps advancing independently from event deltas, consumers will observe a false world where entities can drift through blockers even though the canonical simulation did not.

## Architectural Decision

This plan chooses the world-owned sidecar model as the canonical runtime ownership model.

Specifically:

- authoritative server-confirmed state remains owned by `WorldState` and hydrated entities/player mirror
- live runtime body advancement remains owned by world-side `SpatialBody` sidecars and scene-owned sampling state
- derived samples remain read models over canonical world-owned runtime bodies
- core projection code may remain as a migration facade, but it must stop owning an independently advancing runtime store

Rejected direction:

- a long-lived core-owned canonical runtime body model separate from world

That direction would fight the current sidecar refactor, duplicate ownership boundaries already emerging in `holtburger-world`, and force world/core reconciliation rules to become more indirect than necessary.

## Target Model

The end state has three explicit layers:

1. Authoritative state
   - server-confirmed `Entity` and `PlayerState` snapshots
   - packet-driven mutation and reconciliation only

2. Canonical runtime state
   - world-owned `SpatialBody` sidecars
   - solver advancement, contact state, local motion, suspension, and future constraints

3. Read model / sample surface
   - projected and authoritative sample views derived from canonical runtime bodies
   - read-only for navigation, targeting, render, debug, and other consumers

The non-negotiable rule is that layer 3 cannot independently advance layer 2.

## Frontend Delivery Contract

The current TUI already demonstrates an important boundary that the earlier refactor docs did not spell out clearly enough:

- canonical runtime body state lives inside core/world on the client task
- the frontend game page runs its own app loop and currently owns navigation state plus a projection cache
- frontend-owned operational consumers therefore need a mirrored read model fed from core rather than direct mutable access to canonical bodies

That means the long-term answer is yes: if navigation remains frontend-owned, the frontend must maintain a body/sample cache that is updated from core by explicit `ClientViewEvent` payloads.

What is not allowed:

- cross-thread shared mutable access to canonical `SpatialBody` state
- a frontend cache that advances bodies independently from event-free local ticking
- continuing to rely only on entity-authoritative events as the long-term contract once non-entity and constrained runtime bodies matter

### Required Delivery Shape

Core should publish a dedicated runtime-body view contract over `ClientViewEvent`.

Chosen direction:

- add a frontend-facing `RuntimeSpatialBodyView` or equivalent sample type that contains only the fields operational consumers need
- maintain a frontend-owned read cache keyed by `SpatialBodyId`
- update that cache only from core-emitted view events
- treat the frontend cache as mirrored read state, never as canonical runtime state

Minimum fields for the frontend view type:

- `body_id: SpatialBodyId`
- `authoritative_pose: Option<WorldPosition>`
- `runtime_pose: WorldPosition`
- `velocity: Vector3`
- `omega: Vector3`
- `motion_state: Option<EntityMotionSnapshot>`
- `contact: ContactState`
- `sample_mode: SpatialSampleMode`

Recommended shape:

```rust
pub struct RuntimeSpatialBodyView {
   pub body_id: SpatialBodyId,
   pub authoritative_pose: Option<WorldPosition>,
   pub runtime_pose: WorldPosition,
   pub velocity: Vector3,
   pub omega: Vector3,
   pub motion_state: Option<EntityMotionSnapshot>,
   pub contact: ContactState,
   pub sample_mode: SpatialSampleMode,
}
```

This view type is intentionally narrow:

- it is sufficient for frontend-owned navigation, tracking, and render/debug reads
- it does not expose mutation handles or world-owned indexing internals
- it can represent non-entity bodies because it keys off `SpatialBodyId`, not only `Guid`

### Required `ClientViewEvent` Additions

The current entity-oriented events are sufficient only as a temporary compatibility source for the old projection cache. They are not a complete long-term spec for frontend-owned operational consumers.

This plan therefore requires new runtime-body view events or an equivalent event family. Chosen shape:

- `ClientViewEvent::RuntimeBodySnapshot { bodies: Arc<[RuntimeSpatialBodyView]> }`
- `ClientViewEvent::RuntimeBodyUpserted { body: Box<RuntimeSpatialBodyView> }`
- `ClientViewEvent::RuntimeBodyRemoved { body_id: SpatialBodyId }`
- `ClientViewEvent::RuntimeBodiesReset { cause: RuntimeBodyResetCause }`

The exact naming is flexible, but the contract is not:

- core emits runtime-body snapshots or deltas derived from canonical world-owned runtime bodies
- frontend caches apply those updates mechanically
- frontend navigation/render/debug read from that mirrored cache
- frontend code does not invent or advance constrained/runtime body state on its own

`RuntimeBodyResetCause` should at minimum distinguish:

- initial hydration
- teleport or world-handshake reset
- explicit resync after cache invalidation or overflow recovery

### Chosen Sync Strategy

The frontend/runtime-body mirror contract should be initial snapshot plus deltas, not delta-only and not periodic full snapshots.

Why this is the right fit:

- delta-only is brittle for frontend bootstrap and recovery because the app thread can start after bodies already exist
- snapshot-only is wasteful and pushes too much bandwidth/clone churn through the view layer on every change
- initial snapshot plus deltas matches the existing `RequestInitialViewState` bootstrap pattern already used by the CLI for other cached view state

Concretely:

1. frontend requests initial view state
2. core emits `RuntimeBodySnapshot { bodies }` containing the current mirrored runtime bodies
3. core emits `RuntimeBodyUpserted` and `RuntimeBodyRemoved` for steady-state changes
4. if core or frontend detects cache invalidation, teleport/world reset, or stream-loss recovery needs, core emits `RuntimeBodiesReset { cause }`
5. frontend clears the mirror cache on reset and expects a new `RuntimeBodySnapshot { bodies }`

This gives deterministic bootstrap and recovery without turning every frame or every movement pulse into a full-scene snapshot.

## Dry-Run Findings Against Current Code

Walking this plan against the current codebase surfaced several concrete seams that need to be part of the spec rather than left implicit.

### 1. Initial spatial bootstrap does not exist yet

`ClientCommand::RequestInitialViewState` currently projects reference data such as spell catalog and fellowship state, but it does not emit any spatial snapshot.

Implication:

- the runtime-body mirror cannot rely on an existing bootstrap path as-is
- Phase 3 must explicitly extend `RequestInitialViewState` to emit `RuntimeBodySnapshot { bodies }`

### 2. The TUI already maintains two separate read caches

The game page currently keeps:

- an authoritative entity cache in `data.entities`
- a separate projection cache in `runtime.projection_cache`

Navigation combines both caches today:

- entity cache for metadata such as `use_radius`
- projection cache for `SpatialEntitySample`

Implication:

- the runtime-body mirror will augment the existing authoritative entity cache, not replace it
- migration should preserve `data.entities` for authoritative metadata while replacing the advancing projection cache with the mirrored runtime-body cache

### 3. Frontend navigation still reads player position from app-owned entity data

`NavigationSyncInput.player_position` currently comes from `data.player_pos`, which is updated from `ClientViewEvent::EntityMoved` and `ForcedReposition`.

Implication:

- migration is incomplete if only target bodies move to the runtime-body mirror
- the local player runtime body must also be mirrored and navigation must switch to the mirrored local-player runtime pose rather than authoritative/app-owned player position fields

### 4. World-side iteration surface is still entity-centric

`BodySamplingStore` exposes `iter_projected_entities()`, which only returns entity-backed projected states. The current world surface does not expose a canonical iterator over all runtime bodies in the shape the frontend needs.

Implication:

- Phase 2 must add a world-side iterator or collection helper that yields `RuntimeSpatialBodyView` values for all frontend-visible runtime bodies, including `LocalPlayer` and future ephemeral bodies
- snapshot emission should be built on that helper rather than on ad hoc reconstruction in core

### 5. Remote contact changes do not currently produce a frontend-visible hook

`apply_spatial_body_event()` only emits `PlayerGroundedUpdated` for local-player contact changes. Remote `ContactChanged` updates currently mutate world body state without emitting a corresponding `WorldEvent`.

Implication:

- if `RuntimeSpatialBodyView` keeps `contact`, the runtime-body mirror path needs a deterministic invalidation hook for non-local contact changes
- the cleanest route is to add a world/core-visible runtime-body dirty signal rather than trying to infer all body changes from existing entity events alone

Working direction:

- add a focused world event family such as `WorldEvent::RuntimeBodyChanged { body_id }`, `WorldEvent::RuntimeBodyRemoved { body_id }`, and `WorldEvent::RuntimeBodiesReset { cause }`, or an equivalent narrow dirty-signal mechanism
- have core translate those into `ClientViewEvent` runtime-body mirror updates

### 6. Stream-loss recovery needs to be explicit, not theoretical

The TUI currently tolerates broadcast lag poorly: lagged view-event delivery is ignored in bootstrap, and the main loop drains with `try_recv()` without a resync contract for dropped events.

Implication:

- reset-and-resnapshot is not optional polish; it is required for correctness once the frontend mirror drives navigation
- lagged or invalidated receivers must trigger a runtime-body reset flow and a fresh `RequestInitialViewState`

### 7. Current frontend interactions are still `Guid`-centric

Approach/follow/sticky-melee interactions, UI actions, and most target resolution still key off `Guid`, not `SpatialBodyId`.

Implication:

- the first migration phase for frontend navigation should target entity-backed bodies plus the local-player body
- support for frontend interaction with non-entity/ephemeral bodies should be treated as a later extension rather than a day-one requirement for replacing the current projection cache

## Plan Adjustments From The Dry-Run

- Keep the authoritative entity cache and the mirrored runtime-body cache as separate frontend read models.
- Migrate frontend navigation in two steps:
   - Step 1: entity-backed targets plus mirrored local-player runtime body
   - Step 2: optional explicit frontend support for ephemeral/non-entity bodies if and when a UI actually needs them
- Add a world-side `RuntimeSpatialBodyView` emission helper rather than reconstructing snapshots ad hoc in core.
- Add a narrow runtime-body dirty-signal path from world to core so remote contact and other non-entity-body changes are observable to the frontend mirror.
- Treat lagged view-event recovery as part of the runtime-body mirror definition of done.

### Temporary Migration Rule

During migration, existing `EntitySpawned`, `EntityMoved`, `EntityKinematicsUpdated`, `EntityMotionUpdated`, `ForcedReposition`, and `TeleportStarted` events may continue to feed the old entity-only projection cache.

But once the canonical runtime-body view stream exists:

- frontend operational consumers must move to the new runtime-body cache
- the old entity-event-driven projection advancement path becomes compatibility-only
- the old path must be deleted before constraint-aware runtime bodies ship

`RequestInitialViewState` must be extended as part of that migration so it projects runtime-body snapshot state in addition to the existing reference-data bootstrap.
`RuntimeBodiesReset` recovery must re-bootstrap by re-issuing `RequestInitialViewState`.

## Phased Implementation

### Phase 1: Freeze The Ownership Contract

#### Deliverables

- Update architecture docs to state plainly that world-side `SpatialBody` sidecars are the canonical runtime body model.
- Document that `ClientProjectionCache` is transitional and must become a read facade rather than a second runtime store.
- Document the frontend delivery contract explicitly: frontend-owned navigation/render consumers read a mirrored cache fed by `ClientViewEvent`, not shared mutable runtime bodies.
- Define the concrete runtime-body view type, event family, and initial-snapshot-plus-delta sync contract.
- Audit all public APIs in [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs) and [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs) for wording that still implies dual ownership is acceptable.
- Record the migration rule that any temporary compatibility layer may mirror reads but may not perform independent advancement once world-side sampling is authoritative.

#### Acceptance Criteria

- docs and public comments consistently describe one canonical runtime body owner
- there is no ambiguity about whether future constraint resolution lives in world or core
- the spec explicitly states how operational body state reaches a frontend-owned navigation system
- the spec explicitly chooses initial snapshot plus deltas as the frontend sync model
- migration notes explicitly prohibit reintroducing a second advancing runtime cache

### Phase 2: Make World Sampling State Canonical

#### Deliverables

- Ensure `SpatialScene` or the world-owned spatial composite exposes the canonical sampling/read surface for `SpatialBody` records.
- Move any remaining runtime advancement semantics that still live only behind core-facing cache updates into the world-owned sidecar/sampling path.
- Define explicit world-side helpers for:
  - authoritative snapshot seeding
  - authoritative pose correction
  - kinematics updates
  - motion-state updates
  - teleport suspension
  - forced reposition reset
  - sampling tick/derivation
- Add a world-side helper that materializes `RuntimeSpatialBodyView` values for all frontend-visible runtime bodies.
- Add a narrow runtime-body dirty-signal mechanism so body changes that do not already map cleanly to existing entity events can still reach core/frontend mirrors.
- Keep the sampling config home explicit on the world side so there is one owner for interpolation/dead-reckoning policy.

#### Acceptance Criteria

- world owns the full runtime sampling lifecycle for canonical bodies
- projected/sample derivation can be produced from world-owned body state alone
- there is no runtime sampling rule that exists only inside core projection cache mutation code
- world exposes a canonical iterator or collection helper for frontend-visible runtime-body views
- world exposes a deterministic dirty-signal path for runtime-body changes that matter to frontend mirrors
- world tests cover sampling advancement, suspension, reset, and derived sample behavior

### Phase 3: Collapse Core Projection Into A Read Facade

#### Deliverables

- Refactor [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs) so `ClientProjectionCache` stops owning a private canonical `BodySamplingStore`.
- Replace cache-local mutation with one of these migration-safe shapes:
  - a facade over world-owned sampling reads, or
  - a lightweight snapshot cache that is repopulated from world-owned samples and never advances them independently
- Retarget `ClientViewSpatialBridge` so it no longer acts as the owner of runtime advancement semantics.
- Introduce the dedicated runtime-body `ClientViewEvent` contract and the frontend mirror cache that consumes it.
- Extend `ClientCommand::RequestInitialViewState` handling so it emits `RuntimeBodySnapshot { bodies }` alongside other bootstrap view data.
- Handle runtime-body stream recovery explicitly: lagged or invalidated frontend receivers must trigger `RuntimeBodiesReset` plus re-bootstrap.
- Preserve narrow read ergonomics for apps and render/debug code without preserving duplicate ownership.

#### Acceptance Criteria

- core no longer owns an independently advancing runtime projection store
- `ClientViewSpatialBridge` does not define canonical interpolation/dead-reckoning behavior
- any surviving cache object is read-only or snapshot-only with an explicit non-authoritative contract
- frontend body-cache updates flow through explicit runtime-body view events rather than through shared mutable state
- bootstrap and reset/recovery paths deterministically reconstruct the frontend mirror cache from snapshot plus deltas
- runtime-body mirror updates continue to work for body changes that are not expressible as plain entity moved/vector/motion events
- core tests validate that projected reads follow world-owned body state rather than parallel advancement

### Phase 4: Retarget Operational Consumers

#### Deliverables

- Update navigation, maintain-range, and any other control logic to consume the canonical shared sample surface rather than a separately advanced cache.
- Migrate frontend-owned navigation to the new runtime-body mirror cache keyed by `SpatialBodyId` rather than the old entity-only projection cache.
- In the first migration step, keep frontend interaction targeting `Guid`-based and resolve those targets onto entity-backed runtime-body mirror entries plus mirrored local-player state.
- Keep the authoritative-versus-runtime distinction available where consumers need both values.
- Audit CLI and debug consumers so presentation code reads the same shared sample truth as operational consumers.
- Remove call paths that can continue operating purely from `ClientViewEvent`-driven projection advancement after world-side sampling exists.
- Preserve app-owned navigation autonomy: it may make decisions from mirrored runtime-body views, but it still sends commands back to core rather than mutating body state itself.

#### Acceptance Criteria

- navigation and control logic read from the same canonical sample source as render/debug code
- no operational consumer depends on an independently advancing cache for truth
- frontend-owned navigation reads a mirrored runtime-body cache fed by the new runtime-body view events
- the first frontend migration works for current `Guid`-centric approach/follow/sticky-melee flows without requiring immediate UI support for ephemeral bodies
- consumer tests still cover approach/follow/sticky behavior against the new sample source

### Phase 5: Delete The Hybrid Compatibility Path

#### Deliverables

- Remove obsolete dual-write or dual-advance code paths.
- Delete dead projection-ownership comments, compatibility shims, and tests that validate the old hybrid behavior.
- Tighten world/core public APIs so future callers cannot accidentally recreate a second runtime advancement path.
- Update plan docs and architecture docs to describe the final ownership model only.

#### Acceptance Criteria

- there is one canonical runtime advancement path in the codebase
- no public API suggests core may own runtime body advancement separate from world
- regression tests cover forced reposition, teleport suspension, local solve, and consumer reads under the final ownership model

## Risks & Mitigations

### Risk: World-side sampling becomes a thin wrapper while important advancement semantics remain in core

Mitigation:

- require a world-side API inventory before Phase 3 starts
- do not allow facade work to begin until all canonical advancement rules have a world-owned home

### Risk: Migration leaves a hidden dual-write period

Mitigation:

- treat any temporary facade as read-only or snapshot-only
- prohibit cache-local ticking once world-side ticking is canonical
- remove write paths before broad consumer migration finishes

### Risk: Operational consumers lose access to authoritative-versus-runtime distinctions during migration

Mitigation:

- preserve a sample contract that exposes both authoritative and projected/runtime pose where needed
- migrate consumers mechanically before trimming data fields

### Risk: Future collision-aware work starts before the ownership split is finished

Mitigation:

- treat this plan as a prerequisite for constraint-aware runtime advancement
- do not land geometry-aware simulation on top of the current hybrid

## Definition Of Done

- world-owned `SpatialBody` sidecars are the only canonical runtime body model
- authoritative world snapshots remain distinct from live runtime body state
- projected/sample reads are derived from canonical runtime bodies, not independently advanced elsewhere
- core projection code no longer owns runtime advancement semantics
- navigation, control, render, and debug consumers all read from the same canonical sample truth
- `cargo test -p holtburger-world`, `cargo test -p holtburger-core`, and relevant CLI tests pass

## Living Worksheet

### Task Checklist

- [x] Phase 1: document the ownership decision and migration rule
- [x] Phase 2: finish world-owned canonical sampling API surface
- [x] Phase 3: collapse `ClientProjectionCache` to read-only or snapshot-only behavior
- [x] Phase 4: migrate operational consumers to the canonical sample source
- [x] Phase 5: delete hybrid compatibility seams and dead tests
- [ ] Final verification across world, core, and CLI consumers

### Decisions Log

- Resolved: canonical runtime body advancement and future constraint resolution live in the world-owned sidecar model, not in core.
- Resolved: `ClientProjectionCache` is not a valid long-term owner for independently advancing runtime projection state.
- Resolved: projected pose is operational runtime state and must therefore derive from canonical runtime bodies.
- Resolved: if navigation remains frontend-owned, operational body state reaches it through explicit runtime-body `ClientViewEvent` updates into a mirrored frontend cache, not through cross-thread shared mutable state.
- Resolved: the frontend mirror contract is initial snapshot plus deltas, with reset-and-resnapshot for recovery.
- Resolved: the frontend keeps two read models during migration and likely after it: authoritative entity metadata plus mirrored runtime-body state.
- Resolved: the first frontend migration targets entity-backed bodies and the local player; ephemeral frontend targets are a later extension.
- Resolved: runtime-body mirror correctness requires a world/core dirty-signal path for changes that do not already surface through existing entity events.
- 2026-03-29: Phase 1 wording freeze updated root, world, and core architecture docs plus public spatial/projection doc comments so they consistently describe world-owned `SpatialBody` sidecars as the sole canonical runtime body model and mark `ClientProjectionCache` as transitional mirrored read state.
- 2026-03-29: Phase 1 locked the frontend delivery contract as runtime-body initial snapshot plus deltas with explicit reset-and-resnapshot recovery, rather than delta-only projection advancement.
- 2026-03-29: Phase 2 introduced `RuntimeSpatialBodyView` and `RuntimeBodyResetCause` on the world side, plus canonical scene/world helpers for runtime sampling config, authoritative snapshot seeding, authoritative pose correction, runtime kinematics updates, runtime motion-state updates, forced-reposition reset, teleport suspension, and sampling ticks.
- 2026-03-29: Phase 2 chose to surface runtime-body dirty/reset signals immediately as `WorldEvent::RuntimeBodyChanged`, `WorldEvent::RuntimeBodyRemoved`, and `WorldEvent::RuntimeBodiesReset`, while intentionally leaving `ClientViewEvent` unchanged until Phase 3.
- 2026-03-29: Phase 2 moved remaining runtime-body mutation semantics out of ad hoc `body_mut()` call sites in `WorldState` helpers and into `BodySamplingStore`/`SpatialScene` runtime-body operations.
- 2026-03-29: Phase 3 added `ClientViewEvent::RuntimeBodySnapshot`, `RuntimeBodyUpserted`, `RuntimeBodyRemoved`, and `RuntimeBodiesReset`, and core now projects those directly from canonical world runtime-body state plus `RequestInitialViewState` bootstrap.
- 2026-03-29: Phase 3 converted `ClientProjectionCache` from a private advancing `BodySamplingStore` into a snapshot-only mirrored runtime-body cache while intentionally preserving the old projected-read helper API surface as a compatibility facade for Phase 4 consumers.
- 2026-03-29: Phase 3 made runtime-body recovery explicit in the TUI by treating lagged client-view receivers as a `RuntimeBodiesReset { Resync }` condition followed by a fresh `RequestInitialViewState` bootstrap.
- 2026-03-29: Phase 4 moved the frontend-owned mirrored runtime-body cache onto shared game-page data so navigation, combat automation, debug, HUD, and dashboard tabs now read the same mirrored runtime-body truth instead of mixing runtime cache reads with separate authoritative-only `player_pos` or raw entity positions.
- 2026-03-29: Phase 4 kept the first-step `Guid`-centric targeting contract but changed resolution to prefer mirrored runtime-body samples and local-player runtime pose, with authoritative entity/player state retained only as fallback metadata until Phase 5 removes the old seams.
- 2026-03-29: Phase 4 preserved the authoritative-versus-runtime distinction for consumers by continuing to surface both values through `SpatialEntitySample` while switching the sample source to the mirrored runtime-body cache.
- 2026-03-29: Phase 5 deleted the `ClientViewSpatialBridge` compatibility layer, renamed the core/frontend mirror to `RuntimeBodyViewCache`, and made direct event-application on that cache the only public cache update path.
- 2026-03-29: Phase 5 removed the old projection-flavored core re-exports so public APIs no longer imply core owns projection/runtime advancement policy separate from `holtburger-world`.
- 2026-03-29: Phase 5 updated root/core/world architecture docs to describe the final ownership model only: world owns canonical runtime bodies, core emits runtime-body view events, and frontend caches are mirrored read models.

### Verification Log

- 2026-03-29: confirmed current sidecar primitives and sampling types already exist in [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs).
- 2026-03-29: confirmed `ClientProjectionCache` still privately owns `BodySamplingStore` and advances it from `ClientViewEvent`s in [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs).
- 2026-03-29: confirmed operational consumers already depend on projected samples in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs) and [crates/holtburger-core/src/client/controllers/maintain_range.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/maintain_range.rs).
- 2026-03-29: confirmed the current TUI runs core on a spawned client task while the app game page owns navigation and projection cache state in [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs) and [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs).
- 2026-03-29: dry-run found that `RequestInitialViewState` currently emits reference data only, the TUI navigation path consumes both `data.entities` and `projection_cache`, remote body contact changes do not currently surface as frontend-visible events, and lagged view-event recovery has no spatial resync contract yet.
- 2026-03-29: Phase 1 audit corrected conflicting public wording in [ARCHITECTURE.md](/home/cluracan/code/holtburger/ARCHITECTURE.md), [crates/holtburger-world/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-world/ARCHITECTURE.md), [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md), [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs), and [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs).
- 2026-03-29: Phase 2 added the canonical world-side runtime-body view/query surface in [crates/holtburger-world/src/spatial.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial.rs) and [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs).
- 2026-03-29: Phase 2 added world dirty/reset signals in [crates/holtburger-world/src/events.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/events.rs), emitted them from world mutation and handler paths in [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs), [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs), [crates/holtburger-world/src/handlers/player.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/player.rs), and [crates/holtburger-world/src/state/liveness.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/liveness.rs).
- 2026-03-29: `cargo test -p holtburger-world` passed after updating one pre-existing vector-routing test to account for the new runtime-body dirty signal.
- 2026-03-29: `cargo test -p holtburger-core` passed with Phase 2 compatibility handling for the new world runtime-body events in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs).
- 2026-03-29: Phase 3 replaced the core projection owner path in [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs) with a snapshot-only runtime-body mirror cache and updated [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs), [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), and [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs) to emit runtime-body snapshot/delta/reset view events.
- 2026-03-29: Phase 3 updated the TUI runtime mirror path in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) and [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs) so the frontend no longer locally ticks projection state and now resynchronizes via runtime-body reset plus `RequestInitialViewState` when the client-view stream lags.
- 2026-03-29: `cargo test -p holtburger-core` passed with the Phase 3 runtime-body `ClientViewEvent` contract and snapshot-only projection facade.
- 2026-03-29: `cargo test -p holtburger-cli` passed with the Phase 3 mirrored runtime-body cache integration and lagged-stream resnapshot handling.
- 2026-03-29: Phase 4 moved the frontend mirror cache into shared game data in [apps/holtburger-cli/src/pages/game/data.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/data.rs), updated navigation/combat/debug consumers in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) and [apps/holtburger-cli/src/pages/game/panels/context.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/context.rs), and switched HUD/input/dashboard distance reads to the same mirrored runtime-body truth in [apps/holtburger-cli/src/pages/game/hud/status.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/hud/status.rs), [apps/holtburger-cli/src/pages/game/input.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/input.rs), [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs), [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs), [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/party/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/party/tab.rs), and [apps/holtburger-cli/src/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/state.rs).
- 2026-03-29: Phase 4 added CLI regressions proving navigation input and party-tab distance calculations prefer mirrored runtime-body samples over stale authoritative positions in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) and [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/party/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/party/tab.rs).
- 2026-03-29: `cargo test -p holtburger-cli` passed after the Phase 4 consumer migration onto shared mirrored runtime-body state.
- 2026-03-29: `cargo test -p holtburger-core` still passed after the Phase 4 frontend consumer migration, confirming the unchanged core controllers remained compatible with the new sample source.
- 2026-03-29: Phase 5 removed the last bridge/config compatibility surface in [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs), [crates/holtburger-core/src/lib.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/lib.rs), [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs), [apps/holtburger-cli/src/pages/game/data.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/data.rs), and [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/party/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/party/tab.rs).
- 2026-03-29: `cargo test -p holtburger-core` passed after the Phase 5 API cleanup, confirming the renamed `RuntimeBodyViewCache` and direct event-application path preserved core behavior.
- 2026-03-29: `cargo test -p holtburger-cli` passed after the Phase 5 bridge removal, confirming the TUI reads and updates mirrored runtime-body state without the deleted compatibility layer.

### Phase 1 Deviations

- No architectural pivot is needed. Phase 1 completed as a wording and contract freeze without changing runtime behavior.
- The CLI architecture surface was left unchanged in this phase. The ownership ambiguity is now resolved in the root/core/world architecture docs and the public projection/spatial module docs, and the CLI-specific cache contract can be renamed or tightened when Phase 3 and Phase 4 replace the old projection path in code.

### Phase 2 Deviations

- No architectural pivot is needed. Phase 2 completed with the world-owned canonical runtime sampling API surface and dirty/reset signals in place.
- The new world-side runtime-body view helper currently returns all tracked runtime bodies, not a narrower frontend-visibility-filtered subset. That is intentional for now because the world layer does not yet expose a richer frontend-visibility contract for ephemeral bodies; Phase 3 snapshot emission can layer any required filtering on top of this canonical helper.
- The world/core dirty-signal path landed one phase earlier than the frontend mirror event family. Core now tolerates the new `WorldEvent` variants but intentionally does not project them into `ClientViewEvent` yet. That compatibility seam is deliberate and should be collapsed in Phase 3 rather than treated as the final design.

### Phase 3 Deviations

- No architectural pivot is needed. Phase 3 completed with explicit runtime-body snapshot/delta/reset view events, a snapshot-only core projection facade, and deterministic bootstrap/recovery wiring.
- The compatibility facade names remained in place for Phase 4: `ClientProjectionCache`, `ClientViewSpatialBridge`, and the `Guid`-centric projected read helpers mirrored runtime-body views rather than owning runtime advancement. That delay was deliberate so Phase 4 could retarget consumers mechanically without conflating the API collapse with the consumer migration; Phase 5 deletes those names.
- Lagged-stream recovery is implemented for the current TUI frontend by locally applying `RuntimeBodiesReset { Resync }` and reissuing `RequestInitialViewState`. Additional frontends will need to honor the same reset-and-resnapshot contract when they are introduced; that is a rollout consideration, not a reason to pivot.

### Phase 4 Deviations

- No architectural pivot is needed. Phase 4 completed with operational and presentation consumers reading shared mirrored runtime-body state instead of a separately advanced cache path.
- The CLI still retains `data.player_pos` and raw entity positions as authoritative fallback metadata because bootstrap and a few non-spatial metadata paths still benefit from an authoritative cache even while runtime reads prefer the mirrored runtime-body cache. Phase 5 removes the dead bridge/config seams without deleting those authoritative metadata caches.
- Frontend targeting remains `Guid`-centric by design in this phase. The migration now resolves those `Guid` targets onto mirrored runtime-body samples and the mirrored local-player pose, but explicit UI support for non-entity or ephemeral `SpatialBodyId` targets is still deferred as planned.

### Phase 5 Deviations

- No architectural pivot is needed. Phase 5 completed by deleting the transitional bridge/config surface and tightening the mirror-cache API to direct event application plus read queries.
- The CLI still keeps authoritative entity and player caches as fallback metadata for non-runtime concerns. That is intentional and does not reintroduce hybrid runtime advancement because those caches no longer tick or mutate mirrored runtime-body state.
- `Guid`-centric convenience reads remain on `RuntimeBodyViewCache` because current frontend interactions are still entity-targeted. The cache is keyed internally by `SpatialBodyId`, and explicit non-entity targeting can be added later without reviving a second runtime owner.

### Open Questions

- Resolved for initial implementation: `RuntimeBodySnapshot { bodies }` should contain all current frontend-visible bodies in one event. The current client architecture already treats `RequestInitialViewState` as a rare control path, and adding chunking now would complicate atomic reset semantics before the scene sizes justify it.
- Resolved for initial implementation: the CLI does not need a third spatial snapshot layer beyond authoritative entity cache plus mirrored runtime-body cache. Add helper queries over those two caches instead of inventing another projection store.