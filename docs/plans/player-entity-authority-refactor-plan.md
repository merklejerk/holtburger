# Player Entity Authority Refactor Plan

## Goal

Remove local-player world-state mirroring by making the player `Entity` the sole authoritative holder of entity/object state, while shrinking `PlayerState` to local-player-only state that does not belong on a generic world entity.

## Scope

### In Scope

- Make the player entity in `WorldState.entities` authoritative for world/object state, including live position and `WorldObjectProperties`.
- Remove mirrored player world-state fields from `PlayerState` where they can be read from the player entity instead.
- Replace local-player special casing in world systems with shared entity-based helpers where practical.
- Change APIs across crates where needed; this refactor does not preserve backward compatibility for convenience.
- Retarget tests and helpers to the new ownership model.

### Out Of Scope

- Redesigning player stats/enchantments/spell knowledge beyond moving their base property source onto the entity.
- Redesigning the protocol surface or ACE parity rules.
- Reworking frontend UX or `ClientViewEvent` semantics beyond whatever is mechanically required by the ownership shift.
- General spatial architecture cleanup unrelated to eliminating player/entity duplication.

## Ground Truth

### Reference Sources

- [AGENTS.md](/home/cluracan/code/holtburger/AGENTS.md)
- [ARCHITECTURE.md](/home/cluracan/code/holtburger/ARCHITECTURE.md)
- [crates/holtburger-world/src/player/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/types.rs)
- [crates/holtburger-world/src/player/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/mutations.rs)
- [crates/holtburger-world/src/entity.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/entity.rs)
- [crates/holtburger-world/src/state/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/types.rs)
- [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs)
- [crates/holtburger-world/src/state/liveness.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/liveness.rs)
- [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs)
- [crates/holtburger-world/src/handlers/properties.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/properties.rs)
- [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs)
- [crates/holtburger-world/src/events.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/events.rs)

### Existing Patterns

- `WorldState` already treats the player entity as the world-facing base for some reads, such as enchanted int/float lookups.
- `PlayerState` currently mixes genuinely local state with mirrored world/entity state.
- Movement and liveness code special-case the local player because `PlayerState.position` is treated as authoritative in parallel with the player entity.
- Property handlers currently mirror many updates into both the player entity and `PlayerState.properties`.
- World/context helpers expose player-derived reads through `PlayerState` even when the underlying data is conceptually entity state.
- `holtburger-core` directly reads and mutates `world.player.position` in production code and tests, so the refactor blast radius is wider than `holtburger-world` alone.
- `PlayerDescription` currently hydrates `PlayerState` directly, while login/object-create flows update player entity state separately, so bootstrap order is a real ownership seam.

## Problem Statement

The current model has two mutable homes for local-player world state:

- the player `Entity` in `WorldState.entities`
- mirrored fields on `PlayerState`

That split increases cyclomatic complexity and raises the odds of divergence because systems must answer both of these questions repeatedly:

- is this path operating on an arbitrary entity or specifically the local player?
- if it is the local player, which copy is authoritative here?

This shows up in movement, liveness, property application, runtime-body views, and world-context reads. The result is avoidable branching and mutation coupling across systems that should otherwise treat the local player as just another entity plus a small amount of session-local metadata.

The refactor target is therefore:

- entity/object state lives on the player `Entity`
- local/session/stateful overlays live on `PlayerState`
- `WorldState` provides narrow helpers for "get the player entity" and "get the player entity mutably"
- world systems stop special-casing the local player merely to choose between duplicated state stores

## Target Ownership Model

### Player Entity Owns

- live world position
- velocity and omega
- `WorldObjectProperties`
- health fraction
- motion snapshot
- any other state that conceptually belongs to a generic world object/creature

### PlayerState Owns

- player guid
- stat caches and stat bases used for derived calculations
- spell knowledge and active enchantments
- character options and gameplay option blobs
- inventory/equipment indices
- self-session sequencing that is not part of generic entity state
- client-local flags like `noclip`
- cached/derived event throttling state such as `last_sent_stats`

### Candidate Fields To Remove From PlayerState

- `position`
- `properties`

### Candidate Fields To Re-evaluate Carefully

- `instance_sequence`
- `server_control_sequence`
- `teleport_sequence`
- `force_position_sequence`
- `position_sequence`

These sequence fields may remain on `PlayerState` even after the refactor if they are truly self-session control metadata rather than generic entity state. The plan assumes they stay unless implementation proves consolidating them onto the entity is clearly better.

## Dry-Run Findings

### Confirmed Gaps In The Original Plan

- The original phase breakdown understated the cross-crate churn. Production code in `holtburger-core` falls back to `world.player.position` directly, especially in movement code, so helper introduction must be treated as a workspace-wide migration seam rather than a world-only cleanup.
- The bootstrap path needs to be explicit. `PlayerDescription` currently seeds player properties and optional position onto `PlayerState` even when no player entity exists yet, while separate login/object-create handlers patch the entity later. Deleting the mirror without changing bootstrap order would break current initialization and tests.
- `PlayerState` currently implements `HasProperties` and `HasPropertiesMut`, and methods like `name()`, `level()`, `combat_mode()`, and XP-related helpers sit on top of those property reads. Removing `PlayerState.properties` therefore implies an API shape change, not just field deletion.
- Tests in both `holtburger-world` and `holtburger-core` directly mutate `state.player.position` / `world.player.position`. The plan needs an early testing helper strategy or the churn will be noisy and error-prone.

### Awkward Seams

- `apply_player_description_world_state(...)` currently updates player-facing events and maybe the entity name/position, but does not guarantee the player entity exists. That is the biggest awkward seam for an entity-authoritative model.
- Runtime-body helpers still branch on `guid == self.player.guid` to choose between `self.player.position` and entity state. Those branches do not disappear automatically just by deleting fields; they need a helper-first rewrite.
- Context helpers currently read stats from `PlayerState` and properties from `PlayerState` too. After the refactor, those reads need a clean split: stats/enchantments from `PlayerState`, object properties from the player entity.
- `PlayerInfoData` currently embeds `player_entity` while also carrying a parallel pile of player-local overlays. That is probably acceptable during migration, but it is an obvious place to accidentally reintroduce duplication.

### Better Pattern Than The Original Cut

The dry run suggests a better cut line than simply "remove `position` and `properties` from `PlayerState`":

1. Introduce a first-class `WorldState` player-entity accessor surface and migrate all world/core reads to it.
2. Materialize or upsert the player entity eagerly during `PlayerDescription` handling so entity-authoritative state exists before later deltas arrive.
3. Move property-derived APIs off `PlayerState` and onto `WorldState` or dedicated player-entity helper methods.
4. Only then delete `PlayerState.position` and `PlayerState.properties`.

This sequencing reduces the chance of a half-refactored state where initialization still depends on mirrors.

## Phased Implementation

### Phase 1: Introduce Player Entity Accessors And Test Helpers

#### Deliverables

- Add `WorldState` helpers for reading and mutating the player entity.
- Add narrow helpers for common player-world reads such as player position, player landblock, and player properties.
- Add test helpers/builders for seeding a local player entity without direct `world.player.position` mutation.
- Retarget internal reads in world state, movement, liveness, and context code to those helpers rather than directly reading `self.player.position` or `self.player.properties`.
- Retarget `holtburger-core` movement/runtime call sites to the helper surface early, before field deletion.
- Keep `PlayerState` fields in place temporarily, but stop introducing new reads from the mirrored copies.

#### Acceptance Criteria

- world code can obtain player world/object state without directly touching mirrored `PlayerState` fields
- core movement/runtime code can obtain player world pose without directly touching mirrored `PlayerState` fields
- movement and liveness logic are expressed in terms of the player entity/helper accessors
- the number of `guid == self.player.guid` branches used only to select a storage location is materially reduced
- `cargo test -p holtburger-world` passes
- `cargo test -p holtburger-core` passes

### Phase 2: Make Player Bootstrap Entity-First

#### Deliverables

- Change `PlayerDescription` hydration so the authoritative player entity is created or upserted eagerly when player bootstrap data arrives.
- Move player name/property/position bootstrap writes onto the player entity rather than `PlayerState`.
- Keep `PlayerState` responsible only for local overlays sourced from `PlayerDescription`, such as stats, options, spells, enchantments, inventory/equipment indices, and session metadata.
- Retarget tests that currently assume `PlayerDescription` populates `PlayerState.properties` or `PlayerState.position` directly.

#### Acceptance Criteria

- player bootstrap succeeds even when no prior player entity exists
- `PlayerDescription` no longer requires mirrored player world/object fields to seed initial state
- world tests covering login/bootstrap and self object-create ordering pass

### Phase 3: Move Property-Derived APIs Off PlayerState And Delete Mirrored Fields

#### Deliverables

- Remove `position` and `properties` from `PlayerState`.
- Remove `HasProperties` and `HasPropertiesMut` from `PlayerState`.
- Move property-derived APIs like player name/level/combat mode/XP base reads onto `WorldState` or player-entity helpers.
- Rewrite player movement/property mutation flows so they update only the player entity plus any truly local sequence metadata.
- Update stat/property-derived helpers to use the player entity as the base property source.
- Update self-player runtime-body helpers to derive authoritative pose/kinematics from the player entity.
- Remove the property mirroring path from `apply_property_update_to_target`.

#### Acceptance Criteria

- no persistent copy of player position remains on `PlayerState`
- no persistent copy of player `WorldObjectProperties` remains on `PlayerState`
- no production code depends on `PlayerState: HasProperties`
- movement/property handlers compile and behave with entity-only world/object ownership
- tests covering self movement, property updates, and liveness still pass after retargeting

### Phase 4: Collapse Local-Player Special Cases Across Systems

#### Deliverables

- Simplify movement handler logic so the player path differs only where sequencing/protocol semantics actually differ, not because the storage model differs.
- Simplify liveness/visibility code to read player location through the same entity-oriented path.
- Simplify runtime-body views and body reconciliation helpers so the local player is a body kind distinction, not a second authoritative storage location.
- Simplify context/query helpers to read player properties from the entity and player stats from `PlayerState`.

#### Acceptance Criteria

- local-player branching is limited to true semantic differences such as self sequencing or body identity
- world helper code no longer contains storage-selection branches whose only purpose was mirroring
- code complexity in movement/liveness/context is measurably lower by inspection and by branch count
- `cargo test -p holtburger-world` passes
- `cargo test -p holtburger-core` passes

### Phase 5: Shrink And Clarify PlayerState

#### Deliverables

- Remove any now-dead `PlayerState` APIs that implied ownership of world/object state.
- Rename fields, methods, and docs so `PlayerState` clearly means local-player/session state rather than a second world object.
- Decide whether the type should remain `PlayerState` or be renamed to reflect its reduced role; API breakage is allowed.
- Update `PlayerInfo`/event construction so player snapshots are assembled from the authoritative player entity plus local-player overlays without hidden duplication.

#### Acceptance Criteria

- `PlayerState` no longer advertises or behaves like a partial mirror of the player entity
- docs/comments in world code describe one authoritative source for entity/object state
- dead sync helpers and comments about mirroring are removed
- cross-crate compile succeeds with the new ownership model

### Phase 6: Verification And Cleanup Across Crates

#### Deliverables

- Retarget world, core, and CLI call sites to the new API surface.
- Update or remove tests that were asserting the old mirrored behavior.
- Add focused regression tests for self movement, property updates, visibility/liveness, derived stat reads, and player info emission.
- Update architecture docs and any relevant plan docs that describe the old mirrored model.

#### Acceptance Criteria

- `cargo test -p holtburger-world` passes
- `cargo test -p holtburger-core` passes
- `cargo test -p holtburger-cli` passes
- any workspace-wide targeted verification needed for downstream consumers passes

## Risks & Mitigations

### Risk: Self sequencing and self entity state get conflated during the refactor

Mitigation:

- keep sequence fields in `PlayerState` unless there is a clear reason to move them
- treat sequencing as a separate design question from entity/object ownership

### Risk: Runtime-body code still assumes `PlayerState.position` exists

Mitigation:

- introduce player-entity helper accessors before deleting fields
- retarget runtime-body reads first, then remove mirrored fields

### Risk: Player bootstrap ordering breaks once `PlayerState` stops carrying entity properties/position

Mitigation:

- materialize the player entity eagerly from `PlayerDescription`
- treat bootstrap/order tests as a first-class acceptance gate before field deletion

### Risk: Property-derived APIs on `PlayerState` hide more dependency surface than expected

Mitigation:

- move those APIs behind `WorldState` helpers before removing `HasProperties` from `PlayerState`
- search the full workspace, not just `holtburger-world`, for direct property-derived player calls

### Risk: Derived stats accidentally change because player property base values move

Mitigation:

- preserve current enchanted-property behavior and add regression coverage for representative stat/property reads
- verify combat mode, level info, burden, armor, and resistance calculations after the migration

### Risk: Inventory/equipment ownership logic quietly relies on player property mirroring

Mitigation:

- keep inventory/equipment ownership in `PlayerState`
- audit container/wielder side effects while removing property mirroring

### Risk: Cross-crate churn makes the refactor noisy and hard to land

Mitigation:

- centralize the new access pattern behind `WorldState` helpers first
- make downstream call-site migration mechanical rather than ad hoc

## Definition Of Done

- the player entity is the only authoritative holder of player world/object state
- `PlayerState` holds only local-player/session/derived state that does not belong on a generic entity
- mirrored writes between player entity state and `PlayerState` have been removed
- local-player branching is limited to genuine semantic differences rather than storage duplication
- world/core/cli APIs are updated to the new ownership model without preserving obsolete compatibility shims
- tests cover the major behavior surfaces touched by the refactor and pass

## Living Worksheet

### Task Checklist

- [x] Phase 1: add player-entity helper accessors in `WorldState`
- [x] Phase 1: add test helpers for local-player entity setup
- [x] Phase 1: retarget world/core reads away from mirrored `PlayerState` fields
- [x] Phase 2: make `PlayerDescription` bootstrap the player entity eagerly
- [x] Phase 3: move property-derived player APIs off `PlayerState`
- [x] Phase 3: remove `PlayerState.position`
- [x] Phase 3: remove `PlayerState.properties`
- [x] Phase 3: delete property mirroring in handlers/mutations
- [x] Phase 4: simplify movement/liveness/runtime-body special casing
- [x] Phase 5: trim or rename `PlayerState` APIs/docs
- [x] Phase 6: retarget downstream crates and tests
- [x] Final verification across world/core/cli

### Decisions Log

- API compatibility is not a constraint for this refactor.
- The initial target is to eliminate duplicated world/object state, not to solve every self-sequencing concern in the same pass.
- Inventory, equipment, spell knowledge, enchantments, and stat caches remain player-local until proven better on the entity.
- Dry run conclusion: eager player-entity materialization during `PlayerDescription` is preferable to keeping any transitional bootstrap mirror for position/properties.
- Dry run conclusion: `HasProperties` on `PlayerState` should be treated as an API migration item, not an implementation detail.
- Phase 1 decision: `WorldState` now exposes first-class player-entity helpers (`player_entity`, `player_entity_mut`, `player_position`, `player_landblock`, `player_properties`) and production world/core movement reads should prefer that surface instead of touching mirrored `PlayerState` fields directly.
- Phase 1 decision: those helpers still fall back to mirrored `PlayerState.position` / `PlayerState.properties` when the player entity is absent so Phase 1 can land before the Phase 2 bootstrap rewrite.
- Phase 1 decision: test setup should prefer `seed_local_player_entity(...)` over open-coded `player.guid` + `player.position` + `entities.insert(...)` sequences when a local authoritative pose is required.
- Phase 2 decision: `PlayerDescription` now eagerly creates or refreshes the player entity and writes bootstrap name/properties/position there first, before projecting player-facing events.
- Phase 2 decision: `PlayerState::hydrate_from_player_description(...)` no longer seeds live player position directly; the authoritative bootstrap pose now comes from world-side entity setup.
- Phase 2 decision: `PlayerState.properties` remains populated as a compatibility mirror for now because `get_level_info`, `emit_player_info`, and other property-derived APIs still depend on it. Removing that mirror remains Phase 3 work.
- Phase 3 decision: property-derived player reads now live on `WorldState` (`player_name`, `player_level`, XP/combat-mode/armor/vitae/resistance helpers) so callers consume entity-authored state through a single surface instead of reaching into `PlayerState`.
- Phase 3 decision: derived stat emission that depends on entity properties is now orchestrated from `WorldState`/world handlers rather than from `PlayerState` mutation methods, which keeps player-local stat caches separate from entity-authored property projection.
- Phase 3 decision: world/core tests should seed local-player authority through the player entity helper path (`seed_local_player_entity(...)`) and assert through `WorldState` accessors rather than mutating or reading removed `player.position` / `player.properties` mirrors.
- Phase 4 decision: local-player branching should remain only where the semantics are genuinely self-specific, such as `SpatialBodyId::LocalPlayer(...)`, self sequencing, player-local position-property overlays, or self-side trade/fellowship projection. Branches whose only job was choosing between mirrored storage locations should be removed.
- Phase 4 decision: runtime and movement code should prefer body identity over GUID equality when the distinction is “local player body versus remote body,” and should prefer shared entity-backed helpers over hand-written self fallbacks when the distinction is only storage access.
- Phase 4 decision: self `SetState` remains responsible for advancing player-local instance sequencing, but it must also hydrate the authoritative player entity's physics state/properties when that entity exists so self physics-state updates are not silently dropped.
- Phase 5 decision: keep the type name `PlayerState`; after the ownership cut it still accurately describes the session-local state model for the current player, while avoiding churn that would not buy additional architectural clarity.
- Phase 5 decision: rename remaining overlay-oriented `PlayerState` APIs and fields to advertise their reduced role explicitly (`last_server_grounded`, `local_position_overlays`, derived-stat snapshot naming) so callers do not mistake them for generic world/entity state.
- Phase 5 decision: `PlayerInfoData` should carry a single authoritative player `Entity` snapshot plus player-local overlays, rather than parallel `guid`/`name`/`pos` fields that duplicate the entity snapshot shape.
- Phase 6 decision: keep downstream CLI projection logic centered on entity readiness and `ClientViewEvent` projection rather than introducing any frontend-side `PlayerState` compatibility shim; the downstream work is test/doc retargeting and regression proof, not a new API layer.
- Phase 6 decision: the final regression set should explicitly cover authoritative `PlayerInfo` composition at both boundaries: world emits an entity-backed snapshot, and core projects that snapshot back into the frontend entity stream.

### Progress Log

- 2026-04-20: completed Phase 1 helper introduction and first production migration.
- Landed `WorldState` player-entity/test-helper APIs and retargeted world runtime-body, liveness, movement-handler, and context reads to that helper surface.
- Retargeted `holtburger-core` movement system production call sites away from direct `world.player.position` fallback reads.
- Converted representative world/core movement tests to the new test helper so the supported setup path exists in code, not just in the plan.
- Verification: `cargo test -p holtburger-world` passed and `cargo test -p holtburger-core` passed after the Phase 1 changes.
- 2026-04-20: completed Phase 2 player-bootstrap migration.
- Landed eager player-entity materialization/upsert during `PlayerDescription` handling and moved bootstrap name/property/position writes onto the player entity before `PlayerInfo`/level projection.
- Stopped `PlayerState::hydrate_from_player_description(...)` from seeding live position directly; bootstrap pose is now synchronized from the authoritative entity path.
- Retargeted world tests to assert that `PlayerDescription` creates the player entity eagerly and that the self `ObjectCreate` path still works when it arrives after that bootstrap entity already exists.
- Verification: `cargo test -p holtburger-world` passed and `cargo test -p holtburger-core` passed after the Phase 2 changes.
- 2026-04-20: completed Phase 3 ownership cut for player properties and live pose.
- Removed `PlayerState.position`, `PlayerState.properties`, and the `HasProperties` / `HasPropertiesMut` implementation from `PlayerState`; property-derived player APIs now resolve through entity-backed `WorldState` helpers.
- Deleted the player property-mirroring path from property application and retargeted player-derived stat emission so handlers/world code explicitly project derived stats after player-local stat or enchantment mutations.
- Retargeted world/core tests and helper setup away from direct `player.position` / `player.properties` mutation so local-player authority is always seeded through the player entity path.
- Verification: `cargo test -p holtburger-world -p holtburger-core` passed after the Phase 3 changes.
- 2026-04-20: completed Phase 4 special-case collapse across movement, runtime bodies, and liveness-facing helper paths.
- Removed redundant self-storage fallback branches from world/core movement/runtime code so local-player pose and kinematics now resolve through the same entity-backed/runtime-body helper surface as other authoritative bodies.
- Tightened runtime tracking to distinguish the local player by `SpatialBodyId::LocalPlayer(...)` instead of GUID equality where the semantics are body identity rather than storage ownership.
- Simplified world movement handling so self-only branches remain only for true self semantics, and fixed self `SetState` handling so it no longer drops authoritative physics-state hydration for the local player entity.
- Verification: `cargo test -p holtburger-world -p holtburger-core` passed after the Phase 4 changes.
- 2026-04-20: completed Phase 5 PlayerState clarification and player snapshot cleanup.
- Renamed the remaining `PlayerState` overlay-facing fields and helper methods so grounded state, private position overlays, and derived-stat snapshots no longer read like duplicated world/object ownership.
- Simplified `PlayerInfoData` to carry one authoritative player entity snapshot plus local-player overlays, and retargeted world/core projection code to that explicit composition model.
- Updated architecture/docs wording to describe `PlayerState` as session-local overlay state rather than a second world object.
- Verification: `cargo test -p holtburger-world -p holtburger-core` passed after the Phase 5 changes.
- 2026-04-20: completed Phase 6 downstream cleanup and final verification.
- Audited the actual CLI package (`apps/holtburger-cli`) and downstream core/world surfaces for stale ownership assumptions; no new compatibility layer was needed because the TUI was already consuming entity-oriented readiness and projection state.
- Added focused regression coverage so world bootstrap tests assert the authoritative `PlayerInfo` entity snapshot and core message tests assert that `PlayerInfo` projection re-emits the player entity through `ClientViewEvent::EntitySpawned`.
- Verification: `cargo test -p holtburger-world -p holtburger-core -p holtburger-cli` passed, and `cargo test --all` passed after the final changes.

### Open Questions

- Should self sequencing remain entirely on `PlayerState`, or should some of it move onto the player entity once the base ownership split is complete?