# Holtburger 3D Explorer Weenie Dynamic Runtime Plan

Status: Proposed — preempts `holtburger-3d-spawned-entity-explorer-runtime-plan.md`; not started
Created: 2026-08-16
Refined: 2026-08-16 — catalog-first census, canonical scene indexing, quiescent-body pruning,
collection fixed tick, evidence-selected dynamic geometry/collision lifecycle, and Explorer entity UX
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Predecessor: `docs/plans/holtburger-3d-spawned-entity-explorer-runtime-plan.md`

## Preemption Scope

This plan replaces the predecessor's execution order and first consumer. The predecessor remains a
historical evidence record for the completed convergence, snapshot-recovery audit, motion evidence
gates, and host-physics reconciliations. Its queued seven-phase implementation must not be executed.

The replacement milestone is one complete shared dynamic-entity realization/event path whose first real
consumer is an Explorer command that spawns a WCID from an optional, offline ACE World-derived weenie
catalog. An app-local Explorer registry owns that live instance, feeds a source-neutral definition
into the shared solver and frontend contracts, and reuses the current template, animation, effects,
scene, and renderer systems. The client keeps `WorldState` as its distinct entity authority and
feeds the same path from decoded server facts later; no server spawning, packets, session, or
transport are implemented here.

Physical participation is mutable entity state, not a spawn-time yes/no choice. The catalog retains
the complete ACE template physics-state inputs, the Explorer resolves them with DAT/setup-derived
facts, and the shared runtime applies complete state replacements through reversible physical-body
attachment/reconfiguration while retaining the entity's spatial pose owner.

The following predecessor contracts survive unchanged:

1. Producer authority remains composition-specific: `WorldState` for a client and an app-local
   registry for Explorer. Both feed the same source-neutral solver and projection contracts.
2. One focused reconstructable snapshot after startup/page reload plus ordered live deltas.
3. No frontend motion-table selection, authoritative placement, collision decisions, or per-frame
   host transform stream.
4. No second template cache, animation system, effect dispatcher, pose system, projection grammar,
   or solver integration path within a composition.
5. Explorer UX and catalog discovery remain app-local; shared realization and event mechanics remain
   source-neutral.
6. Feed epochs, global entity sequences, permanent generation tombstones, a stateful projector, and
   a stateful realization service require measured evidence and are not prerequisites.

## Context and Boundaries

### Goal

From the Explorer, spawn a real WCID at an explicit world pose into an app-local entity registry,
feed it through the same source-neutral solver/frontend realization contract available to
`WorldState`, render and animate it through the existing dynamic presentation runtime, advance its
`SpatialBodyId::Entity` through shared environment and dynamic-body collision, reconstruct it after
frontend reload, and despawn it without leaked registry, body, asset, effect, scene, or renderer
state.

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
  behavior, motion, projection, and presentation contracts without owning producer state.
- Complete lossless ACE `PhysicsState` template inputs: optional base mask, every corresponding
  nullable property-bool override, and related friction/elasticity/setup facts required to derive
  the effective initial state exactly.
- A source-neutral complete physics-state replacement operation shared by Explorer scenarios and the
  existing client `SetState` path.
- Reversible physical participation: every dynamic entity retains one spatial pose body while its
  optional physical attachment, collision participation, response policy, and fixed-tick
  participation are installed, detached, or reconfigured from the effective state.
- Shared source-neutral body commands, reliable committed solver outcomes, and pure projection
  functions used by client `WorldState` and the Explorer host.
- An app-local Explorer entity registry with ordered spawn, despawn, and complete replacement. It
  owns semantic state only; solver-owned physical state is joined for projection rather than copied.
- App-local Explorer identity allocation, spawn pose selection, scenario controls, and catalog policy.
- One focused dynamic-entity snapshot/event surface, listener-before-request startup, and
  listener/page-restart reconstruction. Explorer does not reuse the whole client view feed or add a
  delivery-recovery protocol without measured loss.
- One app-local Tauri relay and frontend current-entity mirror.
- A focused Explorer `Entities` tab for direct WCID spawning in front of the current camera, exact
  capability/error feedback, current spawned-entity inspection, selection, and despawn.
- A source-neutral frontend dynamic presentation input shared by authored and spawned adapters.
- Default setup appearance, animation, physics script, particles, audio, bounds, renderer submission,
  and generation-safe resource ownership for spawned entities.
- Setup-resolved grounded physical bodies, fixed-tick solver advancement, locally derived ground
  state, placed paths, non-gating scene residency, and sparse placement presentation.
- Dynamic body-to-body pair discovery, flag-driven filtering, narrow-phase contact/response, and
  collision-report events shared by Explorer and client compositions. The census selects the
  simplest adequate implementation; it does not gate this scope.
- Lossless dynamic-target geometry selected from setup spheres, cylspheres, or physics BSP according
  to retail/ACE rules, distinct from the movement/ground-response spheres where the rules differ.
- Collision start/end lifecycle with retained touch state and forced teardown, rather than
  stateless per-tick hit notifications.
- Solver-owned active/quiescent tracking that omits proven resting bodies from integration while
  retaining their pose, lifecycle, spatial-index membership, target collision, presentation, and
  collision-report maintenance.
- Content-built motion selection and resolved frontend animation/kinematics sufficient for explicit
  stand, move, turn, stop, teleport, pause, resume, and deterministic-step Explorer scenarios.
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
2. The first WCID must traverse the same source-neutral realization and projection contracts a later
   decoded server spawn will use, without sharing registries or pre-building the server adapter.
3. Semantic and physical authority remain separate. Ordered orchestration, compensation, and a
   projection join prevent partial publication; no cross-store transaction or duplicated pose is
   introduced.
4. One owner per composition owns each fact. Catalog owns templates; `WorldState` or Explorer registry
   owns live semantics; its composition-local spatial runtime owns bodies; frontend owns
   presentation; renderer owns batching.
5. Every live entity has one spatial pose owner; physical solver state is an optional, reversible
   attachment selected from the current effective `PhysicsState`, never the condition for entity
   existence.
6. The existing authored presentation runtime is generalized by subtraction: extract static-layer
   assumptions from its input rather than wrap it with a second spawned system.
7. Solver output is entity placement truth for locally simulated bodies. Ground classification is
   derived locally and never supplied by catalog or future server data.
8. The catalog is boring on purpose: fixed header, fixed sorted index, explicit payload codec,
   positioned reads, and no database engine.
9. Complete recovery precedes interesting behavior. If a page reload cannot reconstruct the current
   entity population, motion and effects are not ready to land.
10. Unsupported source facts fail with WCID and provenance, and every shared field/event/operation
    has a named same-phase producer and consumer. No guessed fallback or future-only scaffolding may
    make malformed input look valid.
11. Quiescence removes integration work, never the body. Resting bodies remain indexed collision
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
                                  source-neutral definitions/commands
                                                |
                              composition-local SpatialScene/solver
                                                |
                                  committed body outcomes/snapshots
                                      +---------+----------+
                                      |                    |
                         named semantic consumers     pure projection join
                                                           |
                                      focused dynamic-entity snapshot/deltas
                                                           |
                         narrow app-local Tauri relay
                                                           |
                         frontend current-entity mirror
                                                           |
        template / animation / scripts / effects / placement / renderer
```

The future network path joins at the source-neutral definition/command, committed-outcome, and
projection contracts. It keeps `WorldState` as its authority and uses `WorldState`'s own
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

The two semantic producer authorities are intentionally distinct, and each sits outside its
composition's physical authority:

- client composition: `WorldState::EntityManager` above the separate `WorldState.scene` body store;
- Explorer composition: an app-local `ExplorerEntityRegistry` above
  `HostSimulationRuntime`'s body store.

Neither registry is generalized into a universal store and Explorer does not instantiate
`WorldState`. The shared seam begins only after a producer has assembled source-neutral entity facts.
It consists of focused definition/body-command contracts, reliable committed solver outcomes,
solver snapshots, and pure frontend projection. Existing synchronous returns are the default
in-process delivery mechanism; do not add an async event bus, stateful funnel object, or trait unless
landed consumers prove it removes more code than it adds.

`SpatialScene` is the sole physical-state authority. Every live dynamic entity keeps one
`SpatialBody` for pose/kinematics/projection, while `SpatialBody::physical` is an optional and
reversible solver attachment. The producer registry owns the current complete effective
`PhysicsState` as semantic input. It may consume committed body outcomes when a named semantic rule
needs them, but it does not mirror pose, velocity, contact, response, residency, or placed-path state.
Projection joins the producer's semantic record with the current body view. The frontend receives
the resulting source-neutral view event; it does not become the backend event bus.

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

The catalog record, Explorer request, decoded setup, and derived body profile collapse into one
validated source-neutral definition (final name fixed during Phase 2). It contains semantic
appearance, behavior references, motion source, explicit initial pose/time, and either a complete
effective physics state plus every resolved geometry/response fact its current supported bits
require. It never contains a catalog path, SQL row, frontend node, asset payload, producer-registry
handle, or optional fields whose absence triggers an implicit runtime fallback.

One pure reconciliation decision compares the previous and next effective physics state and produces
the required spatial operations: retain pose-only body, attach physical state, detach physical state,
or replace/reconfigure physical state while preserving compatible pose/kinematics and clearing
incompatible contact/response memory. The same operation handles initial spawn and later complete
state replacement; consumers never hand-edit individual solver fields from bit changes.

Unsupported effective combinations are still losslessly representable. Explorer creation rejects
them before publication with WCID/mask/reason. An authoritative client `SetState` replacement retains
the received semantic mask, stops any now-invalid local simulation, and reports the unsupported
physical interpretation rather than continuing under stale behavior or rejecting server truth.

The Explorer driver reserves identity and validates replacement policy in its own registry; the
client continues to obtain identity/lifecycle from server-driven `WorldState`. All fallible content,
definition, and body preparation completes before either authority mutates. The composition then
serializes semantic registration and body installation, compensates an unpublished partial install
if an unexpected commit step fails, and publishes only the complete projection join.

This is ordered choreography, not a cross-store transaction. A solver rejection emits no committed
outcome. Failure to deliver a frontend event does not roll back accepted simulation; the complete
snapshot repairs presentation. Complete replacement retires the old scheduler participation and
body before publishing the successor. A composition-local instance generation rejects a late
outcome from retired work; no global sequence or permanent tombstone is introduced.

### Projection and Recovery

One focused `DynamicEntitySnapshot` contains every frontend-relevant dynamic entity joined with
appearance, behavior identity, body pose/kinematics/contact/residency, semantic motion, and one host
timeline mapping. Immutable assets are referenced by content identity. Animated attachment state
remains absent until its deferred scenario exists. Every field has a same-phase frontend consumer.

Startup and recovery are one state machine:

1. register the Rust receiver and frontend listener;
2. enter `awaiting-snapshot` and request current state;
3. ignore entity/body/motion deltas until the focused snapshot arrives;
4. atomically reconcile the frontend mirror; and
5. apply later focused deltas in order.

The startup/page-reload snapshot is reconstruction, not a delivery-recovery protocol. Do not add an
intermediary broadcast channel, feed sequence, acknowledgement, or automatic recovery without
measured need on the selected real Tauri boundary.

### Solver and Presentation Placement

One dynamic-entity subsystem participant owns the Explorer entity collection's fixed tick; individual
entities never reserve scheduler slots. The participant visits eligible bodies through an explicit
total ordering for `SpatialBodyId` rather than `HashMap` iteration and emits at most one focused Tauri
advance batch per fixed epoch. Static or otherwise unscheduled bodies may remain dynamic collision
targets without being tick participants, while the synthetic Explorer camera remains outside dynamic
entity collision unless its camera policy explicitly opts in.

Scheduling eligibility from the effective physics state is distinct from solver activity. An eligible
body becomes quiescent only after the Phase R0-proven number of consecutive accepted ticks establish
stable support, canonical zero velocity/omega, no current actuation or acceleration, and no pending
response or accepted motion path. Quiescence is solver-owned derived state, not a catalog fact,
registry semantic, frontend authority, or synonym for `Static`/`Frozen`. The collection participant
continues its cheap stable-order scan at the 50-300-body milestone and simply omits quiescent bodies
from integration and mover-side queries; do not add sleep islands, per-body timers, or a second
active-body registry without Phase R2 evidence.

A quiescent body retains its canonical pose, physical attachment, dynamic-shadow membership, target
geometry, report state, and presentation. Motion/actuation, velocity/acceleration/omega replacement,
teleport, physical-state reconciliation, a change to loaded static world collision, and a dynamic peer
interaction explicitly wake it before the next required solve. The loaded collision changes when the
host adds or removes relevant landblock collision assets; it does not replace bodies or either entity
registry. The first implementation may wake every quiescent body after that change rather than
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
Focused per-body outcomes are collected into the epoch batch. A failed body solve leaves that body's
previous accepted state intact without rolling back unrelated bodies.

Collision reporting is retained physical state, not tick-local deduplication. A touched pair refreshes
its proven lifetime record; first touch, expiry, reporting-state replacement, teleport, detach,
replacement, and despawn produce the ACE/retail-proven start/end outcomes. Expiry consumes an injected
clock so focused tests never sleep. Phase 5A extends the projection with active reported contacts and
recent start/end outcomes for the Explorer selected-entity inspector, giving the shared report
contract a real milestone consumer without moving gameplay into the solver.
Report expiry and forced-end maintenance remain serviced for quiescent bodies according to the Phase
R0-proven lifecycle; skipping integration cannot silently freeze or fabricate a contact lifetime.

The frontend receives sparse accepted path/anchor facts and evaluates presentation at render cadence.
Only its placement subsystem writes the entity root. Animation and effects write visual-root/part
state, never authoritative root placement. Teleport, complete replacement, resnapshot, and timeline
reset explicitly clear prediction and correction state.

## Phased Implementation

### Phase 0: Bootstrap the Export Contract

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

- Populate during execution. Stop for user review if the ACE schema cannot preserve a required
  distinction without importing unrelated gameplay tables.

### Phase 1: Build the Offline Explorer Weenie Catalog

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

- Do not add mmap, compression, checksums, secondary indexes, or template caching unless Phase R0
  measurements prove the simple reader insufficient.

### Phase R0: Survey the Catalog and Freeze the Runtime Scope

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
  integration quiescence, requires a target-geometry refresh only, or is outside the supported first
  population.
- Pick 3-10 named WCIDs covering ordinary creatures, simple objects, pose-only bodies, varied sphere
  geometry, collision-filter/reporting differences, appearance substitutions, default behavior, and
  malformed input. Record why each differs.
- Treat 50-300 spawned entities per populated landblock as the first-milestone workload envelope.
  Combine that known range with measured catalog geometry to validate dynamic-body stamping into the
  existing global 24 m outdoor-cell lattice, exact reached-EnvCell buckets, deterministic visit/pair
  ordering, narrow-phase/contact model, convergence rule, and collision-report contract. Include
  outdoor/EnvCell portal straddling and the active interest window; body-body collision is committed
  scope.
- Census authored and live-instance speed/acceleration bounds for the representative shapes,
  especially `Missile`, and compare per-tick displacement with target dimensions. Select and prove
  swept time-of-impact, bounded substeps, or another authoritative narrow-phase rule; swept bucket
  lookup alone must not be mistaken for continuous contact detection.
- Prove directional pair-processing and report ownership when both bodies are scheduled. Name which
  body solve may apply each response and which retained per-recipient record emits lifecycle events,
  so a pair is neither double-impulsed nor silently skipped by stable visitation.
- Audit the bootstrap catalog schema against the results. Delete survey-only fields with no runtime
  consumer, add only proven missing runtime facts, revise the still-unreleased format version as
  needed, and regenerate fixtures before Phase 2 contracts consume it.
- Dry-run the source-neutral realization seam from both `WorldState` and
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
- The activity census produces one explicit quiescence predicate, consecutive-stable-tick threshold,
  and complete wake matrix. It distinguishes integration, target-geometry maintenance, collision-
  report maintenance, animation, `Static`, and `Frozen`; no wall-clock inactivity heuristic is used.
- The measured sphere geometry and 50-300-entities-per-populated-landblock envelope validate outdoor
  global-cell stamping, update/rebuild policy, and cross-landblock candidate handling. EnvCells use
  their existing reached-cell partition unless a measured single-cell workload proves subdivision is
  necessary.
- The selected narrow phase cannot tunnel through the smallest supported representative target at
  the largest supported per-tick displacement, and two scheduled bodies process/report a pair with
  one explicit deterministic ownership rule.
- The finalized catalog contains only facts consumed by runtime realization or retained provenance,
  and its fixed index/record choices are justified by measured distributions.
- The boundary dry-run proves that neither producer registry nor `SpatialScene` instance must move,
  and that no new event bus or stateful funnel is required to share the realization operations.
- No unresolved source rule becomes a fallback, and no set physics bit is silently inert.

#### Decisions and Course Corrections

- Record the catalog revision and the selected collision algorithm before Phase 2. Stop for user
  review if ACE and retail disagree on consumer-visible behavior or the observed collision model
  requires a materially broader gameplay simulation than contact/report production.

### Phase 2: Land Shared Definitions and Committed Solver Outcomes

#### Deliverables

- Define the validated source-neutral dynamic-entity definition and prepared realization facts. They
  carry identity, appearance, placement, body, and presentation inputs, but no producer-registry
  handle, server/catalog provenance, Tauri type, or storage policy.
- Add the app-local `ExplorerEntityRegistry` as Explorer's semantic instance authority. It owns
  identity, lifecycle, current source-neutral facts, and replacement policy; it is not a Tauri DTO
  cache or a narrowed copy of `WorldState`.
- Extract only the reusable operations proven by both compositions: content/body resolution,
  validation, body commands against a supplied `SpatialScene`, complete committed body outcomes, and
  pure projection inputs. Prefer focused functions, concrete values, and existing scene APIs.
- Make physical attachment explicitly optional and reversible on an existing `SpatialBody`. Add one
  focused attach/detach/reconfigure operation that returns the old/new physical participation and
  preserves pose/kinematics while clearing response memory made invalid by the transition.
- Replace movement-sphere-only assumptions with the smallest Phase R0-proven physical composite:
  movement/ground response geometry, dynamic-target geometry, scheduling eligibility, dynamic
  collision participation, response, and reporting are distinct decisions but one validated value.
  Reuse geometry when the authoritative branches are identical; do not duplicate it for type-shape
  convenience.
- Add solver-owned active/quiescent state to the physical body composite. It records only the minimal
  consecutive-stability evidence needed by the proven predicate; scheduling eligibility remains a
  separate result of effective-state reconciliation. Producer registries never mirror activity.
- Centralize activity invalidation on scene/body operations so actuation, kinematic replacement,
  teleport, physical reconfiguration, and a change to loaded static world collision cannot forget to
  wake affected bodies. Prefer waking all quiescent bodies after that collision changes over a
  speculative support-dependency graph.
- Add the pure effective-physics-state resolver and state-transition decision from the Phase R0
  matrix. Initial Explorer catalog resolution and existing client `SetState` updates invoke the same
  logic; neither producer re-derives bit semantics.
- Keep the client composition unchanged in shape: `WorldState` retains its `EntityManager` and
  `SpatialScene`. Adapt its existing entity/body path only where needed to consume the same
  source-neutral operations and prove that the seam is real. This is a structural reuse check over
  existing client behavior, not implementation of server spawning.
- Keep the Explorer composition unchanged in shape: `HostSimulationRuntime` retains its
  `SpatialScene`; camera and Explorer entity bodies use that one Explorer-local store under distinct
  `SpatialBodyId` variants.
- Add a focused host operation for registering/upserting a caller-supplied
  `SpatialBodyId::Entity`. Keep ephemeral ID allocation as camera/frontend policy; the simulation
  runtime never allocates or rewrites Explorer entity identity.
- Give `SpatialBodyId` one explicit total order consumed by fixed ticks, candidate deduplication, and
  collision lifecycle keys. Hash-map or registration iteration order is never observable.
- Collapse `SpatialScene::entity_poses` into canonical body poses and route registration, accepted
  pose updates, physical attachment changes, teleport, and removal through scene operations that also
  maintain coarse entity and dynamic-shadow memberships. Delete caller-side index choreography and
  prove existing range/liveness queries against the body-owned pose.
- Add the lossless semantic appearance composite currently discarded by the client `Entity`, with
  explicit ordered substitutions and source content identities required by presentation. The shared
  projection consumes the composite without owning either producer registry.
- Make spawn/complete-replace/despawn ordered at the outer producer runtime. Complete preparation
  precedes mutation; an unexpected partial install is compensated before publication, and projection
  joins semantic plus solver state only when both exist.
- Return committed solver outcomes synchronously from the existing body operations. Let registries
  consume only named semantic consequences; never copy the complete physical state into them. Add an
  internal publisher only if Phase R0 finds a concrete consumer that cannot use the returned value.
- Add app-local Explorer GUID allocation and prove reset, repeated spawn, same-WCID independent
  identity, same-GUID replacement, and exhaustion behavior. Do not expose allocation policy in
  shared types.

#### Acceptance Criteria

- Explorer does not construct, wrap, or depend on `WorldState`; its registry is the only Explorer
  semantic entity authority.
- Exactly one `SpatialScene` exists in the Explorer host composition and owns camera plus entity
  bodies under distinct `SpatialBodyId` variants. The client retains its separate scene.
- Existing client `WorldState` tests pass without moving its entity manager or scene into a common
  store.
- Equal source-neutral definitions produce equivalent committed body outcomes and projected views in
  focused Explorer-registry and `WorldState` fixtures.
- Failed definition/body validation produces no committed outcome or projected event. Any
  unpublished partial semantic/body install is compensated.
- Successful physical spawn publishes only after the semantic record and
  `SpatialBodyId::Entity` both exist.
- A retired instance generation ignores late fixed-tick outcomes after same-GUID replacement.
- Toggling the named gravity/collision/response/scheduling flags installs, detaches, or reconfigures
  physical state exactly once without removing the semantic entity or its pose body.
- A static/unscheduled collision target remains indexed without reserving a fixed-tick slot, while an
  environment-only synthetic camera body is excluded from entity collision by explicit camera policy.
- A quiescent eligible body remains registered, projectable, indexed, and target-collidable while
  consuming no integration solve; every Phase R0 wake input reactivates it through one scene-owned
  operation without producer-registry choreography.
- Every body pose mutation updates or invalidates all derived memberships in the same scene operation;
  no stale `entity_poses`, landblock, outdoor-cell, or EnvCell entry survives.
- Existing client `SetState` tests prove that a complete mask replacement reconciles its
  `WorldState.scene` through the same operation and emits the resulting semantic/body events.
- A client `SetState` containing an unsupported combination preserves the new complete mask, retires
  invalid local solver participation, and reports one explicit unsupported interpretation; Explorer
  spawn with the same mask publishes nothing.
- Despawn and replacement remove every old body and semantic state exactly once.
- Catalog, SQL, Explorer registry/scenario, Tauri, and frontend types are absent from shared
  world/core contracts.

#### Decisions and Course Corrections

- Stop for user review if sharing requires either producer to surrender authority, either
  `SpatialScene` to move between compositions, an async backend event bus, or a generic runtime
  hierarchy. The intended seam is value contracts and operations, not a shared runtime owner.

### Phase 3: Land Focused Projection and Recoverable Host Delivery

#### Deliverables

- Define one source-neutral projected entity composite, focused `DynamicEntitySnapshot`, and focused
  incremental event grammar in `holtburger-core`. Projection is a pure join over semantic facts,
  current solver facts, and immutable asset identities.
- Adapt the client to carry this focused surface inside its broader initial-view and `ClientViewEvent`
  paths. Explorer relays the focused surface directly; it does not construct `ClientRuntime`, request
  fellowship/vendor/trade state, or reuse the whole client feed.
- Replace runtime-body-only reset/snapshot vocabulary only where the focused dynamic snapshot
  supersedes it. Do not generalize unrelated client snapshot machinery.
- Add an app-local Explorer entity driver that resolves a catalog template plus DAT/setup facts into
  the Phase 2 definition and invokes the shared body operations against the Explorer registry and
  host simulation. Dependencies—catalog, content, clock, identity allocator, registry, host
  simulation, and projection—are injected. The driver obtains collision snapshots through the host
  simulation rather than a parallel service.
- Add app-local catalog discovery/configuration and capability reporting. Absence disables only
  Explorer WCID spawning; malformed or incompatible configured files report their exact failure, and
  MySQL remains absent from the Tauri host's runtime dependency graph.
- Add typed Tauri commands for catalog capability, reset, spawn-by-WCID-at-candidate-pose, despawn,
  and complete effective-physics-state replacement for the named flag-transition scenarios. The
  Explorer spawn command carries the current host-projected camera pose as a prior-cell hint plus an
  explicit candidate point; the host normalizes outdoor coordinates and resolves final EnvCell
  placement through existing collision transit. Commands serialize into the driver and never mutate
  a second Tauri entity store. Exercise complete entity replacement through focused
  production-contract tests unless an Explorer scenario proves it needs its own command.
- Select one narrow Tauri relay, register the frontend listener before requesting delivery, and
  implement listener-before-request plus explicit page-reload reconstruction.
- Add tests for mutation-before-snapshot, mutation-after-snapshot, deltas while awaiting snapshot,
  listener restart, webview reload handshake, and unrelated event preservation.

#### Acceptance Criteria

- One focused snapshot reconstructs every projected dynamic entity/body without replay history.
- No entity delta applies while awaiting a replacement snapshot.
- The Explorer and existing client projection paths produce equal view entities from equal
  source-neutral entity and current-body facts.
- Tauri carries projected semantic contracts, not raw catalog records, MySQL rows, or `Entity` dumps.
- Camera-relative spawning performs no frontend landblock normalization or portal traversal; the
  committed entity pose is the host-resolved result or one exact failure.
- No channel, feed sequence, acknowledgement, or automatic recovery exists without a measured
  requirement.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 4: Generalize and Reuse Frontend Dynamic Presentation

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

- Populate during execution.

### Phase R1: Visible-Entity Resteering Checkpoint

- Exercise the Phase 4 vertical slice with every Phase R0 representative WCID and record unsupported
  or malformed source facts by WCID.
- Audit the catalog schema: delete exported fields without consumers; add no field without updating
  its producer/consumer table and format version decision.
- Audit lifecycle ownership and resource release under repeated spawn/despawn/replacement and page
  reload before solver state adds another mutable subsystem.
- Re-dry-run Phases 5-7, including Phase 5A, against the landed value/event contracts, Explorer
  registry, relay, and frontend placement contracts.
- Reconcile the Phase R0 collision design against the now-landed body/event contracts before Phase
  5A; do not let frontend integration accidentally dictate solver shapes.

### Phase 5: Attach Spawned Entities to the Shared Solver

#### Deliverables

- Resolve the spawned template's SetupModel and runtime scale through the existing content service;
  resolve its ordinary motion spheres through `resolve_setup_physical_spheres`; combine them with the
  current effective physics state to select the Phase R0-proven physical participation and response.
- Register every entity pose as `SpatialBodyId::Entity` in `HostSimulationRuntime`'s existing
  `SpatialScene`; attach solver state only when selected by the effective physics state. The camera
  remains `Ephemeral`; both use the same Explorer-local store and immutable collision snapshot when
  physically participating.
- Apply complete physics-state replacements through the Phase 2 reconciliation operation. Exercise
  at least attach, detach, gravity on/off, collision participation on/off, frozen/unfrozen, and every
  response-policy transition present in the representative census. Preserve pose and compatible
  velocity; clear incompatible contact, response, path, prediction, and scheduler state exactly once.
- Add one Explorer dynamic-entity collection participant using one `HostFixedTickRuntime` slot. Each
  epoch it snapshots explicit simulation interest, obtains the stable eligible-body order, resolves
  current actuation, invokes focused host solves under one collection tick, rejects outcomes from
  retired instance generations, and collects committed placed-path/body outcomes. No entity reserves
  its own scheduler slot or reacquires the host simulation lock independently.
- Evaluate the Phase R0 quiescence predicate after accepted solves and skip integration/mover queries
  for quiescent bodies while retaining the stable-order collection scan. Animation, presentation,
  target indexing, and collision-report lifetime remain independently serviced.
- Preserve the landed ground vocabulary and contact plane. Supported/sliding/airborne is derived by
  the local solver; catalog and scenario commands cannot assert it.
- Route teleport and forced reset through explicit registry/body operations that clear response,
  prediction, path, and frontend correction state coherently.
- Add app-local scenario simulation-interest policy around named entity/camera owners. Bodies report
  `MissingOwner`/`OutsideLandscape` without loading, suspending, or evicting collision.
- Serialize accepted placed paths or sparse anchors with host time and correction kind. Frontend
  placement evaluates the path at render cadence and never performs portal traversal.
- Emit at most one focused dynamic-body advance batch per fixed epoch, containing only changed
  projected bodies. Do not turn 300 bodies at 30 Hz into 9,000 Tauri events per second.
- Add deterministic zero-actuation settle/fall/slide scenarios before locomotion: supported floor,
  steep contact-slide, airborne fall, cross-owner traversal, missing-owner open space, and teleport.
- Add deterministic quiescence scenarios: stable supported entry after the proven tick count, no
  entry while airborne/sliding/Sledding/responding, and wake on drive, launch, velocity/acceleration/
  omega, teleport, physical-state replacement, and changes to loaded static world collision.

#### Acceptance Criteria

- A spawned creature falls or settles through the existing physical solver and visibly follows the
  accepted placed path without per-frame host messages.
- A pose-only entity remains present and projectable with no physical attachment; enabling and later
  disabling its supported physics state attaches and detaches solver participation reversibly.
- Camera and entity bodies coexist in the Explorer host store and can tick against the same exact
  collision snapshot without affecting each other's identity or response state.
- One collection scheduler registration visits every eligible Explorer entity; static/frozen/
  pose-only and quiescent bodies consume no integration solve, no entity consumes its own scheduler
  slot, and one epoch produces at most one Tauri advance event.
- Quiescence changes neither body/index/frontend counts nor pose. Waking resumes from the retained
  canonical state, and changes to loaded static world collision may conservatively wake all bodies.
- A rejected solve produces no committed outcome. A frontend delivery failure leaves accepted solver
  state intact and converges through the focused snapshot.
- Ground state is locally derived and the old `apply_runtime_body_contact` stopgap loudly refuses to
  overwrite a physically simulated entity.
- Missing collision content remains explicit open-space residency and does not gate motion.
- Every physics-state bit occurring in the representative population or mutation scenarios has its
  Phase R0-proven behavior; unsupported combinations fail explicitly before publication.
- Animation, effects, renderer, and frontend scene code never write authoritative entity placement.

#### Decisions and Course Corrections

- Populate during execution. Any deliberate observable retail departure requires the project's
  `RETAIL QUIRK` or `RETAIL DIVERGENCE` marker with decompile citation, consequence, and census.

### Phase 5A: Add Dynamic Body Collision and Reporting

#### Deliverables

- Add one `SpatialScene`-owned dynamic shadow index over all physically participating bodies and visit
  scheduled bodies in stable `SpatialBodyId` order. Preserve focused single-body solving; do not
  introduce a whole-world transaction merely to make simultaneous contact look mathematically tidy.
- Extract or reuse the existing collision-domain keying rather than creating a competing generic
  index: stamp conservative bounds for the Phase R0-proven target geometry into every overlapped
  global 24 m outdoor cell and register the body in every exact EnvCell reached by its
  `CollisionPlacement`. A portal-straddling body registers in both domains; cross-landblock outdoor
  bounds require no seam-specific bucket.
- Query the union of buckets overlapped by the mover's swept conservative bounds plus provisional
  reached EnvCells, then sort/deduplicate stable body IDs before filtering and narrow phase. Looking
  only at either body's last committed buckets is incorrect for fast motion and portal entry. Keep
  index maintenance, candidate generation, physics-state filtering, and narrow phase separate and
  independently testable.
- Do not subdivide an EnvCell in the first implementation. Phase R2 may add an EnvCell-local index
  only if a measured single-cell population makes its bounded candidate scan miss the fixed-tick
  budget.
- Implement the ACE/retail-proven dynamic collision eligibility and reporting decisions from the
  complete effective masks, including ethereal/ignore/report flags and
  `ReportCollisionsAsEnvironment`. Do not conflate physical response, report production, and the
  identity/classification presented to a report consumer.
- Resolve mover geometry against the Phase R0-supported peer target branches—setup spheres,
  cylspheres, and/or per-part physics BSP—alongside environment contact. Do not substitute movement
  spheres for target geometry merely because both are spatial primitives. Commit each accepted body
  independently, update or invalidate its broad-phase entry according to the selected maintenance
  policy, and allow peer response to converge within a documented bounded number of ticks. Stable
  visitation—not simultaneous atomicity—provides reproducibility.
- Apply the Phase R0-selected continuous-contact rule and deterministic directional pair ownership.
  Broad-phase swept bounds are candidate discovery, not proof of a hit; response and report refresh
  occur only from the authoritative narrow-phase result.
- Define the smallest source-neutral collision start/end values and retained active-contact record
  proven by ACE/retail and the selected-entity inspector. First touch emits start, subsequent touches
  refresh without another start, expiry emits end, and forced teardown/state changes emit the proven
  end/restart sequence. Keep contact response and per-recipient report classification distinct; the
  solver does not implement combat, AI, damage, or Explorer UI policy.
- Extend the focused snapshot/deltas and `ExplorerEntitiesPanel.svelte` selected-entity inspector
  with active reported contacts and recent start/end outcomes. Batch report changes with the epoch's
  focused body advance rather than emitting one Tauri event per pair.
- Reconcile attach, detach, complete state replacement, teleport, despawn, and same-GUID replacement
  while bodies are touching. Each transition clears only invalid contact/response/report state and
  cannot leave a retired body in pair discovery.
- Treat a quiescent body as a normal broad-phase target. Contact from an active mover wakes a
  response-eligible peer for deterministic later convergence; report-only contact follows the proven
  lifecycle without requiring unnecessary integration. A quiescent target is never removed from
  candidate discovery.
- Add focused unit scenarios for disjoint/overlapping/moving pairs, every supported target-geometry
  branch, static versus pushable participants, explicit camera exclusion, reciprocal and
  environment-classified reports, filtered contacts, first-touch/refresh/natural-end/forced-end,
  high-displacement crossing/tunneling bounds, two-scheduled-body pair ownership, three-body ordering,
  simultaneous environment contact, one-body solve rejection, swept
  cross-landblock overlap, outdoor/EnvCell portal straddling, shared/adjacent EnvCells, and 50/300-body
  outdoor-cell workloads, active-mover contact with an unscheduled `Static` target and with quiescent
  pushable/report-only targets, and report expiry while integration is skipped. Inject time for report
  expiry; tests never sleep.

#### Acceptance Criteria

- Representative dynamic pairs make contact and converge to the Phase R0-proven response within the
  documented tick bound. Reversing registry insertion order leaves stable-ID visitation and results
  unchanged.
- Filtered pairs neither respond nor report; response-only and reportable pairs differ exactly where
  the effective masks require them to.
- Every reportable contact produces one start, refreshes retained state without repeated starts, and
  produces the correct natural or forced end plus per-recipient environment classification. The
  selected-entity inspector reconstructs active contacts from a snapshot and displays later
  lifecycle outcomes without becoming collision authority.
- A rejected body solve preserves that body's previous accepted state and emits no report from the
  rejected attempt; already accepted unrelated bodies are not rolled back.
- Detach, despawn, teleport, and replacement during contact leave no stale pair, response, scheduler,
  or report state.
- Quiescent targets remain discoverable; pushable contact wakes exactly the required response work,
  while report lifecycle time advances correctly even when neither body integrates.
- Outdoor bodies reuse the existing global-cell spatial vocabulary and interior bodies reuse reached
  EnvCell identity. No second generic spatial index, EnvCell subdivision, pair cache, or concurrency
  mechanism exists without a measured consumer.
- A fast mover and a portal-straddling mover discover peers through swept/provisional domains, and
  each supported target-geometry branch is exercised without treating movement spheres as a fallback.
- The smallest supported target cannot be crossed at the largest supported per-tick displacement
  without the selected narrow phase detecting contact, and a mutually scheduled pair receives no
  duplicate response or lifecycle transition.

#### Decisions and Course Corrections

- Populate during execution. Stop for user review if authoritative evidence requires gameplay-owned
  state to calculate physical contact rather than merely consume its report.

### Phase R2: Solver Evidence Resteering Checkpoint

- Run the named 50- and 300-body landblock workloads plus adjacent-landblock boundary cases. Record
  broad-phase candidates, narrow-phase tests by target-geometry branch, fixed-tick time, convergence
  ticks, report lifecycle volume, scheduler-slot count, active/quiescent counts, integration solves
  skipped, wake reasons, and Tauri batch/event count; these diagnostics exist only to decide the
  remaining design and are not production metrics.
- Audit outdoor-cell and reached-EnvCell maintenance, stable visitation, contact convergence,
  swept/provisional queries, transition cleanup, and report start/refresh/end behavior against real
  catalog-derived geometries. Add EnvCell-local subdivision only if a recorded single-cell case
  exceeds the fixed-tick budget.
- Audit quiescence churn and wake correctness across the representative workload. Keep the stable
  collection scan unless its measured cost is material; do not add sleep islands, dependency graphs,
  per-body timers, or a second active-body index merely because many bodies become quiescent.
- Re-dry-run motion and end-to-end Phases 6-8 against the landed solver outcomes. Revise path,
  correction, scheduling, and harness contracts before motion builds on accidental solver behavior.
- Record newly supported and still-unsupported physics-state combinations by WCID, then update the
  remaining acceptance matrix and cleanup targets.

### Phase 6: Resolve and Execute Entity Motion

#### Deliverables

- Complete the Phase R0 retail/ACE evidence for transition, interruption, reversal, speed scaling,
  finite links/cycles, animation ranges/rates, and animation position-frame composition with
  velocity/omega.
- Extend the existing content-owned `MotionKinematics` asset and focused source-neutral resolution
  functions from client HBA/DAT facts where the Phase R0 scenarios prove a gap. They consume parsed
  motion facts and never content paths or a `WorldState` instance. Do not introduce separate
  `MotionCatalog` or `MotionResolver` services unless the concrete data access can no longer fit the
  existing seams cleanly.
- Replace reduced `MotionKinematics` as the authoritative selector where the named scenarios require
  richer facts. Retain a reduced diagnostic projection only with a distinct consumer.
- Resolve semantic entity motion once into the smallest host-owned value whose selected animation
  and solver kinematics derive from the same authored motion records and effective host time. Name a
  new plan type only when the proven fields require one.
- Add typed Explorer stand, forward, turn, stop, pause, resume, deterministic-step, and timeline-reset
  commands. Scenario policy chooses commands; the shared motion resolver chooses authored semantics.
- Project focused plan updates with absolute effective time. Frontend stages referenced animations,
  starts late-ready plans at the correct semantic cursor, uses existing hook catch-up, and samples
  smoothly without another pose path.
- Apply animation position-frame/root contribution exactly once according to the proven composition;
  the frontend never independently re-derives it.

#### Acceptance Criteria

- One resolved host plan drives many solver and render frames without repeated semantic selection.
- Animation selection and solver actuation originate from the same resolved authored records.
- A reference-backed test distinguishes root contribution from velocity/omega-only motion and proves
  it is applied once.
- Pause/step/timeline tests use injected clocks and never sleep.
- Superseded or late-ready plan preparation cannot affect a replacement entity.
- Raw motion tables remain outside Tauri DTOs and TypeScript.
- Missing or invalid motion dependencies fail explicitly without substituting unrelated playback.

#### Decisions and Course Corrections

- Stop for user review if retail evidence leaves root/velocity composition ambiguous.

### Phase 7: Prove the Complete Explorer Consumer

#### Deliverables

- Add a host-backed scenario suite covering catalog unavailable/corrupt, absent WCID, repeated WCID
  identities, spawn/despawn, complete replacement, stand/move/turn/stop, settle/fall/slide, continuous
  path, teleport, missing collision owner, listener restart, page reload, late assets, pause/resume,
  deterministic step, timeline reset, pose-only spawn, physical attach/detach, two-body contact,
  filtered/report-only contact, contact-time replacement, and the Phase R0 representative
  physics-state transitions.
- Include mixed active/quiescent populations, active-peer wake of a pushable target, report-only
  contact without unnecessary integration, wake after loaded static world collision changes, and
  continued visual animation while root-body integration is quiescent.
- Run both 50- and 300-entity visible landblock scenarios through the real host/browser boundary,
  including mixed scheduled/static targets and at least one catalog-proven geometry mix.
- Extend the noninteractive browser harness with typed commands and machine-readable dynamic-entity
  state: live Explorer registry entities, host bodies, frontend owners, pending stages, behavior
  owners, placed paths, renderer contributions, browser errors, and relevant resource counts.
- Add focused fault injection for catalog decode, content lookup, template preparation, solver
  acceptance, physics-state reconciliation, and frontend publication.
- Record ad hoc measurements only where a design decision requires them. Do not add production
  metrics for catalog lookup, spawn, ticks, publication, resources, uploads, or draws without a
  scenario where the value changes a decision.
- Record the future server handoff: which decoded spawn/update facts construct the shared
  source-neutral definition and which Explorer-only inputs disappear. Do not implement the adapter.
- Decide whether focused appearance mutation or animated attachments now have a concrete Explorer
  scenario. If yes, author a follow-on plan; do not append dormant operations here.

#### Acceptance Criteria

- Entering a representative WCID and pose produces one visible, animated, solver-backed entity over
  the real host/browser boundary.
- The entity reconstructs after page reload with equivalent semantic, physical-participation, and
  presentation state.
- Repeated spawn/despawn/replacement returns every tracked owner/resource/body count to baseline.
- Repeated physical attach/detach/reconfigure returns scheduler and response-state counts to baseline
  without changing entity identity or pose-body count.
- Quiescent bodies remain visible and collision-queryable, wake through every proven input, and reduce
  integration solves in the 50/300-body scenarios without adding frontend events for unchanged poses.
- Host traffic scales with semantic mutations, fixed solver paths, and sparse anchors—not render
  frames or frontend portal crossings.
- The 300-entity scenario uses one collection scheduler participant and at most one focused advance
  event per fixed epoch; frontend owner, renderer contribution, and resource counts match the live
  registry population and return to baseline after teardown.
- The scenario uses no live ACE Server/MySQL connection after the catalog has been generated.
- No metric, field, or diagnostic survives without a scenario where it changes or a named consumer.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 8: Clean Cutover and Architecture Audit

#### Deliverables

- Delete superseded runtime-body-only snapshot/cache vocabulary, reduced authoritative motion paths,
  authored-only visual-input naming, temporary migration adapters, donor DTOs, duplicate projections,
  and obsolete comments.
- Sweep deleted/renamed mechanisms through symbols, metrics, docs, UI labels, harness output, and
  tests. Do not retain compatibility aliases.
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
| Listener/page restart             | Listener registers first; one snapshot reconstructs current state                         |
| Pose-only entity                  | Entity and spatial pose remain projected with no physical attachment or fixed tick        |
| Physics-state attach/detach       | Same identity/pose body gains and loses solver participation without residue              |
| Physics-state reconfigure         | Gravity/collision/response/scheduling transitions clear only incompatible mutable state   |
| Complete state replacement        | Explorer and client paths derive equal operations from the same previous/next masks       |
| Late asset readiness              | Absolute plan cursor and generation guard prevent stale publication                       |
| Solver settle/fall/slide          | Local contact classification and accepted placed path drive presentation                  |
| Missing collision owner           | Open-space motion continues with explicit non-gating residency                            |
| Continuous path                   | Smooth render-cadence placement without per-frame host transforms                         |
| Teleport/timeline reset           | Immediate path/prediction reset with no old motion continuation                           |
| Camera/entity coexistence         | One Explorer host body store, distinct identities, shared collision snapshot              |
| Canonical pose/index membership   | Every pose/state transition atomically updates scene-owned derived memberships             |
| Collection fixed tick             | 50/300 eligible bodies use one scheduler participant and stable body order                 |
| Quiescent integration pruning     | Stable bodies skip solves but retain pose, indexes, target collision, reports, and visuals |
| Quiescent wake matrix             | Every proven drive/state/scene/contact input wakes before its required response            |
| Quiescent report maintenance      | Injected time advances proven contact expiry/end behavior without body integration         |
| Epoch transport batching          | One fixed epoch emits at most one changed-body/report batch across the Tauri boundary      |
| Dynamic pair response             | Stable-ID order converges within the bound despite reversed registration order            |
| Dynamic target geometry           | Every census-supported sphere/cylsphere/BSP branch uses its authoritative target shape    |
| Dynamic pair filtering            | Effective masks independently select response, report production, and report identity     |
| Camera collision policy           | Synthetic camera is excluded unless explicit scenario policy opts it in                   |
| Swept candidate discovery         | Fast/cross-portal movement finds peers outside both bodies' prior committed buckets        |
| Continuous dynamic contact        | Largest supported step cannot tunnel through the smallest supported target                |
| Pair processing ownership         | Two scheduled peers receive the proven response/report lifecycle exactly once             |
| Incremental solve rejection       | Rejected body attempt preserves it without rolling back unrelated accepted bodies         |
| Contact report lifecycle          | First touch/refresh/natural end/forced end occur once with no stale retained report state  |
| Outdoor-cell workload             | 50/300-body and adjacent-boundary scenarios meet the recorded fixed-tick budget           |
| Interior candidate partition      | Reached EnvCells find contacts without scanning unrelated interior cells                  |
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
| Solver and frontend both advance root motion         | One resolved host rule and one frontend placement owner; root contribution gate in Phase 6                |
| Fixed tick races collision replacement               | Tick captures one immutable `Arc<CollisionScene>`; staged replacement remains atomic                      |
| Physics mask collapses into one collidable flag      | Per-bit ACE/retail matrix plus complete-mask transition fixtures; no silent inert bits                    |
| Detach deletes entity pose/lifecycle                 | Keep `SpatialBody` registered; mutate only optional physical attachment and scheduler participation       |
| State transition retains incompatible response       | One reconciliation decision names preserved and cleared state for every transition                        |
| Pose and indexes become competing authorities        | Delete `entity_poses`; scene operations derive every membership from the canonical body pose              |
| Movement geometry is mistaken for target geometry    | R0 census/proof selects sphere/cylsphere/BSP target branches before the physical composite freezes        |
| Dynamic shadows duplicate existing spatial domains  | Reuse global 24 m outdoor cells and reached EnvCells; subdivide interiors only from measured need         |
| Committed buckets miss a fast or cross-portal mover  | Query swept conservative bounds plus provisional reached cells before narrow phase                        |
| Swept broad phase is mistaken for continuous contact | Census displacement/shape bounds and prove swept TOI or bounded substeps in narrow phase                  |
| Both scheduled bodies process a pair twice           | Freeze directional response and per-recipient lifecycle ownership before implementation                  |
| Incremental pair solving becomes nondeterministic    | Stable body/pair ordering and a measured convergence bound; do not promise simultaneous atomic state      |
| Collision hits are reduced to per-tick occurrences   | Retain first-touch/refresh/end state with injected time and forced teardown transitions                   |
| Entity count multiplies scheduler/transport overhead | One collection participant and at most one changed-body/report Tauri batch per fixed epoch                |
| Resting bodies still consume full solver work        | Solver-owned quiescence skips integration/mover queries while retaining a cheap stable scan               |
| Quiescence becomes a second lifecycle authority      | Keep it derived on physical state; registry, index membership, presentation, and identity remain intact    |
| Quiescent bodies disappear as collision targets      | Retain dynamic-shadow membership and wake response-eligible targets from active-peer contact              |
| Quiescence freezes collision-report expiry           | Service the proven report lifecycle independently with the injected clock                                 |
| Wake dependencies grow into a physics island system  | Centralize wake operations and conservatively wake all when loaded static world collision changes          |
| Synthetic camera accidentally blocks spawned bodies | Make dynamic collision participation explicit and keep camera environment-only by default                |
| Frontend guesses an interior placement cell          | Send prior-cell hint plus candidate point; host collision transit resolves the committed EnvCell          |
| Generalization regresses authored dynamics           | Extract source-neutral visual facts and keep authored placement adapter; run authored suites/harness      |
| Scope grows into gameplay or server emulation        | Explicit out-of-scope list; future server handoff is documentation only                                   |
| Real ACE catalog cannot be redistributed             | Keep catalog generated/optional; record source revision and audit redistribution before checking in data  |

## Definition of Done

- [ ] Offline exporter produces a deterministic, validated, WCID-indexed host catalog from ACE World
      without embedding MySQL in the runtime.
- [ ] The catalog has a canonical portable byte contract—endianness, widths, encoding, ordering, and
      decode limits are explicit rather than serializer defaults.
- [ ] Catalog is optional, app-local, and entirely outside HBA/`ContentRepository`/browser contracts.
- [ ] Client `WorldState` and the app-local Explorer registry remain distinct semantic authorities
      feeding the same source-neutral definition, solver-outcome, and projection contracts.
- [ ] Each composition retains its own `SpatialScene`; Explorer camera and entity bodies share the
      existing `HostSimulationRuntime` store.
- [ ] The catalog preserves complete template physics-state inputs and the Explorer derives the same
      effective initial mask as ACE for every representative fixture.
- [ ] Every dynamic entity retains one pose body while physical attachment and fixed-tick
      participation remain optional, reversible, and driven by complete physics-state replacement.
- [ ] `SpatialScene` owns the only physical pose and all derived landblock/outdoor/EnvCell
      memberships; no `entity_poses` mirror or caller-managed index choreography remains.
- [ ] Existing client `SetState` and Explorer scenario updates use the same per-bit reconciliation
      decision; no defined bit is silently discarded or flattened into a collidable boolean.
- [ ] Physical spawn, complete replacement, and despawn use ordered orchestration, compensate
      unpublished partial installation, and never duplicate solver-owned physical state in a registry.
- [ ] One focused dynamic-entity snapshot reconstructs every frontend-relevant entity without replay
      history, whole-client machinery, or a speculative delivery-recovery protocol.
- [ ] Explorer spawn-by-WCID crosses the real Tauri boundary into the existing template, animation,
      script, particle, audio, effect, scene, and renderer systems.
- [ ] Spawned entities advance through the existing fixed cadence, installed collision snapshot,
      generic solver, placed paths, and locally derived ground state.
- [ ] One collection scheduler participant visits eligible Explorer entities in stable body order,
      integrates only active bodies, and emits at most one focused changed-body/report batch per
      fixed epoch.
- [ ] Solver-owned quiescence skips integration and mover-side queries only after the proven stable
      predicate, retains body/index/target/report/presentation state, and wakes through every
      Phase R0-proven drive, state, scene, geometry, and peer-contact input.
- [ ] Collision-report lifetime and target-geometry maintenance remain correct while root-body
      integration is quiescent; no sleep islands, per-body timers, dependency graph, or second active-
      body registry lands without Phase R2 evidence.
- [ ] The shared solver performs deterministic flag-filtered body-to-body contact and response,
      reuses outdoor global-cell and reached-EnvCell partitioning, handles 50-300 entities per
      populated landblock, queries swept/provisional domains, exercises every census-supported target
      geometry branch, prevents tunneling across its supported displacement/shape envelope, processes
      each directional pair deterministically, and converges within the recorded tick bound.
- [ ] Collision reporting retains proven first-touch/refresh/natural-end/forced-end state with
      explicit per-recipient classification, and the selected-entity inspector reconstructs active
      contacts without becoming collision authority.
- [ ] Host motion resolution selects animation and solver kinematics once from the same authored
      records; raw motion tables remain outside the frontend.
- [ ] Frontend presentation is smooth between host updates and applies root contribution exactly once.
- [ ] Catalog absence/corruption, missing WCID, listener restart, late assets, solver failures,
      timeline reset, replacement, teardown, and representative physics-state transitions have
      explicit tests or harness scenarios.
- [ ] Repeated lifecycle scenarios return all registry/body/frontend/resource counts to baseline.
- [ ] No duplicate authority or downstream path exists inside either composition, and no database
      engine, generic runtime hierarchy, or speculative server adapter survives.
- [ ] Architecture docs and parent roadmap match the landed ownership model.
- [ ] Formatting, checks, lint, tests, Clippy with warnings denied, and representative host/browser
      gates pass.

## Open Questions

1. Which ACE World database/revision is the first exporter source, and how is its stable provenance
   label obtained? Resolve in Phase 0 before the file header is fixed.
2. Which named WCIDs form the representative first population? Resolve from the Phase R0 catalog
   survey; do not choose from memory.
3. How does each effective ACE physics-state bit affect pose-body retention, physical attachment,
   scheduling, collision domains/reporting, response, and presentation for the first population?
   Resolve from ACE/retail call sites and the Phase R0 catalog/DAT survey before the spawn definition
   is fixed.
4. Does the current reduced motion-kinematics archive contain every fact required by the named
   locomotion scenarios? Resolve in Phase R0; Phase 6 expands only the proven gap.
5. Does any representative EnvCell contain enough simultaneously participating bodies to require
   subdivision beyond its natural reached-cell bucket? Measure in Phase R2; do not add an interior
   sub-index from outdoor population counts.
6. Which setup-sphere, cylsphere, and per-part physics-BSP target branches occur in the representative
   population, and which can the first narrow phase support without guessing? Resolve in Phase R0;
   every other observed branch must have a reachable rejection rather than a movement-sphere fallback.

These are execution evidence gates, not invitations to guess or add fallback behavior.
