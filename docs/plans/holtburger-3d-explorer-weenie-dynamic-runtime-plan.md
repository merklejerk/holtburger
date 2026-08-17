# Holtburger 3D Explorer Weenie Dynamic Runtime Plan

Status: In progress — preempts `holtburger-3d-spawned-entity-explorer-runtime-plan.md`; Phase R4 stabilization next, authored root motion deferred
Created: 2026-08-16
Refined: 2026-08-16 — evidence-bounded target geometry, atomic implementation milestones, no
production diagnostic history, shared scene indexing, settled-body pruning, one fixed-tick
collection, adaptive time-sliced dynamic contact/reporting, and focused Explorer entity UX
Rescoped: 2026-08-17 — physics-driven motion remains in this milestone; authored animation root
motion and semantic motion commands move to a dedicated follow-on plan
Resequenced: 2026-08-17 — frontend hydration is not a web recovery subsystem; Phase 6 freezes the
reduced contract, Phase 7 separates focused correctness from one product/workload proof, and Phase 8
performs the final cleanup
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Predecessor: `docs/plans/holtburger-3d-spawned-entity-explorer-runtime-plan.md`

## Preemption Scope

This plan replaces the predecessor's execution order and first consumer. The predecessor remains a
historical evidence record for the completed shared-path work, reload audit, motion evidence checks,
and host-physics fixes. Its queued seven-phase implementation must not be executed.

The replacement milestone is one complete shared dynamic-entity creation/event path whose first real
consumer is an Explorer command that spawns a WCID from an optional, offline ACE World-derived weenie
catalog. An app-local Explorer registry owns that live instance, feeds a definition that does not
depend on whether Explorer or a server created the entity, feeds it into the shared solver and
frontend contracts, and reuses the current template, animation, effects,
scene, and renderer systems. The client keeps `WorldState` as its distinct entity authority and
feeds the same path from decoded server facts later; no server spawning, packets, session, or
transport are implemented here.

Solver participation is mutable entity state, not a spawn-time yes/no choice. The catalog retains
the complete ACE template physics-state inputs, the Explorer resolves them with DAT/setup-derived
facts, and the shared runtime can add, remove, or reconfigure collision/physics state without
deleting the body that owns the entity's world pose.

The following predecessor contracts survive unchanged:

1. Producer authority remains composition-specific: `WorldState` for a client and an app-local
   registry for Explorer. Both feed the same shared solver commands and frontend-view contracts.
2. One dedicated snapshot hydrates the frontend on mount before ordered live updates. The same small
   path permits a webview remount without becoming a delivery-recovery subsystem.
3. No frontend motion-table selection, authoritative placement, collision decisions, or per-frame
   host transform stream.
4. No second template cache, animation system, effect dispatcher, pose system, projection grammar,
   or solver integration path within a composition.
5. Explorer UX and catalog discovery remain app-local; shared creation and event mechanics do not
   depend on the entity source.
6. Per-batch sequence numbers, global entity sequence numbers, permanent records of deleted
   generations, and stateful view-builder/creation services require measured evidence and are not
   prerequisites.

## Context and Boundaries

### Goal

From the Explorer, spawn a real WCID at an explicit world pose into an app-local entity registry,
feed it through the same shared solver/frontend creation contract available to
`WorldState`, render and animate it through the existing dynamic presentation runtime, advance its
`SpatialBodyId::Entity` through shared environment and dynamic-body collision, hydrate its frontend
presentation from current host state, and despawn it without leaked registry, body, asset, effect,
scene, or renderer state.

### Why This Milestone

The authored dynamic runtime has already proven shared templates, rigid animation, physics scripts,
particles, audio, bounds, and renderer integration. Host physics has already proven generic physical
definitions, installed collision snapshots, explicit simulation interest, fixed-tick scheduling,
placed paths, and locally derived supported/sliding/airborne state. The missing product seam is not
another primitive: it is the entity-shaped composition that joins those systems under one lifetime.

An ACE World-derived WCID is a better first consumer than a hand-built spawn fixture because it
forces the runtime to consume real setup, appearance, scale, motion, behavior, and physics facts.
Making the source an offline host-only catalog removes any runtime ACE Server/MySQL dependency while
keeping the eventual network source honest: the catalog supplies a template, Explorer supplies live
instance authority, and the shared definitions, solver commands/outcomes, and projections never know
which producer registry supplied them.

### Current Starting Point

- `holtburger-world::WorldState` owns the network client's `EntityManager`, `SpatialScene`, entity
  lifecycle, attachment state, accepted server placement, semantic motion snapshots, and projection
  helpers.
- `WorldState::add_entity` installs an entity and authoritative spatial body, but `Entity` discards
  the lossless appearance payload. This client-local coupling is evidence for shared value/operation
  seams, not a store shape for Explorer to copy.
- `WorldState::apply_set_state_update` already preserves the complete network `PhysicsState` and
  hydrates its property aliases, but it does not reconcile the entity's solver participation or
  response. The current client is therefore the concrete second consumer for mutable physics-state
  reconciliation without adding server spawning.
- The app-local `HostSimulationRuntime` correctly owns the Explorer composition's distinct
  `SpatialScene`, immutable installed `CollisionScene`, and explicit simulation-interest lifecycle.
  It currently serves physical camera bodies and is the solver target for Explorer entity bodies.
  It must not be merged with client `WorldState`; the two compositions need the same realization
  behavior, not the same state instance.
- `HostFixedTickRuntime` supplies one 30 Hz host cadence and generation-safe participant replacement.
- `HostFixedTickRuntime` schedules subsystem participants in stable slots. Registering one participant
  per entity would turn 50-300 bodies into scheduler and lock overhead; the dynamic entity runtime
  needs one collection participant.
- `resolve_setup_physical_spheres` and `retail_grounded_body` resolve setup-authored geometry into
  the generic physical definition and response policy required by the solver.
- `PhysicalBodyDefinition` currently models only one free sphere or one/two grounded movement spheres.
  Retail dynamic targets may instead select setup spheres, cylspheres, or per-part physics BSP, so it
  is not yet a complete body-body collision shape.
- `CollisionScene::StaticShadowIndex` already partitions outdoor colliders by global 24 m cells and
  interior colliders by reached EnvCell. `SpatialBodyStore` remains a `HashMap`, while the separate
  `landblock_map`/`entity_poses` side index is updated by entity mutations but not physical ticks; it
  cannot become dynamic collision truth unchanged.
- `ClientViewEvent` already carries focused entity and runtime-body deltas, but
  `RequestInitialViewState` still emits separate fellowship, vendor, trade, and runtime-body events;
  it cannot reconstruct entity presentation.
- The frontend `DynamicEntitySystem` already owns failure-atomic generation staging and complete
  mutable teardown, but it accepts `AuthoredDynamicSource`, whose static-layer placement and identity
  assumptions are not valid for spawned entities.
- `apps/holtburger-3d-legacy` contains a donor MySQL WCID lookup that proves the relevant ACE tables
  and palette-range expansion. It is not a production architecture: it opens a pool per request,
  duplicates raw property IDs, and projects directly into frontend-shaped DTOs.

### In Scope

- A deterministic offline export tool that reads an ACE World MySQL/MariaDB database and writes one
  immutable, host-only, WCID-indexed catalog file.
- A flat catalog with one format version, a fixed-width sorted index, and exact point lookup; no HBA
  namespace, `ContentRepository` mount, SQLite database, or runtime SQL connection.
- App-local catalog discovery, capability reporting, and injected lookup in the Explorer Tauri host.
- ACE/retail-proven projection of only the static template facts consumed by this milestone.
- A source-neutral dynamic entity definition that contains every derived fact needed by the solver,
  behavior, projection, and presentation contracts without owning producer state.
- Complete lossless ACE `PhysicsState` template inputs: optional base mask, every corresponding
  nullable property-bool override, and related friction/elasticity/setup facts required to derive
  the effective initial state exactly.
- A source-neutral complete physics-state replacement operation shared by Explorer scenarios and the
  existing client `SetState` path.
- Reversible solver participation: every dynamic entity retains one body that owns its world pose.
  Collision shape, collision response, and fixed-tick work can be added, removed, or reconfigured
  from the effective state without deleting that pose body.
- Shared source-neutral body commands, reliable committed solver outcomes, and pure projection
  functions used by client `WorldState` and the Explorer host.
- An app-local Explorer entity registry with ordered spawn, despawn, and complete replacement. It
  owns semantic state only; solver-owned physical state is joined for projection rather than copied.
- App-local Explorer identity allocation, spawn pose selection, scenario controls, and catalog policy.
- One focused dynamic-entity snapshot/event surface and listener-before-request frontend hydration.
  A webview remount reuses that current-state path; Explorer does not reuse the whole client view feed
  or add a delivery-recovery protocol without measured loss.
- One app-local Tauri relay and frontend current-entity mirror.
- A focused Explorer `Entities` tab for direct WCID spawning in front of the current camera, exact
  capability/error feedback, current spawned-entity inspection, selection, and despawn.
- A source-neutral frontend dynamic presentation input shared by authored and spawned adapters.
- Default setup appearance, animation, physics script, particles, audio, bounds, renderer submission,
  and generation-safe resource ownership for spawned entities.
- Setup-resolved grounded physical bodies, fixed-tick solver advancement, locally derived ground
  state, placed paths, non-gating scene residency, and sparse placement presentation.
- Dynamic body-to-body candidate lookup, flag-driven filtering, exact shape contact/response
  (the narrow phase), and source-neutral collision-report outcomes available to composition-owned
  consumers. The census selects the simplest adequate implementation; it does not gate this scope.
- Lossless dynamic-target geometry selected from setup spheres, cylspheres, or physics BSP according
  to retail/ACE rules, distinct from the movement/ground-response spheres where the rules differ.
- Collision start/end reporting that remembers active contacts and ends them during removal, rather
  than emitting unrelated hit notifications every tick.
- Solver-owned active/settled tracking that omits proven resting bodies from integration while
  retaining their pose, lifecycle, spatial-index membership, target collision, presentation, and
  collision-report maintenance.
- Physics-driven entity advancement from retained velocity, acceleration, angular velocity, launch,
  collision response, relocation, pause/resume, and deterministic fixed-step scenarios. Default
  setup animation remains visual, while animation position-frame translation and rotation do not
  alter the entity root in this milestone. The plan exposes no semantic command that selects authored
  root motion.
- Browser-harness and host-backed verification using generated catalog fixtures and representative
  production WCIDs when a local catalog is available.

### Out of Scope

- Server spawning, login, sockets, packets, protocol sequencing, reconnect, or manufacturing server
  messages for Explorer scenarios.
- Reading a live ACE database at application runtime or requiring an ACE Server process.
- Parsing arbitrary ACE SQL files in Holtburger. SQL-file bootstrap may later orchestrate an
  external disposable MariaDB import before invoking the same exporter.
- HBA storage, `ContentRepository` discovery, DAT namespace allocation, or browser access to the
  weenie catalog.
- A catalog browser, name/type search, secondary indexes, memory mapping, record compression,
  checksums, cache eviction, or background prefetch without measured need.
- Exporting every ACE gameplay table or property merely because it exists.
- Shard/biota state, server GUID allocation, generators, loot, AI, combat, inventory creation lists,
  persistence, or gameplay simulation.
- Gameplay consequences of collision-report events. This milestone must emit the proven semantic
  event but does not implement combat, AI, damage, or server authority in response.
- Focused appearance mutation and animated attachments until a concrete Explorer scenario consumes
  each operation. Complete replacement is required now because spawn lifecycle exercises it.
- A generic runtime superclass, reuse of client `WorldState` inside Explorer, Tauri DTOs as the
  Explorer registry, or TypeScript-authored world truth.
- Reusing Explorer camera input mapping, viewer offsets, camera dimensions, or camera event contracts
  as entity mechanics.
- Per-render-frame host transforms, frontend portal traversal, or frontend raw motion-table decoding.
- Authored root-translation/root-rotation execution, motion-table command selection, semantic
  stand/walk/run/turn/stop transitions, shared animation/physics cursor ownership, or replacement of
  the reduced `MotionKinematics` contract. Those form the dedicated follow-on
  `holtburger-authored-root-motion-physics-integration-plan.md`.
- Explorer collision-history panels, recent-event logs, diagnostic timelines, production counters,
  or retained diagnostic records. The solver keeps only contact state required to produce correct
  start/refresh/end semantics; focused tests and harnesses observe emitted outcomes externally.
- A second Explorer physical-body registry beside `HostSimulationRuntime`, spawned-only solver, or
  body-driven collision loading policy.
- Silently ignoring a set physics-state bit or treating the complete mask as one `collidable`
  boolean. The post-export census must assign every bit to an implemented consumer, a
  derived/content-only role, or an explicit unsupported boundary backed by observed data.

## Ground Truth

### Authoritative References

| Question                                                                              | Source                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete ACE weenie table families and loading                                        | `ACE/Source/ACE.Database/WorldDatabase.cs`, `ACE/Source/ACE.Database/WorldDatabaseWithEntityCache.cs`, `ACE/Source/ACE.Database/Models/World/Weenie.cs`                                                              |
| Weenie-to-live-object defaults and type acceptance                                    | `ACE/Source/ACE.Server/Factories/WorldObjectFactory.cs`, `ACE/Source/ACE.Server/WorldObjects/WorldObject.cs`                                                                                                         |
| Network-visible setup, motion, scale, physics, and ObjDesc projection                 | `ACE/Source/ACE.Server/WorldObjects/WorldObject_Networking.cs`                                                                                                                                                       |
| Physics-state bits, template defaults/overrides, and live broadcasts                  | `ACE/Source/ACE.Entity/Enum/PhysicsState.cs`, `ACE/Source/ACE.Server/Physics/PhysicsGlobals.cs`, `ACE/Source/ACE.Server/WorldObjects/WorldObject_Properties.cs`, `ACE/Source/ACE.Server/WorldObjects/WorldObject.cs` |
| Retail complete-state replacement and bit consumers                                   | `acclient-eor-source/acclient.c:137255-137281`, `acclient-eor-source/acclient.c:138243-138273`, `acclient-eor-source/acclient.c:310307-310347`, plus the Phase R0 per-bit call-site census                           |
| Dynamic shadow registration, target-shape selection, filtering, and contact reporting | `ACE/Source/ACE.Server/Physics/PhysicsObj.cs`, `ACE/Source/ACE.Server/Physics/Common/ObjCell.cs`, `ACE/Source/ACE.Server/Physics/Common/GfxObj.cs`, `ACE/Source/ACE.Server/Physics/ObjectInfo.cs`, and retail `acclient.c:309445-310001` |
| Active-to-resting physics update lifecycle                                            | `ACE/Source/ACE.Server/Physics/PhysicsObj.cs:1832-1860`, `ACE/Source/ACE.Server/Physics/PhysicsObj.cs:4142-4190`, `ACE/Source/ACE.Server/WorldObjects/WorldObject_Tick.cs:228-305`, plus the Phase R0 retail call-site census                         |
| Focused ObjDesc versus complete replacement                                           | `ACE/Source/ACE.Server/WorldObjects/Creature_Equipment.cs`, `ACE/Source/ACE.Server/WorldObjects/Hook.cs`                                                                                                             |
| Retail setup defaults, animation, physics scripts, motion, placement, and destruction | `acclient-eor-source/acclient.c` call sites cited by the completed authored-effects, host-physics, contact-slide, and predecessor plans                                                                              |
| Parsed SetupModel, MotionTable, ObjDesc, scripts, and effects                         | `ACE/Source/ACE.DatLoader`, with `ACViewer/ACViewer/Physics` as supporting evidence                                                                                                                                  |
| SQL donor projection and known palette expansion                                      | `apps/holtburger-3d-legacy/src-tauri/src/adapter/ace_world_sql.rs`                                                                                                                                                   |

### Existing Production Contracts to Extend

- `crates/holtburger-world/src/entity.rs`
- `crates/holtburger-world/src/state/types.rs`
- `crates/holtburger-world/src/state/mutations.rs`
- `crates/holtburger-world/src/state/motion_resolution.rs`
- `crates/holtburger-world/src/spatial/scene.rs`
- `crates/holtburger-world/src/spatial/physical_body.rs`
- `crates/holtburger-core/src/physical_body_definition.rs`
- `crates/holtburger-core/src/content_assets.rs`
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-core/src/client/runtime.rs`
- `crates/holtburger-core/src/client/mod.rs`
- `apps/holtburger-3d/src-tauri/src/host_simulation_runtime.rs`
- `apps/holtburger-3d/src-tauri/src/host_fixed_tick_runtime.rs`
- `apps/holtburger-3d/src-tauri/src/host_camera_runtime/`
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
- `apps/holtburger-3d/src/lib/game/systems/object-visual-template-repository.ts`
- `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`
- `apps/holtburger-3d/src/lib/game/systems/effect-system.ts`

## North Stars

1. A weenie is a static template; an entity is a live authoritative instance. No type may blur the
   distinction, and no shared solver or projection contract may claim producer authority.
2. The first WCID must traverse the same shared creation and frontend-view contracts a later
   decoded server spawn will use, without sharing registries or pre-building the server adapter.
3. Entity facts and solver state remain separate. Prepare fallible work first, undo an unexpected
   partial install, and publish only after both owners contain the entity. This avoids both a
   cross-store transaction and a second copy of the pose.
4. One owner in each runtime owns each fact. Catalog owns templates; `WorldState` or Explorer registry
   owns live entity facts; that runtime's spatial system owns bodies; frontend owns
   presentation; renderer owns batching.
5. Every live entity has one body that owns its world pose. Collision/physics state is optional and
   reversible, selected from the current effective `PhysicsState`, and never required for the entity
   itself to exist.
6. The existing authored presentation runtime is generalized by subtraction: extract static-layer
   assumptions from its input rather than wrap it with a second spawned system.
7. Solver output is entity placement truth for locally simulated bodies. Ground classification is
   derived locally and never supplied by catalog or future server data.
8. The catalog is boring on purpose: fixed header, fixed sorted index, explicit payload codec,
   positioned reads, and no database engine.
9. Frontend hydration precedes interesting behavior. A newly mounted frontend must construct the
   current entity population before applying live deltas; this requires no replay or web recovery
   protocol.
10. Unsupported source facts fail with WCID and provenance, and every shared field/event/operation
    has a named same-phase producer and consumer. No guessed fallback or future-only scaffolding may
    make malformed input look valid.
11. The settled state removes integration work, never the body. Resting bodies remain indexed collision
    targets and visible entities, and every state-changing input has one explicit wake path.

## Selected Ownership and Data Flow

```text
offline only
ACE World MySQL --export--> ExplorerWeenieCatalog (flat indexed file)
                                      |
Explorer spawn command (WCID + pose) -+
                                      v
                         ExplorerEntityRegistry
                         (app-local semantic authority)     WorldState entities
                                      |                    (client semantic authority)
                                      +---------+----------+
                                                |
                                  shared definitions/commands
                                                |
                              each runtime's SpatialScene/solver
                                                |
                                  committed body outcomes/snapshots
                                      +---------+----------+
                                      |                    |
                         named entity-state updates   assemble frontend view
                                                           |
                                      dedicated dynamic-entity snapshot/updates
                                                           |
                         narrow app-local Tauri relay
                                                           |
                         frontend current-entity mirror
                                                           |
        template / animation / scripts / effects / placement / renderer
```

The future network path begins using shared code at the entity definition, solver command/outcome,
and frontend-view contracts. It keeps `WorldState` as its authority and uses `WorldState`'s own
`SpatialScene`; it does not read the Explorer catalog. The Explorer path keeps its app-local registry
and uses `HostSimulationRuntime`'s own `SpatialScene`; it does not synthesize protocol messages.
Shared means identical downstream contracts and behavior, not a shared state instance or a universal
owner.

## Structural Contracts

### Offline Weenie Catalog

The catalog is a separate host reference asset, not client content. Its exact filename is fixed with
the format in Phase 1; app-local discovery/configuration is fixed in Phase 3. The format has:

- a fixed header with magic, one format version, canonical source-provenance length, record count,
  payload range, and index offset;
- canonical provenance derived from the selected ACE World source revision or explicit operator
  label, never a wall-clock timestamp that breaks reproducibility;
- one variable-length semantic template payload per exported WCID;
- one fixed-width index entry `{ wcid: u32, payload_offset: u64, payload_length: u32 }`, strictly
  sorted by WCID; and
- no compression in the first format version.

Phase 1 fixes the complete canonical byte contract: endianness, integer widths, string encoding,
payload field/collection ordering, decode-size limits, and whether unknown payload fields are rejected
or skipped. Reproducibility cannot depend on a serializer library's incidental defaults.

The reader validates the complete header and index before serving lookups: supported versions,
strict WCID ordering, no duplicates, offsets within the payload region, non-overlapping records, and
representable lengths. It retains the small index in memory, uses `binary_search_by_key`, and performs
one positioned read plus one strict payload decode per uncached lookup. EOF, malformed data, missing
WCID, and unsupported version are distinct outcomes.

The semantic payload is not a dump of MySQL rows and not a frontend DTO. Phase 0 bootstraps the
lossless survey fields; Phase R0 deletes survey-only data and freezes the exact runtime-backed
payload after measuring the generated population. Candidate facts include WCID/type/name, setup DID,
motion table DID, sound/PES references, default scale,
the optional `PropertyInt::PhysicsState` base mask, nullable overrides corresponding to runtime
physics-state bits, friction, elasticity, base palette, ordered subpalettes, ordered texture changes,
and ordered animation-part changes. The physics composite is retained because its complete effective
result and later replacement are milestone consumers; unrelated ACE properties remain omitted.

The exporter preserves template inputs rather than pretending it can calculate the final mask alone.
The Explorer host combines them with DAT/setup-derived facts such as physics-BSP, default-animation,
and default-script availability using the Phase R0-proven ACE precedence. The resulting complete
effective `PhysicsState` is the same source-neutral value supplied by a future decoded create or
`SetState` message.

### Producer Registries and the Shared Event Path

The two entity registries are intentionally distinct, and each sits outside its runtime's solver:

- client composition: `WorldState::EntityManager` above the separate `WorldState.scene` body store;
- Explorer composition: an app-local `ExplorerEntityRegistry` above
  `HostSimulationRuntime`'s body store.

Neither registry is generalized into a universal store and Explorer does not instantiate
`WorldState`. Shared code begins only after a registry has assembled the entity definition.
It consists of small definition/body-command contracts, reliable committed solver outcomes,
solver snapshots, and pure functions that assemble frontend views. Existing synchronous returns are the default
in-process delivery mechanism; do not add an async event bus, stateful funnel object, or trait unless
landed consumers prove it removes more code than it adds.

`SpatialScene` is the sole physical-state authority. Every live dynamic entity keeps one
`SpatialBody` for pose, motion, and frontend views, while `SpatialBody::physical` is optional
collision/physics state. The producer registry owns the current complete effective
`PhysicsState` as an entity input. It may consume committed body outcomes when a named entity rule
needs them, but it does not mirror pose, velocity, contact, response, residency, or placed-path state.
A pure function combines the registry record with the current body view. The frontend receives the
resulting shared view event; it does not become the backend event bus.

The clean cutover removes `SpatialScene::entity_poses` as a second pose store. Entity range/liveness
queries read canonical `SpatialBody` poses through a scene-owned coarse membership index, while the
dynamic collision shadow index derives its outdoor-cell/EnvCell memberships from physical geometry
and the last committed `CollisionPlacement`. Registration, pose commit, physical-state replacement,
teleport, and removal update all derived memberships inside `SpatialScene`; callers cannot remember a
second indexing side effect.

The client and Explorer may therefore contain separate `SpatialScene` instances, just as two client
processes would. Within Explorer, camera and dynamic entity bodies share the existing
`HostSimulationRuntime` store; no spawned-only store is added. Within the client, entity bodies stay
in `WorldState.scene`.

### Spawn Definition and Publication

The catalog record, Explorer request, decoded setup, and derived body profile produce one validated
shared definition (final name fixed during Phase 2). It contains entity
appearance, behavior references, explicit initial pose/time, and either a complete
effective physics state plus every resolved geometry/response fact its current supported bits
require. It never contains a catalog path, SQL row, frontend node, asset payload, producer-registry
handle, or optional fields whose absence triggers an implicit runtime fallback.

One pure decision compares the previous and next effective physics state and produces the required
spatial operations: retain a pose-only body; add, remove, or reconfigure collision/physics state;
preserve compatible pose/motion; and clear
incompatible contact/response memory. The same operation handles initial spawn and later complete
state replacement; consumers never hand-edit individual solver fields from bit changes.

Unsupported effective combinations are still losslessly representable. Explorer creation rejects
them before publication with WCID/mask/reason. An authoritative client `SetState` replacement retains
the received semantic mask, stops any now-invalid local simulation, and reports the unsupported
physical interpretation rather than continuing under stale behavior or rejecting server truth.

The Explorer driver reserves identity and validates replacement policy in its own registry; the
client continues to obtain identity/lifecycle from server-driven `WorldState`. All content loading,
definition, and body preparation completes before either authority mutates. The composition then
updates the registry and installs the body in a defined order, removes an unpublished partial install
if an unexpected commit step fails, and publishes only after the frontend view can be assembled.

This is an ordered pair of updates, not a cross-store transaction. A hard solver failure emits no
committed outcome; exhausting grounded contact iterations is ordinary bounded progression, not a
rejection. Failure to deliver a frontend event does not roll back accepted simulation; the complete
snapshot repairs presentation. Complete replacement retires the old scheduler participation and
body before publishing the successor. A composition-local instance generation rejects a late
outcome from retired work; no global sequence or permanent tombstone is introduced.

### Projection and Frontend Hydration

One dedicated `DynamicEntitySnapshot` contains every frontend-relevant dynamic entity together with
appearance, behavior identity, body pose/kinematics/contact/residency, and one host timeline mapping.
Immutable assets are referenced by content identity. Animated attachment state and semantic motion
remain absent until their deferred scenarios exist. Backend client `EntityMotionSnapshot` state does
not cross this focused feed merely because it exists. Every populated field has a same-phase frontend
consumer.

Initial mount and later webview remount use the same small hydration state machine:

1. register the Rust receiver and frontend listener;
2. enter `awaiting-snapshot` and request current state;
3. ignore entity/body updates until the snapshot arrives;
4. replace the frontend mirror as one operation; and
5. apply later updates in order.

The snapshot hydrates current host state; it is not a website delivery-recovery protocol. Do not add
an intermediary broadcast channel, feed sequence, acknowledgement, replay, or automatic recovery
without measured need on the selected real Tauri boundary.

### Solver and Presentation Placement

One dynamic-entity subsystem participant owns the Explorer entity collection's fixed tick; individual
entities never reserve scheduler slots. The participant visits eligible bodies through an explicit
total ordering for `SpatialBodyId` rather than `HashMap` iteration and emits at most one Tauri
advance batch per fixed tick. Settled or otherwise unscheduled bodies may remain dynamic collision
targets without being tick participants, while the synthetic Explorer camera remains outside dynamic
entity collision unless its camera policy explicitly opts in.

Scheduling eligibility from the effective physics state is distinct from solver activity. An eligible
body becomes settled only after the Phase R0-proven number of consecutive accepted ticks establish
stable support, canonical zero velocity/omega, no current actuation or acceleration, and no pending
response or accepted motion path. Settled state is derived and owned by the solver, not a catalog fact,
registry semantic, frontend authority, or synonym for `Static`/`Frozen`. The collection participant
continues its cheap stable-order scan at the 50-300-body milestone and simply omits settled bodies
from integration and mover-side queries; do not add sleep islands, per-body timers, or a second
active-body registry without Phase R2 evidence.

A settled body retains its canonical pose, collision/physics state, spatial-index membership, target
geometry, report state, and presentation. Motion/actuation, velocity/acceleration/omega replacement,
teleport, a physics-state change, a change to loaded terrain/interior collision data, and a dynamic peer
interaction explicitly wake it before the next required solve. The loaded collision changes when the
host adds or removes relevant landblock collision assets; it does not replace bodies or either entity
registry. The first implementation may wake every settled body after that change rather than
introduce support-dependency graphs. Phase R0 determines whether animated parts or physics scripts
mutate target collision geometry; such updates either keep the relevant physical work active or
explicitly dirty the target geometry without conflating visual animation with body integration.

Each active body
queries a dynamic shadow index using the same spatial domains already proven by static collision:
global 24 m outdoor cells and exact reached EnvCells. It then resolves currently visible contacts and
commits its accepted outcome independently. The dynamic index updates as bodies commit or rebuilds at
the next fixed tick according to the Phase R0-proven maintenance policy. Peer response may therefore
converge across later bodies or the next tick; the runtime promises determinism and bounded
convergence, not an atomic simultaneous world step. The client can later run the same operations
against `WorldState.scene`.

Missing environment collision owners remain open space and never suspend bodies or trigger loads;
dynamic peers remain independently eligible according to current physics-state and object-info
filters. Broad-phase queries cover swept conservative bounds and provisional reached cells, not only
the mover's previously committed buckets, so fast motion and portal entry cannot miss a target.
Changed per-body outcomes are collected into the tick batch. Missing coverage, invalid math or
placement, substep-budget overflow, and dynamic slice-budget overflow leave that body's previous
accepted state intact without rolling back unrelated bodies. A grounded substep that merely retains
contacts after its bounded correction passes still commits and continues.

Collision reporting retains only the physical state required for correct lifecycle semantics; it is
not a diagnostic history. A touched pair refreshes its active lifetime record; first touch, expiry,
reporting-state replacement, teleport, detach, replacement, and despawn produce the ACE/retail-proven
start/end outcomes. Expiry consumes an injected clock so focused tests never sleep. Composition-owned
interested parties may consume committed report outcomes, but Explorer does not relay or retain them
merely to populate diagnostics, counters, history, or a collision inspector.
Report expiry and forced-end maintenance remain serviced for settled bodies according to the Phase
R0-proven lifecycle; skipping integration cannot silently freeze or fabricate a contact lifetime.

The frontend receives sparse accepted path/anchor facts and evaluates presentation at render cadence.
Only its placement subsystem writes the entity root. Animation and effects write visual-root/part
state, never authoritative root placement. Teleport, complete replacement, resnapshot, and timeline
reset explicitly clear prediction and correction state.

## Phased Implementation

### Phase 0: Bootstrap the Export Contract

Progress: Complete (2026-08-16). The source trace and bootstrap contract are recorded in
`docs/ace_world_weenie_catalog.md`.

#### Deliverables

- Trace the ACE World table relationships needed to export stable WCID records and prove the
  extraction rules for scalar properties, nullable bool overrides, and ordered appearance
  collections. This phase proves database meaning and absence representation, not final runtime
  behavior.
- Define the smallest lossless bootstrap catalog record needed to survey setup, appearance, motion,
  physics-state inputs, friction, and elasticity without reopening the database for every question.
  Every field's first consumer is the Phase R0 survey; no frontend or solver contract is frozen yet.
- Distinguish runtime `PhysicsState` values from wire `PhysicsDescriptionFlag` field-presence bits so
  the exporter cannot mix the two namespaces.

#### Acceptance Criteria

- Every bootstrap catalog field has a Phase R0 survey question and authoritative ACE source citation.
- Optional values preserve absence distinctly from explicit zero/false, and repeated collections
  have one proven canonical ordering.
- No wire presence flag is persisted as runtime physics state.
- Every export rejection has an input that reaches it and one distinct error message.
- No unresolved database rule is converted into a default or fallback.

#### Decisions and Course Corrections

- The bootstrap record retains optional raw ACE template inputs; it does not require setup, fall back
  from display name to class name, expand palette ranges, narrow database doubles, or calculate the
  effective physics mask.
- Only the eleven `PropertyBool` values consumed by ACE's `CalculatedPhysicsState()` are physics
  overrides. Bits without property-bool counterparts remain losslessly represented by the optional
  raw base mask; setup/runtime-derived bits remain DAT work for Phase R0.
- ACE appearance tables contain semantic sets rather than an order column. Canonical export order is
  animation index, texture `(part index, old DID, new DID)`, and palette
  `(offset, length, subpalette DID)`. Phase R0 must stop for review if real overlapping palette ranges
  make consumer-visible behavior depend on an order the database does not preserve.
- `PhysicsState` and wire `PhysicsDescriptionFlag` remain separate namespaces. No presence bit enters
  the catalog payload.
- Debt carried into Phase 1: implement every rejection named by the Phase 0 contract with a focused
  synthetic fixture, including database-constraint violations that a valid production schema cannot
  produce.

### Phase 1: Build the Offline Explorer Weenie Catalog

Progress: Complete (2026-08-16). `holtburger-weenie-catalog` owns the `.hwc` version 1 semantic
record, codec, reader, deterministic failure-atomic writer, and focused fixtures;
`holtburger-tools::export-weenie-catalog` owns one-connection ACE World extraction.

#### Deliverables

- Add a small dependency-light catalog crate shared only by the exporter and Explorer Tauri host.
  It owns the semantic template record, explicit binary codec, validated reader, deterministic
  writer, and format errors. It has no HBA, Tauri, world, protocol, or MySQL dependency.
- Add the catalog crate to the workspace and document its host-reference boundary. Choose the final
  crate/file-format names in this phase and sweep temporary vocabulary.
- Add an `apps/holtburger-tools` exporter binary. Add the MySQL/MariaDB dependency through Cargo so
  the package manager selects the current compatible version; do not copy the legacy version number.
- Hold one configured database connection for the one-shot export, query the Phase 0 table set,
  validate required facts, canonicalize every repeated collection, and write records in WCID order.
- Export the optional base physics-state mask plus the ACE-defined nullable bool overrides as one
  semantic template-physics composite. Do not flatten absent overrides to `false`, discard unknown
  mask bits, or derive DAT-owned setup flags in the database tool.
- Make export failure-atomic: write a temporary sibling file, flush/close and reopen-validate it,
  then replace the requested output. Do not leave a successful-looking partial catalog.
- Add focused fixtures proving empty catalog, boundary WCIDs, duplicate rejection, truncated header,
  unsorted index, overlapping/out-of-range payload, malformed record, unsupported versions, missing
  WCID, and deterministic round-trip bytes.

#### Acceptance Criteria

- The generated file is neither an HBA nor discoverable through `ContentRepository`.
- Runtime lookup performs binary search over the validated in-memory fixed index and one positioned
  record read; it opens no database or network connection.
- Two exports from identical canonical rows and provenance are byte-identical.
- The reader distinguishes unavailable catalog, absent WCID, corrupt catalog, and unsupported format
  version.
- MySQL is confined to the exporter binary and absent from the catalog library dependency graph.
- A representative generated catalog reopens and resolves every Phase 0 extraction fixture exactly.
- Catalog fixtures distinguish absent base state from an explicit zero mask and distinguish absent,
  true, and false overrides. Effective host-state precedence is deliberately deferred until Phase R0
  can exercise these lossless inputs against real catalog and DAT distributions.

#### Decisions and Course Corrections

- Final names are crate `holtburger-weenie-catalog`, extension `.hwc`, magic `HBWCAT`, and format
  version 1. `docs/ace_world_weenie_catalog.md` specifies every byte, limit, source field, and
  canonical ordering rule.
- The reader retains provenance plus the fixed 16-byte-per-record index, uses binary search, and
  performs a positioned payload read on lookup. It has no database, HBA, content, world, protocol,
  Tauri, or frontend dependency.
- The exporter uses optional feature `weenie-catalog-export` to confine Cargo's `mysql` 28 dependency
  and exporter module to the required-feature binary. It holds one direct connection and issues nine
  bulk ordered queries. It exports every `weenie` parent, including missing-setup/name records
  required by R0, rather than issuing N+1 WCID queries or applying runtime fallbacks.
- The writer canonicalizes source ordering, validates and compares every record after reopening the
  temporary catalog, then atomically publishes it. A rejected replacement preserves an existing
  catalog.
- The Explorer host does not take an unused catalog-crate dependency in this phase. Phase 3 adds it
  with the first app-local discovery/lookup consumer; current dependency-graph checks already prove
  MySQL is confined to `holtburger-tools`.
- Concession: version 1 uses bounded in-memory payload vectors during the one-shot export. The runtime
  still reads one record at a time. R0 must measure payload/file size before a streaming writer is
  considered.
- Debt carried into R0: run the exporter against the selected real ACE World revision, record its
  provenance, and use that generated catalog plus normal DAT content for the required distributions.
  No generated runtime asset is checked in by this phase.
- Do not add mmap, compression, checksums, secondary indexes, streaming output, or template caching
  unless Phase R0 measurements prove the simple implementation insufficient.
- Completion audit closed the Phase 0 rejection-fixture debt: synthetic tests now reach duplicate
  parents/scalars/all three appearance keys, every selected-table unexpected property branch,
  nonfinite database floats, invalid bool values, palette and part-index narrowing, string/collection
  bounds, catalog/record bounds, and the public WCID/field error context. These remain focused
  validation tests rather than a generic diagnostic framework.

### Phase R0: Survey the Catalog and Freeze the Runtime Scope

Progress: Complete (2026-08-16). `docs/ace_dynamic_entity_runtime_survey.md` records the complete
consumer matrices, measured populations, source assignments, supported/deferred boundaries,
representative WCIDs, and shared-boundary dry run. The offline survey command measures the generated catalog
through normal mounted HBA content without reopening SQL. The selected ACE World revision contains
43,913 records and 4,858,241 encoded payload bytes (109-byte median, 159-byte p99, 476-byte maximum),
so the fixed sorted index plus positioned record read remains the final runtime lookup design. All
3,909 referenced setups and their referenced GfxObjs decode from `dats`; the population contains
37,497 sphere, 4,349 cylsphere, 1,254 physics-BSP, and 813 geometry-absent target branches. The
survey found no overlapping or out-of-bounds palette ranges, but it found three zero-length palette
ranges and eight non-positive scales for explicit representative handling.

R0 encountered a consumer-visible collision-report source disagreement. Retail retains one record
per directional recipient, emits only on first touch, silently refreshes later touches, and expires
the record after one second (or after the next positive interval for an ethereal target). ACE's
current `track_object_collision` overwrites its dictionary entry and calls the collision callback on
every observed touch. Retail's complete `set_state` also does not reconcile report/filter bits during
an existing contact; only the specialized hidden transition forces ends and restarts retained
contacts on unhide. The selected contract preserves retail's first-touch/silent-refresh lifetime but
deliberately closes the raw-state-toggle hole: loss of reporting eligibility forces a balanced end,
and restored eligibility starts a new lifetime only when a later solve reconfirms contact. This is a
deliberate retail divergence, not an inferred retail behavior.

#### Deliverables

- Add survey output to the exporter/tooling layer over the generated catalog, not a parallel SQL
  query path. Report total records, setup coverage, payload distribution, repeated appearance
  cardinalities, missing facts, base-mask frequency, nullable override frequency, and friction/
  elasticity distributions.
- Resolve setup-derived facts through the existing DAT/content path and report effective
  physics-state bits and combinations, physical-participation classes, collision-filter classes,
  and sphere counts/radii. Keep this host/tool survey outside the catalog reader and runtime
  contracts; a template catalog must not pretend to measure concurrent spawned density.
- Build a complete ACE/retail `PhysicsState` consumer matrix for `Static`, `Unused1`, `Ethereal`,
  `ReportCollisions`, `IgnoreCollisions`, `NoDraw`, `Missile`, `Pushable`, `AlignPath`, `PathClipped`,
  `Gravity`, `LightingOn`, `ParticleEmitter`, `Unused2`, `Hidden`, `ScriptedCollision`,
  `HasPhysicsBSP`, `Inelastic`, `HasDefaultAnim`, `HasDefaultScript`, `Cloaked`,
  `ReportCollisionsAsEnvironment`, `EdgeSlide`, `Sledding`, and `Frozen`. Record template/default/
  override precedence, retail initialization and live replacement, and the consumer for pose,
  scheduling, environment contact, dynamic-body contact, filtering, reporting, response, or
  presentation.
- Trace adjacent client-visible physics inputs—setup/physics BSP, scale, friction, elasticity,
  velocity, acceleration, and omega—and assign each to catalog data, DAT derivation, live instance
  state, or a cited exclusion.
- Trace every non-`PhysicsState` input used by retail/ACE object collision: weenie/object category,
  player/creature classification, impenetrability, PK/PKLite relation, parent/attachment state,
  projectile target, transient ignore-creatures policy, insertion mode, and viewer policy. Assign each
  to the template, live instance, producer policy, or an explicit unsupported scenario; do not hide
  them inside a generic collision filter.
- Census setup sphere and cylsphere counts plus `HasPhysicsBSP` and per-part physics-BSP availability.
  Prove the moving-query geometry and target geometry selected by each branch before fixing the
  physical definition or narrow phase; movement spheres alone are not assumed sufficient.
- Trace retail/ACE collision-table lifetime semantics: first-touch versus refresh, relative-velocity
  profile facts, static-target environment conversion, `ReportCollisionsAsEnvironment`, timeout,
  ethereal expiry, forced end, and state-toggle restart/end behavior.
- Trace ACE and retail active/inactive transitions independently from `Static` and `Frozen`: zero-
  velocity thresholds, walkable support, movement-manager/animation/script gates, acceleration,
  gravity suppression, collision response, and every operation that reactivates an object. Determine
  whether resting unprocessed contacts remain reported or expire, rather than guessing from the ACE
  timeout in isolation.
- Determine whether idle animation, physics scripts, cylspheres, or per-part physics BSP change
  dynamic target geometry while the root body remains stationary. Name whether each case prevents
  settling, requires a target-geometry refresh only, or is outside the supported first
  population.
- Pick 3-10 named WCIDs covering ordinary creatures, simple objects, pose-only bodies, varied sphere
  geometry, collision-filter/reporting differences, appearance substitutions, default behavior, and
  malformed input. Record why each differs.
- Treat 50-300 spawned entities per populated landblock as the first-milestone workload envelope.
  Combine that known range with measured catalog geometry to validate assigning dynamic bodies to the
  existing global 24 m outdoor-cell lattice, exact reached-EnvCell buckets, deterministic visit/pair
  ordering, exact shape/contact model, convergence rule, and collision-report contract. Include
  outdoor/EnvCell portal straddling and the currently simulated area; body-body collision is committed
  scope.
- Census authored and live-instance speed/acceleration bounds for the representative shapes,
  especially `Missile`, and compare per-tick displacement with target dimensions. Prove the selected
  adaptive slice distance and maximum slice count against that envelope; swept bucket lookup alone
  must not be mistaken for a contact test.
- Prove directional pair-processing and report ownership when both bodies are scheduled. Name which
  body solve may apply each response and which retained per-recipient record emits lifecycle events,
  so a pair is neither double-impulsed nor silently skipped by stable visitation.
- Audit the bootstrap catalog schema against the results. Delete survey-only fields with no runtime
  consumer, add only proven missing runtime facts, revise the still-unreleased format version as
  needed, and regenerate fixtures before Phase 2 contracts consume it.
- Walk the proposed shared creation path from both `WorldState` and
  `HostSimulationRuntime`. List which inputs each producer can supply, which body/projection
  operations are genuinely identical, which committed solver outcomes have named consumers, and
  which ordering/publication guarantees must remain composition-local.
- Dry-run the focused snapshot/Tauri relay and determine whether current `MotionKinematics` covers
  the named locomotion cases. Record exact gaps for later phases rather than designing them here.

#### Acceptance Criteria

- The survey runs entirely from the generated catalog plus normal DAT content; it needs no live ACE
  database after export.
- Every defined physics-state bit and adjacent physical input has an authoritative rule, observed
  frequency, runtime classification, and named consumer or explicit unsupported boundary.
- Dynamic body collision has named representative pair scenarios covering filtering, overlap,
  separation, response, deterministic ordering, high-displacement crossing, and collision reporting.
- Every supported dynamic shape branch and non-state collision input has a representative fixture;
  every deferred branch has a reachable rejection with WCID and reason.
- Collision report acceptance distinguishes start, retained touch, refresh, natural end, and forced
  end; it does not reduce the lifecycle to one event per tick.
- The activity census produces one explicit settled-state predicate, consecutive-stable-tick threshold,
  and complete wake matrix. It distinguishes integration, target-geometry maintenance, collision-
  report maintenance, animation, `Static`, and `Frozen`; no wall-clock inactivity heuristic is used.
- The measured sphere geometry and 50-300-entities-per-populated-landblock envelope validate outdoor
  global-cell stamping, update/rebuild policy, and cross-landblock candidate handling. EnvCells use
  their existing reached-cell partition unless a measured single-cell workload proves subdivision is
  necessary.
- The selected narrow phase detects the supported representative crossings within the measured
  displacement/shape envelope, rejects an over-budget solve before partial commit, and processes/
  reports two scheduled bodies with one explicit deterministic ownership rule.
- The finalized catalog contains only facts consumed by runtime realization or retained provenance,
  and its fixed index/record choices are justified by measured distributions.
- The boundary dry-run proves that neither producer registry nor `SpatialScene` instance must move,
  and that no new event bus or stateful funnel is required to share the realization operations.
- No unresolved source rule becomes a fallback, and no set physics bit is silently inert.

#### Decisions and Course Corrections

- Record the catalog revision and the selected collision algorithm before Phase 2. Stop for user
  review if ACE and retail disagree on consumer-visible behavior or the observed collision model
  requires a materially broader gameplay simulation than contact/report production.
- Selected catalog provenance is ACE World base `v0.8.8`, patch `v0.9.294`, version
  `last_Modified = 2026-06-20 18:22:29`. The generated survey artifact remains local and is not a
  checked-in runtime asset.
- Correction: ACE `PropertyBool` value 1 is `Stuck`, not `Static`. `Static` is live
  `PhysicsObj.State`, and none of the 43,871 present template base masks set it. The bootstrap
  catalog therefore remains at eleven nullable physics overrides; no `Static` property or format
  revision is added.
- Collision reports use retail first-touch, silent-refresh, and expiry semantics rather than ACE's
  repeated callback behavior. Complete state replacement that removes reporting eligibility emits a
  forced end; restoring eligibility does not fabricate a start from stale contact data, and the next
  confirmed touch begins a new lifetime. Later implementation must carry a `RETAIL DIVERGENCE:`
  marker with the retail `set_state` citation and the state-transition fixture census.
- Correction: the live SQL follow-up found 103 of 104 missile templates carry
  `PropertyFloat::MaximumVelocity`, while five carry `RotationSpeed`; ACE consumes them to construct
  launch velocity/omega. Both optional scalars now live in the unreleased version-1 record, and the
  selected live database regenerated `dats/weenies.hwc`. Actual velocity and omega remain live
  instance state. Every retained field has a runtime or presentation consumer; the real 5.3 MiB file and
  sub-500-byte records still do not justify mmap, compression, streaming output, caching, or another
  index.
- Correction: the selected ACE database and production source paths provide no reachable `Static`,
  `Sledding`, or `Pushable` state change. Preserve those bits but reject local simulation when set;
  do not build speculative response or scheduling behavior. `Frozen` remains supported because ACE
  broadcasts it during delayed PK logout. Other proven state broadcasts remain in scope.
- Moving collision uses retail's dummy-or-first-two sphere path, while peer target geometry retains
  the complete retail branch: physics BSP, otherwise all cylspheres, otherwise all ordinary spheres.
  Dynamic narrow phase uniformly samples those branches with adaptive time slices; it does not add a
  second continuous time-of-impact implementation beside the existing time-sliced solver. Each pair
  derives its slice count from a conservative relative path length that includes translation and the
  rotational arc of each body's furthest collision point. Its pair slice distance is the smaller of
  the smallest participating moving/target collision scale and the 0.05 m runtime maximum. The solve
  has a 128-slice budget; a higher required count is an error. The measured 100 m/s opposing-velocity
  case requires 67 slices at 30 Hz. A larger integrated path rejects the directional solve before
  any pose, response, or report is committed.
- Each directional pair test samples both bodies' planned transforms from the same immutable
  tick-start snapshot, including orientation, so moving or rotating offset target geometry is not
  treated as stationary. A single query of the full-path conservative bounds supplies one stable,
  sorted/deduplicated candidate set; individual slices do not query the spatial index again.
- Correction: continuous swept contact was initially selected from the speed/radius census alone.
  Dry-running that choice against the solver showed it would introduce parallel collision machinery
  for sphere, cylsphere, and physics-BSP targets. Uniform bounded slicing reuses the solver's existing
  collision path and is sufficient for the measured first-population envelope. Continuous contact is
  deferred unless Phase R2 measurements demonstrate a case bounded slicing cannot serve.
- Dynamic broad phase reuses global 24 m outdoor cells and exact reached EnvCells. Stable directional
  body solves update only their own body; a peer response wakes the peer for bounded later
  convergence. No new spatial tree, atomic simultaneous batch, or EnvCell subdivision is added for
  the 50-300 body envelope.
- Settling requires one accepted stable tick with walkable support, canonical zero velocity/omega,
  no acceleration/drive, and no pending response/path. It skips integration/mover work only; target
  indexing and report expiry remain live. Phase 1B must name a host-owned dirty/update path for each
  supported animated physics-BSP or scale-changing-script combination; all others reject physical
  realization rather than retaining stale geometry.
- The representative real population is WCID 1 Clay, 21 Corpse, 147 Crate, 158 Large Urn, 239
  Brazier, 400 Carsith the Weaponsmith, 1499 Flame Bolt, 34621 Killagurg, 27437 Dark Monolith, and
  52077 Rynthid Assessment Crystal. The crystal is the measured animated-physics-BSP rejection;
  synthetic fixtures cover proven live-only states absent from the catalog and explicit rejection of
  representable-but-unproduced states.
- Completion audit reran the default offline survey from `dats/weenies.hwc` plus `dats/assets.hba`.
  Provenance, 43,913 records, 4,858,241 payload bytes, all 3,909 decoded setups, the four target-
  geometry populations, 99 effective masks, motion bounds, palette hazards, and scale hazards match
  the recorded evidence without a database connection. The local artifact remains ignored and its
  SHA-256 remains `a18482447dd77c70c0c7fb6088be72cbd2d85fbc1fad045b3049de2731817f5d`.

### Phase 1A: Close Survey-Discovered Catalog Gaps

Progress: Complete (2026-08-16). The unreleased version-1 record now retains optional maximum
velocity and rotation speed, both tools default to the canonical `dats/weenies.hwc` layout, and the
selected live ACE World database regenerated and revalidated the artifact.

#### Deliverables

- Extend the unreleased version-1 catalog record with optional finite `maximum_velocity` and
  `rotation_speed` values sourced from ACE World float property types 26 and 27. Preserve absence and
  explicit zero distinctly; do not store a direction, velocity vector, target, spell, or combat
  policy.
- Update the exporter query, semantic model, codec contract, fixed fixtures, and format documentation,
  then regenerate the canonical `dats/weenies.hwc` artifact from the selected live ACE World database.
- Keep `dats/weenies.hwc` beside `dats/assets.hba` as the canonical portable/install layout. Export
  and survey tools default there; Explorer Phase 3 derives the sibling catalog from the selected HBA
  directory unless an explicit app-local catalog override is supplied.
- Re-run the catalog/DAT survey and update its size/hash/distributions. Do not retain the
  pre-correction artifact or introduce catalog format compatibility for an unreleased local file.

#### Acceptance Criteria

- The default exporter atomically replaces `dats/weenies.hwc`, and the default survey reads it plus
  `dats/assets.hba` without path arguments or a SQL connection.
- Flame Bolt resolves maximum velocity 15 m/s; Whirling Blade resolves rotation speed 2 revolutions/s;
  Rockfall preserves explicit zero; Crimson Night Gem Setting preserves absence.
- Equal SQL rows and provenance still produce byte-identical files, every catalog fixture passes,
  and MySQL remains outside runtime dependencies.
- No launch vector, target identity, seeking behavior, combat state, or fallback speed enters the
  catalog.

#### Decisions and Course Corrections

- The catalog supplies launch magnitudes, not motion. Missiles remain ordinary solver bodies with
  live vectors. ACE tracking leads the initial shot from target velocity; it is not continuous
  seeking and is outside the first Explorer launch scenario.

### Phase 1B: Close the Mutable Target-Geometry Boundary

Progress: Complete (2026-08-16). The offline survey now expands all 23 distinct physics-BSP setups
with default behavior into exact setup/template identities, BSP part indexes, decoded default
animation, and transitive physics-script closure. The only physically mutable case is setup
`0x02001BF2`, whose 120-frame animation moves all nine BSP parts for WCIDs 52077, 52078, and 72157.

#### Deliverables

- Census the one physics-BSP setup with a default animation and the 23 physics-BSP setups with
  default scripts. Record the affected WCIDs, whether the animation moves physical parts, and which
  decoded script hooks can change scale or another collision transform.
- Trace how retail and ACE keep per-part physics-BSP transforms and script-driven scale synchronized
  with collision queries. Name the authoritative state owner and update path; do not make frontend
  presentation state authoritative input to the host solver.
- Select the smallest first-population boundary from the measured cases. Support a host-owned update
  only when existing decoded semantic facts can drive it cleanly; otherwise reject physical
  realization for the affected combination with WCID/setup/reason rather than freezing stale target
  geometry or adding a speculative host animation runtime.
- Update the physical-composite contract, representative WCIDs, and later collision acceptance cases
  with the selected supported and rejected combinations.

#### Acceptance Criteria

- Every catalog-reachable animated or script-mutated physics-BSP setup has a named supported update
  path or an explicit reachable rejection.
- Ordinary setup spheres and cylspheres remain root-pose/scale geometry and require no idle refresh.
- No frontend callback, diagnostic record, polling bridge, or second animation clock is introduced to
  feed collision truth back into the host.
- Phase 2 can freeze its physical facts without an unresolved owner for mutable target geometry.

#### Decisions and Course Corrections

- Retail and ACE own current part pose in the physics object's sequence/part array and consume that
  exact pose during physics-BSP collision. The browser animation clock is presentation authority and
  will not feed the host solver.
- The measured script closures contain only `CreateParticle`, `SoundTweaked`, and `CallPES`; none
  changes scale, root motion, collision state, or collision geometry. Their 49 script-only templates
  retain stable physical BSP geometry while presentation owns the effects.
- Solver-body preparation rejects setup `0x02001BF2` with WCID, setup, animation, and moving-part
  reason, even when current collision flags suppress the target because those flags are reversible.
  Bodyless visual realization remains valid. This is a three-template YAGNI boundary, not a reason
  to add a host animation/script subsystem.
- A future default script with a decoded `Scale`, `Ethereal`, `SetOmega`, blocking-particle, or other
  collision-relevant hook must gain an explicit host-owned update path or fail the same preparation
  boundary. Presentation-only hooks do not dirty collision geometry.
- Phase 2 dry-run found that ObjDesc animation-part substitutions apply after retail caches the
  setup-selected `HasPhysicsBSP` branch. The extended catalog/HBA census found zero BSP-changing
  substitutions, including the three crystal templates, so the measured branch and rejection remain
  valid. Prepared target geometry still applies appearance substitutions before resolving actual
  part shapes; it may not infer that ordering from the current zero population.

### Phase 2: Freeze Shared Entity and Physics Decisions

Progress: Complete (2026-08-16). The shared effective-state resolver, transition decision,
source-neutral definition and preparation path, prepared dynamic-body contracts, reversible scene
operations, synchronous committed outcomes, lossless client appearance/state integration, and
explicit `SpatialBodyId` ordering have landed. The final audit covers every retained semantic bit,
typed unsupported/missing-preparation dispositions, producer-neutral boundaries, field consumers,
and independently decoded but content-identical prepared geometry.

#### Deliverables

- Define the validated source-neutral dynamic-entity definition and prepared realization facts. They
  carry identity, appearance, placement, body, and presentation inputs, but no producer-registry
  handle, server/catalog provenance, Tauri type, or storage policy.
- Extract only the reusable operations proven by both compositions: content/body resolution,
  validation, body commands against a supplied `SpatialScene`, complete committed body outcomes, and
  pure projection inputs. Prefer focused functions, concrete values, and existing scene APIs.
- Replace movement-sphere-only assumptions with the smallest Phase R0-proven physical composite:
  movement/ground response geometry, dynamic-target geometry, scheduling eligibility, dynamic
  collision participation, response, and reporting are distinct decisions but one validated value.
  Reuse geometry when the authoritative branches are identical; do not duplicate it for type-shape
  convenience.
- Make stable target geometry a validated preparation result. Animated physics-BSP setup
  `0x02001BF2` produces a typed unsupported-physical-realization error carrying WCID, setup,
  animation, and moving part indexes; the same check runs when solver participation is initially or
  later enabled. A semantic/bodyless entity does not invent target geometry or lose presentation.
- Add the pure effective-physics-state resolver and state-transition decision from the Phase R0
  matrix. Initial Explorer catalog resolution and existing client `SetState` updates invoke the same
  logic; neither producer re-derives bit semantics.
- Give `SpatialBodyId` one explicit total order consumed by fixed ticks, candidate deduplication, and
  collision lifecycle keys. Hash-map or registration iteration order is never observable.
- Add the lossless semantic appearance composite currently discarded by the client `Entity`, with
  explicit ordered substitutions and source content identities required by presentation. The shared
  projection consumes the composite without owning either producer registry.
- Return committed solver outcomes synchronously from the existing body operations. Let registries
  consume only named semantic consequences; never copy the complete physical state into them or add
  an internal publisher without a concrete asynchronous consumer.

#### Acceptance Criteria

- Equal source facts produce equal definitions, physical-participation decisions, transition
  decisions, and committed-outcome shapes without consulting either producer registry.
- Every retained field has a named solver, presentation, or projection consumer; unsupported mutable
  target geometry follows the Phase 1B boundary rather than acquiring an implicit fallback.
- The effective-state and transition fixtures cover every representative bit combination, preserve
  unknown/unsupported semantic truth, and never flatten collision, response, reporting, or scheduling
  into one boolean.
- Catalog, SQL, Explorer registry/scenario, Tauri, and frontend types are absent from shared
  world/core contracts.

#### Decisions and Course Corrections

- Effective physics state retains the source mask and unsupported/unknown truth while deriving
  scheduling, collision participation, response, reporting, and presentation independently. Client
  `SetState` and Explorer-ready preparation use the same resolver and transition decision.
- Prepared target geometry and physical-body definitions live in `holtburger-world`, which owns
  `SpatialScene`; `holtburger-core` remains the content-resolution and source-neutral operation
  adapter. This avoids a dependency inversion where the scene would need core-owned types.
- Acceleration is now part of the canonical body kinematics composite instead of an out-of-band
  producer fact. Body operations return committed outcomes synchronously; no diagnostic history or
  internal asynchronous publisher was introduced.
- Prepared geometry compatibility uses immutable SetupModel/GfxObj identities plus placement facts,
  not decoded `Arc` pointer identity. Re-preparing the same content therefore preserves compatible
  response memory instead of manufacturing a geometry change.
- Stop for user review if sharing requires either producer to surrender authority, either
  `SpatialScene` to move between compositions, an async backend event bus, or a generic runtime
  hierarchy. The intended seam is value contracts and operations, not a shared runtime owner.

### Phase 2A: Make `SpatialScene` the Canonical Body Authority

Progress: Complete (2026-08-16). Optional physical participation and focused
enable/disable/reconfigure solver-participation operations are implemented. The separate entity-pose side store has been
removed; registration, accepted movement, solver commits, suspension, reset, and removal now maintain
coarse landblock membership from the canonical body pose. The client `SetState` path exercises the
shared reversible transition. Focused tests prove runtime and solved pose movement, removal cleanup,
boundary landblocks, canonical range queries, physical replacement, and Explorer-style ephemeral
camera/entity coexistence; the stale side-index and direct-mutation audits are clean.

#### Deliverables

- Make collision/physics state explicitly optional and reversible on an existing `SpatialBody`.
  Add one focused add/remove/reconfigure operation that returns the old/new solver participation,
  preserves compatible pose/kinematics, and clears only invalid response memory.
- Collapse `SpatialScene::entity_poses` into canonical body poses. Route registration, accepted pose
  updates, physical-state replacement, teleport, and removal through scene operations that maintain
  every derived membership; delete caller-side index choreography.
- Keep `WorldState`'s `EntityManager` and `SpatialScene` composition intact while adapting its existing
  body and `SetState` paths to the Phase 2 decisions and outcomes. This proves structural reuse without
  implementing server spawning.
- Add the focused host operation for a caller-supplied `SpatialBodyId::Entity`; the host simulation
  never allocates or rewrites producer identity.

#### Acceptance Criteria

- Every body pose mutation updates or invalidates all derived memberships atomically; no stale
  `entity_poses`, landblock, outdoor-cell, or EnvCell entry survives.
- Toggling supported gravity/collision/response/scheduling facts installs, detaches, or reconfigures
  physical state once without removing the semantic entity or pose body.
- Existing client `SetState` fixtures use the shared transition decision, retain unsupported server
  truth while retiring invalid local simulation, and pass without moving either client store.
- Explorer camera and entity IDs can coexist in the host scene under explicit policies, while the
  client retains its separate scene.

#### Decisions and Course Corrections

- A live simulated entity keeps its pose body and disables only solver participation. Removing the
  body would violate the invariant that every live dynamic entity has one canonical pose.
- Landblock membership is derived inside `SpatialScene` from each accepted canonical body pose.
  Producer mutations no longer maintain a parallel pose/index choreography.
- Canonical owner normalization exposed that the previous neighbor scan excluded coordinate-zero
  landblocks and depended on an exact-key fallback to mask it. The scan now includes the full byte
  range, and boundary coverage is retained as an acceptance fixture.

### Phase 2B: Land Explorer Registry and Lifecycle

Progress: Complete (2026-08-16). The app-local `ExplorerEntityRegistry` owns bounded GUID
allocation, monotonic instance generations, current source-neutral definitions, replacement, and
reset. `ExplorerEntityRuntime` orders it over the existing `HostSimulationRuntime`, publishes only
after body installation, joins solver facts only during projection, compensates failed same-GUID
body replacement, and removes an exact generation once. Focused tests cover range reset/exhaustion,
same-WCID independent spawns, pose-only and physical bodies, failed installation, replacement,
late-generation rejection, despawn, and full reset.

#### Deliverables

- Add the app-local `ExplorerEntityRegistry` as Explorer's sole semantic instance authority. It owns
  identity, lifecycle, current source-neutral facts, replacement policy, and instance generation; it
  is not a Tauri DTO cache or a narrowed `WorldState`.
- Add app-local Explorer GUID allocation and prove reset, repeated spawn, same-WCID independent
  identity, same-GUID replacement, and exhaustion. Shared types accept identity but never allocate it.
- Make spawn, complete replacement, and despawn ordered at the outer producer runtime. Preparation
  completes before mutation, unexpected unpublished partial installation is compensated, and a
  retired instance generation rejects late outcomes.
- Join registry semantics with current scene facts only at projection time. The registry consumes
  named semantic consequences and never mirrors complete solver state.

#### Acceptance Criteria

- Explorer does not construct, wrap, or depend on `WorldState`; its registry is its only semantic
  authority and `HostSimulationRuntime` remains its only body store.
- Failed preparation or installation publishes nothing and leaves no semantic/body residue.
- Successful physical spawn becomes publishable only after both its semantic record and
  `SpatialBodyId::Entity` exist; pose-only spawn remains a valid lifecycle.
- Despawn and replacement remove the old semantic/body generation exactly once, and late work cannot
  mutate its successor.

#### Decisions and Course Corrections

- Explorer GUIDs use an app-local bounded `0xF0000001..=0xFFFFFFFE` range. The range and allocator do
  not enter shared contracts; focused tests inject a tiny range to prove exhaustion without an
  artificial production limit.
- Instance generations never reset, even when GUID allocation resets. A reused GUID therefore
  cannot make work from a retired pre-reset instance current again.
- Lifecycle lock order is registry then host simulation. Later fixed-tick adapters must check the
  generation before and after the scene transaction and must not call the registry while the scene
  lock is held; this prevents a registry/simulation lock inversion without adding a combined owner.
- The registry retains no pose, participation, response, or collision state. Snapshot/projection
  holds the semantic generation stable while reading the canonical body from host simulation.

### Phase 3: Compose the Catalog-Backed Explorer Host

Progress: Complete (2026-08-16). The app-local driver now serializes catalog lookup, setup/DAT
preparation, host-owned placement, spawn, same-GUID complete replacement, despawn, reset, and
complete physics-state replacement over the Phase 2B runtime. Production composition discovers the
optional canonical `weenies.hwc` sibling (or an explicit `HOLTBURGER_WEENIE_CATALOG` override),
retains missing versus invalid capability reasons, and has no MySQL/MariaDB/SQL runtime dependency.
Focused host tests cover missing WCID, preparation failure, equal repeated-WCID realization,
replacement, despawn, state attach/reconfigure/detach, catalog selection, and override precedence.

#### Deliverables

- Add an app-local Explorer entity driver that resolves a catalog template plus DAT/setup facts into
  the Phase 2 definition and invokes shared body operations against the Explorer registry and
  host simulation. Dependencies—catalog, content, clock, identity allocator, registry, host
  simulation—are injected. The driver obtains collision snapshots through the host simulation rather
  than a parallel service.
- Add app-local catalog discovery/configuration and capability reporting. The default is
  `weenies.hwc` beside the selected HBA content: join it to a selected directory or use the parent of
  a selected `.hba` file. An explicit app-local catalog override wins. Do not scan for arbitrary
  `.hwc` files or teach `ContentRepository` about the catalog. Absence disables only Explorer WCID
  spawning; malformed or incompatible configured files report their exact failure, and MySQL remains
  absent from the Tauri host's runtime dependency graph.
- Add focused host operations for catalog capability, reset, spawn-by-WCID-at-candidate-pose,
  despawn, and complete effective-physics-state replacement. The
  Explorer spawn request carries the current host-projected camera pose as a prior-cell hint plus an
  explicit candidate point; the host normalizes outdoor coordinates and resolves final EnvCell
  placement through existing collision transit. The operations serialize through the driver and
  never mutate a second entity store. Complete replacement is exercised through focused production
  contracts unless an Explorer scenario proves it needs its own command.

#### Acceptance Criteria

- Catalog absence disables only Explorer WCID creation with an exact capability reason; malformed or
  incompatible configured files fail distinctly and MySQL is absent from runtime dependencies.
- Equal catalog/setup/request facts create equal prepared definitions and committed host outcomes.
- Camera-relative spawning performs no frontend landblock normalization or portal traversal; the
  committed entity pose is the host-resolved result or one exact failure.
- Host composition tests cover missing WCID, preparation failure, repeated WCID identities,
  replacement, despawn, and catalog override precedence without requiring Tauri or a browser.

#### Decisions and Course Corrections

- Catalog discovery has a deterministic constructor that accepts an already-resolved override and a
  separate production constructor that reads `HOLTBURGER_WEENIE_CATALOG`. Operator environment can
  therefore select the exact asset without contaminating injected tests or introducing scanning.
- Setup-only preparation resolves the placement sphere for every entity. Pose-only realization does
  not prepare solver target geometry, which keeps WCID 52077 eligible for later bodyless visual
  realization while enabling solver participation still crosses the strict geometry boundary.
- The authoritative ACE `WeenieType` domain extends through `CombatPet = 71`, not the client's old
  `LifeStone = 25` endpoint. The shared enum now represents the complete ACE numeric domain; an
  out-of-domain catalog value fails before publication instead of being narrowed by the Explorer.
- Identity allocation remains owned by `ExplorerEntityRegistry` and reaches the injected driver
  through `ExplorerEntityRuntime`. A separately injected driver allocator would split identity
  authority and make reset/replacement policy easier to violate; focused registry construction still
  injects bounded ranges for exhaustion tests.
- Complete replacement is a focused production driver operation but is not exposed as an Explorer
  command. The current UX has no replacement scenario; Phase 3A exposes only the lifecycle commands
  a named frontend consumer needs.
- Failed preparation may consume an Explorer GUID without publishing it. GUIDs are cheap bounded
  session-local identities, while trying to reclaim them would couple fallible preparation to
  allocator rollback. Reset deliberately restarts GUID allocation, and monotonic instance
  generations preserve late-work safety across reuse.

### Phase 3A: Land Focused Projection and Frontend Hydration

Progress: Complete (2026-08-16). `holtburger-core` now owns one serializable source-neutral entity
view, stable snapshot, pure projector, host-timeline anchor, and snapshot/upsert/remove grammar. The
client adapts its `WorldState` entity/body facts into the focused feed while retaining unrelated
`ClientViewEvent` consumers; Explorer projects its distinct registry/body join directly. Typed Tauri
commands expose catalog capability, snapshot request, spawn, despawn, reset, and complete physics
state replacement. `ExplorerApp` installs the listener before requesting state, and the frontend
mirror ignores deltas while awaiting an atomic replacement snapshot. Focused Rust and TypeScript
tests cover equal client/Explorer projection, current-state hydration, deltas around hydration,
listener remount, stale generations, duplicate snapshot identities, wire casing, and preservation of
the broader client entity event.

#### Deliverables

- Define one source-neutral projected entity composite, focused `DynamicEntitySnapshot`, and focused
  incremental event grammar in `holtburger-core`. Projection is a pure join over semantic facts,
  current solver facts, and immutable asset identities.
- Adapt the client to carry this focused surface inside its broader initial-view and `ClientViewEvent`
  paths. Explorer relays the focused surface directly; it does not construct `ClientRuntime`, request
  fellowship/vendor/trade state, or reuse the whole client feed.
- Replace runtime-body-only reset/snapshot vocabulary only where the focused dynamic snapshot
  supersedes it. Do not generalize unrelated client snapshot machinery.
- Add typed Tauri commands for the Phase 3 host operations and one narrow delivery relay. Register the
  frontend listener before requesting current state so initial mount and webview remount share one
  hydration path.
- Test mutation before/after snapshot, deltas while awaiting hydration, listener remount, and
  unrelated event preservation.

#### Acceptance Criteria

- One focused snapshot reconstructs every projected dynamic entity/body without replay history, and
  no entity delta applies while awaiting replacement.
- Explorer and client projection produce equal view entities from equal source-neutral semantic and
  body facts.
- Tauri carries projected contracts, not raw catalog records, MySQL rows, or `Entity` dumps.
- No intermediary channel, feed sequence, acknowledgement, automatic recovery, diagnostic event log,
  or retained delivery history exists without a measured requirement.

#### Decisions and Course Corrections

- The focused presentation identity contains GUID, WCID, and resolved name but not `WeenieType`.
  ACE object creation does not supply the server template category, and presentation has no named
  consumer for it; Explorer retains it in the semantic definition where dynamic collision filtering
  does consume it. Projecting it would force the client to invent source data.
- Snapshot capture and actual Tauri publication share one app-local ordering gate with every Explorer
  mutation publication. Without it, async command continuations could publish a later delta before
  the snapshot baseline, causing the awaiting frontend to discard the only evidence of that
  mutation. The gate retains no events, sequence, acknowledgement, replay, or diagnostics.
- Focused remove events carry the retired producer generation. This lets a late Explorer command
  continuation or client event remove only its own instance rather than a same-GUID successor; no
  permanent tombstone or global feed sequence is required. The client uses its server object-instance
  sequence, while Explorer uses its monotonic app-local generation.
- The snapshot's composition-local monotonic host instant is paired with frontend receipt time and
  retained as one clock mapping by the mirror. Untimed upsert/remove events do not carry a field with
  no current consumer; this plan adds no absolute semantic-motion time. The deferred authored-root-
  motion plan may extend timed facts only after naming their consumers.
- The existing client runtime-body snapshot/deltas remain for the TUI's `RuntimeBodyViewCache`, which
  also carries local-player concerns outside this focused presentation feed. They are not reused by
  Explorer and are deferred to the Phase 8 consumer audit rather than deleted prematurely.

### Phase 4: Generalize and Reuse Frontend Dynamic Presentation

Progress: Complete (2026-08-16). The source-neutral presentation input, authored and spawned
adapters, host `HBDV` visual closure, sole dynamic-root placement writer, atomic visual/behavior
staging, focused mirror-to-runtime reconciliation, presentation-state consequences, dynamic setup
lights, and initial `Entities` panel are implemented. Focused TypeScript/Svelte checks and 47 tests
cover decoding, coordinate conversion, source adaptation, placement ownership, shared visual loads,
same-GUID replacement, late-load removal, state transitions, and script staging. The canonical
browser harness spawned real catalog WCID 239 (`Brazier`) through the app-local host and `HBDV`
boundary, rendered its ten parts in front of the camera, and exactly despawned it. Current-entity,
dynamic-runtime, effect-state, and template counts returned from one to zero with no browser error;
the captured image was inspected rather than inferred from renderer counters. The complete app gates
pass: 1,092 TypeScript tests, 136 Rust tests, Svelte/TypeScript checks, Prettier, ESLint/Knip, and
Clippy with warnings denied.

#### Deliverables

- Extract one source-neutral dynamic presentation input from `AuthoredDynamicSource`: visual
  template identity/input, behavior references, scale, local bounds, and initial presentation facts.
  Authored and spawned adapters compute it at their existing boundaries.
- Keep authored placement/scope ownership in the authored adapter. Add a spawned current-entity
  mirror and placement adapter; do not add placement/scope optionals to the common visual input.
- Feed spawned owners through the existing content-addressed `ObjectVisualTemplateRepository` and
  `DynamicEntitySystem`. Retain one owner generation per live entity identity.
- Stage complete visual, default animation, script closure, emitter, sound-table, texture, geometry,
  and atlas dependencies before atomic publication. Late or failed work cannot publish after
  despawn/replacement/resnapshot.
- Add one frontend placement subsystem as the sole entity-root transform writer. Initially it may
  publish the accepted spawn pose; Phase 5 adds solver paths without replacing this owner.
- Wire snapshot reconciliation and focused spawn/despawn/replacement events into `GameRuntime`.
- Replace the existing `ExplorerTools` `entities` stub with a focused
  `ExplorerEntitiesPanel.svelte`. Show catalog availability/provenance, accept one decimal or `0x`
  WCID, and spawn at an explicit camera-relative distance along the current view direction. Explorer
  policy snapshots the host-projected camera anchor and computes the candidate point once; the host
  resolves the final landblock/EnvCell placement. The host never reads camera UI state or invents
  placement defaults, and the frontend never performs portal traversal.
- Show the current spawned entities from the frontend mirror with GUID, WCID, resolved name,
  lifecycle/physical status, selection, and per-entity despawn. Report lookup, preparation, and spawn
  failures inline with WCID/provenance; do not expose raw catalog records or add name/type search.
- Project and apply only the presentation-owned consequences of effective physics-state replacement,
  including the Phase R0-proven no-draw/hidden/cloaked/lighting/default-behavior effects. The frontend
  never interprets collision, gravity, scheduling, or response bits.
- Decide spawned effect teardown against the named scenarios, with retail destruction evidence:
  instant emitter teardown unless a concrete product scenario justifies drain-then-reap.

#### Acceptance Criteria

- A catalog-backed setup renders with its complete appearance and default behavior across the real
  Tauri/browser boundary before solver motion is enabled.
- Authored dynamic residents pass unchanged through the generalized input and retain fixed authored
  placement/residency.
- Same-WCID entities share immutable template/assets and retain independent playback/effect/pose
  state.
- Despawn, same-GUID replacement, resnapshot removal, and preparation failure leak no node, geometry,
  atlas, animation, script, emitter, audio owner, bound, or pending stage.
- Presentation-visible physics-state transitions match the retail `set_state` census without
  rebuilding unrelated entity state.
- With a valid catalog, one direct WCID submission from the `Entities` tab spawns a visible entity in
  front of the camera, adds it to the current list, and allows exact-identity despawn. Catalog absence
  disables the form with the host-provided reason while the list remains usable.
- No second dynamic entity system, template repository, animation system, effect system, renderer
  route, or entity mirror authority exists.

#### Decisions and Course Corrections

- `DynamicPresentationSource` contains only source-neutral immutable visual/behavior facts. Authored
  and spawned adapters retain placement and producer identity policy outside that contract; no
  placement optional or Explorer scope concept was added to the shared visual input.
- `GameRuntime` reuses its one `ObjectVisualTemplateRepository`, `DynamicEntitySystem`, animation,
  script, particle, effect, audio, geometry, texture, and atlas paths. Spawned reconciliation retains
  generation/currentness and resource-key metadata only; the `DynamicEntityMirror` remains the sole
  frontend semantic current-entity authority.
- The session emits a state-change notification only after the mirror accepts an event. Svelte keeps
  a current view projection, not an event log or diagnostic history. Reconciliation errors replace
  one inline current error and carry the affected WCID set plus catalog provenance.
- Complete visual and behavior dependencies, including particle meshes, are staged before the
  synchronous owner commit. Replacement/despawn destroys existing emitters immediately and removes
  animation, script, sound-table, dynamic-root, template, atlas, and geometry ownership through the
  same owner retirement path.
- Retail `CPhysicsObj::set_state` mutates only lighting, no-draw, and hidden presentation state
  (`acclient.c:310307-310344`); `CPhysicsPart::SetTranslucency` ignores writes while cloaked
  (`acclient.c:303936`). The frontend therefore suppresses draws for no-draw/hidden, preserves the
  last part translucency while cloaked, and does not invent cloak alpha. Default setup animation and
  script activation remain setup-owned initialization rather than being restarted by state-bit
  replacement.
- Dynamic setup lights follow the current unscaled object frame. Retail copies the object frame into
  each `LIGHTOBJ` (`LIGHTLIST::set_frame`, `acclient.c:312960-312970`) while
  `CPartArray::SetScaleInternal` changes only part gfx scales (`acclient.c:313765-313806`). Lighting
  state enables or removes the setup lights independently from no-draw/hidden, matching
  `CPhysicsObj::set_state`.
- Explorer spawn UX accepts only decimal or `0x` WCIDs and an explicit visible distance. It snapshots
  the currently presented camera once, converts canonical scene position and view direction into AC
  landblock-local coordinates, sends identity candidate orientation, and requests explicit
  `pose-only` participation. The host remains the only portal/EnvCell placement authority; Phase 5
  changes the explicit physical intent without replacing this UI/host placement seam.
- The canonical browser harness reuses the existing host composition and dynamic visual endpoint.
  Its `--brief` report projects only current identities and named lifecycle counters; it does not
  retain event history or add production diagnostics. Replacement/resnapshot and shared-resource
  teardown remain covered at the owning unit boundaries rather than growing a diagnostic registry
  to restate those owners.

### Phase R1: Visible-Entity Resteering Checkpoint

Progress: Complete (2026-08-16). The real host/browser matrix exercised all ten Phase R0 WCIDs.
Clay (1), Corpse (21), Crate (147), Large Urn (158), Brazier (239), Carsith the Weaponsmith (400),
Killagurg (34621), and Rynthid Assessment Crystal (52077) rendered and returned entity/effect/
template ownership to baseline after exact despawn. Flame Bolt (1499) also completed the same
lifecycle, but its small visual is rejected by the normal 64-square-pixel footprint policy at five
meters; setting the existing harness threshold to zero made it visible without a product/runtime
special case. Dark Monolith (27437) rejected before publication because its authored zero scale
cannot produce valid movement geometry. The crystal remains a valid bodyless animated visual;
its measured moving physics-BSP rejection belongs only to initial or later local physical realization.

The schema audit found no format change. Every field is consumed by current definition,
presentation, physical preparation, or the committed launch/motion phases; `class_name` remains the
one explicitly retained source-provenance field used by the offline survey and never substitutes for
the optional display name. The frontend hydration path installs the listener before requesting one
current snapshot, and remount tests reconstruct from that snapshot without replay. Host tests cover repeated
same-WCID identities, complete replacement, stale-generation rejection, reset, solver-participation
enable/reconfigure/disable, and compensation before semantic publication. Frontend tests now assert that two equal
WCIDs share one template, one surviving owner retains it, and final removal releases it.

- Exercise the Phase 4 vertical slice with every Phase R0 representative WCID and record unsupported
  or malformed source facts by WCID.
- Audit the catalog schema: delete exported fields without consumers; add no field without updating
  its producer/consumer table and format version decision.
- Audit lifecycle ownership and resource release under repeated spawn/despawn/replacement and
  frontend remount before solver state adds another mutable subsystem.
- Re-dry-run Phases 5-7, including Phases 5A-5D, against the landed value/event contracts, Explorer
  registry, relay, and frontend placement contracts.
- Reconcile the Phase R0 collision design against the now-landed body/event contracts before Phases
  5B-5D; do not let frontend integration accidentally dictate solver shapes.

#### Decisions and Course Corrections

- Phase 5 builds on already-landed setup preparation, pose-body registration, optional solver
  participation, and complete physics-state transition operations. It must not replace those seams with
  a scheduler-owned entity registry.
- One Explorer collection participant will enter one `HostSimulationRuntime` collection transaction
  per fixed tick. That transaction captures stable eligible IDs and an immutable tick-start body
  snapshot once, then commits accepted directional body solves independently in stable ID order.
  This preserves the Phase R0 pair-sampling contract without requiring atomic whole-world rollback
  or repeatedly acquiring the simulation lock.
- Fixed-tick motion extends the existing `DynamicEntityEvent` channel with one changed-entity batch;
  it does not add a second relay or emit one event per entity. Lifecycle upsert/remove events remain
  distinct from high-frequency accepted placement paths.
- Extract the placement-point/leg validation and evaluation core from the existing physical-camera
  path contract. Camera and entity envelopes keep their own identity/status fields, but there will
  not be a second portal-path interpolation implementation in the frontend.
- Phase 5B extracts the existing global 24 m cell key/range primitive from `collision.rs` for both
  static and dynamic shadow indexes. `SpatialScene` owns the dynamic membership maps; the existing
  coarse landblock membership is not precise enough and is not repurposed as the peer broad phase.
  Exact reached-EnvCell membership continues to come from `CollisionPlacement`.
- The focused Flame Bolt evidence may disable the existing footprint threshold when visibility is the
  fact under test. Normal Explorer rendering retains shared object-culling policy; a semantically live
  entity is not guaranteed to contribute a draw at every camera distance.

### Phase 5: Enable Spawned Entities in the Shared Solver

Progress: Complete (2026-08-17). `SpatialScene` derives one stable sorted eligible-entity scan from
enabled physical state; one Explorer participant captures tick-start bodies and one immutable
collision snapshot under a single collection transaction; pose-only and frozen entities consume no
solve. Changed accepted results publish at most one `advanced` batch on the existing focused feed.
The frontend mirror accepts only newer exact-generation advances, while the sole dynamic-placement
owner evaluates their placed paths at render cadence using the path core extracted from physical
camera presentation. Late visual readiness installs the mirror's latest accepted endpoint rather
than retaining spawn-time pose.

Catalog-backed launch now normalizes the explicit scenario direction, applies optional maximum
velocity, converts ACE rotation speed from revolutions per second to world-X radians per second, and
clears align-path when spin is present. Flame Bolt (1499) launched at exactly 15 m/s. Whirling Blade
(1636) launched at 15 m/s with 12.566371 rad/s omega and rotated 24 degrees during one 33.333333 ms
tick. Missing, zero, and invalid launch inputs reject only the operation. Generation-stable
teleport/reset operations reuse one scene relocation primitive, atomically update coarse membership,
clear pose-dependent response and kinematics, and publish one zero-duration snap correction; a live
Flame Bolt reset preserved identity/generation and cleared velocity, acceleration, and omega.

The HTTP scenario host now installs the same revisioned camera-centered simulation-interest owner set
as the production host before physical spawn. A real Killagurg (34621) became visible immediately,
fell from z=65.11325 to z=20.00715 through the shared solver, reached grounded canonical zero velocity
on changed tick 102, emitted no change for ticks 103-120, and exact-despawned back to zero entity,
template, and effect ownership. Existing focused solver fixtures cover supported floor, steep slide,
airborne fall, cross-owner traversal, missing-owner open space, and teleport/reset. Rust world/core/
host suites, focused frontend feed/session/placement suites, Clippy with warnings denied, Svelte/
TypeScript checks, and formatting pass. Phases 5A-5D remain.

#### Deliverables

- Build on the landed resolution of the spawned template's SetupModel and runtime scale through the existing content service;
  resolve its ordinary motion spheres through `resolve_setup_physical_spheres`; combine them with the
  current effective physics state to select the Phase R0-proven physical participation and response.
- Build on the landed registration of every entity pose as `SpatialBodyId::Entity` in `HostSimulationRuntime`'s existing
  `SpatialScene`; attach solver state only when selected by the effective physics state. The camera
  remains `Ephemeral`; both use the same Explorer-local store and immutable collision snapshot when
  physically participating.
- Apply complete physics-state replacements through the Phase 2 reconciliation operation. Exercise
  at least attach, detach, gravity on/off, collision participation on/off, frozen/unfrozen, and every
  response-policy transition present in the representative census. Preserve pose and compatible
  velocity; clear incompatible contact, response, path, prediction, and scheduler state exactly once.
- Add the focused Explorer launch scenario: an explicit direction plus positive catalog maximum
  velocity produces live velocity; nonzero rotation speed produces live omega and disables
  align-path as ACE does. Ordinary spawn remains at rest. Missing or zero launch speed rejects only
  the launch operation, not a pose-only spawn.
- Add one Explorer dynamic-entity collection participant using one `HostFixedTickRuntime` slot. Each
  epoch it enters one host collection transaction, snapshots explicit simulation interest, obtains
  the stable eligible-body order and immutable tick-start body facts, resolves current actuation,
  invokes focused solves, rejects outcomes from retired instance generations, and collects committed
  placed-path/body outcomes. No entity reserves its own scheduler slot or reacquires the host
  simulation lock independently.
- Preserve the landed ground vocabulary and contact plane. Supported/sliding/airborne is derived by
  the local solver; catalog and scenario commands cannot assert it.
- Route teleport and forced reset through explicit registry/body operations that clear response,
  prediction, path, and frontend correction state coherently.
- Add app-local scenario simulation-interest policy around named entity/camera owners. Bodies report
  `MissingOwner`/`OutsideLandscape` without loading, suspending, or evicting collision.
- Extract source-neutral placed-path point/leg validation and evaluation from the existing physical
  camera path implementation. Serialize accepted entity paths or sparse anchors with host time and
  correction kind; frontend placement evaluates the shared path core at render cadence and never
  performs portal traversal.
- Add one changed-entity batch variant to the existing focused dynamic-entity event channel and emit
  at most one such batch per fixed tick. Do not turn 300 bodies at 30 Hz into 9,000 Tauri events per
  second or create a parallel motion relay.
- Add deterministic zero-actuation settle/fall/slide scenarios before locomotion: supported floor,
  steep contact-slide, airborne fall, cross-owner traversal, missing-owner open space, and teleport.

#### Acceptance Criteria

- A spawned creature falls or settles through the existing physical solver and visibly follows the
  accepted placed path without per-frame host messages.
- Flame Bolt launches at 15 m/s along the explicit scenario direction; Whirling Blade receives its
  2-revolutions-per-second omega; Rockfall's explicit zero and Crimson Night Gem Setting's absent
  speed both reject launch without preventing ordinary pose-only spawn.
- A pose-only entity remains present and visible to projection with no collision/physics state; enabling and later
  disabling its supported physics state attaches and detaches solver participation reversibly.
- Camera and entity bodies coexist in the Explorer host store and can tick against the same exact
  collision snapshot without affecting each other's identity or response state.
- One collection scheduler registration visits every eligible Explorer entity; frozen and pose-only
  bodies consume no integration solve, no entity consumes its own scheduler slot, and one tick
  produces at most one Tauri advance event.
- A hard-rejected solve produces no committed outcome. A bounded grounded solve with residual contact
  is accepted, remains active, and converges through later substeps or ticks. A frontend delivery
  failure leaves accepted solver state intact and converges through the focused snapshot.
- Ground state is locally derived and the old `apply_runtime_body_contact` stopgap loudly refuses to
  overwrite a physically simulated entity.
- Missing collision content remains explicit open-space residency and does not gate motion.
- Every physics-state bit occurring in the representative population or mutation scenarios has its
  Phase R0-proven behavior; unsupported combinations fail explicitly before publication.
- Animation, effects, renderer, and frontend scene code never write authoritative entity placement.

#### Decisions and Course Corrections

- A Tauri advance-publication failure is reported immediately but does not unregister the collection
  participant or roll back already accepted solver state. A later frontend hydration snapshot
  supplies current state; retaining failed events or adding delivery diagnostics would create a
  second history.
- Transient path playback lives only in `DynamicEntityPlacementSystem`. The semantic mirror retains
  the latest complete endpoint, and `GameRuntime` retains that desired current view while visual
  preparation is pending. No path queue/history is required for late resource readiness.
- The current collection solve still sees static collision only. Its tick-start body capture is the
  input seam Phase 5B/5C will use for directional peer candidates; this progress does not claim
  body-body collision early.
- ACE projectile omega is a world-X angular velocity. Retail `CPhysicsObj::update_object` scales
  `m_omegaVector` and `Frame::grotate` left-multiplies the delta quaternion; treating it as a local
  axis would produce the wrong orientation for already-rotated bodies.
- A collidable no-gravity body is valid. `GroundedConfig` therefore accepts finite non-positive
  gravity rather than requiring a negative value; zero preserves ordinary collision while retaining
  explicit linear airborne motion. The former validation contradicted the catalog's independent
  Gravity and collision-participation flags.
- Integrated advance batches require positive duration. Teleport/reset correction batches use zero
  duration because they describe a snap, not elapsed simulation. The shared frontend path validator
  accepts that shape only for correction kinds and clears any active interpolation.
- Teleport and reset share the same scene-owned state mutation and differ only in the published
  correction semantic. The host resolves the destination through current setup movement geometry;
  the frontend never performs portal traversal or asserts contact.
- Same-generation commands wait for an accepted feed revision later than command invocation. Merely
  observing the already-current generation is insufficient proof that launch or relocation delivery
  completed.
- The browser harness captures one immediate post-spawn state for visual/lifecycle assertions and one
  post-operation state for the final physical outcome. Tick evidence is reduced to counts plus the
  first and last changed batch; no production or harness diagnostic history is introduced.
- Any deliberate observable retail departure requires the project's
  `RETAIL QUIRK` or `RETAIL DIVERGENCE` marker with decompile citation, consequence, and census.

### Phase 5A: Add Settled-State Pruning and Wake Reconciliation

Progress: Complete (2026-08-17). Dynamic-only physical state now pairs the existing prepared
collision definition with a crate-owned `Active | Settled` activity value; app and producer code
cannot manufacture activity or project it into semantic/frontend state. Because R0 selected one
stable accepted tick, no counter is retained. The accepted-tick commit settles only after walkable
`GroundState::Supported` remains unchanged, velocity/acceleration/omega are canonical zero, no
motion snapshot or actuation remains, and every accepted path point equals its initial point.
Support acquisition, placement repair, airborne/sliding response, explicit drive (including zero
drive), acceleration, omega, launch, and any changed response therefore remain active.

The existing stable body-store scan now filters settled bodies while retaining them in the canonical
scene and coarse memberships. Kinematic replacement, authoritative vectors/motion, runtime pose,
contact projection where permitted, relocation/reset, physical replacement, and explicit scene wake
operations reactivate through `SpatialScene`. A committed simulation-interest residency change wakes
all settled dynamic bodies; no support graph is retained. A reverse-insertion 300-body fixture proves
stable ordering with 150 settled bodies skipped and all 300 bodies still present. The real Killagurg
scenario remains presentation-identical after pruning: 102 changed fall/landing ticks, then no
changed batches through tick 120, with exact teardown to zero ownership. The 350-test world suite,
cross-crate checks, Clippy with warnings denied, formatting, and the browser scenario pass.

#### Deliverables

- Add solver-owned active/settled state containing only the minimal consecutive-stability evidence
  required by the Phase R0 predicate. Scheduling eligibility remains a separate effective-state
  result, and producer registries never mirror activity.
- After accepted solves, settle only bodies with stable walkable support, canonical zero
  velocity/omega, no acceleration or drive, and no pending response/path. Retain the stable collection
  scan while skipping integration and mover queries.
- Centralize wake invalidation in scene/body operations for drive, launch, velocity/acceleration/omega,
  teleport, physical reconfiguration, and loaded static collision changes. Conservatively wake all
  settled bodies after a relevant loaded-scene change; do not add support graphs or sleep islands.
- Keep presentation, animation, target indexing, and later collision-report lifetime independent from
  root integration.

#### Acceptance Criteria

- A settled body retains identity, pose, presentation, spatial memberships, and target eligibility
  while consuming no integration solve.
- Airborne, sliding, responding, accelerating, driven, or path-following bodies cannot settle.
- Every proven wake input reactivates through one scene-owned operation before its required solve;
  producer registries perform no wake choreography.
- The 50/300-body path still uses one stable collection scan and no second active-body registry,
  per-body timer, dependency graph, or production activity metric.

#### Decisions and Course Corrections

- The one-tick R0 threshold collapses the minimal evidence to a two-state activity value; retaining
  a stable-tick count would be dead state. Activity is grouped with dynamic-only collision state so a
  generic camera body cannot accidentally acquire it, but remains crate-private so registries and
  frontends cannot become competing authorities.
- The tick that first acquires support does not settle even if its final vectors are zero: its
  response or collision placement changed. One subsequent unchanged accepted tick supplies the
  required stable evidence.
- Explicit zero drive is still actuation. Treating it as coasting would let the solver discard a
  controller-owned command merely because its current magnitude is zero.
- Loaded collision residency changes conservatively wake every settled dynamic body. At 50-300
  bodies this is simpler and safer than support dependency tracking; R2 retained the policy after
  measuring the selected workloads.
- Settled state is deliberately absent from runtime views, events, snapshots, counters, and Explorer
  diagnostics. The stable scan and focused fixtures are the proof surface.

### Phase 5B: Add Dynamic Target Geometry and Candidate Discovery

Progress: Complete (2026-08-17). The static collision global-cell range is now a shared spatial
primitive, and `SpatialScene` owns one dynamic shadow index rebuilt from the canonical body store at
the start of each entity collection tick. The rebuild stamps conservative target bounds into every
overlapped outdoor 24 m cell and every reached EnvCell, then returns stable sorted/deduplicated
candidates from the mover's complete swept range and provisional placement. Settled targets remain
indexed, while camera and other non-entity bodies are excluded explicitly.

Dynamic physical state now retains the complete accepted `CollisionPlacement`, not only its committed
cell. Tick preparation refreshes every placement from the same immutable collision snapshot used by
the collection solve before atomically replacing the index. Target bounds cover fallback spheres and
cylspheres plus each placed physics-BSP part; the transform math is shared with static collision
through a source-neutral placed-shape bounds helper rather than inventing static source identity for
dynamic bodies. Focused fixtures prove cross-landblock stamping, outdoor/EnvCell portal straddling,
exact transformed target bounds, camera exclusion, settled-target discovery, stable 50/300-body
populations, and full swept-range discovery beyond the mover's initial bucket.

#### Deliverables

- Add one `SpatialScene`-owned dynamic shadow index over all physically participating bodies and visit
  scheduled bodies in stable `SpatialBodyId` order. Preserve focused single-body solving; do not
  introduce a whole-world transaction merely to make simultaneous contact look mathematically tidy.
- Extract the existing `collision.rs` global-cell range/keying primitive rather than creating a competing generic
  index: stamp conservative bounds for the Phase R0-proven target geometry into every overlapped
  global 24 m outdoor cell and register the body in every exact EnvCell reached by its
  `CollisionPlacement`. A portal-straddling body registers in both domains; cross-landblock outdoor
  bounds require no seam-specific bucket.
- Query the union of buckets overlapped by the mover's swept conservative bounds plus provisional
  reached EnvCells, then sort/deduplicate stable body IDs before filtering and narrow phase. Looking
  only at either body's last committed buckets is incorrect for fast motion and portal entry. Keep
  index maintenance, candidate generation, physics-state filtering, and narrow phase separate and
  independently testable.
- Do not subdivide an EnvCell in this milestone. R2 found no measured single-cell workload that
  changes the decision; a future plan may add an EnvCell-local index only after such evidence exists.
- Resolve the Phase 1B-supported peer target branches—setup spheres, cylspheres, and per-part physics
  BSP—without substituting movement spheres merely because both are spatial primitives. Unsupported
  mutable target geometry fails at preparation with its recorded reason.
- Add focused discovery fixtures for cross-landblock bounds, outdoor/EnvCell portal straddling,
  shared/adjacent EnvCells, fast/provisional movement, settled targets, camera exclusion, every
  supported target branch, 50/300-body bucket populations, and WCID 52077 failing body preparation
  before it can enter any target bucket.

#### Acceptance Criteria

- Outdoor bodies reuse global 24 m cells and interior bodies reuse reached EnvCells; no second generic
  index, EnvCell subdivision, pair cache, or concurrency mechanism exists.
- Swept/provisional queries discover fast, cross-boundary, and portal-straddling candidates outside
  both bodies' prior committed buckets, then return stable sorted/deduplicated body IDs.
- Every supported target branch owns its authoritative conservative bounds and membership updates;
  unsupported mutable geometry follows Phase 1B rather than becoming stale solver truth.
- Settled targets remain discoverable and the synthetic camera remains excluded by explicit policy.

#### Decisions and Course Corrections

- Rebuild the index once per collection tick. At the expected 50-300 bodies per landblock this keeps
  mutation paths and failure behavior simple, provides one coherent tick-start snapshot, and avoids
  an incremental registry, pair cache, or synchronization machinery before evidence warrants it.
- Preserve complete movement-sphere collision placement on the canonical physical body. A committed
  cell alone loses provisional portal membership and would make fast entry undiscoverable; deriving
  placement independently inside the index would create a second collision authority.
- Share only source-neutral placed-shape bounds between static and dynamic collision. Dynamic targets
  do not manufacture `StaticColliderPlacement` identity merely to reuse existing transform math.
- Outdoor bodies use the extracted global 24 m cell keying and interiors use exact reached EnvCells.
  No EnvCell subdivision exists in this milestone; a later plan may revisit only if a measured
  single-cell population exceeds the fixed-tick budget.
- Empty effective target geometry produces no shadow membership. Unsupported mutable geometry is
  still rejected during body preparation, before solver participation, rather than entering the index
  with stale or substitute movement geometry.

### Phase 5C: Add Directional Dynamic Contact and Response

Progress: Complete (2026-08-17). The collection tick now captures one immutable tick-start body
snapshot, spatial index, and environment-only motion plan before any body commits. Each active mover
gets one directional attempt against the fixed candidate set; accepted movers commit independently,
while a contacted settled peer is woken for a later tick. Dynamic narrow phase reuses the same
source-neutral placed sphere, cylsphere, and physics-BSP geometry as static collision, with adaptive
pair slicing over both planned transforms and a typed hard-budget rejection. Focused fixtures cover
the supported target branches, policy filters, high-speed missiles, opposing/rotating movers,
deterministic three-body selection, exact slice limits, isolated rejection, and simultaneous floor
and peer contact.

#### Deliverables

- Implement the ACE/retail-proven dynamic collision eligibility and response decisions from the
  complete effective masks, including ethereal/ignore flags. Retain the already-derived report
  eligibility/classification facts for Phase 5D, but do not produce or store report events here.
- Resolve mover geometry against the Phase 5B target branches alongside environment contact. Commit
  each accepted body independently and allow peer response to converge within a documented bounded
  number of ticks. Stable visitation—not simultaneous atomicity—provides reproducibility.
- Apply the Phase R0-selected adaptive time-sliced narrow phase and deterministic directional pair
  ownership. Query full-path swept conservative bounds once, then test the fixed candidate set at
  pair-specific slices of both planned transforms. Include the tick-start placement and each slice
  endpoint. Broad-phase bounds are candidate discovery, not proof of a hit; response and report
  refresh occur only from a sampled narrow-phase contact.
- Compute `pair_slice_distance` as the smaller of the participating collision scale and
  `maximum_dynamic_slice_distance`, then compute
  `required_slices = max(1, ceil(conservative_relative_path_length / pair_slice_distance))`.
  Conservative path length includes relative translation plus the rotational travel of each body's
  furthest collision point. The first runtime constants are 0.05 m and 128 slices, justified by the
  R0 census rather than copied into tests. If a pair needs more slices, reject that body's directional
  solve before partial commit and report the body/pair/path length/budget; never clamp the count or
  silently skip the pair.
- Add focused response fixtures for disjoint/overlapping/moving pairs, every supported target branch,
  filtered/response-only pairs, exact slice boundaries, over-budget rejection, opposing and rotating
  peers, two-scheduled-body ownership, three-body ordering, simultaneous environment contact, and
  one-body rejection.

#### Acceptance Criteria

- Representative pairs contact and converge within the documented tick bound; reversing registry
  insertion order does not change stable-ID visitation or results.
- Filtered pairs do not respond, response-only pairs respond without manufacturing reports, and a
  mutually scheduled pair receives no duplicate impulse.
- Representative sphere, cylsphere, and physics-BSP targets cannot be crossed inside the supported
  displacement/shape envelope. Over-budget work rejects before pose, response, or report publication.
- A rejected directional solve preserves that body and does not roll back unrelated accepted bodies.

#### Decisions and Course Corrections

- Extract `PlacedCollisionShape` from the static-collider wrapper instead of forging static source
  identity for dynamic bodies. Static and dynamic narrow phase now share transform and geometry math
  without sharing ownership semantics.
- Freeze all tick-start body state and environment trajectories before directional commits. This is
  the selected eventual-consistency model: each mover changes only itself, stable body-ID ordering is
  reproducible, and a woken peer participates on a later tick rather than receiving an atomic paired
  impulse.
- Give each body one attempt per prepared collection epoch, including a rejected attempt. A peer
  woken by an earlier mover cannot consume mutable mid-tick state or integrate twice.
- Query one full-path candidate set, apply a pair-level swept-bounds rejection, and only then enforce
  the adaptive slice budget. The pair filter prevents unrelated bodies that merely share a coarse
  24 m bucket from causing false over-budget failures.
- On a blocking peer contact, re-solve only the accepted partial interval against the environment.
  This preserves floor/support and other environment state at the contact point without running the
  complete environment solver at every dynamic sample.
- Add `accepts_peer_reports` to the effective dynamic collision policy. `IgnoreCollisions` suppresses
  both the body's own response and peer reports about it; keeping this derived fact in the contract
  avoids consumers reconstructing mask semantics.
- Missile targets remain excluded from peer targeting, matching the source evidence. An accepted
  eligible object impact by a targetless missile clears `Missile`, `AlignPath`, and `PathClipped` as
  one named committed physics-state consequence. The Explorer registry, which owns the authored
  state, consumes that consequence synchronously; the solver does not gain a registry or event-bus
  dependency.
- A dynamic block truncates the accepted path and holds the mover at contact for the remainder of
  the tick; the computed rebound velocity applies on the next tick. This is the deliberate bounded
  eventual-consistency concession, avoiding remaining-tick reintegration and paired atomic solving.
- A typed per-body slice-budget error is logged immediately by the host and collection processing
  continues. No collision diagnostic history, counter, registry, or frontend surface is retained.
- Report-only contacts are detected but not retained or published in this phase. Phase 5D owns
  contact lifetimes and source-neutral outcomes; static-environment missile report/state consequences
  remain part of that reconciliation rather than being inferred here.

### Phase 5D: Add Minimal Collision-Report Lifecycles

Progress: Complete (2026-08-17). `SpatialScene` now retains only stable directional active-contact
records keyed by recipient and static environment or identified dynamic peer. Exact narrow-phase
touches produce one committed start, later accepted touches silently refresh the injected timestamp,
and collection finalization expires untouched records even when the active-mover scan is empty.
Reciprocal eligibility is resolved from the same confirmed contact, so a settled report-only peer
does not integrate merely to receive its direction. Committed collection results return start/end
outcomes separately from body projection ticks; Explorer intentionally neither relays nor retains
them. Focused fixtures cover reciprocal and report-only contact, object/environment classification,
static environment contact, strict and ethereal expiry, consumer rejection, accepted-path clipping,
state loss/restart, detach, relocation, despawn, and same-GUID replacement.

#### Deliverables

- Define the smallest source-neutral collision start/end values and retained active-contact record
  proven by ACE/retail. First touch emits start, later touches refresh without another start, expiry
  emits end, and forced teardown/state changes emit the proven end/restart sequence. Keep response
  and per-recipient report classification distinct; the solver implements no gameplay or UI policy.
- Return report outcomes in the committed collection result so a composition-owned interested party
  can consume them. Explorer adds no collision panel, Tauri report relay, snapshot field, recent-event
  history, counter, diagnostic store, or production log merely to demonstrate the contract.
- Reconcile attach, detach, complete state replacement, teleport, despawn, and same-GUID replacement
  while bodies are touching. Each transition clears only invalid contact/response/report state and
  cannot leave a retired body in pair discovery.
- Treat a settled body as a normal spatial-index candidate. Contact from an active mover wakes a
  response-eligible peer for deterministic later convergence; report-only contact follows the proven
  lifecycle without requiring unnecessary integration. A settled target is never removed from
  candidate discovery.
- Add focused report fixtures for reciprocal and environment-classified recipients, filtered and
  report-only contact, first-touch/refresh/natural-end/forced-end, active-mover contact with settled
  response-eligible/report-only targets, and expiry while integration is skipped. Inject time; tests
  never sleep, and any event capture lives only in the test or harness consumer.

#### Acceptance Criteria

- Every reportable contact produces one start, refreshes retained state without repeated starts, and
  produces the correct natural or forced end plus per-recipient environment classification.
- A hard-rejected body solve preserves that body's previous accepted state and emits no report from
  the rejected attempt; already accepted unrelated bodies are not rolled back. A grounded residual
  endpoint is accepted contact and participates in the normal report lifecycle.
- Solver-participation disable, despawn, teleport, and replacement during contact leave no stale pair, response, scheduler,
  or report state.
- Settled targets remain discoverable; response-eligible contact wakes exactly the required work,
  while report lifecycle time advances correctly even when neither body integrates.
- The solver retains no emitted-outcome history beyond the minimal active-contact record needed for
  future refresh/end semantics, and Explorer production state contains no collision diagnostics,
  history, counters, or inspector projection.

#### Decisions and Course Corrections

- Normalize object and environment-classified contacts to one balanced start/end lifecycle. Retail
  retains object records but gives the environment channel only a collapsed start callback and
  silent clear (`acclient.c:308446-308560`, `:309869-309968`). This user-approved
  `RETAIL DIVERGENCE` keeps dynamic peer identity when classified as environment, so forced teardown
  can end only the affected directional records. The 4,497-template
  `ReportCollisionsAsEnvironment` census sizes the compatibility surface.
- Keep the retained value strictly physical: last accepted touch time and whether the source was
  ethereal. Emitted outcomes contain lifecycle identity, classification, and phase. Relative
  velocity and ACE gameplay-profile flags are not copied into dormant event payload fields; the
  response solver already consumes relative motion, and gameplay consequences remain explicitly out
  of scope until a named consumer proves its contract.
- Generate both eligible recipient directions from one exact contact observation. A settled target
  remains in the index and can receive a report without becoming an integration mover; a second
  scheduled direction merely refreshes the same records and cannot duplicate starts.
- Clip report observations to the response-selected accepted interval. Contacts found later on the
  provisional environment-only path are not events when an earlier blocking peer truncates that
  path.
- Preview first-touch outcomes before the consumer callback, then mutate active lifetimes only after
  that callback accepts the body transaction. A hard-rejected body or over-budget dynamic
  directional solve changes neither body state nor report state; an accepted grounded residual
  endpoint refreshes reports normally.
- Finish expiry after every prepared mover has been attempted. This preserves retail's strict
  `> 1 second` ordinary timeout and positive unrefreshed ethereal timeout while allowing an empty
  settled collection to advance report time without timers, sleepers, or another scheduler.
- Reconfiguration invalidates directions by their actual dependencies rather than clearing every
  contact. Recipient movement geometry/report eligibility, source target geometry/filtering/
  classification, and static collision filters are compared separately; response-only or scheduling
  changes preserve still-valid report state.
- Build a same-GUID successor completely before replacing its body. This removes the old
  remove/install/rollback window and lets replacement return its forced report ends with one scene
  mutation.
- Static environment contact now applies the same accepted missile consequence as an eligible peer
  impact, clearing `Missile`, `AlignPath`, and `PathClipped` synchronously through the existing named
  producer-state change.
- Explorer drops report outcomes at its composition boundary and continues filtering projection
  ticks only by frontend-relevant body/path/state changes. No Tauri event, DTO field, frontend mirror,
  history, counter, log, inspector, or diagnostic registry was added.

### Phase R2: Solver Evidence Resteering Checkpoint

Progress: Complete (2026-08-17). A temporary ignored app test prepared WCIDs 1, 147,
158, and 400 from the canonical `dats/weenies.hwc` and `dats/assets.hba`, installed 50- and
300-body outdoor populations over real `0xDA55` terrain with a resident 3x3 landblock neighborhood,
and ran the complete 30 Hz collection transaction. Temporary feature-gated counters measured the
exact dynamic-contact seams; the probe and counters were removed after capture. Measurements used
an optimized test build on a Ryzen 9 5900X with Rust 1.95.0.

The 50-body workload settled all bodies in 163 ticks. Its optimized tick median was 2.45 ms and
maximum was 7.03 ms; 48,983 broad candidates were visited, no candidate reached dynamic narrow
phase at the authored 9 m spacing, and 50 report starts remained active at convergence. The
300-body workload reached 293 settled bodies by tick 240 and 299 by tick 400. Its first-240-tick
median was 8.75 ms with a 44.3 ms maximum; including the mostly-settled tail through tick 400 reduced
the median to 0.93 ms while the maximum remained 44.0 ms. Across 400 ticks it visited 372,689 broad
candidates, performed 402 sphere and 110 physics-BSP narrow tests over 2,165 slices, and produced
308 balanced report starts and 308 ends. Focused overlapping pairs prepared from the same catalog
proved the real WCID 1 sphere, WCID 147 physics-BSP, and WCID 158 cylsphere branches; every sampled
stationary pair required one slice. The single collection scheduler slot and zero-or-one focused
Tauri advance event per tick remain enforced by the landed host tests; no report event or diagnostic
surface was introduced.

The evidence corrected one omission before the pause. Supported bodies could retain response
velocities below retail's 0.25 m/s floor forever, preventing settlement. Grounded coasting now
canonicalizes retained velocity before acceleration and integration using retail's exact squared
threshold and physics epsilon (`CPhysicsObj::UpdatePhysicsInternal`,
`acclient.c:306106-306153`). Explicit drive and launch remain commands and are not canonicalized.
A focused fixture proves a supported body at 0.2 m/s commits no displacement, reaches exact zero,
and settles; the 50-body workload improved from 194 to 163 convergence ticks and the two measured
sub-threshold drifters disappeared.

One WCID 1 body originally could not converge. From tick 240 through a dedicated tick 401 probe it
retained the exact same airborne pose and velocity while every solve returned
`ContactBudgetExceeded` with six constraints, one completed substep, and nine total contact queries
against the configured eight-pass-per-substep limit. The hold-and-retry contract therefore created
an immortal active body and an integration solve every subsequent tick. This was a solver liveness
gap, not spatial-index pressure: 299 peers settled, the settled scan made the tail cheap, and neither
another outdoor index nor EnvCell subdivision addressed it.

A focused trace has now localized the failure. The retained pose and first half-step are valid. The
second half-step reaches collider 86, authored as `BuildingShell { source_index: 1 }` at landblock
origin `(36.12, 108.0, 20.0)`. WCID 1's support and upper spheres then alternate across the thin
sloped shell while the separation correction walks the pair sideways around its edge. This is not a
terrain-domain error, invalid spawn placement, impossible constraint set, or accumulated solver
state. The overlap depths decrease monotonically from approximately 0.17 m to 0.0002 m, but the
eight-pass cap rolls back before the next clear query. With a temporary 12-pass-per-substep cap, the
same tick solves normally after eleven queries in the contested substep (twelve total including the
first clear substep), commits both substeps, and emits the expected static-environment contact start.

The value eight has no retail provenance; it entered with the original bounded host solver profile.
Retail and ACE retain bounded insertion but use a structurally different nested algorithm:
transitional movement calls `TransitionalInsert(3)`, which can call the per-cell collision routine
up to three times per insertion (`CTransition::find_transitional_position` and
`CTransition::transitional_insert`, `acclient.c:301714-301858`, `:301488-301626`;
`Transition.FindTransitionalPosition`, `Transition.TransitionalInsert`). Those counts do not map
one-for-one to this aggregate projection solver, but they establish that eight is a local safety
choice rather than a compatibility contract.

A temporary follow-up population probe placed the same 300 real WCID 1/147/158/400 definitions on a
20 by 15 outdoor grid at 9 m spacing, 36 m elevation, over the resident `0xDA55` 3x3 neighborhood.
With a per-definition 12-pass cap, all 300 bodies settled by tick 217 and no solve exhausted the
larger cap. The exact reproduction, feature gate, source labels, population probe, and temporary
diagnostic output were removed after capture.

The follow-up review rejected both whole-tick rollback and cap tuning as the primary correction.
Grounded contact passes are a per-substep compute budget, not a requirement that every accepted pose
be overlap-free. Keep the current eight-pass bound. After the last pass, commit the latest finite
corrected candidate with its valid placement even when contacts remain, then run every remaining
substep with its ordinary requested displacement and the same bounded correction loop. The body may
therefore carry residual intersection across later substeps or fixed ticks while normal movement and
separation eventually clear it. Do not add a correction-only phase, stationary remainder, retained
retry count, penetration-debt record, recovery registry, larger default pass cap, or specialized
paired-sphere/polygon-edge solver without new evidence.

The steered policy is now implemented. Grounded solves retain the eight-pass per-substep bound,
commit the latest finite corrected candidate, and continue every remaining ordinary displacement
substep. One final placement-contact query derives the residual-contact fact at the layer that owns
the accepted endpoint. That fact is carried only through the internal physical commit and prevents
settlement; it does not add a public tick status, retry state, log, metric, host DTO, registry field,
or frontend event. Dynamic peer clipping now copies environment/residual facts from its accepted
partial static solve rather than leaving facts from the abandoned full path attached to the commit.

The narrow retail caller trace is conclusive. An `OK_TS` candidate advances `curr_pos`, while an
adjusted or slid transition restores `check_pos` to `curr_pos`
(`CTransition::validate_transition`, `acclient.c:300924-300972`); the outer loop then advances to the
next ordinary substep (`acclient.c:301938-301946`). Committing a still-intersecting corrected
candidate is therefore a deliberate `RETAIL DIVERGENCE`, marked at the solver policy site with its
census consequence. Retail's hold behavior is not restored because it reproduces the measured
immortal thin-shell retry in this aggregate paired-sphere solver.

An asset-independent fixture distilled the real collider-86 sloped shell into its opposing authored
faces and the catalog-derived WCID 1 sphere pair. At the production eight-pass cap it commits a
finite residual endpoint, emits both requested substeps through fraction 1.0, remains ineligible for
settlement, and clears on a later ordinary tick directed away from the edge. Existing focused
environment-report/projectile and failure-atomic budget fixtures remain green around that new
endpoint contract.

The temporary real-content probe was rerun and removed. With the canonical `dats/weenies.hwc` and
`dats/assets.hba`, the same WCID 1/147/158/400 mix at 30 Hz converged all 50 bodies by tick 144 and
all 300 bodies by tick 168 at the unchanged eight-pass cap. The former 299/300 tail through tick 400
is gone. A 50-body grid spanning the north/east `0xDA55` landblock boundaries converged by tick 101
with the resident 3x3 collision neighborhood. No production instrumentation or asset-dependent test
was retained.

Residual contact is physical state, not a diagnostic failure. The grounded solve computes it once at
the final committed candidate and passes it through the internal commit contract so the existing
activity decision keeps the body active. Do not add it to the frontend DTO, Tauri event, Explorer
registry, report history, or production log. A fully clear later solve removes the condition through
ordinary recomputation; there is no separately mutable flag for callers to clear.

Retail advances `CurPos` only after accepted transition steps and restores adjusted/slid checks to
the prior current position before the outer loop continues. The compatibility marker above records
the proven departure without distorting the simpler solver contract.

The transaction still rejects non-finite correction, invalid placement/cell transit, missing hard
coverage, substep-count overflow, and dynamic pair slice-budget overflow. Those failures cannot
supply a coherent committed pose. Dynamic pair sampling remains a distinct preflight budget and
continues to reject before pose/response/report publication; this steering changes only the grounded
static-contact convergence loop.

#### Residual-Contact Deliverables

- Replace the grounded contact-budget outcome with one solved outcome that retains the latest
  corrected candidate after the fixed pass count, continues later displacement substeps, and reports
  whether contacts remain at the final committed candidate. Keep collision normals and achieved
  velocity derived from the accepted complete tick path.
- Thread the final residual-contact fact only through the internal physical commit and the
  solver-owned active/settled decision. A motionless intersecting body remains active; a clear stable
  body can settle under the existing predicate. Grounded ticks remain ordinary solved ticks; do not
  add a public tick status merely to expose internal convergence work.
- Treat contacts on the committed residual endpoint as accepted static-environment contact for
  response, balanced report lifecycle, and missile consequence. Never publish contacts observed only
  on an abandoned provisional candidate.
- Preserve the normal substep displacement schedule after a residual result. Each later substep
  applies its requested bounded displacement and then runs the ordinary correction loop; it does not
  stop, pad the path, or enter a special recovery mode.
- Remove grounded-only `ContactBudgetExceeded` production and any host rejection/log branch made dead
  by the cutover, while retaining the status/error vocabulary still consumed by free-flight or hard
  dynamic budgets. Sweep tests, metrics, docs, and UI labels with any removed vocabulary.
- Complete the retail caller trace for exhausted nested insertion and add a compatibility marker only
  if the committed-residual policy is a proven observable departure.
- Add asset-independent thin sloped-shell fixtures reproducing the real paired-sphere alternation,
  then rerun the temporary real 50/300-body and adjacent-boundary workloads. Keep only focused
  synthetic regression fixtures in the repository.

#### Residual-Contact Acceptance Criteria

- The eight-pass thin-shell fixture commits a finite corrected pose, consumes all requested
  substeps, retains valid cell placement, remains scheduled while intersecting, and clears through
  later ordinary substeps or ticks without raising the pass cap.
- Motion directed away from a residual contact clears naturally; tangential motion can carry the
  body around the edge. Motion into a thin shell does not produce non-finite state, unboundedly
  increasing penetration, or wrong-side traversal in the focused and real-content workloads.
- Achieved velocity, response normal, support/contact classification, placed path, scene index,
  collision report lifecycle, and projectile consequence all describe the committed path and final
  candidate exactly once.
- A final residual contact prevents settlement without creating retry counters, timers, diagnostic
  history, another active-body index, or frontend-visible collision state.
- Missing coverage, invalid math/placement, substep overflow, and dynamic slice overflow retain their
  existing failure-atomic behavior.
- The representative 50/300-body workloads converge without immortal rollback loops and remain
  inside the recorded fixed-tick envelope; temporary probes leave no production instrumentation.

- Run the named 50- and 300-body landblock workloads plus adjacent-landblock boundary cases. Record
  broad-phase candidates, narrow-phase tests by target-geometry branch, fixed-tick time, convergence
  ticks, report lifecycle volume, scheduler-slot count, active/settled counts, integration solves
  skipped, wake reasons, and Tauri batch/event count. Capture these in the harness invocation and
  resulting plan evidence only; they are temporary decision inputs, not production metrics, DTOs,
  histories, registries, or runtime state.
- Audit outdoor-cell and reached-EnvCell maintenance, stable visitation, contact convergence,
  swept/provisional queries, transition cleanup, and report start/refresh/end behavior against real
  catalog-derived geometries. Add EnvCell-local subdivision only if a recorded single-cell case
  exceeds the fixed-tick budget.
- Audit settled-state churn and wake correctness across the representative workload. Keep the stable
  collection scan unless its measured cost is material; do not add sleep islands, dependency graphs,
  per-body timers, or a second active-body index merely because many bodies become settled.
- Re-dry-run motion and end-to-end Phases 6-8 against the landed solver outcomes. Revise path,
  correction, scheduling, and harness contracts before motion builds on accidental solver behavior.
- Record newly supported and still-unsupported physics-state combinations by WCID, then update the
  remaining acceptance matrix and cleanup targets.

### Phase R3: Close Motion Composition Evidence

Progress: Complete (2026-08-17). Retail advances one `CSequence` cursor by elapsed quantum. For every
departed animation frame it composes the authored position frame into one local offset and then adds
the sequence velocity/omega contribution to that same offset (`CSequence::update_internal` and
`apply_physics`, `acclient.c:326355-326383`, `:327127-327216`). Crossing finite link boundaries
subtracts or combines the boundary position frame and applies the proportional leftover quantum
before entering the next clip (`acclient.c:326952-327033`). Negative framerate reverses the selected
range and subtracts its position frames; speed changes multiply cyclic framerate and replace the
same motion-data velocity/omega contribution (ACE `MotionTable.cs:132-180`, `:358-393`). A command
change removes the prior cyclic sequence, queues its authored link(s), and then installs the new
cycle; stop, reversal, and style changes are therefore ordinary link resolution, not pose snaps
(ACE `MotionTable.cs:76-185`).

`CPhysicsObj::UpdatePositionInternal` asks the part array for that single accumulated offset, retains
and object-scales its translation only while on walkable support, lets `PositionManager` add physical
response, and combines the result with the current world frame exactly once
(`acclient.c:308262-308298`). Airborne motion suppresses animation/motion-table root translation and
uses physical velocity; animation rotation remains part of the sequence offset. The landed solver
already owns accepted world pose, support classification, collision correction, absolute fixed-tick
time, and placed paths. The frontend already samples only rigid part frames and ignores decoded
position frames. The resulting composition rule is unambiguous:

- one host-owned resolved motion cursor selects the ordered links/cycle, animation ranges/rates, and
  matching velocity/omega from the same motion-table records;
- while supported, the host composes authored animation position-frame deltas plus motion-data
  velocity/omega into solver actuation once; while airborne, it suppresses sequence translation,
  retains sequence rotation, and leaves ordinary physical velocity authoritative;
- the solver's corrected placed path is the only root placement published to the frontend; the
  frontend samples the selected clip cursor for articulated part transforms and hooks but never
  applies animation position frames to the scene root; and
- pause, resume, deterministic step, late asset readiness, and replacement alter the injected
  absolute motion timeline/cursor, never the accepted body pose or animation start time implicitly.

The current reduced `MotionKinematics` cannot express this contract because it drops link selection,
ordered animation IDs/ranges/rates, and position frames. Closing that gap also changes existing
client character projection, physical actuation, committed path shape, dynamic target sampling, and
frontend cursor ownership. It is now the dedicated deferred
`holtburger-authored-root-motion-physics-integration-plan.md`, not Phase 6 of this milestone. No
motion history, timeline recorder, or diagnostic state was added for this checkpoint.

- Complete the retail/ACE trace for transition, interruption, reversal, speed scaling, finite
  links/cycles, animation ranges/rates, and animation position-frame composition with velocity/omega.
- Dry-run the landed solver path, absolute host time, frontend placement owner, and animation staging
  against the scenarios recorded in the dedicated follow-on plan.
- Keep the active dynamic-entity milestone from extending runtime motion types or freezing an
  endpoint approximation while the shared effort is deferred.
- Record only the source facts and resulting contract decision; do not land a motion-event history,
  timeline recorder, production trace buffer, or diagnostic state model.

### Phase R4: Stabilize the Reduced Milestone Boundary

Progress: Complete (2026-08-17). The committed Phase 5D/R2/R3 tranche passed formatting, workspace
Clippy with warnings denied, and the complete workspace test suite. The ownership-boundary diff
review found no temporary probes, production counters, ignored real-asset tests, or diagnostic
vocabulary; the only report-count accessor is `#[cfg(test)]`, and the new collection-tick type is
app-local in `src-tauri`. The plan, survey evidence, deferred
`holtburger-authored-root-motion-physics-integration-plan.md`, and parent roadmap agree on the
temporary motion boundary and remaining execution order. No behavior, adapter, or observation
surface was added.

#### Deliverables

- Verify the landed Phase 5D/R2/R3 solver, collision-report, residual-contact, and census tranche with
  its focused Rust/host gates before changing focused entity DTOs or frontend contracts.
- Review the current diff by ownership boundary and confirm that temporary probes, counters, ignored
  real-asset tests, and diagnostic vocabulary are absent.
- Freeze the remaining scope corrections in this plan: current-state frontend hydration rather than
  website recovery, ignored spawned animation root frames with one measured retail divergence,
  explicit solver-participation vocabulary, unchanged physical-camera policy, and no EnvCell
  subdivision in this milestone.
- Do not add behavior, compatibility adapters, or new observation surfaces at this checkpoint.

#### Acceptance Criteria

- Phase 5D/R2/R3 focused tests, formatting, and Clippy with warnings denied pass on the current
  implementation tranche.
- The plan, survey evidence, dedicated authored-root-motion plan, and parent roadmap agree on the
  temporary motion boundary and remaining execution order.
- Phase 6 begins from a reviewable, diagnostics-free solver baseline.

#### Decisions and Course Corrections

- The review found one omission against the Phase R0 decision: the state-toggle report
  reconciliation in `SpatialScene` lacked its mandated `RETAIL DIVERGENCE:` marker. The marker now
  cites retail `set_state` (`acclient.c:310307-310335`), reverified to reconcile only lighting,
  `NoDraw`, and `Hidden`, and names the state-transition fixture census. No reconciliation behavior
  changed.

### Phase 6: Close the Physics-Only Motion Boundary

Progress: Complete (2026-08-17). The focused dynamic-entity view no longer carries
`motion_table_did` or the semantic `motion` object; the shared projector, client adapter, Explorer
driver, and frontend feed schema shrank together, and a boundary-decode contract test proves a host
emitting either field cannot deliver it past the Tauri feed. Physical-state `Attach`/`Detach`
vocabulary landed as `EnableSolverParticipation`/`DisableSolverParticipation` transition actions,
`SolverParticipationEnabled`/`SolverParticipationDisabled` reconfiguration outcomes, and
`install_physical_body`; object parenting and animated-attachment vocabulary is untouched. The
spawned root-frame gate (`sampleAnimationPose` reads only `partFrames`) carries the measured
`RETAIL DIVERGENCE:` marker citing `acclient.c:308262-308298` with the WCID 36449 census, and a
synthetic fixture proves non-identity position-frame translation and rotation cannot reach sampled
part poses. A new `ExplorerSimulationControl` at the collection scheduler boundary provides
pause/resume and exactly-once queued deterministic stepping over an injected clock; paused ticks
skip integration without touching entity, body, or report state. No Tauri command exposes the
control yet: the browser harness reaches the runtime through the dev content host rather than
Tauri IPC, and no Explorer UI consumer exists, so the packaged app's collection simply never
pauses. Phase 7B or a later Entities-tab control adds the production surface when a real caller
lands. `MotionKinematics`, client motion resolution, and `BasicSpatialPhysics` are unchanged.

Scope review (2026-08-17): authored root motion is explicitly deferred. The current
`PhysicalBodyActuation` expresses velocity-shaped physical work, the accepted `PlacedMotionPath`
contains translation/placement only, and dynamic target rotation is reconstructed from retained
omega. Extending those contracts correctly would also require replacing the client-wide reduced
`MotionKinematics` authority. This milestone does not build an Explorer-only sequence resolver,
equivalent-vector adapter, proposed-root-path stub, or parallel animation clock.

Census checkpoint (2026-08-17): complete. The existing offline `survey-weenie-catalog` tool now
walks the mounted HBA resource index, decodes all 436 raw motion tables and their 1,938 distinct
referenced animations, applies each authored animation range, and resolves catalog templates through
the template-motion-table override/setup-default rule. It records no runtime history or diagnostics.
The canonical `dats/weenies.hwc` plus `dats/assets.hba` population measured:

- 353 animations with position frames, 341 with non-identity translation, and 20 with non-identity
  rotation; their selected ranges reach 205, 203, and 48 motion tables respectively;
- 13,996 catalog templates naming an effective motion table, of which 13,992 decode from the
  canonical HBA. The four unavailable references all name `0x09000085` and remain explicit survey
  output rather than being classified as identity motion. Of the decoded population, 7,903 reach
  position frames, including 7,901 with translation and 1,497 with rotation;
- 21,244 table animation entries selecting position frames. At stored rate their possible authored
  frame-boundary crossings per 30 Hz tick have p50 1, p95/p99 3, and maximum 8; 4,854 entries can
  cross more than one boundary. Under the explicitly labeled 3x speed stress case, p50 is 3,
  p95/p99 9, maximum 24, and 19,703 entries can cross more than one boundary; and
- one catalog template combines effective physics-BSP target geometry with table-reachable root
  motion: WCID 46320 Security Station, motion table `0x090000A1`, with translation but no root
  rotation. The representative physics-BSP cases do not: WCID 147 has no motion table and WCID
  52077's `0x09000227` table has no position frames.

Within the fixed representative population, WCIDs 1, 21, and 400 resolve `0x09000001` with root
translation and a stored-rate maximum of four crossed boundaries per tick; WCID 34621 resolves
`0x09000009` with translation and maximum one; the other six resolve no root-transform animation.
None of the ten representative tables reaches authored root rotation. Classification uses a
`1e-6` translation/rotation tolerance; the boundary bound is
`ceil(abs(stored_framerate) * speed_modifier / 30)` and therefore does not depend on a favorable
starting cursor. Here, table-reachable means selected by at least one authored cycle, modifier, or
link in the effective table. It is a conservative solver-contract bound, not a claim that the first
Explorer command surface or every ACE gameplay path issues every measured record.

The census proves that ordered multi-frame translation is common, root rotation is catalog-reachable,
and moving physics-BSP root motion exists. Those facts reject silent velocity flattening as a final
contract but do not prevent a narrower entity-system milestone. For this plan only, entity roots move
from explicit relocation or solver-owned physical velocity, acceleration, angular velocity, launch,
gravity, and collision response. Setup-default articulated animation continues visually, but its
animation position-frame translation and rotation do not alter the entity root.

No semantic production operation in this plan selects a motion-table cycle. The separate shipped
setup-default scan found two default clips with position-frame arrays. Both have zero translation but
non-identity root rotation: animations `0x03000BB7` and `0x03000BDE`, selected by setups
`0x02001694` and `0x02001752`. Only the latter setup is referenced by the canonical weenie catalog,
through WCID 36449 Bats; the physics-BSP default animation selected by WCID 52077's setup has no
position-frame array. The active milestone keeps Bats spawnable and deliberately ignores its
setup-default root rotation. The exact spawned-dynamic root-frame gate must carry a
`RETAIL DIVERGENCE:` marker citing `acclient.c:308262-308298`, state that Bats animates without its
authored root rotation, and record the one-WCID canonical-catalog census. This is a temporary fidelity
boundary, not a stub motion system. If another root-bearing setup default becomes catalog-reachable
before the follow-on plan, update the census and marker consequence before accepting it.

#### Deliverables

- Keep the Phase 5/R2 collection tick and solver contracts unchanged: retained
  velocity/acceleration/omega, launch, gravity, collision response, relocation, reversible solver
  participation, and complete physics-state replacement are already the physical movement path.
- Project each committed `PlacedMotionPath` through the existing focused entity advance and frontend
  placement owner. The frontend interpolates accepted solver positions; it does not infer velocity,
  apply position frames, or perform portal traversal.
- Keep default setup animation, part animation, hooks, effects, and late asset readiness on the
  existing presentation clock. Their visual execution never writes the entity root. Add the measured
  `RETAIL DIVERGENCE:` marker and a synthetic fixture proving non-identity position-frame translation
  and rotation leave the spawned root under solver ownership while articulated playback continues.
- Rename remaining shared and Explorer `Attach`/`Detach` physical-state actions and prose to
  `EnableSolverParticipation`/`DisableSolverParticipation` (or an equally explicit landed spelling).
  Parenting and animated attachments retain their existing distinct vocabulary.
- Remove `motion_table_did` from `DynamicEntityContent`/the focused dynamic-entity view and remove the
  semantic `motion` object from that feed; neither has a runtime consumer under this scope. Preserve
  catalog motion-table facts for the offline census and preserve backend client motion state for
  existing client behavior, but do not project either as a placeholder for the follow-on plan.
- Exercise pause/resume and deterministic fixed stepping at the collection scheduler boundary. These
  control physical integration time; they do not introduce a semantic animation-motion timeline.
- Reuse the already implemented typed launch and relocation scenario operations for moving-body
  coverage. Do not add stand/walk/run/turn/stop commands in this plan.
- Leave `MotionKinematics`, client motion resolution, and `BasicSpatialPhysics` unchanged. Add no
  placeholder root-motion types or compatibility adapters for the deferred plan.

#### Acceptance Criteria

- A launched or otherwise physically moving entity advances through environment and body-to-body
  collision, publishes its accepted sparse path, and renders at the solver-owned root pose.
- Retained acceleration and angular velocity remain physical state across ticks; collision response,
  settling, wake, relocation, and complete physics-state replacement remain coherent.
- The production and representative scenario surfaces cannot execute authored root motion. A focused
  capability test proves that no semantic motion command/DTO exists, and a synthetic fixture proves
  ignored animation root frames cannot mutate the solver-owned root.
- Pause/resume and deterministic-step tests use injected scheduler time and never sleep.
- Superseded or late-ready visual preparation cannot affect a replacement entity.
- Raw motion tables, semantic motion commands, and placeholder root-path types remain absent from
  Tauri DTOs and TypeScript.
- The focused dynamic-entity DTO contains neither `motionTableDid` nor an unused semantic `motion`
  object; backend client motion state and its existing consumers remain intact.
- Existing client motion behavior and tests are unchanged by this milestone.
- Existing physical-camera locomotion remains on its host-local body/controller path, and the camera
  remains excluded from dynamic entity peer collision unless a later explicit policy opts it in.

#### Decisions and Course Corrections

- Authored root-motion/physics unification is intentionally deferred in full rather than approximated
  locally. Revisit only through `holtburger-authored-root-motion-physics-integration-plan.md` after
  this plan completes.
- Ignoring spawned setup-default root frames is an explicit one-WCID retail divergence, not a claim
  that retail ignores them or permission to route frontend transforms back into the solver.

### Phase 7A: Audit Focused Correctness

Progress: Complete (2026-08-17). The complete verification matrix was mapped against the landed
Rust and TypeScript suites. Of 42 scenario rows, 36 already had a named focused proof, one
(visible 300-entity lifecycle) belongs to Phase 7B, and five were genuine gaps now closed with one
focused test each:

- `animated_physics_bsp_rejects_solver_participation_but_remains_a_valid_visual` — the measured
  WCID 52077 boundary. Both entry points (initial spawn and later solver enablement) reject with
  the same typed moving-physics-BSP reason before scene mutation, while the template still
  realizes as a live pose-only visual that survives the rejected upgrade.
- `unavailable_catalog_reports_its_reason_and_refuses_every_spawn` — an absent catalog is a
  capability boundary; spawning surfaces the exact reason and produces no fallback entity.
- `contact_time_replacement_removes_blocking_without_retiring_the_peer_body` — complete state
  replacement mid-contact removes solid participation, keeps the peer's pose body and solver
  participation, and stops blocking on the next solve.
- `loaded_collision_change_wakes_settled_dynamic_entities` — the app-level wiring from a loaded
  static-world collision change to the conservative settled-population wake, which previously had
  only a synthetic scene-primitive test.
- `explorer_derives_the_same_transition_actions_as_the_client_set_state_path` — both producers
  derive the same action from the same mask pair, walking the exact GRAVITY/FROZEN/PUSHABLE
  sequence the client `SetState` test asserts.

No production fault command, debug mode, diagnostic mirror, event recorder, or metrics registry
was added; every injected failure reaches its owning unit through an existing dependency seam.

#### Deliverables

- Map the final verification matrix to the focused Rust host/world/core and TypeScript tests already
  landed. Add coverage only for an uncovered behavior; do not rewrite proven cases through the
  browser or create a second test API.
- Close any genuine gaps around catalog absence/corruption, absent WCID, repeated identities,
  spawn/despawn/replacement, launch/coast/settle/fall/slide, retained acceleration/omega, accepted
  physical paths, relocation, missing collision owners, scheduler pause/resume/deterministic step,
  pose-only entities, enabling/disabling/reconfiguring solver participation, and stale-generation
  rejection.
- Prove solid, ethereal/report-only, and suppressed dynamic contacts; contact-time replacement;
  active-peer wake of a response-eligible settled target; report expiry without integration; and wake
  after loaded static-world collision changes.
- Keep WCID 52077 as the explicit moving-physics-BSP boundary: visual realization remains valid, while
  initial or later solver participation rejects before scene mutation with the same typed
  setup/animation/moving-part reason. This is not object parenting.
- Retain focused frontend tests for initial hydration, webview remount through the same current-state
  snapshot, late visual readiness, path placement, generation replacement, and complete resource
  teardown. Do not add a website recovery protocol.
- Exercise source failures through existing injected dependencies at their owning unit boundary.
  Do not add a production fault command, debug mode, retained fault switch, diagnostic mirror, event
  recorder, or metrics registry merely to reproduce them in a browser.

#### Acceptance Criteria

- Every verification-matrix row names one existing or newly added focused proof, with no hollow
  duplicate at a higher layer.
- Enabling, disabling, and reconfiguring solver participation preserve entity identity and pose while
  clearing only incompatible scheduler, response, path, contact, and collision-report state.
- Quiescent bodies remain visible and collision-queryable, wake through every proven input, and avoid
  integration and unchanged-pose frontend traffic.
- WCID 52077 remains a valid animated visual and consistently rejects unsupported local physical
  realization without leaving body, scheduler, registry, frontend, or resource residue.
- Initial mount and webview remount hydrate current state through the same listener-before-snapshot
  path without replay, acknowledgement, or recovery history.
- Existing client motion and Explorer physical-camera behavior remain unchanged.

#### Decisions and Course Corrections

- Each new gap test was falsified before acceptance: inverting the behavior under test (keeping the
  replaced peer solid, disabling the production wake) makes the corresponding test fail. A test that
  passes against both the correct and the broken implementation proves nothing.
- The driver fixture's `fail_physical: bool` became a `FixturePhysical` enum so each rejection
  reaches the driver by its own typed reason instead of one opaque failure flag. This was required
  to express the animated-physics-BSP case and removes a magic boolean from nine call sites.
- An audit claim that `contact_projection_refuses_grounded_physical_bodies`
  (`spatial/scene.rs`) lacked a `#[test]` attribute and never ran was investigated and found false:
  the attribute is present with a `#[cfg_attr(debug_assertions, should_panic)]` between it and the
  function. The test runs and passes. No change was made.
- Debt: cross-EnvCell-portal dynamic peer candidate discovery is proven only for outdoor
  cross-landblock and fast-mover cases (`scene.rs` swept-bounds and fast-missile tests). Interior
  portal traversal is proven for static motion paths but not for dynamic peer lookup. R2 measured
  no interior workload that would change a decision, so this remains recorded debt rather than a
  new test against an unmeasured scenario.
- Debt: frontend teardown asserts entity and template counts return to baseline, not GPU texture,
  geometry, or animation-acquisition counts. Phase 7B's resource-baseline scenario is the named
  consumer for the wider census.
- Debt: the Tauri command layer itself has no direct tests; stale-generation rejection and error
  mapping are proven in the driver and runtime beneath it. The commands are thin argument-forwarding
  wrappers, so a test at that seam would restate the layer below rather than add a proof.

### Phase 7B: Prove the Product and Workload Boundary

#### Deliverables

- Run one supported representative WCID through the real Explorer UI/Tauri boundary: catalog lookup,
  registry publication, visual preparation, solver advancement, sparse placed-path presentation,
  initial frontend hydration, selection, and exact despawn.
- Run one real two-entity scenario that visibly exercises dynamic contact and response. Keep the
  host-local physical camera outside entity peer collision.
- Run one 300-visible-entity landblock scenario with mixed active/settled bodies and at least one
  catalog-proven target-geometry mix. R2 already proved 50- and 300-body host-solver workloads; do not
  repeat a 50-entity browser workload without a new decision it can change.
- Compose the noninteractive browser harness from production commands/snapshots plus test-owned
  observers for browser errors and resource baselines. Deeper entity/body/stage observation remains
  in focused tests.
- Verify that final teardown returns registry, body, scheduler, frontend owner, template, effect,
  renderer contribution, and other named resource counts to baseline.
- Record the future server handoff: which decoded spawn/update facts construct the shared
  source-neutral definition and which Explorer-only inputs disappear. Do not implement the adapter.
- Decide whether focused appearance mutation or animated parenting now has a concrete Explorer
  scenario. If yes, author a follow-on plan; do not append dormant operations here.

#### Acceptance Criteria

- A supported WCID becomes one visible, animated, solver-backed entity through the production
  boundary. Only physical input or explicit relocation changes its root; ignored animation root
  frames remain the documented Phase 6 divergence.
- A real entity pair produces the proven response/report lifecycle without involving the camera or a
  frontend collision path.
- The 300-entity scenario uses one collection scheduler participant and at most one focused advance
  batch per fixed tick. Frontend/renderer ownership matches the live registry population and returns
  to baseline after teardown.
- Host traffic scales with semantic mutations, fixed-tick solver paths, and sparse anchors—not render
  frames or frontend portal crossings.
- The scenario uses no live ACE Server/MySQL connection after the catalog has been generated.
- No diagnostic field, event history, test observer, fault switch, or measurement hook survives in
  production merely because the final scenario used it.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 8: Clean Cutover and Architecture Audit

#### Deliverables

- Delete superseded runtime-body-only snapshot/cache vocabulary, authored-only visual-input naming,
  temporary entity migration adapters, donor DTOs, duplicate projections, and obsolete comments.
  Preserve the existing reduced `MotionKinematics` contract for its current client consumers; its
  clean replacement belongs to the authored-root-motion follow-on plan.
- Sweep deleted/renamed mechanisms through symbols, metrics, docs, UI labels, harness output, and
  tests. In particular, replace physical `Attach`/`Detach` vocabulary with explicit solver-
  participation enable/disable names wherever object parenting is not meant. Do not retain
  compatibility aliases.
- Update crate boundary docs for the catalog crate, shared definition/solver-outcome contracts, core
  projection, app-local Explorer registry/catalog/driver/relay, and frontend
  placement/presentation ownership.
- Update `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` from “spawned entities queued” to the landed
  runtime shape and update the parent roadmap's Definition of Done.
- Run formatting, TypeScript/Svelte checks, ESLint, Knip, frontend tests, Rust tests, Cargo check,
  rustfmt, and Clippy with warnings denied plus representative host/browser gates.

#### Acceptance Criteria

- Every production Explorer spawn traverses catalog lookup, the Explorer registry, shared
  definition/body operations against the host simulation's body store/solver, focused projection,
  narrow Tauri relay, current-entity mirror, existing presentation runtime, and existing renderer.
- No frontend code reads the catalog, decodes raw motion tables, applies collision, or claims world
  authority.
- No HBA/content repository code knows about the Explorer weenie catalog.
- No `PhysicsState` bit or nullable ACE override is dropped, silently defaulted, or interpreted in
  more than one producer adapter.
- No duplicate Explorer entity authority, Explorer physical-body registry, feed, placement
  authority, pose system, or motion-selection path survives. The separate client `WorldState`
  composition is intentional, not duplication.
- No epoch, global sequence, world generation tombstone, stateful projector, database engine, or
  speculative server adapter exists without recorded evidence and review.
- All verification gates pass and the plan records final runtime/browser evidence.

#### Decisions and Course Corrections

- Populate during execution.

## Verification Matrix

| Scenario                          | Required proof                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Catalog absent                    | Explorer spawning disabled with exact capability reason; normal client content unaffected |
| Catalog corrupt/version mismatch  | Loud distinct error; no partial catalog service                                           |
| WCID missing/malformed            | Distinct absence/source error with WCID; no fallback entity                               |
| Catalog determinism               | Same canonical source/provenance yields byte-identical file                               |
| Catalog byte portability          | Canonical endian/encoding/order/limits decode identically independent of serializer defaults |
| Spawn preparation/install failure | No published partial entity; unpublished semantic/body residue is compensated             |
| Repeated WCID                     | Shared immutable template/assets, independent identity and mutable state                  |
| Complete replacement              | Every old body, plan, effect, path, stage, and lease retires                              |
| Listener before snapshot          | Earlier deltas superseded; later deltas apply normally                                    |
| Initial hydration/remount         | Listener registers first; one current-state snapshot hydrates without replay              |
| Pose-only entity                  | Entity and spatial pose remain visible with no collision/physics state or fixed tick       |
| Solver participation enable/disable | Same identity/pose body gains and loses physical participation without residue           |
| Physics-state reconfigure         | Gravity/collision/response/scheduling transitions clear only incompatible mutable state   |
| Complete state replacement        | Explorer and client paths derive equal operations from the same previous/next masks       |
| Late visual asset readiness       | Generation guard prevents stale publication; default animation starts through existing staging |
| Solver settle/fall/slide          | Local contact classification and accepted placed path drive presentation                  |
| Grounded residual contact         | Bounded correction commits finite overlap, continues displacement, stays active, and clears later |
| Missing collision owner           | Open-space motion continues with explicit non-gating residency                            |
| Continuous path                   | Smooth render-cadence placement without per-frame host transforms                         |
| Explicit relocation               | Immediate accepted-path reset with no old physical interpolation continuation             |
| Authored motion capability boundary | No semantic command/DTO selects authored root motion; ignored WCID 36449 root rotation carries the measured divergence marker |
| Camera/entity coexistence         | One Explorer host body store, distinct identities, shared collision snapshot              |
| Canonical pose/index membership   | Every pose/state transition atomically updates scene-owned derived memberships             |
| Collection fixed tick             | 50/300 eligible bodies use one scheduler participant and stable body order                 |
| Quiescent integration pruning     | Stable bodies skip solves but retain pose, indexes, target collision, reports, and visuals |
| Quiescent wake matrix             | Every proven drive/state/scene/contact input wakes before its required response            |
| Quiescent report maintenance      | Injected time advances proven contact expiry/end behavior without body integration         |
| Tick transport batching           | One fixed tick emits at most one changed-body batch across the Tauri boundary              |
| Dynamic pair response             | Stable-ID order converges within the bound despite reversed registration order            |
| Dynamic target geometry           | Every census-supported sphere/cylsphere/BSP branch uses its authoritative target shape    |
| Animated physics-BSP rejection    | WCID 52077 solver enablement fails before scene mutation; visual animation remains valid  |
| Dynamic pair filtering            | Effective masks independently select response, report production, and report identity     |
| Camera collision policy           | Synthetic camera is excluded unless explicit scenario policy opts it in                   |
| Swept candidate discovery         | Fast/cross-portal movement finds peers outside both bodies' prior committed buckets        |
| Adaptive dynamic contact          | Measured crossings are detected; over-budget displacement rejects before partial commit   |
| Pair processing ownership         | Two scheduled peers receive the proven response/report lifecycle exactly once             |
| Hard incremental solve rejection  | Invalid/unsupported body attempt preserves it without rolling back unrelated accepted bodies |
| Contact report lifecycle          | First touch/refresh/natural end/forced end occur once with no stale retained report state  |
| Outdoor-cell workload             | 50/300-body and adjacent-boundary scenarios meet the recorded fixed-tick budget           |
| Interior candidate partition      | Reached EnvCells find contacts without scanning unrelated cells; no subdivision is added  |
| Visible 300-entity lifecycle      | Host/frontend/renderer counts agree and teardown returns every count to baseline          |
| Despawn                           | Registry, body, frontend, behavior, and renderer counts return to baseline                |

No checked-in test may depend on a generated catalog or runtime archive absent from the repository.
The catalog crate uses small synthetic binary fixtures; exporter integration against a real ACE World
database and representative WCID/browser evidence are recorded diagnostics. A deliberately small
generated catalog fixture may be checked in only if its source/provenance and redistribution terms
are documented and the test requires the real binary boundary rather than mutable runtime data.

## Verification Commands

Run phase-scoped checks during execution and the complete set in Phase 8:

```console
cargo fmt --all -- --check
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p holtburger-tools --features weenie-catalog-export --lib --bin export-weenie-catalog
npm --prefix apps/holtburger-3d run format:check
npm --prefix apps/holtburger-3d run check
npm --prefix apps/holtburger-3d run lint
npm --prefix apps/holtburger-3d run test:ts
npm --prefix apps/holtburger-3d run harness:browser -- <recorded dynamic-entity scenario>
```

The TUI client is never run for diagnostics. Host-backed dynamic scenarios use the existing browser
harness or a focused noninteractive harness.

## Risks and Mitigations

| Risk                                                 | Mitigation                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Catalog becomes a disguised ACE database dump        | Bootstrap only survey inputs, then delete fields without runtime consumers at Phase R0                    |
| Flat format silently accepts corrupt offsets         | Validate the complete fixed index and every range before lookup; fuzz/truncation fixtures                 |
| Catalog bytes depend on codec implementation details | Freeze endian/encoding/order/limits explicitly and compare canonical byte fixtures                        |
| Optional catalog leaks into client/HBA content       | Dedicated crate and app-local discovery; acceptance forbids HBA/`ContentRepository` knowledge             |
| Shared path absorbs producer authority               | Distinct registry fixtures; shared contracts begin only at source-neutral definitions                     |
| Explorer is coupled to client `WorldState`           | Explorer registry and host scene remain app-local; reuse is limited to values and focused operations      |
| Registry mirrors solver-owned physical state         | Projection joins registry semantics with solver snapshots; outcomes update only named semantic consumers  |
| Entity publishes before body/resources are complete  | Prepare first, compensate partial install, and gate projection until semantic and body facts both exist   |
| Late solve mutates a replacement instance            | Composition-local instance generation rejects retired fixed-tick work                                     |
| Catalog defaults diverge from server-created objects | ACE factory/networking trace and representative parity fixtures; no legacy constant copied by faith       |
| Explorer GUID policy contaminates shared contracts   | App-local allocator; shared contract accepts identity but never allocates or brands its provenance        |
| Temporary authored-motion boundary becomes permanent | No semantic motion API/stub, explicit measured divergence, and dedicated shared cutover plan              |
| Fixed tick overlaps loaded collision-data update     | Tick keeps one immutable terrain/interior collision snapshot; the next tick sees the update              |
| Physics mask collapses into one collidable flag      | Per-bit ACE/retail matrix plus complete-mask transition fixtures; no silent inert bits                    |
| Removing solver state deletes entity pose/lifecycle  | Keep `SpatialBody` registered; mutate only collision/physics state and scheduler participation             |
| State transition retains incompatible response       | One reconciliation decision names preserved and cleared state for every transition                        |
| Pose and indexes become competing authorities        | Delete `entity_poses`; scene operations derive every membership from the canonical body pose              |
| Movement geometry is mistaken for target geometry    | R0 selects sphere/cylsphere/BSP branches; Phase 1B closes mutable BSP/script ownership before definitions freeze |
| Frontend animation becomes collision authority       | Solver owns root placement; ignored root frames carry the measured divergence, moving BSP physics rejects, and visual state never feeds backward |
| Packaged-app hydration grows into web recovery       | Keep one listener-before-current-snapshot mount path; add no replay, acknowledgement, retry log, or delivery history |
| Dynamic shadows duplicate existing spatial domains  | Reuse global 24 m outdoor cells and reached EnvCells; add no interior subdivision in this milestone       |
| Committed buckets miss a fast or cross-portal mover  | Query swept conservative bounds plus provisional reached cells before narrow phase                        |
| Swept broad phase is mistaken for proof of contact    | Query candidates once, then prove contact with bounded adaptive slices of both planned transforms         |
| Both scheduled bodies process a pair twice           | Freeze directional response and per-recipient lifecycle ownership before implementation                  |
| Incremental pair solving becomes nondeterministic    | Stable body/pair ordering and a measured convergence bound; do not promise simultaneous atomic state      |
| Collision hits are reduced to per-tick occurrences   | Retain first-touch/refresh/end state with injected time and forced teardown transitions                   |
| Diagnostics become a shadow product architecture     | Tests/harnesses own transient observation; ship no collision inspector, history, counters, recorder, or diagnostic DTO |
| Entity count multiplies scheduler/transport overhead | One collection participant and at most one changed-body Tauri batch per fixed tick                        |
| Resting bodies still consume full solver work        | Solver-owned settled state skips integration/mover queries while retaining a cheap stable scan            |
| Settled state becomes a second lifecycle authority   | Keep it derived on physical state; registry, index membership, presentation, and identity remain intact    |
| Settled bodies disappear as collision targets        | Retain spatial-index membership and wake response-eligible targets from active-peer contact               |
| Settled state freezes collision-report expiry        | Service the proven report lifecycle independently with the injected clock                                 |
| Wake dependencies grow into a physics island system  | Centralize wake operations and conservatively wake all when loaded static world collision changes          |
| Synthetic camera accidentally blocks spawned bodies | Make dynamic collision participation explicit and keep camera environment-only by default                |
| Frontend guesses an interior placement cell          | Send prior-cell hint plus candidate point; host collision transit resolves the committed EnvCell          |
| Generalization regresses authored dynamics           | Extract source-neutral visual facts and keep authored placement adapter; run authored suites/harness      |
| Scope grows into gameplay or server emulation        | Explicit out-of-scope list; future server handoff is documentation only                                   |
| Real ACE catalog cannot be redistributed             | Keep catalog generated/optional; record source revision and audit redistribution before checking in data  |

## Definition of Done

- [x] Offline exporter produces a deterministic, validated, WCID-indexed host catalog from ACE World
      without embedding MySQL in the runtime.
- [x] The catalog has a canonical portable byte contract—endianness, widths, encoding, ordering, and
      decode limits are explicit rather than serializer defaults.
- [ ] Catalog is optional, app-local, and entirely outside HBA/`ContentRepository`/browser contracts.
- [ ] Client `WorldState` and the app-local Explorer registry remain distinct semantic authorities
      feeding the same source-neutral definition, solver-outcome, and projection contracts.
- [ ] Each composition retains its own `SpatialScene`; Explorer camera and entity bodies share the
      existing `HostSimulationRuntime` store.
- [ ] The catalog preserves complete template physics-state inputs and the Explorer derives the same
      effective initial mask as ACE for every representative fixture.
- [ ] Every dynamic entity retains one pose body while collision/physics state and fixed-tick
      participation remain optional, reversible, and driven by complete physics-state replacement.
- [ ] `SpatialScene` owns the only physical pose and all derived landblock/outdoor/EnvCell
      memberships; no `entity_poses` mirror or caller-managed index choreography remains.
- [ ] Existing client `SetState` and Explorer scenario updates use the same per-bit reconciliation
      decision; no defined bit is silently discarded or flattened into a collidable boolean.
- [ ] Physical spawn, complete replacement, and despawn use ordered orchestration, compensate
      unpublished partial installation, and never duplicate solver-owned physical state in a registry.
- [ ] One focused dynamic-entity snapshot hydrates every frontend-relevant entity on initial mount or
      webview remount without replay history, whole-client machinery, or a delivery-recovery protocol.
- [ ] Explorer spawn-by-WCID crosses the real Tauri boundary into the existing template, animation,
      script, particle, audio, effect, scene, and renderer systems.
- [ ] Spawned entities advance through the existing fixed cadence, installed collision snapshot,
      generic solver, placed paths, and locally derived ground state.
- [ ] One collection scheduler participant visits eligible Explorer entities in stable body order,
      integrates only active bodies, and emits at most one focused changed-body batch per
      fixed tick.
- [ ] Solver-owned settled state skips integration and mover-side queries only after the proven stable
      predicate, retains body/index/target/report/presentation state, and wakes through every
      Phase R0-proven drive, state, scene, geometry, and peer-contact input.
- [ ] Collision-report lifetime and target-geometry maintenance remain correct while root-body
      integration is settled; no sleep islands, per-body timers, dependency graph, or second active-
      body registry lands without Phase R2 evidence.
- [x] Grounded static-contact correction remains bounded per substep, commits its latest finite
      candidate when overlap remains, continues ordinary displacement, prevents residual bodies from
      settling, and converges without retry bookkeeping or frontend-visible diagnostic state.
- [ ] The shared solver performs deterministic flag-filtered body-to-body contact and response,
      reuses outdoor global-cell and reached-EnvCell partitioning, handles 50-300 entities per
      populated landblock, queries swept/provisional domains, exercises every census-supported target
      geometry branch, adaptively samples both planned transforms across its supported path/shape
      envelope, rejects over-budget work before partial commit, processes each directional pair
      deterministically, and converges within the recorded tick bound.
- [ ] Collision reporting retains proven first-touch/refresh/natural-end/forced-end state with
      explicit per-recipient classification and no emitted-outcome history or Explorer diagnostic
      projection.
- [ ] Physics-driven entity motion uses retained velocity/acceleration/omega, launch, relocation,
      gravity, and collision response without adding semantic motion or root-path placeholders.
- [ ] Frontend presentation is smooth between physical host updates; the scoped command surface
      cannot select authored root motion, ignored setup-default root frames retain solver-owned root
      placement, and the measured `RETAIL DIVERGENCE` marker records the one-WCID consequence.
- [ ] Catalog absence/corruption, missing WCID, frontend remount, late assets, solver failures,
      relocation, replacement, teardown, and representative physics-state transitions have
      explicit tests or harness scenarios.
- [ ] Repeated lifecycle scenarios return all registry/body/frontend/resource counts to baseline.
- [ ] No duplicate authority or downstream path exists inside either composition, and no database
      engine, generic runtime hierarchy, or speculative server adapter survives.
- [ ] Architecture docs and parent roadmap match the landed ownership model.
- [ ] Formatting, checks, lint, tests, Clippy with warnings denied, and representative host/browser
      gates pass.

## Open Questions

None block the remaining milestone. Reached EnvCells remain the complete interior partition for this
scope. R2 found no evidence that another interior index would change a decision, so EnvCell
subdivision is deferred until a measured real workload exceeds the fixed-tick budget.

These are execution evidence gates, not invitations to guess or add fallback behavior.
