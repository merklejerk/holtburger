# Holtburger 3D Dynamic Entity Runtime Plan

Status: Final; ready for phased implementation
Created: 2026-07-31
Evidence pass: 2026-07-31
Refinement pass: 2026-07-31

## Context and Boundaries

### Goal

Build one dynamic entity runtime for static-authored promoted residents and resolved runtime entities,
with shared immutable visual templates, independently mutable entity state, explicit pose
composition, sparse motion/placement projection, rigid-part animation and hooks, and frame-streamed
GPU instancing as the default rendering path.

### Problem Statement

The new 3D app has most of the correct seams, but they stop before producing a usable dynamic
runtime:

- Object classification promotes setup-backed residents with default animations, but runtime only
  records them as deferred diagnostics; retail also schedules static objects with default scripts
  for behavior updates, which the classifier currently misses.
- Spawn commits have a typed shape, but no consumed runtime-entity ingress supplies them.
- `DynamicEntitySystem` creates entity and part nodes, then prepares each presentation separately.
  `GeometryManager` prevents duplicate GPU geometry, but repeated entities still repeat CPU visual
  preparation and have no appearance-aware template identity.
- `AnimationSystem` stores already-sampled poses and applies them directly to part nodes. It does not
  load clips, advance playback, or emit animation hooks, and its current application ownership would
  mix playback truth with scene-transform mutation once real animation lands.
- The renderer counts visible dynamics, resolves their geometry, and discards the result.
- The static renderer already has persistent and frame-streamed GPU instance mechanisms, while the
  dynamic path has no submission contract.
- The protocol decodes create/update appearance data, but `holtburger-world::Entity` does not retain
  the wire `ModelData`, and no world handler applies `ObjDescEvent`.
- Animation hooks are only partly decoded, and physics script/script-table records do not yet have
  runtime content representations.
- The nominal client entry is a Svelte route shell. The Tauri host owns static content commands and
  has no session, protocol, or world-state runtime, so a live Rust client feed is not available to
  implement inside this plan without a separate client-host project.

This plan completes those seams without introducing an ECS framework, a universal event bus, or a
second renderer architecture.

### In Scope

- A canonical, appearance-aware object visual template identity and lease-owning template manager.
- Shared in-flight preparation for identical static-authored and runtime appearances.
- Atomic entity visual-template replacement and synchronous prepared part replacement.
- Owner-safe installation and eviction for multiple promoted dynamics in one authored layer.
- Activation of outdoor and env-cell static-authored dynamics.
- A consumed frontend ingress port for already-resolved runtime-entity snapshots and ordered deltas,
  exercised by a checked-in synthetic producer.
- Rigid-part default animation and motion-sequence playback.
- A common prepared playback contract for setup-default, resolved direct, and motion-plan-selected
  animation without requiring motion-table state for the first two.
- Explicit composition and application of current scene placement, reconciliation correction,
  visual-root modifiers, rigid-part pose, and scale without giving animation ownership of scene
  placement.
- Sparse placement-anchor and resolved-motion-plan ingestion with frontend motion-derived root
  placement, outdoor normalization, and environment-cell portal traversal.
- Fractional render-time pose evaluation above the authored clip sample rate, independently of
  semantic playback and hook advancement.
- A deterministic hook queue and explicit hook dispatch ports.
- Physics-script playback using the same prepared hook commands as animation playback.
- Frame-streamed GPU instancing for opaque/cutout dynamic parts and sorted compatible runs for
  transparent parts.
- Synthetic harness coverage for numerous identical animated residents and mixed runtime entities.
- Diagnostics that distinguish templates, prepared animation/script/table resources, entities,
  visible part instances, instance uploads, asset/feed bytes, and submitted draws.

### Out of Scope

- Weighted skeletal skinning; AC object animation is currently proven to be flat rigid-part motion.
- A generic ECS library, generic `System` interface, or global event bus.
- Local gameplay prediction, input rollback/reconciliation, or authoritative collision simulation.
  Frontend presentation projection and sparse-anchor visual correction remain in scope.
- Full particle, lighting, and audio implementations. Hook commands and typed dispatch ports are in
  scope; rich consumers may remain later features.
- Optimizing animation sampling by shared phase until retail phase behavior is proven.
- Copying legacy distance thresholds or throttling semantic playback/hooks by camera distance before
  the representative workload proves a pose-evaluation bottleneck.
- GPU-driven culling, indirect drawing, bindless materials, or texture-array redesign.
- An arbitrary LRU for visual templates. Initial residency is explicit and lease based.
- Preserving legacy renderer contracts or compatibility shims.
- Building the Rust client host: login, session/socket ownership, protocol dispatch, world-state
  orchestration, reconnect/resume, initial snapshot synchronization, or Tauri event subscription.
- Adding unused Rust DTOs or dormant Tauri commands for a future client feed. The future production
  mapping stays documented until a real Rust client-mode consumer exists.

## Ground Truth and Existing Precedent

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `CPartArray::Draw` at 313361 and `CPhysicsPart::Draw` at 303122: parts render independently.
  - `CPartArray::UpdateParts` at 314107: object frame, sampled part frame, and scale produce each
    rigid part transform.
  - `CSequence::get_curr_animframe` at 326259: retail samples the integer frame at
    `floor(frame_number)`; fractional visual interpolation is a deliberate Holtburger presentation
    improvement, not a claimed retail behavior.
  - `CPhysicsObj::UpdatePositionInternal` around 308255: ordinary moving objects pass an offset frame
    into sequence advancement, then position/physics processing decides how it affects placement.
  - `CSequence::update_internal` and `apply_physics` around 327100 and 326355: animation position
    frames and motion-table velocity/omega contribute to the sequence offset consumed by placement.
  - `CPartArray::SetPlacementFrame` at 314297: placement-pose selection and fallback.
  - `CPartArray::DoObjDescChanges` and `DoObjDescChangesFromDefault` around 314187 and 314339:
    appearance changes update an existing object presentation.
  - `CObjectMaint::SetVisualDesc` and `ACCObjectMaint::SetVisualDesc` around 137180 and 373469:
    sequence-gated `ObjDescEvent` changes preserve entity identity.
  - `UpdateObject` handling around 140101: a complete object update forces recreation.
  - `CAnimHook::GetSubDataIDs` and hook-specific implementations around 329556: hook dependency
    assets are enumerable before playback.
  - `DBCache` construction around 284621, 284766, 285607, and 285636: animations, motion tables,
    physics scripts, and physics script tables are independently cached immutable DB objects rather
    than embedded per physics object.
  - `PhysicsScriptTableManager` and `PhysicsScriptManager` around 316300-316500: timed physics
    scripts dispatch animation hooks.
  - `CPhysicsObj::InitDefaults` at 309089-309136: a static object enters the static-animation list
    when its setup has either a default animation or a default physics script.
  - `CPhysicsObj::animate_static_object` at 309368-309405: default animation and default scripts are
    advanced independently for static animating objects; animation advances with no root-offset
    output while omega rotates the object frame explicitly.
  - `CPhysicsObj::UpdateChild` and `UpdateChildrenInternal` at 308302 and 309344: a child attached to
    a part consumes that part's final animated world frame; part transforms must therefore be current
    before attachment propagation.
- `ACE/Source/ACE.DatLoader/FileTypes/Animation.cs` and
  `ACE/Source/ACE.DatLoader/Entity/AnimationFrame.cs`: animation frames contain one transform per
  setup part plus hooks.
- `ACE/Source/ACE.DatLoader/Entity/AnimationHooks/ReplaceObjectHook.cs`: a replace hook carries an
  `AnimationPartChange`, proving part-local replacement.
- `ACE/Source/ACE.DatLoader/FileTypes/PhysicsScript.cs` and `PhysicsScriptTable.cs`: timed script
  and table record layouts.
- `ACE/Source/ACE.DatLoader/FileTypes/MotionTable.cs`: style defaults, cycles, modifiers, links,
  animation ranges/rates, velocity, and omega used to resolve motion playback and kinematics.
- `ACE/Source/ACE.Server/WorldObjects/Creature_Equipment.cs:354-438`: equipment mutations emit
  `ObjDescEvent` rather than recreating the entity.
- `ACE/Source/ACE.Server/WorldObjects/Hook.cs:139-214`: setup, motion, physics, sound, scale, and
  appearance changes use a complete `UpdateObject`, with a corresponding reversal.
- `ACViewer/ACViewer/Physics/PartArray.cs:293-304`: setup default animation is installed as a
  looping sequence.
- `ACViewer/ACViewer/Physics/PhysicsObj.cs:680-710`: setup defaults initialize animation, motion,
  scripts, script tables, and sound tables; static objects with default animation/script are marked
  as static animating objects.

### Existing Patterns to Extend

- `apps/holtburger-3d/src/lib/game/resolution/object-resident-classifier.ts`: exhaustive
  static/dynamic partition whose current animation-only predicate must become retail's broader
  setup-default-behavior rule.
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`: entity roots, flat rigid-part
  nodes, attachments, owner lifetime, and the current preparation seam.
- `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`: separate animation component owner
  and narrow part-node update port; retain the ownership separation but remove direct node mutation
  from the final playback system.
- `apps/holtburger-3d/src/lib/game/geometry/geometry-manager.ts`: logical resource identity,
  idempotent publication, shared leases, and physical resource release.
- `apps/holtburger-3d/src/lib/game/textures/atlas/resident-texture-atlas.ts`: provisional
  requirements, in-flight completion, revision activation, and owner-scoped withdrawal.
- `apps/holtburger-3d/src/lib/game/renderer/frame-instance-stream-arena.ts`: renderer-owned reusable
  storage for changing per-view instance populations.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`: instanced object shader with a
  per-instance matrix and color.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts:1367-1429`: transparent ordering and
  adjacent compatible frame-instance runs.
- `apps/holtburger-3d/src/lib/game/scene/portal-trace.ts`: stateless repeated directed-aperture trace
  that can resolve multiple dense environment-cell crossings along one world segment and retain a
  proven fallback residency when topology is unavailable.
- `apps/holtburger-3d-legacy/src/lib/renderer/types.ts:255-317`: explicit separation between shared
  dynamic visual resources and entity instances.
- `apps/holtburger-3d-legacy/src/lib/dynamic/dynamic-animation-player.ts`: fractional interpolation
  between authored frames, but playback, hook dispatch, pose sampling, and root effects are coupled
  in one record update.
- `apps/holtburger-3d-legacy/src/lib/dynamic/dynamic-animation-update-cadence.ts`: camera-distance
  pose throttling precedent whose fixed thresholds and stale-pose behavior require measurement and
  stronger spatial guarantees before reuse.
- `crates/holtburger-content/src/material_graph.rs:67-76`: `ResolvedSetupAppearance` already exposes
  an appearance key and concrete part/material dependencies.
- `crates/holtburger-core/src/content_assets.rs`: deduplicated runtime content loading already
  supports `Animation` and setup appearance requests.
- `crates/holtburger-world/src/bootstrap.rs` and `state/types.rs`: the current derived
  `MotionKinematics` resource is already retained once as an `Arc` in world bootstrap/state rather
  than copied into entities.
- `crates/holtburger-world/src/entity.rs`: authoritative GUID, physics, placement, attachment, motion
  snapshot, and sequence state for server entities.
- `crates/holtburger-world/src/state/motion_resolution.rs`: current host-side resolution of motion
  snapshots into reduced velocity/omega projection bases.
- `crates/holtburger-dat/src/file_type/motion_table.rs`: the full parsed motion data, including
  animation selections that the reduced `MotionKinematics` asset intentionally omits.
- `crates/holtburger-core/src/client/simulation.rs`: sparse host spatial projection precedent; only
  tracked bodies near the player enter the current solve request.

### Existing Workload Evidence

The 2026-07-31 archive census used the production `dats/assets.hba`, the current content service,
and a Chebyshev-radius-one scan around both representative landblocks. It included explicit
objects, buildings, generated scenery, and environment-cell static objects. The temporary probe was
removed after recording these results.

| Workload     | Setup-backed sources | Default animation | Default script | Total behavior owners |
| ------------ | -------------------: | ----------------: | -------------: | --------------------: |
| `0xDA55FFFF` |                1,315 |                44 |             66 |                   110 |
| `0xDC58FFFF` |                1,362 |               162 |             52 |                   214 |

The legacy 44/162 counts were correct for default-animation owners, but were not the full retail
static-behavior population. No representative setup had both defaults. The additional script-only
owners are primarily particle, chained-script, and sound carriers; they require the Phase 10 script
producer and must not be presented as animation workload.

The complete representative default-animation inventory is:

| Setup        | Animation    | DA55 | DC58 | Frames / parts | Material passes | Hooks          | Position frames |
| ------------ | ------------ | ---: | ---: | -------------- | --------------- | -------------- | --------------: |
| `0x02000493` | `0x030006CB` |   22 |   77 | 90 / 2         | 2 alpha-test    | one `SetOmega` |               0 |
| `0x02000494` | `0x030006CA` |   19 |   82 | 90 / 2         | 2 alpha-test    | one `SetOmega` |               0 |
| `0x020005AC` | `0x03000751` |    3 |    3 | 7 / 2          | 2 opaque        | one `SetOmega` |               0 |

The two butterfly setups are therefore exact fixtures, not a generic “one-part opaque” proxy. Both
use GfxObj `0x01003D53` for both parts, surface `0x0800128C`, surface texture `0x05002C29`, and
render surface `0x06006270`, with no palette substitution. Their object-template identities differ
because setup and default animation differ, while their prepared part visual and material resources
can share. All representative appearances are the base setup appearance; the union contains 17
setup-level appearance keys and no authored appearance override.

The three animations contain no replace-part hooks and no external hook dependencies. Every clip
has exactly one hook-bearing frame, one hook on that frame, direction `0`, and the required Phase 5
consumer is `SetOmega`. Each hook is on frame zero. The two butterfly clips share the decoded omega
approximately `(0, 0, -0.026797784)`; `0x03000751` uses approximately
`(0, 0, -0.038397241)`. Fixtures should retain the raw 12-byte payload as well as the decoded value.
Prepared A/B part replacement remains a synthetic contract test because it is central to focused
appearance mutation, not because this workload happens to exercise it.

A complete production-archive scan found 134 setup models with default animations. Only setups
`0x02001694` and `0x02001752` reference animations with position-frame arrays; every position frame
in both clips has zero translation, with only small rotational deltas. No shipped setup-default
animation therefore demonstrates residency-changing root translation. The runtime will not encode
an authored/static root-motion suppression branch: all dynamic playback may contribute its authored
root track to `PlacementSystem`, and identity root data naturally leaves placement unchanged. The
retail static null-offset path remains documented ground truth rather than a provenance-based
frontend capability restriction.

The 14 default-script roots contain 25 authored events: 17 `CreateParticle`, five `CallPES`, and
three `SoundTweaked`. Transitive `CallPES` traversal reaches 17 scripts total. Four shipped scripts
(`0x330003CC`, `0x33000711`, `0x3300072C`, and `0x33000863`) call themselves, proving that dependency
cycle detection must terminate preparation traversal while preserving deliberate scheduled loops.
It must not reject cyclic script graphs. Phase 10 therefore owns script activation and the particle,
audio, and chained-script ports; none of these dependencies pull `PhysicsScriptSystem` into Phase 5.
None of the 17 representative setup appearances has a default physics-script table; table-key and
intensity selection remain a Phase 9 evidence task for runtime content.

Setup selection/sorting spheres are not conservative animation bounds: all three animation setups
author radius zero, while a vertex sweep over all clip frames requires origin-centered radii of
approximately `3.9722`, `12.8419`, and `19.5903`. The butterfly `SetOmega` hooks also rotate the
visual root indefinitely. `ObjectVisualTemplate` must therefore prepare a conservative local AABB
covering every clip frame, reachable prepared part variant, setup part scale, and any unbounded
rotation sweep. Current-pose bounds and setup spheres are insufficient for culling or skipped pose
evaluation.

The earlier implementation record remains relevant:

- `docs/plans/holtburger-3d-open-world-streaming-materialization-remodel-plan.md:3706` proves the
  butterfly workload shared render surface `0x06006270` across 49 bindings/owners only after
  content-stable texture identity replaced owner-derived identity. Authored/runtime origin is not a
  resource key; resolved source identity and appearance fingerprints are.
- Issue 57.10 at line 3707 proves dynamic visual readiness must be decided before renderer
  publication; the renderer cannot own missing-binding recovery.

### Current Gaps That Shape the Sequence

- `DynamicEntitySystem.install` removes the existing owner before every installation. A landblock
  layer owner therefore cannot install more than one promoted resident.
- `DynamicVisualPreparer.prepare` is called per entity. Geometry publication is idempotent, but CPU
  preparation and template orchestration are not shared.
- Dynamic preparation currently ignores resident appearance and scale and chooses only the first
  part material.
- The static instance record is semantically generic but named `StaticInstanceData`; the frame arena
  and diagnostics are correspondingly static/transparent-biased.
- `WebGL2Renderer` resolves and discards dynamic renderables at its visible-contribution branch.
- `ContentAssetRequest` supports animation but not physics scripts or physics script tables.
- Animation hooks are represented by a mixture of typed and raw payloads in `holtburger-dat`.
- The classifier recognizes only setup default animations even though retail also advances static
  objects with setup default scripts.
- Spawned `CommitBundle`s have a consumer but no producer. `ClientApp.svelte` is only a route shell,
  the Tauri host registers static-content commands only, and its crate has no `holtburger-session`,
  `holtburger-protocol`, or `holtburger-world` dependency.
- `Entity::apply_description` does not retain `ObjectDescriptionData.model_data`, and no handler
  consumes `GameMessage::ObjDescEvent`. Those are future Rust client-host requirements, not a reason
  to add unconsumed adapter code in this plan.
- `holtburger-world` currently resolves motion-table state only into reduced velocity/omega for
  nearby host projection. The full DAT motion table also contains the animation IDs, frame ranges,
  rates, cycles, modifiers, and links needed for presentation, but no shared result carries both
  playback and kinematic facts to a frontend consumer.
- The frontend has no sparse motion-plan/placement-anchor ingress or entity placement owner. Its
  existing portal tracer is camera-oriented but already demonstrates multi-portal traversal and a
  proven-residency fallback that can be generalized without making dense-cell crossings host
  traffic events.

## North Stars

1. One entity model serves authored promotions and resolved runtime entities; origin affects
   lifetime, not rendering or animation capability.
2. Expensive prepared state is keyed by visual identity, never entity identity.
3. Frame-time systems consume prepared handles. They do not decode DAT records, prepare materials,
   allocate geometry, or wait on I/O.
4. GPU instancing is the normal rigid-part submission path, not a numerous-object special case.
5. Renderer batching is renderer policy. Domain systems provide batch-compatible identities and
   transforms without owning GPU cohort construction.
6. Focused appearance changes preserve entity identity and mutable state; complete object updates
   replace the installed entity generation.
7. Hooks are explicit commands with deterministic ordering, not an untyped event bus.
8. Animation owns playback truth, placement owns the one current scene root/residency, and pose owns
   downstream visual transforms; none may impersonate another.
9. Every retained field has a named runtime consumer; diagnostics observe decisions but never drive
   them.
10. Capabilities are activated by resolved source facts, not entity-class heuristics. Only entities
    with motion-table state use shared motion resolution; explorer animation, placement, portal
    residency, rendering, and batching remain in `apps/holtburger-3d`.

## Target Runtime Shape

```text
DAT-authored resident ─┐
                      ├─> ResolvedDynamicEntitySource ─> DynamicEntitySystem
runtime entity feed ──┘                │                        │
                                      acquire                   ├─ pose contributions
                                         │                      ├─ part selection
                              ObjectVisualTemplateManager       ├─ attachment
                                         │                      └─ current ScenePlacement
                     geometry / materials / prepared hooks

PLAYBACK SELECTION (one active driver)
  setup-default animation ───────────────────────────┐
  resolved direct playback ──────────────────────────┼─> PreparedPlaybackSequence
  host MotionCatalog ─> MotionResolver ─> ResolvedMotionPlan ─> MotionSystem ─┘
                                                                          v
                                                                  AnimationSystem
                                                                    ├─ part pose
                                                                    ├─ root sample
                                                                    └─ prepared hooks ─> HookSystem

PLACEMENT (motion-table capability optional)
  PlacementAnchor + optional active-phase kinematics + optional animation root sample
    ─> PlacementSystem ─> current ScenePlacement/residency

POSE AND SUBMISSION
  current ScenePlacement + part pose + typed hook/visual contributions
    ─> PoseSystem ─> attachments/visible parts ─> frame grouping/draws

INDEPENDENT TIMED HOOK PRODUCER
  PhysicsScriptSystem ─> HookSystem ─> typed entity mutation ports
```

The checked-in synthetic feed is the production consumer of the frontend ingress contract in this
plan. A future Rust client host will send sparse placement anchors and resolved motion-plan changes,
not per-render-frame transforms. This plan implements the consumed frontend shapes and shared motion
resolution with existing Rust consumers, but does not create dormant Tauri session machinery.

### Immutable Template State

`ObjectVisualTemplate` owns or references:

- Canonical setup topology, attach points, placement poses, and a prepared conservative local AABB.
- The conservative AABB covers every prepared clip frame and reachable part variant. A visual-root
  rotation such as `SetOmega` expands it to a rotation-invariant envelope; setup spheres are source
  evidence, not an assumed culling guarantee.
- One initial `PartVisualTemplateKey` per authored part index.
- Prepared alternative part templates reachable from animation or script hooks.
- Geometry keys, complete material draw partitions, and texture requirement handles.
- Prepared animation/hook dependency identities needed by default behavior.

`PartVisualTemplate` owns or references:

- Source geometry identity and draw ranges.
- Complete material bindings, texture placements, and render-state facts.
- A batch key containing every fact that must match for one instanced draw.

The canonical object template key must include setup identity, effective appearance identity, and
other facts that change prepared output. It must not include GUID, authored resident index,
placement, entity scale, current pose, or animation time.

### Behavior Resource Ownership and Transport

DAT motion tables, animations, physics scripts, and physics script tables are immutable content
resources, but execution ownership determines which side retains their prepared form. Entity source,
snapshot, and delta contracts communicate semantic selection and timing; they never embed decoded
resource payloads.

- The host pins one derived `MotionCatalog` in `holtburger-world` bootstrap. It replaces the current
  reduced `MotionKinematics` resource in a clean cutover and retains setup defaults, styles, cycles,
  modifiers, links, animation ID/range/rate steps, and per-`MotionData` velocity/omega. Raw or
  compiled motion tables never become frontend resources.
- `MotionResolver` projects the catalog plus authoritative entity motion state into a comparatively
  small per-entity `ResolvedMotionPlan`. The initial runtime snapshot may carry that plan inline and
  later deltas replace it; neither path uses the authored landblock commit pipeline.
- The frontend owns an `AnimationAssetRepository` keyed by animation ID. One prepared animation
  contains part frames, root frames, and normalized prepared hooks; active or staged playback holds
  a handle plus per-entity cursor state rather than copying frame arrays.
- The frontend owns typed `PhysicsScriptAssetRepository` and `PhysicsScriptTableRepository`
  instances keyed by DAT ID. Prepared scripts contain timed prepared hook commands; prepared tables
  retain the proven type/intensity-to-script selection needed by frontend script execution.
- Each typed repository has explicit `preparing`, `ready`, and `failed` states, shared in-flight
  work, generation-safe acquisition, and deterministic release. A staged entity, playback handoff,
  or script activation pins its complete dependency closure until activation is cancelled or no
  active consumer remains.
- The Tauri content adapter transports a resource once per repository miss using a typed compact
  payload; source/feed DTOs carry IDs, selections, revisions, and effective times only. The content
  service decodes and transports assets but does not become the frontend's mutable playback owner.

Do not introduce one untyped `BehaviorResourceManager`. Share a small repository-state primitive
only after animation and script repositories prove the lifecycle genuinely isomorphic; decoding,
preparation, keys, dependency traversal, and failure types remain resource-specific.

Initially keep the small resolved phase sequence inline in each `ResolvedMotionPlan`. Animation and
script payloads are the heavy shared data. A shared `ResolvedMotionProgram` registry requires a
measured DTO/storage bottleneck and a real identity contract; repeated monster spawns alone do not
justify speculative cache coherence.

### Mutable Entity State

One installed dynamic entity retains:

- Authored identity or server GUID and owner generation.
- One current root `ScenePlacement` or parent attachment, plus a visual-pose root and rigid-part
  nodes.
- A placement anchor and projection/reconciliation state while it is a world root. Authored
  residents begin with their authored placement and may never receive another anchor; runtime
  entities may receive sparse replacements.
- Optional capability state only when used: prepared animation playback, an active resolved motion
  plan, physics scripts, and timed visual modifiers. An animated entity does not gain an empty
  motion plan merely to fit a uniform shape.
- Acquired object template handle.
- Current part-template selection by authored part index.
- Current explicit pose contributions produced by the focused behavior systems.
- Sequence values needed to reject stale server mutations.

### Dynamic Entity Aggregate Responsibility

`DynamicEntitySystem` is the transactional lifecycle and presentation-aggregate boundary, not the
frame-time behavior scheduler. It owns installed entity identity/generation and source-owner
membership; scene-root, visual-root, and rigid-part node topology; retained template leases and
current part-template selection; attachment relationships and parent-part bindings; scale and
stored presentation contributions; and atomic focused or complete-generation replacement of that
aggregate.

It exposes narrow generation-safe operations and queries to the focused systems. Storing current
placement or a pose contribution in the entity record does not grant behavioral ownership:
`PlacementSystem` is the only writer of world-root placement, `AnimationSystem` owns playback, and
`PoseSystem` owns transform application. `GameRuntime` coordinates cross-system activation and
teardown so replacement/despawn removes playback, motion, scripts, hooks, attachments, pending
preparation, nodes, and leases as one generation-safe operation.

`DynamicEntitySystem` does not interpret motion tables, advance clocks, sample clips, cross hooks,
project placement, traverse portals, compose poses, prepare physical resources, collect visibility,
form renderer batches, or submit draws. Retain the existing `System` name because its atomic
install/replace/remove behavior is substantive; do not split ceremonial registry and installer
types unless implementation evidence produces independently useful consumers.

### Resolved Motion and Sparse Placement Contracts

`ResolvedMotionPlan` is a shared semantic result, not a DAT record and not a vague “motion segment.”
It contains a motion revision, effective host time, and ordered phases. Each phase pairs one or more
animation ID/frame-range/rate steps with that `MotionData` record's resolved velocity/omega and is
explicitly finite or repeating; links can therefore hand off to a cycle without applying the
cycle's kinematics too early. A plan remains active until its finite phases finish or a newer
revision replaces it. It is an executable time-anchored schedule, not a predicted collision path,
cell-crossing list, or promise that the host will send the next placement.

A pure `holtburger-world` `MotionResolver` computes the plan once from parsed motion-table bootstrap
data and authoritative motion state. Existing host spatial projection consumes the active phase's
kinematics; the frontend consumes the same playback and placement facts without reinterpreting raw
motion-table keys.

Motion resolution is an optional capability. Setup-default animation, a resolved direct playback
request, and physics-script playback do not pass through `MotionResolver`. The first two produce or
select prepared animation playback directly; physics scripts retain their independent clock and
emit prepared hook commands. Only a source carrying motion-table style/command state produces a
`ResolvedMotionPlan` and frontend `MotionSystem` state.

`PlacementAnchor` contains a complete world pose/residency, sample time, placement revision, entity
generation, and an explicit continuous/discontinuous correction kind. The host sends an anchor on
spawn, authoritative correction, teleport/reset, attachment change, or another meaningful rebase;
it does not stream a transform every render frame. An authored resident's initial placement is the
same contract produced locally.

The frontend retains one current `ScenePlacement`, not parallel “authoritative” and “presentation”
residencies. `PlacementSystem` samples the anchor plus active plan at absolute time, combines
velocity/omega with the animation root sample, and updates the scene root atomically. Small
continuous corrections may decay through one named visual correction transform; discontinuities,
generation changes, and incompatible residency changes snap.

Residency is derived from motion locally. For a world root, `PlacementSystem` traces the previous
presented world point to the next absolute-time endpoint through the prepared portal topology, so
one sample may cross multiple dense environment cells; an outdoor endpoint normalizes directly to
its landblock. When topology is unavailable or ambiguous, it keeps the previous proven residency,
reports the unresolved trace, and rebases on a later anchor rather than guessing. Attached entities
surrender independent residency and inherit their ancestor's until detached.

### Pose and Transform Ownership

`AnimationSystem` owns prepared clip playback: cursor, rate, direction, loop/sequence state, crossed
frame detection, and production of rigid-part pose plus an absolute root-track sample. Its common
`PreparedPlaybackSequence` input may come from setup-default behavior, a resolved direct playback
request, or `MotionSystem`; playback execution does not care which producer selected it. It emits
crossed prepared commands to `HookSystem`. It does not mutate scene nodes, placement, residency,
bounds, templates, or renderer state.

The active rigid-part playback driver is an exhaustive choice: setup default, resolved direct
request, or motion-plan revision. Switching drivers stages the complete replacement sequence and
dependencies before an atomic handoff; it does not layer two base sequences or manufacture an empty
motion plan. Physics scripts remain independently clocked because they produce hook commands rather
than select the base rigid-part pose.

`PlacementSystem` is the sole owner of a world root's current transform and residency. Every active
animation may contribute its authored root track; empty or identity root data naturally leaves the
anchor unchanged. Authored versus runtime origin changes lifetime and correction sources, not root
motion capability. Motion-table omega belongs to placement, while `SetOmega` and other decorative
hook modifiers remain visual-root state.

`PoseSystem` consumes an explicit composite rather than an arbitrary layer stack. It reads the
already-current scene root and combines downstream transforms in a proven order:

- Current scene placement or inherited parent attachment.
- Optional decaying visual correction from placement reconciliation.
- Visual-root transforms and typed hook modifiers.
- Setup placement pose or sampled rigid-part animation pose.
- Entity and part scale.

It applies the resulting visual-root and part transforms once per evaluation without rewriting the
scene root, then propagates attachments before visibility and rendering observe them. The
entity root retains the prepared conservative template AABB, so skipped pose evaluation cannot
invalidate spatial residency. `PoseSystem` does not select clips, advance clocks, dispatch hooks,
sample root motion, or own scene residency.

Semantic playback and render pose evaluation use separate cadences. Playback advancement never
drops crossed hooks because of camera distance. The initial render path evaluates fractional poses
at the current render time so authored 30 Hz clips render smoothly at higher display rates. Any
later distance/visibility policy may reduce pose evaluation only after measurement and must retain
conservative spatial bounds; it cannot pause playback truth, hook dispatch, or resource lifetime.

Animation selection may change resource demand only at a staged playback boundary. Installing or
changing a sequence acquires its prepared clip and transitive hook/template dependency closure
before activation. Frame sampling and hook execution never perform I/O or preparation; a replace
hook changes active part selection and renderer cohort among already pinned resources.

### Prepared Hook Commands

Raw DAT hooks are normalized before playback into an exhaustive discriminated union. A replacement
command contains a prepared part-template key, not a raw GfxObj ID. Commands initially include the
visual mutations required by the measured authored workload plus explicit unsupported commands with
source asset and frame context. Unsupported execution is observable and attributable; it is never
silently discarded. A hook whose unresolved dependency would make preparation dishonest fails
staging instead.

`HookSystem` owns queue ordering, forward/reverse/catch-up rules, bounded reentrancy, and exhaustive
dispatch. It mutates entity state through narrow injected ports; it does not own visual templates,
animation playback, physics-script clocks, particle state, or audio state.

## Final Evidence Gate

The 2026-07-31 archive/reference pass is complete and recorded in _Existing Workload Evidence_.

- [x] Count animation and script behavior owners across outdoor and environment-cell sources in
      `0xDA55FFFF` and `0xDC58FFFF`.
- [x] Record setup/default IDs, base-appearance multiplicity, parts, material passes, repeated owner
      counts, and content-stable texture/palette facts.
- [x] Inventory reachable default-animation hooks, direction, density, dependencies, and part
      replacements.
- [x] Confirm that every representative default animation has zero position frames; scan every
      setup default and prove that the only two clips with root arrays have zero translation.
- [x] Identify the exact two-part alpha-tested butterfly fixtures.
- [x] Bring the required `SetOmega` consumer into Phase 5 through `HookSystem` and visual-root state.
- [x] Traverse default-script dependencies far enough to prove the Phase 9 preparation/Phase 10
      execution boundary and intentional cyclic `CallPES` behavior.
- [x] Prove that authored setup spheres cannot be reused as conservative animation bounds.
- [x] Reject an authored/static root-motion suppression fork: origin affects lifetime and anchor
      updates, while the common placement path consumes any authored root track.

Exact default-animation phase, reverse/catch-up execution, ObjDesc sequence fields, physics-script
table selection, picking payloads, and performance optimization remain phase-local evidence tasks;
they do not change the ownership model and therefore do not block finalizing the plan.

## Phased Implementation

### Phase 1: Close the Dynamic Source Contract

Establish one lossless frontend source shape before adding more runtime state.

#### Deliverables

- Replace the alias-only `DynamicEntityCommit = ResolvedObjectResident` boundary with an honestly
  named dynamic source contract that explicitly carries effective appearance, scale, setup effect
  defaults, placement, identity, and bounds.
- Keep the source contract referential: behavior fields carry animation/script/table IDs and
  resolved selection facts, never decoded animation frames, motion tables, script timelines, or
  other content payloads.
- Define canonical `ObjectVisualTemplateKey` and `PartVisualTemplateKey` types at the layer that owns
  resolved presentation identity.
- Surface the content-owned setup appearance key through the host contract and compute each template
  key once from resolved appearance and prepared-output facts; carry it through commits rather than
  reconstructing it in systems or the renderer.
- Make authored-layer dynamic installation a complete owner-scoped set. One owner replacement must
  install every promoted resident without one entity deleting the previous one.
- Replace the animation-only boolean with an exhaustive setup-default-behavior classification:
  animation, physics script, both, or neither. Preserve the reason(s) in the source contract.
  Animation owners become promotable in Phase 5; script-only residents retain their working static
  base presentation until Phase 10 can atomically promote and activate their behavior.
- Remove the unused spawned variant from the landblock `CommitPipeline`; runtime entity ingress must
  not masquerade as scene-interest preparation. Preserve one per-entity source contract consumed
  directly by `DynamicEntitySystem` and, later, `DynamicEntityFeed`.
- Replace the current asynchronous fire-and-forget visual publication with an explicit staged
  installation result or generation token so a stale preparation cannot publish into a replaced
  entity.
- Keep `DynamicEntitySystem` focused on atomic aggregate install/replace/remove and generation-safe
  mutation ports. `GameRuntime`, rather than the entity aggregate, coordinates registration and
  teardown across motion, animation, placement, pose, hooks, and scripts.

#### Task Checklist

- [ ] Inventory every consumer of `DynamicEntityCommit`, `ResolvedObjectResident`, and dynamic owner
      IDs.
- [ ] Add and document the canonical template-key types.
- [ ] Add contract tests rejecting embedded behavior payloads and preserving every referenced
      behavior resource ID required for later staging.
- [ ] Change landblock and env-cell commits to carry one dynamic install set per owner.
- [ ] Add classifier coverage for animation-only, script-only, both, and neither.
- [ ] Delete `CommitBundleSourceKind.Spawned` and its unreachable runtime branch; do not replace it
      with another commit-pipeline mutation bus.
- [ ] Replace `DynamicEntitySystem.install(owner, resident)` with an owner-atomic install/replace
      operation that supports one or many entities.
- [ ] Add generation-safe tests for multiple residents, replacement during preparation, eviction,
      and attachment lookup.

#### Acceptance Criteria

- One authored owner can install at least two promoted dynamics and remove both atomically.
- Animation-only, script-only, combined, and neither classifications are lossless. Phase 1 does not
  make script-only base presentations disappear before a script consumer exists.
- Replacing or evicting an owner while preparation is pending cannot publish resources or mutate
  nodes belonging to the old generation.
- Landblock commit bundles contain landblock work only; no dormant spawn producer/consumer remains.
- No template key contains an entity GUID, resident index, or placement.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 2: Add Shared Visual Template Preparation and Residency

Move reusable preparation above individual entity installation and make appearance changes atomic.

#### Deliverables

- Add an injected `ObjectVisualTemplatePreparer` that converts one resolved template source into
  complete geometry, material partitions, texture facts, and prepared part templates.
- Prepare a conservative base-appearance local AABB from complete part geometry and setup part
  transforms. Phase 4 extends the preparation closure with clip frames, reachable variants, and
  rotation-invariant hook modifiers before animation-backed activation.
- Add `ObjectVisualTemplateManager` with `preparing`, `ready`, and `failed` states, shared in-flight
  requests, owner leases, and deterministic release.
- Reuse `GeometryManager` and `ResidentTextureAtlas` for physical resource sharing and lifetime;
  do not add duplicate GPU caches inside the template manager.
- Replace first-material-only dynamic preparation with the same complete material partition policy
  used by static objects.
- Apply effective appearance during template preparation. Keep entity scale in mutable entity state
  and compose it into per-part instance transforms; differently scaled entities must share a visual
  template.
- Add an atomic entity operation that acquires a ready object template, switches the retained
  handle and part selection, then releases the previous handle.
- Add synchronous prepared part replacement by `PartVisualTemplateKey` for later hook dispatch.

#### Task Checklist

- [ ] Extract reusable object geometry/material preparation primitives from static-only naming
      where the result is genuinely shared.
- [ ] Define template preparation input, result, handle, and failure types.
- [ ] Deduplicate simultaneous requests for the same canonical key.
- [ ] Connect template leases to geometry and texture leases without creating split lifetime
      authority.
- [ ] Ensure failed preparation is visible and retry policy is explicit rather than implicit.
- [ ] Test identical entity acquisition, distinct appearance acquisition, atomic replacement,
      owner release, and failed/stale requests.

#### Acceptance Criteria

- Preparing 100 identical entity sources invokes the CPU preparer once and creates one set of
  geometry/material/texture resources.
- Two different effective appearances never alias one object template.
- Swapping A to B never exposes an entity with half of either template.
- A prepared A/B part oscillation performs no DAT decoding, geometry creation, texture preparation,
  or asynchronous work during the swap.
- Releasing one entity does not release resources still leased by another entity or authored layer.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 3: Render Dynamic Rigid Parts Through Frame-Streamed Instancing

Make instancing the first working dynamic draw path rather than introducing a disposable
non-instanced path.

#### Deliverables

- Rename or replace `StaticInstanceData` with a strategy-neutral object instance record containing
  the matrix and color/modifier values consumed by object shaders.
- Generalize `FrameInstanceStreamArena` metrics and call sites so opaque, cutout, and transparent
  dynamic populations can use it.
- Add a renderer-neutral dynamic part contribution containing template batch identity, resolved
  geometry/material draw partition, landblock/render scope, composed part-to-landblock transform,
  and per-instance modifiers.
- Gather visible dynamic part contributions after scene culling.
- Group opaque and cutout contributions by all draw-compatible facts and submit one instanced draw
  per group.
- Insert transparent contributions into global ordering and form only adjacent compatible instance
  runs after sorting.
- Preserve portal/render-domain and landblock-anchor boundaries; objects in different incompatible
  domains must not be batched merely because they share a template.
- Add dynamic-specific metrics for visible entities, visible part instances, frame upload count and
  bytes, cohort count, instanced draw count, and submitted instances.

#### Task Checklist

- [ ] Remove static-only vocabulary from the generic instance record and frame arena.
- [ ] Define a complete dynamic batch key and one comparison function owned by renderer policy.
- [ ] Consume scene-resolved part-to-landblock transforms without reconstructing pose composition in
      the renderer.
- [ ] Add dynamic contributions to the existing object pass rather than creating a parallel shader
      family.
- [ ] Extend transparent scheduling to admit both static and dynamic frame templates.
- [ ] Add synthetic renderer tests for identical, mixed-template, mixed-material, mixed-domain, and
      transparent dynamic populations.
- [ ] Extend the terrain browser harness with a checked-in numerous-rigid-parts fixture representing
      butterfly-like animated residents.

#### Acceptance Criteria

- One hundred identical one-part, one-material opaque dynamics in one compatible domain submit one
  instanced draw with 100 instances.
- One hundred identical two-part dynamics submit one draw per compatible part/material partition,
  not one draw per entity-part.
- Different per-entity part matrices remain in the same compatible cohort.
- A part-template replacement moves only that instance-part to the replacement cohort on the next
  frame.
- Transparent dynamics remain globally ordered; only adjacent compatible entries batch.
- No production dynamic renderer path loops into one `drawElements` call per entity-part.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 4: Prepare Shared Animation Resources

Land immutable animation transport, preparation, dependency, and lifetime contracts before adding
playback clocks or activating authored dynamics.

#### Deliverables

- Add a typed frontend animation asset contract carrying frame count, frame duration/rate, flat part
  transforms, position/root-motion frames, and normalized prepared hooks.
- Expose demand-loaded animation assets through the app-local Tauri content adapter, backed by the
  existing `ContentAssetRequest::Animation` service.
- Add `AnimationAssetRepository`, keyed by DAT animation ID, with shared in-flight preparation,
  explicit ready/failed state, acquired handles, and deterministic release.
- Define the prepared hook-command union required by the final evidence inventory. A replace-part
  command contains a prepared `PartVisualTemplateKey`, never a raw GfxObj ID.
- Define one `PreparedPlaybackSequence` contract that retains acquired animation/dependency handles
  and can later be driven by setup-default, resolved direct, or motion-plan selection.
- Extend object-template/default-behavior staging to prewarm default animation and transitive hook,
  part-template, and effect dependencies.
- Compute and retain a conservative local animation AABB spanning every prepared clip frame and part
  variant. `SetOmega` requires a rotation-invariant envelope; do not use exact sampled pose bounds.

#### Task Checklist

- [ ] Define the Tauri animation transfer format and avoid JSON arrays for large numeric frame data
      where the existing binary transport pattern applies.
- [ ] Prove source/feed contracts carry animation identity and playback selection only; frame/root
      arrays and normalized hooks enter the frontend exclusively through `AnimationAssetRepository`.
- [ ] Normalize raw animation hooks during preparation, not during sampling.
- [ ] Prewarm default animation plus its transitive visual dependencies while the owner revision is
      staging.
- [ ] Compute the clip/variant/hook-conservative local AABB during staging; assert that the real
      butterfly fixtures exceed their authored radius-zero setup spheres.
- [ ] Test simultaneous acquisition, shared failure, cancellation/replacement while preparing, and
      deterministic release.

#### Acceptance Criteria

- Simultaneously staging many entities for one animation performs one content transfer/preparation;
  releasing one handle cannot invalidate the prepared asset while another retains it.
- Prepared animation and hook commands contain every frame-time fact required by Phase 5 and perform
  no DAT decoding or dependency discovery when sampled/executed.
- The checked-in butterfly fixture has two alpha-tested parts using the same prepared GfxObj and
  render surface, with setup/animation variants matching `0x02000493` and `0x02000494`.
- Rotation and wing motion fit inside the prepared conservative local bound.
- Phase 4 adds no new playback clock and does not activate animation-backed authored residents before
  an execution consumer exists.

#### Decisions and Course Corrections

- 2026-07-31: Split immutable animation preparation from runtime playback so transport, repository
  lifetime, dependency closure, and conservative bounds land before four focused runtime systems.

### Phase 5: Execute Default Animation, Placement, Pose, and Hooks

Make the first production dynamic slice animate honestly: playback and hook crossing land together
before authored dynamics are activated.

#### Deliverables

- Implement pure clip time normalization, fractional visual pose evaluation, integer semantic frame
  selection, direction, loop, root-motion accumulation, and crossed-frame functions. Verify stepped
  semantic rules against retail/ACE; interpolation cannot alter hooks or root-motion semantics.
- Add `HookSystem` with deterministic queue ordering, direction/catch-up rules, generation-safe
  targets, bounded reentrancy, and exhaustive dispatch through narrow injected ports.
- Implement the visual mutation ports required by representative setup-default animations,
  specifically persistent `SetOmega` visual-root state, plus synchronous prepared part replacement
  as a synthetic focused-mutation contract.
- Extend `AnimationSystem` to own per-entity prepared playback state, advance semantic time, publish
  rigid-part pose and absolute root-track samples, and enqueue crossed commands exactly once. Its
  active driver is setup default or resolved direct in this phase; Phase 8 adds motion-plan input.
- Add `PlacementSystem` with one current `ScenePlacement` per world root. Seed authored residents
  from authored placement, sample root tracks at absolute time, trace dense portal topology,
  normalize outdoor landblocks, and atomically apply transform plus residency.
- Add `PoseSystem` with an explicit current-placement/attachment, visual-root, part-pose, and scale
  composite. Insert a visual-pose root below each scene root and apply transforms once before
  attachments and renderer collection. Phase 7 adds the named correction input.
- Evaluate active fractional poses at render time independently of semantic playback/hook cadence.
- Install the Phase 4 conservative bound before activation, route every authored root track through
  `PlacementSystem`, and activate authored dynamics only after the full prepared closure is ready.
- Keep animation phase per entity until evidence proves retail synchronization or offsets.

#### Task Checklist

- [ ] Prove retail stepped selection, looping, reverse playback, frame-boundary hook, catch-up,
      position-frame accumulation, static null-offset, and `SetOmega` semantics. Record the deliberate
      common frontend root-track path and prove interpolation changes presentation only.
- [ ] Define exhaustive playback, root-sample, placement/state, composed-pose, and portal-trace result
      types; do not use a generic transform-layer array or suppression boolean.
- [ ] Add focused prepared-mutation and pose-application ports to `DynamicEntitySystem` without
      exposing its internal maps.
- [ ] Move part-node application out of `AnimationSystem`; give `PoseSystem` one transaction that
      applies transforms and propagates attachments under the conservative root bound.
- [ ] Generalize the stateless camera portal trace for entity-origin placement, preserving
      multi-crossing and topology-unavailable fallback guarantees.
- [ ] Test ordering, catch-up, generation replacement, unsupported-command reporting, persistent
      `SetOmega`, and synthetic A/B prepared part replacement.
- [ ] Test independent entities sharing one clip, different anchors, higher render than authored
      cadence, and setup-default/direct playback without motion-plan state.
- [ ] Test a synthetic authored root track crossing multiple environment cells and an outdoor
      landblock, plus attachments and skipped pose evaluation.
- [ ] Replace animation-backed authored deferral with real owner-scoped activation.

#### Acceptance Criteria

- Representative animation-backed authored dynamics are installed and animated rather than
  deferred; identical butterflies share assets but retain independent playback.
- A 30 Hz clip renders fractionally at a higher cadence without double advancement or duplicate
  hooks; large deltas neither lose nor duplicate crossed hooks.
- Sampling and repeated prepared hooks perform no content transfer, DAT decoding, resource
  preparation, or asynchronous work.
- `AnimationSystem` does not mutate scene nodes, placement, residency, bounds, or resources;
  `PlacementSystem` alone mutates world-root transform/residency; `PoseSystem` owns neither playback
  nor placement.
- Root-moving authored animation uses the common placement/residency path; identity-root butterflies
  remain stationary from data rather than policy.
- `HookSystem` owns neither animation clocks nor entity visual resources.
- Default/direct animated entities have no motion-plan state but converge on the same animation,
  root-sample, pose, hook, and renderer paths.

#### Decisions and Course Corrections

- 2026-07-31: Narrowed `AnimationSystem` to playback/contribution production; `PoseSystem` is the
  sole explicit visual pose compositor/applicator.
- 2026-07-31: Separated current placement, visual-root modifiers, and rigid-part pose. Every root
  track uses `PlacementSystem`; the archive has no setup-default root translation today.
- 2026-07-31: Made fractional every-render evaluation the correctness baseline; distance policy may
  throttle pose only after measurement under conservative bounds.
- 2026-07-31: `SetOmega` is the only production Phase 5 hook consumer in the archive census and
  requires the Phase 4 rotation-invariant envelope.

### Phase 6: Resteer on Real Authored Dynamics

Validate the architecture using the real workload that justified it before adding runtime ingress,
motion selection, and physics scripts.

#### Task Checklist

- [ ] Run the representative dense authored workload identified by the final evidence gate and record
      template, animation, hook, upload, draw, and frame-time diagnostics.
- [ ] Compare the checked-in fixture with both real 90-frame, two-part, alpha-tested butterfly setups
      and confirm that shared part/material resources do not collapse distinct object/clip identity.
- [ ] Verify that dynamic batch identity has no entity-specific fields.
- [ ] Verify that entity, template, and renderer code do not own duplicate material or texture
      lifetime.
- [ ] Inspect whether animation sampling or scene-node propagation dominates frame cost; do not add a
      bypass unless measurement identifies the bottleneck and attachment/spatial guarantees have
      named replacements.
- [ ] Compare every-render fractional pose evaluation with the legacy near/mid/far cadence under the
      representative workload. If reduced cadence is justified, choose new thresholds from measured
      cost and visual error rather than copying `64`, `128`, `50 ms`, or `150 ms`.
- [ ] Verify any proposed skipped-pose path retains conservative animation bounds and advances
      playback/hooks continuously; stale exact bounds are not a valid culling guarantee.
- [ ] Exercise the synthetic root-moving authored resident through dense portal topology and confirm
      that current residency changes without transferring its source-owner lifetime.
- [ ] Dry-run Phases 7-11 against the implemented contracts and update this document before continuing
      if preparation, ingress, playback, or script boundaries differ.

#### Acceptance Criteria

- Template preparation and draw counts scale with unique visual/batch identities, while instance
  upload and pose work scale with visible part instances.
- Representative authored dynamics animate with no dropped required hook behavior or renderer-side
  readiness recovery.
- Higher-than-authored render cadence is smooth near the camera, and the resteer records whether a
  measured distance-based pose policy belongs in a later phase.
- The remaining phases require no alternate render path, visual-resource model, or hook dispatcher.
- Any course correction is recorded in this document before implementation continues.

#### Decisions and Course Corrections

- 2026-07-31: Added an explicit comparison against legacy distance cadence. Legacy constants are
  evidence, not defaults; any new thresholds require workload measurements and a spatial guarantee.

### Phase 7: Add Consumed Runtime Ingress and Sparse Placement Projection

Prove the decided spawn/mutation shape without pretending this app already contains a Rust protocol
client.

#### Deliverables

- Add a frontend `DynamicEntityFeed` port accepting an initial resolved snapshot and exhaustive
  ordered `ResolvedDynamicEntityDelta` values.
- Cover spawn, despawn, sparse `PlacementAnchor`, attachment, scale, focused visual replacement,
  complete generation replacement, resolved direct-playback changes, and optional already-resolved
  motion-plan changes.
- Define `PlacementAnchor` as complete pose/residency, sample time, placement revision, entity
  generation, and continuous/discontinuous correction kind. Do not introduce parallel frontend
  authoritative/presentation residency fields; it seeds or rebases the one current
  `ScenePlacement`.
- Define `ResolvedMotionPlan` as revision/effective time plus ordered finite/repeating phases, each
  pairing animation ID/frame-range/rate steps with its resolved velocity/omega. Do not call this a
  “motion segment” or carry raw motion-table keys that the frontend would have to reinterpret.
- Keep snapshot/delta values referential. They may inline the small selected motion plan, but never
  animation frames, scripts, script tables, motion catalogs, geometry, or material payloads.
- Add a frontend `MotionSystem` that stages prepared dependencies and installs already-resolved plans;
  it does not resolve DAT motion tables. Extend `PlacementSystem` to sample plan velocity/omega and
  animation root tracks from the anchor at absolute time.
- Represent playback selection as a discriminated capability input. A direct-playback delta routes
  to the common prepared playback contract, while a motion-plan delta activates `MotionSystem`; stop
  or driver replacement removes only the state owned by the previous driver.
- Add named continuous correction state below the current scene root and above visual/part pose;
  discontinuities, generation changes, attachment changes, and incompatible residency corrections
  snap atomically.
- Add a checked-in synthetic producer that drives the same feed through `GameRuntime`; it is the
  concrete consumer that keeps this seam honest.
- Add distinct diagnostics for accepted/rejected plan revisions, accepted anchors, continuous
  corrections, discontinuous snaps, portal crossings, and unresolved topology. Each counter must
  differ in at least one checked-in correction/traversal scenario.
- Preserve retail's two replacement modes in frontend behavior:
  - focused appearance replacement acquires and atomically swaps templates while retaining entity
    root, attachment, and compatible playback state;
  - complete replacement creates a new installed generation and removes old topology, playback,
    hooks, and leases.
- Document the future production mapping:
  `Rust session -> holtburger-world MotionCatalog/MotionResolver -> sparse anchors/resolved plans ->
Tauri adapter -> DynamicEntityFeed`.
- Do not add feed-specific Rust DTOs, Tauri events/commands, world message handlers, or session
  dependencies until a real Rust client host consumes them. Phase 8 may change shared motion
  resolution because today's host projection is already a real consumer.

#### Task Checklist

- [ ] Define snapshot/delta, `PlacementAnchor`, host-time mapping, and `ResolvedMotionPlan` types with
      one named runtime consumer for every field.
- [ ] Route the feed through `GameRuntime` without exposing system internals.
- [ ] Create synthetic repeated-monster, focused appearance, complete replacement, attachment, stale
      generation, direct-animation-without-motion-table, and despawn-during-preparation scenarios.
- [ ] Add a sparse-anchor fixture: one plan update drives many render frames, crosses several local
      portal cells, receives a small continuous rebase, and later receives a discontinuous snap.
- [ ] Prove endpoint placement is sampled from absolute anchor time rather than accumulated render
      deltas, while residency traces incrementally from the previous presented point.
- [ ] Ensure resolved appearance/template identity enters the port once and is not reconstructed from
      WCID or frontend heuristics.
- [ ] Assert that repeated entity DTOs reference shared asset IDs and do not scale transport with
      animation-frame or script payload size.
- [ ] Document the future ObjDesc-to-focused-replacement and UpdateObject-to-generation-replacement
      mapping without implementing an unused Rust adapter.

#### Acceptance Criteria

- A synthetic resolved spawn produces one rendered dynamic entity and despawn removes its nodes,
  playback, pending work, and leases.
- Authored install sets and runtime feed spawns call the same per-entity installation primitive;
  their different owners decide lifetime without forking rendering or behavior.
- Repeated identical monster spawns share one template and compatible render cohorts.
- A runtime entity can start, replace, and stop resolved direct playback without acquiring
  motion-table or `MotionSystem` state.
- Runtime motion remains smooth across render frames without per-frame feed traffic; a new anchor or
  plan revision deterministically rebases the same current `ScenePlacement`.
- The frontend scene graph stores one current residency per root. Anchor provenance exists only in
  placement projection state and cannot become a second visibility truth.
- One placement sample may traverse multiple environment-cell portals; unavailable/ambiguous
  topology retains the previous proven residency and reports the failure rather than guessing.
- Focused replacement preserves the entity root and attachments.
- Complete replacement cannot leave old part nodes, animation state, queued hooks, or leases alive.
- The feed is consumed by the runtime and fixtures; no dormant Rust/Tauri boundary is added.
- The frontend never reconstructs authoritative visual state from WCID heuristics.

#### Decisions and Course Corrections

- 2026-07-31: Runtime ingress uses sparse placement anchors plus resolved motion-plan changes rather
  than per-frame transforms. The frontend owns motion-derived current placement and portal residency;
  the host periodically rebases it.

### Phase 8: Build the Host Motion Catalog and Resolve Shared Plans

Resolve AC motion semantics once for both existing host projection and future 3D presentation without
turning the frontend into a second motion-table interpreter.

#### Deliverables

- Replace the reduced `MotionKinematics` bootstrap asset with an honestly named `MotionCatalog` in a
  clean cutover, preserving its process-wide `Arc` retention while adding setup defaults, styles,
  cycles, modifiers, links, animation ranges/rates, and per-record kinematics.
- Add a pure `holtburger-world` `MotionResolver` that converts the parsed `MotionCatalog`,
  current style/commands/speeds, previous resolved plan, and effective host time into one
  `ResolvedMotionPlan` containing ordered finite/repeating phases whose playback steps and
  velocity/omega come from the same resolved `MotionData` records.
- Keep `holtburger-content` responsible for discovering/assembling the catalog and
  `holtburger-world` responsible for consuming parsed bootstrap semantics; do not move archive paths
  or discovery policy into world/core.
- Migrate existing host grounded projection to consume the kinematics from the same resolved plan;
  consumers never separately re-derive command velocity/omega.
- Keep host spatial ticking selective: resolving/emitting a plan change is cheap and event-driven,
  while collision/gameplay projection may ignore non-relevant bodies. A future adapter sends the
  plan once and lets frontend `MotionSystem`/`PlacementSystem` sample it until replacement.
- Keep frontend `MotionSystem` to plan installation, preparation, sequencing, and generation-safe
  replacement. `AnimationSystem` executes prepared playback and emits part/root samples;
  `PlacementSystem` consumes root samples plus plan kinematics and owns current residency.
- Activate this path only for entities carrying resolved motion-table state. Setup-default, direct
  playback, and physics-script-only entities do not call the resolver or retain placeholder plan
  state.
- Preload newly selected clips and required hook dependencies before switching, with explicit
  pending/failure state rather than frame-time I/O.
- Preserve deterministic transition and interruption semantics proven from retail/ACE.

#### Task Checklist

- [ ] Prove style-default, cycle, modifier, transition, interruption, and root-velocity selection
      rules from retail, ACE, and the existing motion-table model.
- [ ] Prove the exact phase handoff rule when a finite link completes and a repeating cycle begins;
      host projection and frontend playback must switch kinematics and animation on the same
      semantic boundary.
- [ ] Prove how animation position frames combine with motion-data velocity/omega across transitions,
      reversal, cycle seams, and speed scaling; do not add an authored/runtime suppression mode.
- [ ] Define one complete `ResolvedMotionPlan` contract and delete “motion segment” vocabulary;
      consumers do not re-derive table lookups or kinematics.
- [ ] Sweep `MotionKinematics` vocabulary from the derived resource, bootstrap fields, builders,
      diagnostics, and tests in the same clean cutover to `MotionCatalog`.
- [ ] Test that the host kinematics consumer and frontend playback/placement contract consume the
      same resolver result, including one-difference-at-a-time style, speed, link, and modifier cases.
- [ ] Test default cycles, transitions, interruption, missing clip failure, repeated entities sharing
      clips, sparse-anchor continuation, and generation replacement during a transition.

#### Acceptance Criteria

- Runtime entities transition among resolved motion sequences without changing visual-template or
  render-batch identity.
- Frontend motion-plan installation performs no DAT decoding or raw motion-table interpretation and
  does not directly mutate part nodes or scene placement.
- No motion-table/catalog payload crosses the frontend feed or content adapter; the frontend sees
  only selected plan phases and referenced animation IDs.
- Non-motion-table animated and script-only entities neither invoke `MotionResolver` nor allocate
  `ResolvedMotionPlan`/`MotionSystem` state.
- A stale motion delta or clip completion cannot mutate a replaced entity generation.
- Motion-table selection and kinematic facts are computed once in the shared resolver. Animation
  samples authored root data, and `PlacementSystem` combines it with those facts without
  provenance-based suppression.
- Root motion, velocity, and omega cross current scene residency only through `PlacementSystem`;
  `PoseSystem` cannot independently move an entity between cells or landblocks.
- Host traffic scales with anchors and plan changes, not host simulation ticks or frontend render
  frames.

#### Decisions and Course Corrections

- 2026-07-31: Replaced frontend motion-table selection with shared `ResolvedMotionPlan` resolution.
  The frontend owns plan execution and one current motion-derived `ScenePlacement`; sparse host
  anchors correct it without introducing a second frontend residency.

### Phase 9: Prepare Shared Physics-Script Resources

Build the frontend's immutable script warehouse and dependency closure before introducing another
clocked runtime producer.

#### Deliverables

- Finish typed decoding for supported animation hook payloads in `holtburger-dat`, retaining source
  provenance and failing loudly where payload boundaries or dependencies remain unproven.
- Add `PhysicsScript` and `PhysicsScriptTable` DAT models based on ACE layouts and expose them through
  `holtburger-content`/`ContentAssetRequest` plus typed compact Tauri transfer payloads.
- Add typed `PhysicsScriptAssetRepository` and `PhysicsScriptTableRepository` instances with shared
  in-flight preparation, ready/failed state, acquired handles, and deterministic release.
- Compile physics-script records into immutable timed sequences of the same prepared hook-command
  union animation already uses. Prepared table records retain proven type/intensity selection.
- Enumerate setup default scripts, table-selected scripts, hook references, `CallPES` edges, and
  transitive visual/effect dependencies during staging. Closure traversal records already-visited
  nodes without rejecting cycles.
- Extend object-template/default-behavior staging to acquire the prepared script/table closure, but
  retain the working static base presentation until Phase 10 supplies an execution consumer.

#### Task Checklist

- [ ] Cross-reference every decoded script/table field, selection rule, and dependency edge with ACE
      and retail.
- [ ] Define typed repository keys, handles, preparation failures, transfer payloads, and release
      ownership with one named consumer for every field.
- [ ] Enumerate transitive hook/script dependencies with terminating cycle detection while preserving
      cyclic runtime edges.
- [ ] Test simultaneous acquisition, shared failure, cancellation/replacement while preparing,
      deterministic release, direct script IDs, and type/intensity table selections.
- [ ] Assert entity source/feed DTOs carry script/table identity and activation facts only; decoded
      timelines and table maps enter through their repositories.

#### Acceptance Criteria

- Preparing one script/table dependency closure for many entities performs one content transfer and
  one compilation per unique resource ID.
- Prepared scripts contain timed prepared commands and perform no DAT decoding, resource lookup, or
  visual preparation when later executed.
- Prepared tables reproduce every proven retail/ACE type/intensity selection case.
- The four representative self-calling scripts form a finite preparation closure while retaining
  their cyclic `CallPES` edges for Phase 10 execution.
- Phase 9 introduces no `PhysicsScriptSystem`, script clock, or fake execution consumer; script-only
  residents keep their valid static base presentation.

#### Decisions and Course Corrections

- 2026-07-31: Split immutable script/table preparation from runtime execution so repository lifetime,
  dependency closure, and transfer contracts land before clocks and visual consumers.

### Phase 10: Execute Physics Scripts and Expand Hook Consumers

Complete static default behavior and the second timed hook producer without turning
`AnimationSystem` or `HookSystem` into a god system.

#### Deliverables

- Add `PhysicsScriptSystem` with independent per-entity clocks, intensity/state, script chaining,
  scheduled cyclic `CallPES`, and generation-safe targets.
- Feed prepared script commands into the existing `HookSystem`; execution receives acquired handles
  and never requests or prepares content.
- Expand visual consumers for the proven hook inventory: visibility,
  translucency/luminosity/diffusion, scale, omega, texture velocity, and any other required visual
  command.
- Add typed ports for audio, particles, and lighting. A missing rich consumer reports unsupported
  execution with provenance; it does not disappear silently.
- Atomically promote script-only authored residents from their retained static base presentation
  after required script, table, hook, and transitive dependencies are ready.

#### Task Checklist

- [ ] Cross-reference every implemented hook/script execution and timing rule with ACE and retail.
- [ ] Test independent animation/script clocks, ordering at equal times, reentrancy bounds, script
      chaining, timed modifiers, teardown, and generation replacement.
- [ ] Test repeated scheduled `CallPES` separately from synchronous dispatch reentrancy limits.
- [ ] Replace script-only authored deferral with real owner-scoped activation.

#### Acceptance Criteria

- Animation and physics scripts emit the same prepared command representation into the existing
  `HookSystem`.
- Physics-script-only entities run without `MotionResolver`, `ResolvedMotionPlan`, or
  `AnimationSystem` state unless another independent capability actually requires them.
- Script-only static-authored residents are promoted, installed, and updated rather than baked
  static or permanently deferred.
- One hook cannot mutate an entity generation that has been replaced or removed.
- Script and hook execution performs no raw DAT decoding, content transfer, repository miss, or
  visual-resource preparation.
- The four representative self-calling scripts repeat through scheduled `CallPES` without infinite
  synchronous recursion or being rejected as invalid content.
- `HookSystem` does not own visual resources, animation state, physics-script clocks, particles,
  lighting, or audio state.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 11: Resteer Against Retail and Representative Workloads

Audit behavior, resource sharing, and cost before cleanup or any broader client-host project.

#### Task Checklist

- [ ] Compare default-animation, default-script, motion transition, hook crossing, focused
      replacement, and complete replacement behavior against retail/ACE references.
- [ ] Exercise representative numerous authored dynamics, repeated synthetic monster spawns,
      appearance changes, attachments, part-replacement hooks, sparse anchor corrections, and
      root-motion crossings through dense portal topology.
- [ ] Confirm template and prepared behavior-asset counts track effective appearances and unique
      animation/script/table IDs rather than entities.
- [ ] Confirm dynamic draw counts track compatible part/material cohorts rather than entities.
- [ ] Measure semantic playback, fractional pose evaluation, absolute placement sampling, portal
      traversal, pose composition/application, physics scripts, hook dispatch, scene transform
      propagation, visibility collection, instance upload, and drawing separately.
- [ ] Measure source/feed DTO bytes separately from content-asset transfer bytes and prove repeated
      spawns do not retransmit animation frames, scripts, tables, or motion catalogs.
- [ ] Confirm plan/anchor traffic scales with semantic changes and corrections rather than host
      simulation ticks, render frames, or cell crossings.
- [ ] Decide from measurements whether distance-based pose cadence, shared phase cohorts, pose
      caching, resolved-motion-program sharing, or worker sampling has a concrete consumer and
      meaningful benefit.
- [ ] Record remaining semantic gaps and the explicit handoff for the future Rust client host.

#### Acceptance Criteria

- No unresolved correctness question is hidden behind a performance shortcut.
- Any proposed optimization names the measured bottleneck and preserves attachment, culling,
  ordering, hooks, and resource-lifetime guarantees.
- The frontend ingress contract is sufficient for a future production adapter without containing
  dormant adapter-specific fields or embedded immutable resource payloads.
- Remaining work is either incorporated into this plan or explicitly documented as out of scope.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 12: Cleanup and Architectural Cutover

Remove the scaffolding and vocabulary made obsolete by the completed runtime.

#### Deliverables

- Delete `InlineDynamicVisualPreparer` and per-entity visual preparation.
- Delete the static-authored dynamic deferral diagnostics and activate every supported promoted
  resident.
- Remove static-only naming from instance records and frame-stream infrastructure now shared by
  static and dynamic objects.
- Remove legacy-style dynamic resource/instance contracts if any temporary copies were introduced;
  retain one template/entity/submission vocabulary.
- Delete hollow tests that assert stubs or deferred behavior and replace them with behavioral tests.
- Update `apps/holtburger-3d` architecture documentation and relevant completed plan status.
- Sweep deleted or renamed concepts from diagnostics, explorer labels, comments, tests, and docs.

#### Task Checklist

- [ ] Search for `deferred`, `future playback`, `visibleDynamics` placeholder wording,
      `DynamicVisualPreparer`, `MotionKinematics`, static-only frame-instance vocabulary, vague
      `motion segment` terminology, parallel frontend residency, frontend raw motion-table
      interpretation, and behavior payloads embedded in entity DTOs.
- [ ] Verify every template/resource field has a named consumer.
- [ ] Verify every metric differs from another metric in at least one covered scenario.
- [ ] Run formatter, type checks, lint, tests, Rust checks, and the terrain browser harness.
- [ ] Perform a final architecture audit of world/content/core/app and system/renderer boundaries.

#### Acceptance Criteria

- No production path counts and discards dynamic renderables.
- No promoted resident remains deferred solely because it has a supported setup default animation
  or default physics script.
- No entity installation performs duplicate visual or behavior-resource preparation for an already
  preparing/ready key.
- No obsolete dynamic placeholder or reduced motion-kinematics vocabulary survives in source,
  tests, diagnostics, or UI.
- Touched code passes formatting, TypeScript checks, ESLint/Knip, Vitest, Rust checks, and Clippy with
  warnings denied.

#### Decisions and Course Corrections

- Pending implementation.

## Verification Strategy

### Checked-In Synthetic Fixtures

- Two-part alpha-tested butterfly cohorts modeled on setups `0x02000493` and `0x02000494`, sharing
  GfxObj/material resources while retaining distinct clips and independently changing transforms.
- Two compatible wing parts proving one instanced draw can contain both part instances from every
  visible butterfly rather than splitting by entity or authored part index.
- Transparent animated cohort proving global ordering and adjacent-run batching.
- Mixed appearances sharing setup geometry but not object templates.
- Repeated identical runtime monsters sharing templates and clips while using different poses.
- One 30 Hz clip evaluated at a 60 Hz render cadence without duplicate hook dispatch.
- Setup-default and resolved-direct animated entities proving both use the common playback path
  without motion-table, `ResolvedMotionPlan`, or `MotionSystem` state.
- Many entities sharing one prepared physics script/table closure while retaining independent script
  clocks and generation-safe targets.
- Repeated spawn/feed records proving behavior payload bytes remain in typed asset transfers rather
  than scaling with entity DTO count.
- Identical animation poses layered over different current scene placements.
- Root-moving authored default animation crossing multiple dense environment cells and an outdoor
  landblock through the same `PlacementSystem` used by runtime entities.
- Sparse runtime anchor plus `ResolvedMotionPlan` driving many render frames, a continuous
  correction, and a discontinuous snap without parallel frontend residency fields.
- Ambiguous/unavailable portal topology retaining previous proven residency with attributable
  diagnostics.
- Skipped pose evaluations proving playback/hooks continue and conservative bounds remain valid.
- A/B part replacement hook moving one instance between cohorts.
- Focused resolved visual replacement preserving entity identity.
- Complete resolved generation replacement removing old topology and playback state.

Fixtures must be source-first and must not require DAT archives that are absent from the repository.

### Commands

Run through the repository-selected package manager:

- `npm --prefix apps/holtburger-3d run format:check`.
- `npm --prefix apps/holtburger-3d run check`.
- `npm --prefix apps/holtburger-3d run lint`.
- `npm --prefix apps/holtburger-3d run test:ts`.
- `npm --prefix apps/holtburger-3d run check:rust`.
- `npm --prefix apps/holtburger-3d run harness:terrain` for the checked-in browser fixture.
- Relevant workspace Rust tests for `holtburger-dat`, `holtburger-content`, `holtburger-world`, and
  `holtburger-core` whenever those crates are touched.

## Risks and Mitigations

### Template Keys Omit an Output-Affecting Fact

Two visually different entities could alias one template. Construct the key from the canonical
resolved appearance result, test one-difference-at-a-time cases, and never let renderer consumers
append their own identity derivation.

### Split Resource Lifetime Authority

A template manager that independently owns GPU objects would conflict with geometry and atlas
leases. Keep the template manager responsible for semantic preparation state and dependency leases;
existing managers remain the only physical resource authorities.

### Entity DTOs Become Immutable Resource Containers

Embedding animation frames, scripts, tables, or motion catalogs in spawn/update DTOs would make
transport and memory scale with entity count while bypassing shared preparation. Keep DTOs
referential, measure feed bytes separately from asset-transfer bytes, and reject embedded behavior
payloads in contract tests. A `ResolvedMotionPlan` is the deliberate exception only for its small
entity-specific selected schedule; its referenced animation payloads remain shared assets.

### Typed Behavior Repositories Collapse into a Generic Cache

Animation, scripts, and script tables share mechanical in-flight/handle states but not keys,
preparation, dependency graphs, or failure semantics. Keep typed repositories and extract only a
proven stateless lifecycle primitive. An untyped behavior-resource union would trade a few repeated
lines for runtime branching and dishonest ownership.

### Dynamic Instancing Breaks Ordering or Portal Domains

Batching across incompatible domains or before transparency sorting would be incorrect. Include
domain and render state in compatibility, group opaque/cutout contributions freely, and form
transparent runs only after global ordering.

### Scene-Node Transform Propagation Becomes the Bottleneck

Numerous animated rigid parts update scene nodes for attachment and spatial correctness. Measure
before bypassing that path. If a render-only transform stream is later needed, explicitly replace
the attachment, culling, and spatial-update guarantees rather than silently forking transforms.

### Pose Composition Becomes Generic Transform Soup

An arbitrary list of weighted layers would hide AC's meaningful composition order and invite every
system to smuggle in transforms. Keep a closed composite with named current placement, optional
continuous correction, visual-root modifier, rigid-part pose, and scale fields. Add a field only
with evidence and a named producer/consumer.

### Motion Placement Drifts or Applies Root Movement Twice

Incremental render-delta integration would drift, and independently applying host-projected movement
plus animation root data could double movement. Sample each endpoint from absolute anchor/plan time;
each resolved phase pairs velocity/omega with its playback steps, `AnimationSystem` samples root
data once, and only `PlacementSystem` composes them into current placement. New anchors rebase that
projection.

### Optional Capabilities Collapse into Placeholder State

Forcing every animated entity through `MotionResolver` would invent motion-table state for authored
defaults, direct clips, and script-only objects, then spread meaningless optionals through every
system. Use exhaustive playback-driver and capability-state unions, construct `MotionSystem` state
only from a real resolved plan, and test non-motion animation and physics scripts without resolver
invocation.

### Dense or Unavailable Portal Topology Produces Wrong Residency

Endpoint containment alone cannot identify a route through overlapping dense cells. Trace every
previous-point-to-endpoint segment through directed apertures and allow multiple crossings. On
missing or ambiguous topology, retain the previous proven residency with attributable diagnostics
until a later trace or anchor rebases it; never guess a nearby cell.

### Moving Authored Residents Outlive Their Source Interest Incorrectly

Authored origin owns lifetime even when animation root motion changes current residency. The shipped
default-animation archive has no translational root track, so do not invent ownership transfer now.
Exercise the synthetic moving fixture and, if real content later moves beyond origin interest,
define a roaming lifetime owner from that evidence rather than suppressing motion.

### Pose Cadence Drops Hooks or Invalidates Culling

Camera distance is presentation policy, while playback and hooks are semantic state. Keep playback
advancement independent, and require any skipped-pose optimization to retain conservative animation
bounds. Do not copy legacy thresholds until representative measurements quantify CPU benefit and
visible error.

### Asset Preparation Arrives After Entity Replacement

Asynchronous completions could publish stale visuals. Tag requests with owner/entity generations,
validate before activation, and release stale handles without mutating current state.

### Hook Dependency Closure Is Incomplete or Recurses Forever

An unprepared replacement would introduce frame-time I/O or missed effects. Enumerate dependencies
from typed hook/script records with a visited set. Cyclic `CallPES` graphs are shipped content and
must remain executable; fail staging only when a referenced dependency cannot be prepared, with full
provenance. Bound synchronous dispatch reentrancy separately from scheduled script repetition.

### A Future Adapter and the Frontend Re-Derive Different Visual State

If the frontend infers setup or appearance from WCID/property fragments, a future server adapter
will drift from it. Require `DynamicEntityFeed` inputs to contain resolved visual/template identity.
Likewise, the frontend must not reinterpret raw motion-table keys. When the Rust client host exists,
it must retain authoritative world visual/motion state, resolve visual identity and
`ResolvedMotionPlan` once through shared behavior, and carry those results through the adapter.

### The Plan Creates a Ceremonial Client Boundary

Unused Rust DTOs or Tauri commands would preserve no guarantee and would likely rot before client
mode exists. Keep the future flow documented, implement only the consumed frontend feed and
synthetic producer, and add the production adapter in the client-host project that can exercise it.

### Default Animation Phase Is Assumed Incorrectly

Sharing one clip does not prove synchronized playback. Keep per-entity time initially and only add
phase sharing after retail evidence and profiling justify it.

### The Hook System Becomes a God System

Keep it to ordering and exhaustive dispatch through typed ports. Animation, scripts, visual state,
resources, particles, lighting, and audio retain their own ownership and clocks.

## Definition of Done

- [ ] Static-authored outdoor and env-cell residents with supported default animation or default
      physics scripts are installed and updated rather than deferred.
- [ ] Resolved runtime entities are spawned, updated, attached, visually replaced, generation
      replaced, and despawned through the consumed `DynamicEntityFeed` and checked-in producer.
- [ ] Identical appearances share one in-flight/ready visual template across authored and runtime
      origins.
- [ ] Different effective appearances never alias accidentally.
- [ ] Animation and physics-script playback consume shared prepared assets and emit deterministic
      prepared hooks.
- [ ] Entity sources, runtime snapshots, and deltas contain behavior IDs/selections/timing rather
      than decoded animation, script, table, motion-catalog, geometry, or material payloads.
- [ ] `AnimationAssetRepository`, `PhysicsScriptAssetRepository`, and
      `PhysicsScriptTableRepository` deduplicate in-flight work, expose explicit failure, and retain
      prepared resources until the final staged/active handle releases them.
- [ ] For motion-table-driven entities, shared `MotionResolver` produces one `ResolvedMotionPlan`
      consumed by existing host kinematics and frontend motion playback/placement without either
      side re-deriving table facts.
- [ ] One host-pinned `MotionCatalog` replaces the reduced `MotionKinematics` resource; no raw or
      compiled motion-table catalog becomes a frontend asset.
- [ ] Setup-default and resolved-direct animation use the same prepared playback execution without
      invoking `MotionResolver` or allocating placeholder plan/`MotionSystem` state; physics scripts
      remain independently clocked.
- [ ] `DynamicEntitySystem` owns only transactional presentation-aggregate lifecycle and
      generation-safe state access; `GameRuntime` coordinates focused-system activation and complete
      teardown.
- [ ] Sparse `PlacementAnchor` and plan changes drive smooth frontend motion across many render
      frames; feed traffic does not scale with render cadence or dense cell crossings.
- [ ] `AnimationSystem` owns playback and part/root sampling without mutating scene nodes, placement,
      residency, bounds, or resource state.
- [ ] `PlacementSystem` owns exactly one current root `ScenePlacement`, composes anchor, plan
      kinematics, and animation root track at absolute time, and resolves dense portal/landblock
      residency locally.
- [ ] Authored and runtime entities use the same root-motion placement path; origin changes lifetime
      and sparse correction sources rather than animation capability.
- [ ] `PoseSystem` consumes the current scene root and applies correction, visual-root, rigid-part,
      and scale transforms once without rewriting placement, before attachment, visibility, and
      rendering consumers observe them.
- [ ] Each active template supplies a conservative local AABB covering prepared clips, variants,
      part scale, and unbounded visual-root rotation; culling never relies on radius-zero authored
      butterfly spheres or stale exact poses.
- [ ] Authored clips render with fractional interpolation above their sample rate without changing
      semantic playback or duplicating crossed hooks.
- [ ] Camera-distance pose policy, if measurements justify one, cannot pause playback/hooks or use
      stale exact bounds as its culling guarantee.
- [ ] Part replacement and other implemented visual hooks perform no frame-time asset preparation.
- [ ] Opaque/cutout dynamic parts use frame-streamed GPU instancing by compatible cohort.
- [ ] Transparent dynamic parts preserve ordering and batch only in compatible adjacent runs.
- [ ] Numerous identical butterflies and monsters have draw counts proportional to compatible part
      cohorts, not entity count.
- [ ] Focused resolved visual changes preserve entity identity; complete generation changes remove
      the old entity generation without leaked nodes, state, or resources.
- [ ] Attachments follow animated part nodes before visibility collection and rendering.
- [ ] Attached entities inherit ancestor residency; ambiguous or unavailable portal traces retain
      the prior proven root residency rather than guessing.
- [ ] Diagnostics separately expose templates, prepared animation/script/table resources,
      entities, part instances, uploads, cohorts, draws, feed/asset-transfer bytes, preparation
      failures, plan revision outcomes, anchor/correction kinds, portal crossings, and unresolved
      topology, with a distinct scenario for every metric.
- [ ] No unconsumed client stub, supported deferred-dynamic path, per-entity preparer, or
      count-and-discard renderer path remains.
- [ ] All touched TypeScript/Svelte and Rust code passes formatting, checking, linting, tests, and
      Clippy with warnings denied.
- [ ] Architecture documentation describes the landed contracts and ownership boundaries.

## Open Questions

These are evidence tasks, not choices to settle by intuition:

1. What exact clock and phase does retail use when setup-default animation begins for static
   animating objects entering interest, and how does its static update cadence define `SetOmega`
   integration?
2. Which hook types execute while seeking/catching up, and how does reverse playback order them?
3. How does retail accumulate animation position frames with motion-data velocity/omega across
   sequence transitions, reversal, cycle seams, and speed changes, and which parts of that math are
   required for host gameplay projection versus frontend presentation placement?
4. Which server sequence field gates `ObjDescEvent`, and what state survives a focused visual change
   versus a complete `UpdateObject` recreation?
5. Which physics-script-table keys and intensity rules are exercised by shipped content?
6. Does per-instance picking require extending the initial matrix/color instance record, or can the
   existing scene selection pass remain separate without duplicate geometry submission?
7. After the first butterfly performance measurement, is fractional pose evaluation or scene-node
   propagation significant enough to justify distance cadence, shared-phase evaluation, pose
   caching, or worker sampling, and does the prepared conservative envelope make that policy safe
   without excessive false-positive visibility?
8. What monotonic/server-time mapping should `PlacementAnchor` and `ResolvedMotionPlan` use across a
   future Tauri adapter so absolute frontend sampling survives latency and clock resynchronization?
9. Does retail assign an object's environment-cell residency from its position origin or a collision
   extent during movement, and which topology-unavailable fallback best matches presentation needs?

Question 4 is a handoff requirement for the future Rust client-host plan. It does not authorize or
block dormant protocol/world/Tauri implementation in this plan.
